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

import logging
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from app.services import audio as audio_svc
from app.services.alignment import (
    align_take,
    attacks_outnumber_the_music,
    AlignmentResult,
    apply_fuzzy_match,
    build_timeline,
    CleanedAlignment,
    ExpectedTimeline,
    is_alignment_broken,
    closest_expected_gap,
    collapse_double_attacks,
)
from app.services.audio_config import AudioConfig, load_audio_config
from app.services.insights import Insights, insights_for
from app.services.onset_recovery import predict_audio_times, recover_onsets
from app.services.classification import (
    Band,
    Delta,
    Direction,
    UntimedReason,
    compute_deltas,
    generate_verdict,
    rolling_trend,
)
from app.services.score_schema import ScoreJson, tempo_change_spans

log = logging.getLogger("intempo.analysis")

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
    #: Which of those, when `timed` is false. `None` on a result stored before
    #: this field existed, which reads as "not said" rather than as a fourth
    #: reason.
    untimed_reason: UntimedReason | None = None
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
    #: Why nothing in this bar was timed, when every untimed note agrees.
    #:
    #: **Only when they agree, and only when the bar is wholly untimed.** A bar
    #: holding a fermata *and* an ornament has no single answer, and inventing
    #: a headline for it would be worse than the honest silence the app already
    #: falls back to. `None` therefore means "no single reason" as well as "an
    #: older result" — both land on the same wording, which is why they can
    #: share a value.
    untimed_reason: UntimedReason | None = None
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
    #: What the pipeline already knew and never said — the pace actually
    #: played, whether it held, and how evenly. See `services/insights.py`.
    #: Every field inside is independently nullable: a short take has a pace
    #: and a spread but no trustworthy drift.
    insights: Insights = Field(default_factory=Insights)
    #: Which takes may be compared with which, stamped by the runner.
    #:
    #: **Not computed here**, because `analyze` is given audio and a score and
    #: has never seen the analyses row — the key depends on the target tempo and
    #: the instrument, which live on it. The runner sets it before the dump.
    #:
    #: It was set on the *payload dict* after the dump instead, so this model —
    #: the thing that documents what an analysis result is — did not mention a
    #: field the app reads on every take (`lib/insights/comparison.ts` decides
    #: which takes are comparable by matching it). Nothing was lost in practice,
    #: because `result_json` is read back as a plain dict and never revalidated
    #: through this class. But `test_client_body_fields.py` had been failing on
    #: exactly that gap, and a field that only exists between the dump and the
    #: database is one strip-and-revalidate away from disappearing.
    comparison_key: str | None = None


_BAND_SEVERITY = {Band.on: 0, Band.slight: 1, Band.rush_drag: 2, Band.severe: 3}


def _shared_untimed_reason(
    group: list[Delta], timed: list[Delta]
) -> UntimedReason | None:
    """The one reason a whole bar went unjudged, or None if there isn't one.

    Two conditions, and dropping either produces a sentence that is not true.
    The bar must be **wholly** untimed — naming a reason on a bar that also has
    measured notes in it would caption the whole row with something that
    explains part of it. And the untimed notes must **agree**: a bar holding
    both a fermata and an ornament has no single answer, and the app's existing
    wording for "nothing here could be timed" is the honest thing to fall back
    to.
    """
    if timed or not group:
        return None
    reasons = {d.untimed_reason for d in group}
    return reasons.pop() if len(reasons) == 1 else None


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
                untimed_reason=_shared_untimed_reason(group, timed),
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
        return "More notes came through than the page writes. Check its slurs."

    if _take_is_much_longer_than_the_page(onsets, expected):
        return (
            "Your take runs longer than this page. Look for a missing repeat, "
            "or a rest bar with a number over it."
        )

    # Far fewer attacks than the page writes. A take that is simply *short* no
    # longer arrives here — `align_dtw` matches a passage against the passage
    # it covers — so what is left is a take that spanned the page and was half
    # heard. Nothing in that says the musician was on the wrong piece, and the
    # two things that do explain it are both worth naming: a microphone that
    # could not hear the attacks, and a transcription that does not match what
    # is on the stand.
    if raw.coverage < _SPARSE_COVERAGE and raw.n_detected < raw.n_expected:
        return (
            f"Only {raw.n_detected} of {raw.n_expected} notes came through. "
            "Move the microphone closer."
        )

    # **More sound arrived than any performance of this page could make.**
    # Checked before the wrong-piece sentence because it is the commoner cause
    # and the two are indistinguishable from the counts alone: a take carrying
    # a great deal of noise matches badly everywhere, which looks exactly like
    # the wrong music. Every take this app has analysed lands here, and every
    # one of them was the right piece — see `attacks_outnumber_the_music`.
    if attacks_outnumber_the_music(onsets, expected):
        return (
            "More sound came through than this page writes. Move the "
            "microphone closer to the instrument, away from anything noisy."
        )

    # **Everything the page writes was heard, and none of it where the page
    # puts it.** That really is the wrong-piece signature, and the advice is
    # earned here in a way it was not above: the counts agree, so quoting them
    # would tell the musician nothing, and what is left is that these notes are
    # not this music.
    return "Same notes, different times. Check you're on the right piece and the tempo."


#: Below this share of the page's notes, there is not enough of a take to
#: compare and the reason is worth naming rather than guessing at. Set at the
#: refusal threshold's own neighbourhood: `broken_quality` is 0.4 and quality is
#: `timing_quality * coverage`, so a take under this could not have passed on
#: coverage alone however well it was played.
_SPARSE_COVERAGE = 0.5


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


def _why_nothing_to_compare(expected: np.ndarray) -> str:
    """Nothing was heard, or nothing was written. Which, and what to do.

    This branch used to say *"try re-recording a bit louder"* for both, and that
    is wrong twice over.

    **Loudness has nothing to do with it.** `onset_strength` differences a
    dB-scaled mel spectrogram, so scaling a waveform shifts every frame by the
    same constant and the differencing removes it — the detector is
    amplitude-invariant by construction. Measured on all six audio fixtures,
    requantised to 16-bit at each level: the onset count is **identical from
    0 dBFS down to -90 dBFS**, where the samples are barely more than one LSB
    (`01_detache_clean` finds its 32 notes at every level, `06_pizzicato` its
    16). Ten seconds of white noise at -60 dBFS produces ten onsets; ten seconds
    of digital silence produces none. Level is not what separates them.

    So the only recording that reaches here is one that is *digitally silent* —
    every sample zero. A muted input, a device recording from a source with
    nothing routed to it, a permission granted and then revoked. Playing louder
    into a muted microphone produces exactly the same file, so the advice sent
    the musician to repeat the one thing that could not help.

    **And the score may be the empty one.** `expected.size == 0` means the page
    has no notes on it — nothing to do with the recording at all, and told to
    the musician as though their playing were at fault, which is the same
    mistake `_read_page`'s failure reasons made three times. It is named first
    when both are true: a take against a page with no notes cannot be analysed
    however well it is recorded, so sending them back to the microphone would
    cost them a second take and change nothing.

    Only `expected` is needed to tell them apart: the caller enters this branch
    when either is empty, so a non-empty score here means the recording was the
    silent one.
    """
    if expected.size == 0:
        return "This piece has no notes to compare against. Check the transcription."
    return "No sound reached the microphone. Check that nothing is muting it."


@dataclass(frozen=True)
class Heard:
    """What the detector made of a recording, before anything is aligned."""

    #: The waveform as loaded and filtered — what the dashboard plots.
    y: np.ndarray
    sr: int
    timeline: ExpectedTimeline
    #: Where the score says the onsets are, on the timeline's clock.
    expected: np.ndarray
    #: Which of `expected` are ornaments, and so not a mistake to miss.
    grace: np.ndarray
    #: What the detector fired on, on the recording's clock.
    onsets: np.ndarray


def prepare_for_alignment(
    audio: Path | str | tuple[np.ndarray, int],
    score: ScoreJson,
    target_bpm: float,
    *,
    instrument: str | None = None,
    double_bass: bool = False,
    config: AudioConfig,
) -> Heard:
    """Decode, filter, read the score, and detect — the steps before aligning.

    **Shared with `diagnostics.analyze_with_diagnostics`, which had copied
    them.** That module's docstring promises "everything here calls the same
    functions `analyze()` calls … so a number on the dashboard is the number
    the pipeline used", and it was one argument short of true: its
    `closest_expected_gap(expected)` omitted `optional=`, so on any page with
    an ornament on it the dashboard sized the detector's window off the
    acciaccatura. `closest_expected_gap` records what that costs — 14 onsets
    detected for 8 clicks, quality 0.665 on a perfect take — which is the
    failure the dashboard exists to tune away, happening to the dashboard.

    Two implementations of one order of operations cannot be kept in step by
    reading them, so there is one.
    """
    if isinstance(audio, tuple):
        y, sr = audio
    else:
        y, sr = audio_svc.load_audio(audio, sr=config.onset.sr)
    # **The filter and the threshold come from one entry.** They were two
    # decisions before — this function chose whether to high-pass and
    # `detect_onsets` chose the threshold — so a caller could get a bass's
    # peak-pick threshold with a violin's (absent) filter. A viola's open C is
    # 131 Hz and a cello's is 65 Hz, and neither was ever given a cutoff of
    # its own; the table says so explicitly now rather than a boolean hiding
    # it. See `[onset.instrument]` in config.toml.
    named = instrument or ("double_bass" if double_bass else None)
    settings = audio_svc.onset_settings_for(config, named)
    if settings.highpass_hz > 0:
        y = audio_svc.high_pass(y, sr, settings.highpass_hz)

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
    grace = np.array([n.is_grace_note for n in timeline.notes], dtype=bool)

    onsets = audio_svc.detect_onsets(
        audio_svc.pre_emphasis(y, config=config),
        sr,
        instrument=named,
        config=config,
        min_gap_s=closest_expected_gap(expected, optional=grace),
    )
    # **One attack reported twice is not two notes**, and until this line it
    # could out-vote the machinery for a partial take: `subsequence` is gated
    # on the detections being fewer than the page's notes, so an over-detected
    # half-take (`onsets=77/75`) was matched against the whole page and refused
    # as a wrong piece. The detector's own `wait_ms` is a fact about how fast a
    # string can be re-attacked; this is a fact about what is on the stand, and
    # they are different claims. See `collapse_double_attacks`.
    onsets = collapse_double_attacks(onsets, expected, optional=grace)
    return Heard(
        y=y, sr=sr, timeline=timeline, expected=expected, grace=grace, onsets=onsets
    )


# The two recovery thresholds live in `[onset.recovery]` in config.toml,
# like every other tunable number in this pipeline (`CLAUDE.md` §1 rule 7).


def _recover_missed_onsets(
    heard: Heard,
    cleaned: CleanedAlignment,
    onsets: np.ndarray,
    expected: np.ndarray,
    *,
    min_gap_s: float | None,
    config: AudioConfig,
) -> np.ndarray:
    """A second look, only where the page writes a note and none was heard.

    **Nothing happens when nothing was missed**, which is the property the
    whole shape was chosen for: `missed_expected` empty means this returns an
    empty array before touching the audio, so a take that read correctly
    cannot be moved by this pass and no existing reading changes.

    The envelope is recomputed rather than carried on `Heard`, and that is a
    deliberate trade. It costs one more pass over the audio on takes that
    missed something — bounded, since `onset_envelope` is already blocked for
    memory — and it buys leaving `detect_onsets`, `Heard` and both of their
    call sites exactly as they were. A signature change there would touch the
    calibration path too, which has no score and no use for any of this.
    """
    if not cleaned.missed_expected or not cleaned.matched:
        return np.array([], dtype=float)

    predicted = predict_audio_times(
        cleaned.matched, onsets, expected, cleaned.missed_expected
    )
    if predicted.size == 0:
        return np.array([], dtype=float)

    strength = audio_svc.onset_envelope(
        audio_svc.pre_emphasis(heard.y, config=config), heard.sr
    )
    search = (min_gap_s or 0.0) * config.onset.recovery_search_share
    if search <= 0:
        return np.array([], dtype=float)

    return recover_onsets(
        strength,
        hop_length=audio_svc.HOP_LENGTH,
        sr=heard.sr,
        detected=onsets,
        predicted_s=predicted,
        search_s=search,
        floor_ratio=config.onset.recovery_floor_ratio,
        # A recovered note may not land within one `wait` of anything already
        # there; the detector's own re-trigger guard, reused so the two cannot
        # disagree about what counts as one attack.
        min_separation_s=config.onset.wait_ms / 1000.0,
    )


def analyze(
    audio: str | Path | tuple[np.ndarray, int],
    score: ScoreJson,
    target_bpm: float,
    *,
    instrument: str | None = None,
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
    heard = prepare_for_alignment(
        audio,
        score,
        target_bpm,
        instrument=instrument,
        double_bass=double_bass,
        config=cfg,
    )
    timeline = heard.timeline
    expected = heard.expected
    grace_onsets = heard.grace
    onsets = heard.onsets

    if onsets.size == 0 or expected.size == 0:
        return AnalysisResult(
            status="no_onsets",
            quality=0.0,
            tolerance=Tolerance.of(cfg),
            verdict=_why_nothing_to_compare(expected),
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

    # **A second look, before the take is called unreadable rather than
    # after.** This began life below the refusal check, where it was useless:
    # a take that lost half its notes to a live room is refused on coverage,
    # returns early, and never reaches the code written to rescue it.
    # Measured — at 92 BPM with 20 dB of range in a 0.9 s room the take is
    # refused outright at coverage 0.667, and the recovery pass sat unreached
    # below it.
    #
    # `apply_fuzzy_match` is pure, so asking it here for the missed-note list
    # and asking it again below changes nothing. A badly broken alignment
    # gives a nonsense line to predict from, and that is safe by construction:
    # the search finds no peak at a nonsense time, so nothing is added.
    probe = apply_fuzzy_match(raw, onsets, expected, optional=optional)
    recovered = _recover_missed_onsets(
        heard,
        probe,
        onsets,
        expected,
        # The same gap the detector was sized from, so the search window and
        # the peak-pick window are derived from one number rather than two.
        min_gap_s=closest_expected_gap(expected, optional=optional),
        config=cfg,
    )
    if recovered.size:
        log.info(
            "analysis: recovered %d onset(s) the first pass did not report",
            recovered.size,
        )
        anchored = align_take(
            np.sort(np.concatenate([onsets, recovered])),
            expected,
            target_bpm=target_bpm,
            config=cfg,
            steady=steady,
            optional=optional,
        )
        onsets = anchored.onsets
        raw = anchored.alignment

    if is_alignment_broken(raw.quality, config=cfg):
        # **The one line that says which half refused the take.**
        #
        # `quality` is `timing_quality * coverage`, and a refusal reported only
        # the product — so "the shape disagrees with the page" and "we heard a
        # third of the notes" arrived as the same number, and the same sentence.
        # The first eight takes this app analysed all read `quality 0.000`, and
        # separating the two required re-running the pipeline by hand against a
        # copy of the row.
        #
        # The spans matter as much as the counts: a take far shorter than the
        # page is a musician practising a passage, which is a different fault
        # from one that ran the length of the page and was half heard.
        log.warning(
            "analysis: refused, quality=%.3f (timing=%.3f coverage=%.3f) "
            "onsets=%d/%d take_span=%.1fs page_span=%.1fs subsequence=%s",
            raw.quality,
            raw.timing_quality,
            raw.coverage,
            onsets.size,
            expected.size,
            float(onsets[-1] - onsets[0]) if onsets.size >= 2 else 0.0,
            float(expected[-1] - expected[0]) if expected.size >= 2 else 0.0,
            raw.subsequence,
        )
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
            untimed_reason=d.untimed_reason,
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
        insights=insights_for(
            cleaned.matched,
            onsets,
            expected,
            target_bpm,
            # The same deltas the verdict is built from, so a musician cannot
            # be told the spread of one set of numbers and the average of
            # another.
            [d.delta_pct for d in deltas if d.timed],
            # Paired with the written length of the note each delta belongs
            # to, so the take can be grouped by what was on the page. The
            # lookup is by `global_index` because `deltas` is already filtered
            # and `timeline.notes` is not.
            [
                (timeline.notes[d.global_index].beats, d.delta_pct)
                for d in deltas
                if d.timed and 0 <= d.global_index < len(timeline.notes)
            ],
            target_bpm_for_lead=target_bpm,
        ),
    )
