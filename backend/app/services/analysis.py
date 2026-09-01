"""Orchestrator: ties audio → alignment → classification into `analyze()`.

Public entry point for Batch 3. Synchronous by design — Batch 4 wraps
this in FastAPI `BackgroundTasks` (and later Celery). The return value is
a Pydantic model so it serializes to the `analyses.result_json` column
cleanly and deterministically.

Flow (spec §4 pseudocode):
    load → pre-emphasis → onset detect → expected onsets → DTW →
    (bail if broken) → fuzzy match → deltas → bands → trend → verdict
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from app.services import audio as audio_svc
from app.services.alignment import (
    align_take,
    AlignmentResult,
    apply_fuzzy_match,
    build_timeline,
    is_alignment_broken,
    closest_expected_gap,
)
from app.services.audio_config import AudioConfig, load_audio_config
from app.services.classification import (
    Band,
    Delta,
    Direction,
    compute_deltas,
    generate_verdict,
    rolling_trend,
)
from app.services.score_schema import ScoreJson, tempo_change_spans

Status = Literal["ok", "alignment_failed", "no_onsets"]


class PerNote(BaseModel):
    global_index: int
    measure_number: int
    delta_ms: float
    delta_pct: float
    band: Band
    direction: Direction
    is_slur_interior: bool
    #: This note's deviation was measured against a time the page states —
    #: see `classification.Delta.timed`. False for a `rit.`, a fermata, an
    #: ornament and the note it decorates.
    timed: bool = True
    #: A written tempo change covers this note's measure, so `band` and
    #: `direction` are `on` by refusal rather than by measurement — see
    #: `classification.Delta`.
    under_tempo_change: bool = False
    #: The change lurched at this note instead of flowing.
    uneven: bool = False


class PerMeasure(BaseModel):
    measure_number: int
    note_count: int
    #: The mean deviation of the notes that were **timed**.
    #:
    #: A bar with one grace note in it used to average that note's deviation in
    #: with the rest — and its "expected" time is `ORNAMENT_SHARE` splitting the
    #: difference between two readings an engraver may have meant, a number this
    #: code invented. The app draws this as the bar's deviation, so one ornament
    #: moved a bar's whole reading. `worst_band` never had the problem, because
    #: an untimed note's band is `on`.
    avg_delta_pct: float
    #: How many of `note_count` were actually measured.
    #:
    #: `None` on a result stored before this field existed — read as "all of
    #: them", which is what those rows meant. Zero means the bar was not timed
    #: at all and `avg_delta_pct` falls back to the whole bar, because a field
    #: that is sometimes absent is worse than one that is sometimes unjudged.
    timed_note_count: int | None = None
    worst_band: Band
    direction: Direction
    #: A written tempo change covers this measure. A screen showing a rushing
    #: or dragging colour here would be colouring a bar the page said would not
    #: be steady.
    under_tempo_change: bool = False
    #: Somewhere in this measure the change lurched. This is what replaces the
    #: tolerance bands under a `rit.`, not an addition to them.
    uneven: bool = False


class Tolerance(BaseModel):
    """The band edges this take was judged by, as a % of one beat.

    Recorded on the result rather than served from config, because a take was
    judged by the thresholds in force when it ran. Once these are tuned against
    real recordings — which is the whole point of `TUNING_LOG.md` — a chart
    drawn against today's config would rescale every take already stored, and a
    musician would watch last month's practice change shape for no reason they
    did any part of.

    Asymmetric by design: rushing and dragging carry independent cutoffs (§4).
    """

    rushing_inner_pct: float
    rushing_mid_pct: float
    rushing_outer_pct: float
    dragging_inner_pct: float
    dragging_mid_pct: float
    dragging_outer_pct: float

    @classmethod
    def of(cls, config: AudioConfig) -> "Tolerance":
        tol = config.tolerance
        return cls(
            rushing_inner_pct=tol.rushing_inner_pct,
            rushing_mid_pct=tol.rushing_mid_pct,
            rushing_outer_pct=tol.rushing_outer_pct,
            dragging_inner_pct=tol.dragging_inner_pct,
            dragging_mid_pct=tol.dragging_mid_pct,
            dragging_outer_pct=tol.dragging_outer_pct,
        )


class AnalysisResult(BaseModel):
    status: Status
    quality: float = Field(ge=0.0, le=1.0)
    low_confidence: bool = False  # quality below warn threshold — show a caveat
    verdict: str
    verdict_direction: Direction = Direction.on
    #: Null on rows analysed before the thresholds were recorded. A reader
    #: has to fall back to its own copy for those, so it is not optional in
    #: anything written from now on.
    tolerance: Tolerance | None = None
    per_note: list[PerNote] = Field(default_factory=list)
    per_measure: list[PerMeasure] = Field(default_factory=list)
    trend: list[float] = Field(default_factory=list)
    n_detected_onsets: int = 0
    n_expected_onsets: int = 0
    n_missed_notes: int = 0
    n_extra_notes: int = 0


_BAND_SEVERITY = {Band.on: 0, Band.slight: 1, Band.rush_drag: 2, Band.severe: 3}


def _summarize_measures(deltas: list[Delta]) -> list[PerMeasure]:
    by_measure: dict[int, list[Delta]] = defaultdict(list)
    for d in deltas:
        if d.is_slur_interior:
            continue  # interior slur notes are not timed individually
        by_measure[d.measure_number].append(d)

    summaries: list[PerMeasure] = []
    for measure_number in sorted(by_measure):
        group = by_measure[measure_number]
        timed = [d for d in group if d.timed]
        # The whole bar only when nothing in it was timed — a bar that is
        # entirely a `rit.` still has to report something, and `timed_note_count`
        # is what says the number should not be read as a verdict.
        avg_pct = float(np.mean([d.delta_pct for d in (timed or group)]))
        worst = max(group, key=lambda d: _BAND_SEVERITY[d.band])
        if avg_pct < 0:
            direction = Direction.rush
        elif avg_pct > 0:
            direction = Direction.drag
        else:
            direction = Direction.on
        summaries.append(
            PerMeasure(
                measure_number=measure_number,
                note_count=len(group),
                avg_delta_pct=round(avg_pct, 2),
                worst_band=worst.band,
                direction=direction,
                under_tempo_change=any(d.under_tempo_change for d in group),
                uneven=any(d.uneven for d in group),
                timed_note_count=len(timed),
            )
        )
    return summaries


def _why_alignment_failed(
    raw: AlignmentResult,
    onsets: np.ndarray,
    expected: np.ndarray,
    *,
    optional: np.ndarray | None = None,
) -> str:
    """Say which failure this is, when it can be told apart.

    "Check you're on the right piece" is the right advice for a wrong page and
    the wrong advice for the case that produces it most often now: every note
    the score expects was found, and a great many more besides.

    That is what playing détaché against written slurs looks like. A slur means
    one bow stroke, so the timeline expects an onset for the bow change and not
    for the notes under it — and a musician who bows each note separately, or a
    page whose slurs were never really there, produces an attack for every one.
    Nothing is wrong with the recording; it does not match the marks.

    Told apart by covering every expected onset while carrying far more
    detected ones. A wrong piece does not do that — it misses expected onsets,
    which is why `missed` has to be empty for this branch to fire.

    The second case is a page that is *shorter than what was played*, and the
    commonest cause is bars that never reached the transcription. A
    multi-measure rest — a bar with a number over it, ordinary in any orchestral
    part — read as a single bar of rest leaves the timeline seven or twenty
    bars short, and the beat-sum check cannot see it: one whole rest in 4/4 adds
    up perfectly. Measured on a page of one bar, eight bars' rest and four more
    bars, read as one rest bar: `alignment_failed`, quality **0.000**, and the
    validator flagged nothing. Sending that musician to look for the wrong
    piece is sending them to look in the wrong place.
    """
    cleaned = apply_fuzzy_match(raw, onsets, expected, optional=optional)
    heard_everything = not cleaned.missed_expected and bool(cleaned.matched)
    far_too_many = len(cleaned.extra_detected) > len(cleaned.matched)

    if heard_everything and far_too_many:
        return (
            "We heard every note the score expects, and a lot more besides — "
            "this usually means the slurs on the page aren't the ones you "
            "played. Check the slur markings on this piece."
        )

    if _take_is_much_longer_than_the_page(onsets, expected):
        return (
            "Your recording is much longer than this page of music — that "
            "usually means some bars are missing from it. Check for a rest bar "
            "with a number over it, or a repeat, that didn't make it into the "
            "transcription."
        )

    return (
        "We had trouble matching your recording to the score — "
        "check you're on the right piece and re-record."
    )


#: How much longer a take has to run than its page before the page is the suspect.
#:
#: A musician practising slowly is the thing this must not accuse. The tempo
#: clamp already says the matcher will not believe a ratio beyond 1.7, so a take
#: within that is a tempo difference by definition; past it, something is
#: missing from the page. The smallest multi-measure rest worth printing is two
#: bars, which on a short page is already well beyond this.
TAKE_TOO_LONG_RATIO = 1.8


def _take_is_much_longer_than_the_page(
    onsets: np.ndarray, expected: np.ndarray
) -> bool:
    """Did the musician play for far longer than this transcription accounts for?

    Compared as spans rather than note counts, because the bars that go missing
    this way are *rests* — they carry no notes at all, so counting notes cannot
    see them. Time is the only thing that shows a gap where nothing was played.
    """
    if onsets.size < 2 or expected.size < 2:
        return False
    page = float(expected[-1] - expected[0])
    take = float(onsets[-1] - onsets[0])
    return page > 0 and take > page * TAKE_TOO_LONG_RATIO


def analyze(
    audio: str | Path | tuple[np.ndarray, int],
    score: ScoreJson,
    target_bpm: float,
    *,
    double_bass: bool = False,
    config: AudioConfig | None = None,
) -> AnalysisResult:
    """Analyze a recording against a score at a target tempo.

    `audio` is either a path to load, or an already-decoded `(waveform,
    sample_rate)` tuple — the Batch 4 worker decodes storage bytes once
    and passes the waveform straight through, avoiding a second decode.

    Returns a graceful `alignment_failed` / `no_onsets` result rather than
    raising when the input can't be trusted — the caller turns status into
    the right user-facing state.
    """
    cfg = config or load_audio_config()

    if isinstance(audio, tuple):
        y, sr = audio
    else:
        y, sr = audio_svc.load_audio(audio, sr=cfg.onset.sr)
    if double_bass:
        y = audio_svc.high_pass(y, sr, cfg.onset.double_bass_highpass_hz)

    # The score is read *before* the audio, so the detector can be told how
    # close together the notes it is looking for actually are. Nothing about
    # this depends on the recording, and it is what stops a fixed window from
    # making fast passages undetectable.
    timeline = build_timeline(score, target_bpm)
    expected = timeline.onsets
    # Which expected onsets it is not a mistake to miss: the grace notes, whose
    # written time is `ORNAMENT_SHARE` splitting the difference between two
    # readings the page did not choose between. Built here because the detector
    # is sized from it too — see `closest_expected_gap`.
    grace_onsets = np.array([n.is_grace_note for n in timeline.notes], dtype=bool)

    onsets = audio_svc.detect_onsets(
        audio_svc.pre_emphasis(y, config=cfg),
        sr,
        double_bass=double_bass,
        config=cfg,
        min_gap_s=closest_expected_gap(expected, optional=grace_onsets),
    )

    if onsets.size == 0 or expected.size == 0:
        return AnalysisResult(
            status="no_onsets",
            quality=0.0,
            tolerance=Tolerance.of(cfg),
            verdict="We couldn't hear any notes to analyze — try re-recording a bit louder.",
            n_detected_onsets=int(onsets.size),
            n_expected_onsets=int(expected.size),
        )

    # Both sequences on the same clock before anything is compared, and the
    # origin chosen by evidence rather than by position. Without the first, a
    # perfect take with a five-second lead-in aligns at 0.053 and the musician
    # is told to check they are on the right piece. Without the second, a bow
    # settling on the string before the first note becomes the downbeat, and
    # the same perfect take is told it dragged; without it at the other end, a
    # bow going down afterwards costs enough confidence to trigger a caveat.
    # Which written onsets a steady tempo is supposed to account for. Notes
    # under a `rit.` are not among them: the page has said the beat will not be
    # steady there, so they can say nothing about whether a steady-tempo
    # alignment is trustworthy.
    #
    # An ornament is not steady either, and for a stronger reason than a
    # `rit.`: its written time is not a claim the page made, it is
    # `ORNAMENT_SHARE` splitting the difference between the two readings an
    # engraver may have meant. A number this file invented can say nothing
    # about whether the alignment is trustworthy — and the note the ornament
    # decorates is in the same position, because the two readings put its
    # attack the better part of a beat apart.
    steady = np.array(
        [
            not n.under_tempo_change and not n.is_grace_note and not n.after_grace_note
            for n in timeline.notes
        ],
        dtype=bool,
    )
    # Which onsets it is not a mistake to miss. Only the grace notes: the note
    # they decorate is certainly played, it is only its *time* that is in
    # doubt, and forgiving it would forgive a genuinely skipped note.
    optional = grace_onsets
    anchored = align_take(
        onsets,
        expected,
        target_bpm=target_bpm,
        config=cfg,
        steady=steady,
        optional=optional,
    )
    onsets = anchored.onsets
    raw = anchored.alignment
    if is_alignment_broken(raw.quality, config=cfg):
        return AnalysisResult(
            status="alignment_failed",
            quality=round(raw.quality, 3),
            tolerance=Tolerance.of(cfg),
            verdict=_why_alignment_failed(raw, onsets, expected, optional=optional),
            n_detected_onsets=raw.n_detected,
            n_expected_onsets=raw.n_expected,
        )

    cleaned = apply_fuzzy_match(raw, onsets, expected, optional=optional)
    deltas = compute_deltas(cleaned, onsets, timeline, target_bpm, config=cfg)
    trend = rolling_trend(deltas, config=cfg)
    verdict = generate_verdict(
        deltas, target_bpm, config=cfg, tempo_spans=tempo_change_spans(score)
    )

    per_note = [
        PerNote(
            global_index=d.global_index,
            measure_number=d.measure_number,
            delta_ms=d.delta_ms,
            delta_pct=d.delta_pct,
            band=d.band,
            direction=d.direction,
            is_slur_interior=d.is_slur_interior,
            under_tempo_change=d.under_tempo_change,
            uneven=d.uneven,
            timed=d.timed,
        )
        for d in deltas
    ]

    return AnalysisResult(
        status="ok",
        quality=round(raw.quality, 3),
        tolerance=Tolerance.of(cfg),
        low_confidence=raw.quality < cfg.alignment.warn_quality,
        verdict=verdict.text,
        verdict_direction=verdict.direction,
        per_note=per_note,
        per_measure=_summarize_measures(deltas),
        trend=trend,
        n_detected_onsets=raw.n_detected,
        n_expected_onsets=raw.n_expected,
        n_missed_notes=len(cleaned.missed_expected),
        n_extra_notes=len(cleaned.extra_detected),
    )
