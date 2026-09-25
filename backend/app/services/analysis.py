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
import math
from collections import defaultdict
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field

from app.services import audio as audio_svc
from app.services import pitch_evidence
from app.services.alignment import (
    MIN_TEMPO_RATIO,
    MIN_TRIM_GAIN,
    align_dtw,
    align_take,
    attacks_outnumber_the_music,
    AlignmentResult,
    AnchoredAlignment,
    apply_fuzzy_match,
    build_timeline,
    CleanedAlignment,
    ExpectedTimeline,
    is_alignment_broken,
    closest_expected_gap,
    collapse_double_attacks,
    _clamp_ratio,
    to_timeline_base,
    typical_gap,
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

Status = Literal["ok", "alignment_failed", "no_onsets", "not_played"]

#: What a take that was never played is told, under the app's heading "We
#: didn't hear you play". The owner's words, approved 2026-09-23, split where
#: every other refusal is split: the finding in the heading, the move here.
NOT_PLAYED = "Try again closer to your instrument."


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
    reclaimable: np.ndarray | None = None,
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
    cleaned = apply_fuzzy_match(
        raw, onsets, expected, optional=optional, reclaimable=reclaimable
    )
    heard_everything = not cleaned.missed_expected and bool(cleaned.matched)
    far_too_many = len(cleaned.extra_detected) > len(cleaned.matched)

    if heard_everything and far_too_many:
        return "More notes than the page has. Check its slurs."

    if _take_is_much_longer_than_the_page(onsets, expected):
        return (
            "Your take is longer than this page. Check its repeats, and any "
            "rest bar with a number over it."
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
            "Move the mic closer."
        )

    # **More sound arrived than any performance of this page could make.**
    # Checked before the wrong-piece sentence because it is the commoner cause
    # and the two are indistinguishable from the counts alone: a take carrying
    # a great deal of noise matches badly everywhere, which looks exactly like
    # the wrong music. Every take this app has analysed lands here, and every
    # one of them was the right piece — see `attacks_outnumber_the_music`.
    if attacks_outnumber_the_music(onsets, expected):
        return "Too much sound. Move the mic closer, away from noise."

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


def nothing_played(
    evidence: pitch_evidence.Evidence,
    *,
    quality: float,
    n_detected: int,
    n_expected: int,
    config: AudioConfig,
) -> bool:
    """Was this sound somebody playing, or something else the microphone heard?

    True when `why_not_played` names a rule; see it for the rules.
    """
    return (
        why_not_played(
            evidence,
            quality=quality,
            n_detected=n_detected,
            n_expected=n_expected,
            config=config,
        )
        is not None
    )


def why_not_played(
    evidence: pitch_evidence.Evidence,
    *,
    quality: float,
    n_detected: int,
    n_expected: int,
    config: AudioConfig,
) -> str | None:
    """Which rule says nothing was played — `no_pitch`, `one_pitch` or
    `not_tonal` — or None if none does.

    Named rather than only decided because the first real take this refused
    (2026-09-24, a double bass that detected 73 of 75 notes) could not say
    which of the three it tripped, and the answer is the whole of what tuning
    them against real rooms needs. `analyses.diagnostics` stores it.

    **Measured on 2026-09-23, on synthetic takes** (TUNING_LOG.md has every
    row). Takes with nothing played:

    - a metronome of any kind, an empty room: a pitch held after 0.00–0.03 of
      the attacks. The case that matters most, because a click on every beat
      is a perfect take of a page of even notes — it was told "Steady all the
      way through" at quality 1.00;
    - talking: the page's pitches after at most 0.07 of notes, and a poor fit
      to its rhythm (quality 0.47 at best, which was enough for talking alone
      to be given a verdict);
    - a beep, a bow knocking a stand, a stand ringing, a glass: the same sound
      each time, so one pitch after every attack, whatever the page writes.

    **The page is trusted when it agrees and doubted when it does not.** A
    transcription can be wrong everywhere — a misread clef moves every note —
    and a real take against it holds none of its written pitches: 0.00, on a
    scale read a third off. So every rule below first requires the page's
    pitches not to have been heard beyond chance, and then something more:

    1. **Nothing held a pitch** → not played. Clicks, room.
    2. **One pitch every time, on a page with several** → not played. A beep,
       a knock, a ring: one object struck again and again. A short take of a
       different piece is several pitches (0.33 on four notes) and is left to
       the rest of the pipeline to call the wrong piece. A page of one
       repeated pitch cannot use this rule — a real open-string take against
       a misread page looks the same.
    3. **Less steady than an instrument, and not the page's rhythm either** →
       not played. Talking. Instruments held a pitch after 0.87 or more of
       attacks — sixteenths against a misread page too — and fit the page's
       rhythm at 0.93 or more even when misread.

    Everything else is left to the rest of the pipeline, exactly as before.
    See `pitch_evidence` for the two shares and `[pitch]` in config.toml for
    the numbers.
    """
    p = config.pitch
    if evidence.n_attacks == 0:
        return None
    # Some of the page's pitches were heard: whatever else went wrong, it is
    # somebody playing, and what they are told is the rest of the pipeline's.
    # **More of them than chance would put there**, as well as a share: three
    # glass clinks against a bass page matched eight notes and "held" two, 0.25
    # — on the line as a share, and a one-in-three chance by luck. Two notes of
    # two, from a player who stopped after two, is not luck.
    if evidence.page_share >= p.not_played_page and _beyond_chance(
        evidence.n_confirmed, evidence.n_matched, chance=p.chance, alpha=p.significance
    ):
        return None
    if evidence.tonal_share < p.not_played_tonal:
        return "no_pitch"
    if evidence.page_classes >= 2 and evidence.one_pitch_share >= p.one_pitch:
        return "one_pitch"
    if (
        evidence.tonal_share < p.played_tonal
        and quality < config.alignment.warn_quality
    ):
        return "not_tonal"
    return None


def _beyond_chance(hits: int, trials: int, *, chance: float, alpha: float) -> bool:
    """Would `hits` of `trials` happen by luck less often than `alpha`?

    The one-sided binomial tail, summed directly: `trials` is a page's matched
    notes, dozens at most, and this runs once a take.
    """
    if trials <= 0 or hits <= 0:
        return False
    tail = sum(
        math.comb(trials, k) * chance**k * (1 - chance) ** (trials - k)
        for k in range(hits, trials + 1)
    )
    return tail < alpha


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
        return "This piece has no notes. Check the score."
    return "No sound reached the microphone. Is it muted?"


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
    # **The detector is sized from every note the page prints, slurred or
    # not.** Sized from the bow changes alone, a page of four-note slurs looked
    # like a page of half notes: the window widened to ±464 ms and the
    # detector kept whichever slurred pitch change was loudest in each window,
    # rather than the bow change the timeline expected. Whether those notes
    # are heard is decided later, by the reading the take fits best — see
    # `readings_of` — and a window narrow enough to hear them costs nothing
    # when they are silent. A page with no slurs builds the same timeline
    # twice and nothing moves.
    every_note = build_timeline(score, target_bpm, legato=True)
    every_grace = np.array([n.is_grace_note for n in every_note.notes], dtype=bool)

    onsets = audio_svc.detect_onsets(
        audio_svc.pre_emphasis(y, config=config),
        sr,
        instrument=named,
        config=config,
        min_gap_s=closest_expected_gap(every_note.onsets, optional=every_grace),
    )
    # **One attack reported twice is not two notes**, and until this line it
    # could out-vote the machinery for a partial take: `subsequence` is gated
    # on the detections being fewer than the page's notes, so an over-detected
    # half-take (`onsets=77/75`) was matched against the whole page and refused
    # as a wrong piece. The detector's own `wait_ms` is a fact about how fast a
    # string can be re-attacked; this is a fact about what is on the stand, and
    # they are different claims. See `collapse_double_attacks`.
    onsets = collapse_double_attacks(onsets, every_note.onsets, optional=every_grace)
    return Heard(
        y=y,
        sr=sr,
        timeline=timeline,
        expected=expected,
        grace=grace,
        onsets=onsets,
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

    emphasised = audio_svc.pre_emphasis(heard.y, config=config)
    strength = audio_svc.onset_envelope(emphasised, heard.sr)
    search = (min_gap_s or 0.0) * config.onset.recovery_search_share
    if search <= 0:
        return np.array([], dtype=float)

    found = recover_onsets(
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
    # **Only where the recording is actually sounding.** Until the clock fix
    # above, every take with a lead-in searched the wrong seconds, and this pass
    # had never been asked about a note that was really not played. Asked, it
    # answered wrongly: a note dropped from the varied page was "recovered" off
    # the log-spectral wiggle of room tone — at 4.9% of the envelope's peak,
    # above the 1.5% floor, and at 1.6 times its neighbourhood, which is
    # *more* prominent than some genuine quiet notes under reverb (1.2–1.5).
    # Prominence cannot tell them apart; level can. Room tone sits at the take's
    # noise floor, and a quiet note swallowed by a live room is still tens of
    # decibels above it. See `[onset.recovery]` in config.toml.
    if found.size:
        loud_enough = (
            audio_svc.level_above_floor_db(heard.y, heard.sr, found)
            >= config.onset.recovery_min_level_db
        )
        found = found[loud_enough]
    # Placed on the same fine grid as everything the first pass reported, so a
    # recovered note is not the one note in the take still sitting on a frame.
    return audio_svc.refine_onset_times(emphasised, heard.sr, found)


# ---------------------------------------------------------------------------
# Readings: the ways a take may have been played from one page
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Reading:
    """One way the musician may have played this page, as a timeline.

    **The page was assumed to be played exactly one way, and practice is not
    played that way.** Measured end to end, each of these was refused with
    "Check you're on the right piece" on a take in which every note was on
    time:

      * a printed repeat, not taken — quality 0.000;
      * stopping in bar 6 and starting again from bar 5 — 0.134;
      * a slurred passage whose notes the detector heard — 0.385.

    None is a wrong piece. Each is the page read another way, and which way is
    something only the take can say — so each is built as a timeline, the take
    is aligned against every one, and the page as written is kept unless
    another fits clearly better (`MIN_READING_GAIN`).
    """

    #: What was done differently from the page as written, for the log.
    name: str
    timeline: ExpectedTimeline

    @property
    def expected(self) -> np.ndarray:
        return self.timeline.onsets

    @property
    def steady(self) -> np.ndarray:
        """The onsets a steady tempo is supposed to account for.

        Notes under a `rit.` are not among them: the page has said the beat
        will not be steady there. An ornament is not steady either, and for a
        stronger reason: its written time is `ORNAMENT_SHARE` splitting the
        difference between two readings an engraver may have meant, and the
        note it decorates is in the same position.
        """
        return np.array(
            [
                not n.under_tempo_change
                and not n.is_grace_note
                and not n.after_grace_note
                for n in self.timeline.notes
            ],
            dtype=bool,
        )

    @property
    def optional(self) -> np.ndarray:
        """The onsets it is not a mistake to miss: ornaments, and slurred notes
        in the reading where they may be heard. The note an ornament decorates
        is certainly played — only its *time* is in doubt — and forgiving it
        would forgive a genuinely skipped note."""
        return np.array(
            [n.is_grace_note or n.under_slur for n in self.timeline.notes], dtype=bool
        )

    @property
    def grace(self) -> np.ndarray:
        """The ornaments. The only optional onsets whose detection the next
        note may take back (see `apply_fuzzy_match`), and the only ones left
        out when sizing a window from the page's closest notes (see
        `closest_expected_gap`)."""
        return np.array([n.is_grace_note for n in self.timeline.notes], dtype=bool)

    @property
    def reclaimable(self) -> np.ndarray:
        return self.grace


#: How much better another reading must fit before it replaces the page as
#: written. The same margin, for the same reason, as `MIN_TRIM_GAIN`: a looser
#: reading can only ever fit at least as well, so a margin of zero would trade
#: the page for a rounding difference.
MIN_READING_GAIN = MIN_TRIM_GAIN


def readings_of(score: ScoreJson, target_bpm: float) -> list[Reading]:
    """The page as written, then each way of playing it that differs.

    As written comes first and is the default. The others are only built where
    the page makes them possible — a page with no slurs has no legato reading —
    and a reading that comes out identical to one already listed is dropped,
    so a page with neither slurs nor repeats is aligned exactly once, exactly
    as before.
    """
    has_repeat = any(r.type == "repeat" for r in score.repeats)
    variants = [("as written", {})]
    variants.append(("legato", {"legato": True}))
    if has_repeat:
        variants.append(("repeats not taken", {"take_repeats": False}))
        variants.append(
            ("legato, repeats not taken", {"legato": True, "take_repeats": False})
        )
    out: list[Reading] = []
    for name, options in variants:
        timeline = build_timeline(score, target_bpm, **options)
        if any(
            timeline.onsets.size == r.expected.size
            and np.array_equal(timeline.onsets, r.expected)
            for r in out
        ):
            continue
        out.append(Reading(name=name, timeline=timeline))
    return out


@dataclass(frozen=True)
class _Pitch:
    """The take's chroma, for pairing attacks with notes by what they sounded.

    Computed once per take and shared by the matcher and the pitch evidence,
    which read the same transform. See `alignment.PITCH_WEIGHT` for the real
    take that needed it.
    """

    frames: np.ndarray
    sr: int
    steady: float

    def mismatch(self, attacks_s: np.ndarray, reading: Reading) -> np.ndarray:
        return pitch_evidence.mismatch(
            self.frames,
            self.sr,
            attacks_s,
            [note.pitch for note in reading.timeline.notes],
            steady=self.steady,
        )


def _pitch_of(
    heard: Heard,
    score_pitches: list[str | None],
    *,
    low_instrument: bool,
    config: AudioConfig,
) -> _Pitch:
    """The chroma the matcher and the pitch evidence share.

    Low register decided the way `pitch_evidence.assess` decides it, from the
    page rather than the matched notes — the match is what this feeds, so it
    cannot wait for one.
    """
    written = [m for m in (pitch_evidence.midi(p) for p in score_pitches) if m is not None]
    low = low_instrument or (
        bool(written) and float(np.median(written)) < config.pitch.low_register_midi
    )
    return _Pitch(
        frames=pitch_evidence.chroma(heard.y, heard.sr, low_register=low),
        sr=heard.sr,
        steady=config.pitch.steady,
    )


def _align_reading(
    onsets: np.ndarray,
    reading: Reading,
    target_bpm: float,
    config: AudioConfig,
    pitch: _Pitch | None = None,
    origin: float = 0.0,
) -> AnchoredAlignment:
    """Align `onsets` to `reading`, by timing and, where it fits better, pitch.

    **Pitch proposes; timing decides.** The pitch-guided pairing is kept only
    when its quality — measured on timing alone — beats the timing-only
    pairing by `MIN_READING_GAIN`. So it can rescue a take whose extra and
    missing attacks lost the timing-only match, and cannot make a worse fit
    win: every take that aligned before aligns the same way. `origin` puts
    `onsets` back on the recording's clock, which is where the chroma is.
    """
    plain = align_take(
        onsets,
        reading.expected,
        target_bpm=target_bpm,
        config=config,
        steady=reading.steady,
        optional=reading.optional,
    )
    if pitch is None or len(onsets) == 0:
        return plain
    guided = align_take(
        onsets,
        reading.expected,
        target_bpm=target_bpm,
        config=config,
        steady=reading.steady,
        optional=reading.optional,
        pitch=pitch.mismatch(np.asarray(onsets, dtype=float) + origin, reading),
    )
    if guided.alignment.quality > plain.alignment.quality + MIN_READING_GAIN:
        log.info(
            "analysis: paired by pitch as well as timing, quality %.3f -> %.3f",
            plain.alignment.quality,
            guided.alignment.quality,
        )
        return guided
    return plain


def _best_reading(
    onsets: np.ndarray,
    readings: list[Reading],
    target_bpm: float,
    config: AudioConfig,
    pitch: _Pitch | None = None,
) -> tuple[Reading, AnchoredAlignment]:
    """The first reading, unless another fits by more than `MIN_READING_GAIN`."""
    scored = [(r, _align_reading(onsets, r, target_bpm, config, pitch)) for r in readings]
    chosen = scored[0]
    rivals = scored[1:]
    if rivals:
        best = max(rivals, key=lambda pair: pair[1].alignment.quality)
        if best[1].alignment.quality > chosen[1].alignment.quality + MIN_READING_GAIN:
            chosen = best
    return chosen


#: The shortest silence that can be a stop rather than part of the music.
#:
#: The other bound is derived: a gap longer than the longest the page writes,
#: at the slowest tempo the matcher will believe (`MIN_TEMPO_RATIO`), cannot be
#: a performance of it. This floor is for pages of quick notes, where that
#: bound falls under the time it takes to stop, look back, and start again.
PAUSE_FLOOR_S = 1.0

#: How many bars back a restart is looked for, before the bar where the take
#: stopped. Musicians go back to the start of the phrase, or to the top, and
#: the top is always tried as well.
RESTART_BARS_BACK = 8

#: How far either side of the note-count estimate the last note played before
#: a stop is looked for — room for a missed or doubled detection, and for the
#: noise `align_take` may trim from the front.
RESTART_SLACK_NOTES = 3

#: At most this many stops are examined in one take.
MAX_RESTARTS = 3


def _pauses(onsets: np.ndarray, expected: np.ndarray) -> list[int]:
    """Indices of the detections a stop follows. See `PAUSE_FLOOR_S`."""
    if onsets.size < 2 or expected.size < 2:
        return []
    longest = float(np.max(np.diff(expected)))
    threshold = max(PAUSE_FLOOR_S, longest / MIN_TEMPO_RATIO)
    return [int(i) for i in np.flatnonzero(np.diff(onsets) > threshold)]


def _restarted(
    reading: Reading, last: int, again: int, pause_written_s: float
) -> Reading:
    """`reading` played to note `last`, then again from note `again`.

    `again` may be `last + 1`: a stop, then carrying on. The stop is written in
    as a rest as long as the one the musician took, so the note they came back
    in on is on time by construction rather than judged against a silence the
    page never wrote.
    """
    notes = reading.timeline.notes
    onsets = reading.expected
    head_notes, tail_notes = notes[: last + 1], notes[again:]
    shift = float(onsets[last]) + pause_written_s - float(onsets[again])
    joined = [*head_notes, *tail_notes]
    times = np.concatenate([onsets[: last + 1], onsets[again:] + shift])
    renumbered = [
        replace(note, global_index=index, onset_s=float(times[index]))
        for index, note in enumerate(joined)
    ]
    bar = notes[again].measure_number
    what = "paused" if again == last + 1 else f"restarted at bar {bar}"
    return Reading(
        name=f"{reading.name}, {what}",
        timeline=ExpectedTimeline(onsets=times, notes=renumbered),
    )


def _with_restarts(
    onsets: np.ndarray,
    chosen: tuple[Reading, AnchoredAlignment],
    target_bpm: float,
    config: AudioConfig,
    pitch: _Pitch | None = None,
) -> tuple[Reading, AnchoredAlignment]:
    """The chosen reading, with the stops and starts a practice take has in it.

    **Only for a take the page as read cannot explain** — one under
    `warn_quality`. A take that already fits is never re-read, so nothing that
    reads today can move.

    At each stop, the candidates are every bar start up to
    `RESTART_BARS_BACK` before the note the take stopped on, and the top of
    the page, crossed with a few guesses at which note that was. Each is scored
    once; the best is kept if it beats what came before by
    `MIN_READING_GAIN`. Among candidates that fit equally — a page of
    identical bars, where the rhythm cannot say which bar was repeated — the
    latest bar is taken, because the nearest phrase is where musicians go
    back to.
    """
    reading, anchored = chosen
    if anchored.alignment.quality >= config.alignment.warn_quality:
        return chosen
    based = to_timeline_base(onsets)
    for pause in _pauses(onsets, reading.expected)[:MAX_RESTARTS]:
        notes = reading.timeline.notes
        expected = reading.expected
        # Which note the stop came after: the count of detections before it,
        # give or take a few.
        estimate = min(pause, expected.size - 1)
        lasts = range(
            max(0, estimate - RESTART_SLACK_NOTES),
            min(expected.size - 1, estimate + RESTART_SLACK_NOTES) + 1,
        )
        bar_starts = [
            j
            for j in range(expected.size)
            if j == 0 or notes[j].measure_number != notes[j - 1].measure_number
        ]
        # The pause in written seconds, at the pace the take was played before
        # it — the same bounded ratio the matcher believes.
        before = onsets[: pause + 1]
        played_gap = typical_gap(np.diff(before)) if before.size >= 2 else 0.0
        best: tuple[float, int, int, Reading] | None = None
        for last in lasts:
            written_gap = (
                typical_gap(np.diff(expected[: last + 1])) if last >= 1 else 0.0
            )
            ratio = (
                _clamp_ratio(written_gap / played_gap)
                if played_gap > 0 and written_gap > 0
                else 1.0
            )
            pause_written = float(onsets[pause + 1] - onsets[pause]) * ratio
            starts = [j for j in bar_starts if j <= last]
            # Carrying on from the next note is a candidate too, and it has to
            # be: a stop to turn a page is the commonest stop there is, and
            # without it the nearest restart would win by default and invent
            # the notes it replays as missed. Measured: a two-second pause
            # mid-take read as a restart with four notes missed. It is never
            # *chosen* — see below.
            onward = {last + 1} if last + 1 < expected.size else set()
            for again in {0, *starts[-RESTART_BARS_BACK - 1 :], *onward}:
                candidate = _restarted(reading, last, again, pause_written)
                quality = align_dtw(
                    based,
                    candidate.expected,
                    target_bpm=target_bpm,
                    config=config,
                    steady=candidate.steady,
                    optional=candidate.optional,
                ).quality
                key = (quality, again, last)
                if best is None or key > best[:3]:
                    best = (quality, again, last, candidate)
        # **A stop that carried on is scored, and never chosen.** It has to be
        # a candidate — without it the nearest restart wins by default and
        # invents the notes it replays as missed. But as a reading it would
        # also absorb something that must not be absorbed: eight bars of rest
        # the transcription never read look exactly like a musician pausing,
        # and those must still be refused with "look for a rest bar with a
        # number over it" (`test_a_page_shorter_than_the_take_says_bars_are_
        # missing`). A pause already reads as a hesitation on the page as
        # written, so keeping that reading loses nothing a musician needs.
        if best is None or best[1] == best[2] + 1:
            continue
        candidate = best[3]
        realigned = _align_reading(onsets, candidate, target_bpm, config, pitch)
        if realigned.alignment.quality > anchored.alignment.quality + MIN_READING_GAIN:
            log.info(
                "analysis: read as %r, quality %.3f -> %.3f",
                candidate.name,
                anchored.alignment.quality,
                realigned.alignment.quality,
            )
            reading, anchored = candidate, realigned
    return reading, anchored


#: The most attack times one trace keeps. A fourteen-minute take at a fast
#: tempo is a few thousand; past this the list is the detector misfiring, and
#: its first few thousand say so as well as all of them would.
_TRACE_MAX_TIMES = 4000


def _traced(trace: dict[str, Any] | None, **values: Any) -> None:
    """Record `values` in `trace`, if the caller asked for one."""
    if trace is not None:
        trace.update(values)


def _times(values: np.ndarray) -> list[float]:
    """Seconds to the millisecond, as plain floats: JSON, not numpy."""
    return [round(float(v), 3) for v in values[:_TRACE_MAX_TIMES]]


def _alignment_trace(anchored: AnchoredAlignment) -> dict[str, Any]:
    raw = anchored.alignment
    return {
        "quality": round(float(raw.quality), 3),
        "timing_quality": round(float(raw.timing_quality), 3),
        "coverage": round(float(raw.coverage), 3),
        "subsequence": bool(raw.subsequence),
        "n_detected": int(raw.n_detected),
        "trimmed_lead": int(anchored.trimmed_lead),
        "trimmed_tail": int(anchored.trimmed_tail),
    }


def analyze(
    audio: str | Path | tuple[np.ndarray, int],
    score: ScoreJson,
    target_bpm: float,
    *,
    instrument: str | None = None,
    double_bass: bool = False,
    config: AudioConfig | None = None,
    trace: dict[str, Any] | None = None,
) -> AnalysisResult:
    """Analyze a recording against a score at a target tempo.

    `audio` is either a path to load, or an already-decoded `(waveform,
    sample_rate)` tuple — the Batch 4 worker decodes storage bytes once
    and passes the waveform straight through, avoiding a second decode.

    `trace`, when given, is filled with the working on the way to the answer:
    every attack the detector reported, the reading chosen, the alignment's two
    halves, the pitch evidence and the rule that refused the take, if one did.
    Nothing is recomputed for it — each value is the one the decision used —
    and nothing reads it back; the worker stores it on the row
    (`analyses.diagnostics`) so a real take can say why it was refused without
    anyone fetching its audio. See `_traced`.

    Returns a graceful `alignment_failed` / `no_onsets` / `not_played` result
    rather than raising when the input can't be trusted — the caller turns status into
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
    onsets = heard.onsets
    _traced(
        trace,
        duration_s=round(heard.y.size / heard.sr, 3) if heard.sr else None,
        detected_s=_times(heard.onsets),
        n_expected_as_written=int(heard.expected.size),
    )

    if onsets.size == 0 or heard.expected.size == 0:
        _traced(trace, outcome="no_onsets")
        return AnalysisResult(
            status="no_onsets",
            quality=0.0,
            tolerance=Tolerance.of(cfg),
            verdict=_why_nothing_to_compare(heard.expected),
            n_detected_onsets=int(onsets.size),
            n_expected_onsets=int(heard.expected.size),
        )

    # Both sequences on the same clock before anything is compared, and the
    # origin chosen by evidence rather than by position — `align_take`. Without
    # the first, a perfect take with a five-second lead-in aligns at 0.053 and
    # the musician is told to check they are on the right piece. Without the
    # second, a bow settling on the string before the first note becomes the
    # downbeat, and the same perfect take is told it dragged; without it at the
    # other end, a bow going down afterwards costs enough confidence to trigger
    # a caveat.
    #
    # Against every way this page may have been played, not only the one it
    # prints — see `Reading`. As written comes first and is kept unless another
    # reading fits clearly better, and a take the chosen reading still cannot
    # explain is read once more for stops and restarts.
    # The take's chroma, once: the matcher pairs attacks with notes by it
    # where timing alone loses its place, and the pitch evidence below reads
    # the same frames.
    pitch = _pitch_of(
        heard,
        [note.pitch for note in heard.timeline.notes],
        low_instrument=(instrument or ("double_bass" if double_bass else None))
        in cfg.pitch.low_instruments,
        config=cfg,
    )
    reading, anchored = _with_restarts(
        onsets,
        _best_reading(onsets, readings_of(score, target_bpm), target_bpm, cfg, pitch),
        target_bpm,
        cfg,
        pitch,
    )
    if reading.name != "as written":
        log.info("analysis: read as %r", reading.name)
    timeline = reading.timeline
    expected = reading.expected
    steady = reading.steady
    optional = reading.optional
    reclaimable = reading.reclaimable
    onsets = anchored.onsets
    raw = anchored.alignment
    _traced(trace, reading=reading.name, n_expected=int(expected.size))

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
    probe = apply_fuzzy_match(
        raw, onsets, expected, optional=optional, reclaimable=reclaimable
    )
    # **On the recording's clock, not the take's.** `onsets` count from the
    # first note kept; the envelope counts from the moment recording began.
    # The pass predicted on one and searched the other, so any lead-in moved
    # every search window by its own length — two seconds of settling before
    # the first note, and the pass looked two seconds early for every note it
    # was meant to find. It went unnoticed because the only take that
    # exercised it began its first note at 0.0 s.
    origin = float(heard.onsets[anchored.trimmed_lead])
    recovered = _recover_missed_onsets(
        heard,
        probe,
        onsets + origin,
        expected,
        # The same gap the detector was sized from, so the search window and
        # the peak-pick window are derived from one number rather than two.
        min_gap_s=closest_expected_gap(expected, optional=reading.grace),
        config=cfg,
    ) - origin
    _traced(trace, recovered=int(recovered.size))
    if recovered.size:
        log.info(
            "analysis: recovered %d onset(s) the first pass did not report",
            recovered.size,
        )
        combined = np.sort(np.concatenate([onsets, recovered]))
        # `combined` is on the take's clock; `origin` puts it back on the
        # recording's, where the chroma is.
        anchored = _align_reading(combined, reading, target_bpm, cfg, pitch, origin)
        onsets = anchored.onsets
        raw = anchored.alignment
        # `align_take` re-zeroes on the first onset it keeps, so the recording
        # clock moves with it. Nothing below this line used it until the pitch
        # check, which has to find each note in the waveform.
        origin += float(combined[anchored.trimmed_lead])

    probe = apply_fuzzy_match(
        raw, onsets, expected, optional=optional, reclaimable=reclaimable
    )
    evidence = pitch_evidence.assess(
        heard.y,
        heard.sr,
        heard.onsets,
        [(float(onsets[d] + origin), timeline.notes[e].pitch) for d, e in probe.matched],
        steady=cfg.pitch.steady,
        min_share=cfg.pitch.min_share,
        top=cfg.pitch.top,
        min_relative=cfg.pitch.min_relative,
        low_register_midi=cfg.pitch.low_register_midi,
        low_instrument=(instrument or ("double_bass" if double_bass else None))
        in cfg.pitch.low_instruments,
        page_pitches=[note.pitch for note in timeline.notes],
        frames=pitch.frames,
    )
    _traced(
        trace,
        alignment=_alignment_trace(anchored),
        pitch={
            "tonal_share": round(evidence.tonal_share, 3),
            "page_share": round(evidence.page_share, 3),
            "one_pitch_share": round(evidence.one_pitch_share, 3),
            "n_attacks": evidence.n_attacks,
            "n_matched": evidence.n_matched,
            "n_confirmed": evidence.n_confirmed,
            "page_classes": evidence.page_classes,
        },
    )
    log.info(
        "analysis: pitch held after %.2f of %d attacks, written pitch after "
        "%.2f of %d notes",
        evidence.tonal_share,
        evidence.n_attacks,
        evidence.page_share,
        evidence.n_matched,
    )
    # **Before the refusal check and before the verdict**, because both of
    # the takes this exists for would otherwise get past it: a metronome in an
    # empty room aligns perfectly, and talking on its own reached a verdict at
    # quality 0.47. What the alignment made of a sound nobody played is not a
    # reason to say anything about it.
    refused_by = why_not_played(
        evidence,
        quality=raw.quality,
        n_detected=int(heard.onsets.size),
        n_expected=int(heard.expected.size),
        config=cfg,
    )
    if refused_by is not None:
        _traced(trace, outcome="not_played", rule=refused_by)
        log.warning(
            "analysis: not played — pitch held after %.2f of %d attacks, "
            "written pitch after %.2f of %d notes",
            evidence.tonal_share,
            evidence.n_attacks,
            evidence.page_share,
            evidence.n_matched,
        )
        return AnalysisResult(
            # Zero, not the alignment's quality: a click track aligns at 1.00,
            # and `alignment_quality` is stored on the row as a number about
            # the performance.
            status="not_played",
            quality=0.0,
            tolerance=Tolerance.of(cfg),
            verdict=NOT_PLAYED,
            n_detected_onsets=int(heard.onsets.size),
            n_expected_onsets=int(heard.expected.size),
        )

    if is_alignment_broken(raw.quality, config=cfg):
        _traced(trace, outcome="alignment_failed")
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
            verdict=_why_alignment_failed(
                raw, onsets, expected, optional=optional, reclaimable=reclaimable
            ),
            n_detected_onsets=raw.n_detected,
            n_expected_onsets=raw.n_expected,
        )

    cleaned = apply_fuzzy_match(
        raw, onsets, expected, optional=optional, reclaimable=reclaimable
    )
    _traced(
        trace,
        outcome="ok",
        n_missed=len(cleaned.missed_expected),
        n_extra=len(cleaned.extra_detected),
    )
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
            # Not the slurred notes: their timing is the player's, which is
            # why the verdict and the trend leave them out too.
            [d.delta_pct for d in deltas if d.timed and not d.is_slur_interior],
            # Paired with the written length of the note each delta belongs
            # to, so the take can be grouped by what was on the page. The
            # lookup is by `global_index` because `deltas` is already filtered
            # and `timeline.notes` is not.
            [
                (timeline.notes[d.global_index].beats, d.delta_pct)
                for d in deltas
                if d.timed
                and not d.is_slur_interior
                and 0 <= d.global_index < len(timeline.notes)
            ],
            target_bpm_for_lead=target_bpm,
        ),
    )
