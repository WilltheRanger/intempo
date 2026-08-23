"""Layer 2 of the audio pipeline: match detected onsets to the score.

Three jobs:
  1. Turn the score JSON into the sequence of onset times we *expect* at
     the target tempo (`compute_expected_onsets` / `build_timeline`).
  2. Warp the detected onset sequence onto the expected one with DTW
     (`align_dtw`), returning a monotonic index mapping + a 0..1 quality
     score.
  3. Clean up the count mismatches DTW can't (`apply_fuzzy_match`):
     missed notes (one-to-many) and extra/false-trigger notes
     (many-to-one), per spec §7.

If alignment is too poor to trust, `is_alignment_broken` says so and the
orchestrator refuses to report rather than inventing deltas.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import librosa
import numpy as np

from app.services.audio_config import AudioConfig, load_audio_config
from app.services.score_schema import DURATION_BEATS, Measure, ScoreJson

# Note duration → length in quarter-note beats. `target_bpm` is always
# quarter-notes-per-minute, so a quarter note is 1.0 beats regardless of
# the notated time signature's lower number (a pragmatic MVP choice; the
# common exceptions like 6/8 are a documented V2 gap).
#: Imported, not copied — see `score_schema.DURATION_BEATS` for why.
_DURATION_BEATS = DURATION_BEATS


@dataclass(frozen=True)
class ExpectedNote:
    """One sounded onset we expect, with the metadata deltas need later."""

    onset_s: float
    measure_number: int
    note_index_in_measure: int
    global_index: int
    is_slur_interior: bool
    #: First note of a slur, or the first note after one ends — the notes that
    #: carry a real bow attack and so are held to the tolerance bands.
    #:
    #: Nothing reads this yet; `is_slur_interior` is what the verdict filters
    #: on, and its complement is the same set. Kept because it is the spec's
    #: vocabulary and it is what a slur-total check (spec: "we measure the
    #: *total* duration of the slur") would need. One honest limitation: a slur
    #: ending on a measure's last note puts "the first note after" in the next
    #: measure, and this is computed per measure, so that one goes unmarked.
    is_slur_boundary: bool


@dataclass(frozen=True)
class ExpectedTimeline:
    onsets: np.ndarray  # shape (N,), seconds since start of the first note
    notes: list[ExpectedNote]


def _beats(duration: str) -> float:
    """Beats for a duration, or a loud failure.

    This indexed with a `.get(duration, 1.0)` default. `Duration` is a closed
    Literal that Pydantic validates, so nothing unknown reaches here from a
    stored score — but a duration added to the Literal and forgotten in the
    table would have been silently counted as a quarter note, which does not
    produce a wrong beat, it produces a wrong *timeline*: every onset after it
    shifts, and the analysis reports the player rushing or dragging from that
    bar to the end of the piece.

    The identical default in `validate.py` — `.get(duration, 0.0)` — did
    exactly that when the triplets landed. Raise instead.
    """
    try:
        return _DURATION_BEATS[duration]
    except KeyError:  # pragma: no cover - unreachable via a validated score
        raise KeyError(
            f"no beat value for duration {duration!r}; add it to "
            "score_schema.DURATION_BEATS"
        ) from None



def expand_repeats(score: ScoreJson) -> list[Measure]:
    """The measures in playing order, with repeated sections written out twice.

    **`build_timeline` walked `score.measures` once and ignored
    `score.repeats` entirely.** A musician who takes an eight-bar repeat plays
    sixteen bars and produces roughly twice the onsets, against a timeline that
    held eight — so DTW was matching a doubled performance to a single pass and
    every delta after the repeat sign was meaningless. Silent, because the
    alignment still produced *a* number.

    Endings are handled the way a player reads them: the first time through,
    play the first ending and go back; the second time, skip it and take the
    second. A `repeat` with no endings is simply the span played twice.

    **Measure numbers are not renumbered.** The musician's part says bar 5 once
    and they play it twice, so both passes stay bar 5 — the verdict then names
    the bar they can find on the page. The consequence, which is the honest
    one, is that `PerMeasure` averages both passes of a repeated bar: it cannot
    say "you rushed the second time through" because nothing downstream
    distinguishes the passes, and inventing bar numbers that are not printed
    anywhere would be worse than averaging.

    A repeat naming measures that do not exist is ignored rather than fatal —
    OCR produces those, and losing the whole take to a mis-read repeat sign
    would be the wrong trade.
    """
    if not score.repeats:
        return list(score.measures)

    by_number = {m.measure_number: m for m in score.measures}
    order = [m.measure_number for m in score.measures]

    # Only plain repeats define a span to play twice; endings modify one.
    spans = [
        r for r in score.repeats
        if r.type == "repeat" and r.start_measure <= r.end_measure
        and r.start_measure in by_number and r.end_measure in by_number
    ]
    if not spans:
        return list(score.measures)

    firsts = {
        n
        for r in score.repeats
        if r.type == "first_ending"
        for n in range(r.start_measure, r.end_measure + 1)
    }
    seconds = {
        n
        for r in score.repeats
        if r.type == "second_ending"
        for n in range(r.start_measure, r.end_measure + 1)
    }

    played: list[Measure] = []
    consumed: set[int] = set()
    for number in order:
        if number in consumed:
            continue
        span = next((r for r in spans if r.start_measure == number), None)
        if span is None:
            if number in seconds and number not in consumed:
                # A second ending reached without its repeat is just music.
                played.append(by_number[number])
            elif number not in seconds:
                played.append(by_number[number])
            continue

        body = [n for n in order if span.start_measure <= n <= span.end_measure]
        # First pass: everything up to and including the first ending.
        played.extend(by_number[n] for n in body if n not in seconds)
        # Second pass: the same, skipping the first ending, taking the second.
        played.extend(by_number[n] for n in body if n not in firsts)
        consumed.update(body)

    return played or list(score.measures)


def build_timeline(score: ScoreJson, target_bpm: float) -> ExpectedTimeline:
    """Walk the score, accumulating time, emitting one entry per *sounded* onset.

    - Rests advance the clock but produce no onset.
    - A note tied FROM the previous note is not re-attacked: it advances
      the clock but produces no onset of its own.
    - Slur interiors are marked so classification can suppress per-note
      timing there (musical license within one bow; §4 layer 2).
    - **Repeated sections are written out twice**, because the musician plays
      them twice. See `expand_repeats`.
    """
    if target_bpm <= 0:
        raise ValueError(f"target_bpm must be positive, got {target_bpm}")
    sec_per_beat = 60.0 / target_bpm

    onsets: list[float] = []
    notes: list[ExpectedNote] = []
    elapsed_beats = 0.0
    global_index = 0
    tied_from_prev = False

    for measure in expand_repeats(score):
        # Slur interiors/boundaries are per-measure (slur indices are
        # note offsets within the measure).
        interior: set[int] = set()
        boundary: set[int] = set()
        for slur in measure.slurs:
            # Spec §"Slurred passages": the boundary notes are "first note of
            # the slur, first note after the slur ends" — so the slur's *own*
            # last note is interior, not a boundary.
            #
            # This read `range(start + 1, end)` and marked `end` a boundary,
            # which timed the last note under the bow. That note has no bow
            # attack; it is a left-hand change inside one stroke. The onset
            # detector either misses it or fires late, which is precisely the
            # phantom-"dragging" report the spec warns about — a player using
            # ordinary legato was being told they dragged on the last note of
            # every slur.
            boundary.add(slur.start_note_index)
            boundary.add(slur.end_note_index + 1)
            for i in range(slur.start_note_index + 1, slur.end_note_index + 1):
                interior.add(i)

        for i, note in enumerate(measure.notes):
            is_rest = note.pitch == "rest"
            sounded = not is_rest and not tied_from_prev
            if sounded:
                onsets.append(elapsed_beats * sec_per_beat)
                notes.append(
                    ExpectedNote(
                        onset_s=elapsed_beats * sec_per_beat,
                        measure_number=measure.measure_number,
                        note_index_in_measure=i,
                        global_index=global_index,
                        is_slur_interior=i in interior,
                        is_slur_boundary=i in boundary,
                    )
                )
                global_index += 1
            elapsed_beats += _beats(note.duration)
            # A rest breaks any tie; otherwise carry the tie forward.
            tied_from_prev = note.tied_to_next and not is_rest

    return ExpectedTimeline(onsets=np.asarray(onsets, dtype=float), notes=notes)


def compute_expected_onsets(score: ScoreJson, target_bpm: float) -> np.ndarray:
    """Seconds-since-start of every expected onset (spec signature)."""
    return build_timeline(score, target_bpm).onsets


@dataclass
class AlignmentResult:
    """Raw DTW output: monotonic detected→expected index mapping + quality."""

    mapping: list[tuple[int, int]]  # (detected_idx, expected_idx), ascending
    cost: float  # total DTW path cost (seconds)
    quality: float  # 0..1; higher = better fit
    n_detected: int
    n_expected: int


@dataclass
class CleanedAlignment:
    """Fuzzy-matched result: clean note pairs plus the count-mismatch fallout."""

    matched: list[tuple[int, int]] = field(default_factory=list)  # (detected, expected)
    missed_expected: list[int] = field(default_factory=list)  # skipped notes
    extra_detected: list[int] = field(default_factory=list)  # re-attacks / added notes
    quality: float = 1.0


def _quality_from_cost(total_cost: float, path_len: int, sec_per_beat: float) -> float:
    """Map average per-step timing error to a 0..1 quality score.

    Average error is expressed as a fraction of a beat; half a beat of
    average error is treated as fully broken (quality 0). This is a
    starting curve — it is meant to be re-shaped during tuning, which is
    why the 0.5-beat anchor is the only magic number and it lives here,
    documented, rather than scattered through the pipeline.
    """
    if path_len == 0 or sec_per_beat <= 0:
        return 0.0
    avg_error_beats = (total_cost / path_len) / sec_per_beat
    return float(np.clip(1.0 - avg_error_beats / 0.5, 0.0, 1.0))


def to_timeline_base(detected: np.ndarray) -> np.ndarray:
    """Detected onsets re-expressed as seconds since the first note.

    `build_timeline` returns "seconds since start of the first note" — its own
    words. `detect_onsets` returns seconds since the *recording* started. Those
    are two different clocks, and every comparison between them was made in
    whichever clock happened to arrive.

    `compute_deltas` already knew this and corrected for it — "the recording's
    lead-in latency (reaction time before the first note) is not a timing
    error" — but it runs at the *end* of the pipeline, and `align_dtw` and
    `apply_fuzzy_match` run before it in the recording's clock. So a musician
    who tapped record, picked up the bow and then played was compared against a
    score that assumed they began instantly.

    The cost is not subtle. A **perfectly played** take, measured against the
    band-constrained DTW:

        lead-in   0.5s → quality 1.000
        lead-in   2.0s → quality 0.762
        lead-in   3.0s → quality 0.566
        lead-in   5.0s → quality 0.053   ← "check you're on the right piece"

    Five seconds is tapping record, putting the phone down and picking up the
    bow. Every one of those is 1.000 once both sequences are on the same clock.

    Shifted by the first *detected* onset, which is the only origin available
    before anything is matched. If that first onset is spurious the whole
    sequence shifts with it — but only by the width of one false trigger, and
    `compute_deltas` re-derives its own origin from the first *matched* pair
    afterwards, so a spurious lead does not reach the verdict.
    """
    detected = np.asarray(detected, dtype=float)
    if detected.size == 0:
        return detected
    return detected - detected[0]


def align_dtw(
    detected: np.ndarray,
    expected: np.ndarray,
    *,
    target_bpm: float = 120.0,
    config: AudioConfig | None = None,
) -> AlignmentResult:
    """Align detected onsets to expected onsets with a constrained DTW.

    Onsets are 1-D time sequences; we hand librosa `(1, N)` feature rows
    (1 feature = time, N steps). A Sakoe-Chiba band keeps the warp near
    the diagonal so a lost passage can't cause a wild excursion (§7.5a).
    The warping path is walked start→end and collapsed to the best
    expected index per detected onset.
    """
    cfg = config or load_audio_config()
    sec_per_beat = 60.0 / target_bpm if target_bpm > 0 else 0.5

    detected = np.asarray(detected, dtype=float)
    expected = np.asarray(expected, dtype=float)
    if detected.size == 0 or expected.size == 0:
        return AlignmentResult(
            mapping=[], cost=float("inf"), quality=0.0,
            n_detected=int(detected.size), n_expected=int(expected.size),
        )

    x = detected.reshape(1, -1)
    y = expected.reshape(1, -1)
    try:
        acc_cost, wp = librosa.sequence.dtw(
            X=x,
            Y=y,
            metric="euclidean",
            global_constraints=True,
            band_rad=cfg.alignment.sakoe_chiba_band,
        )
    except Exception:  # noqa: BLE001 — band too tight for the size ratio, etc.
        acc_cost, wp = librosa.sequence.dtw(X=x, Y=y, metric="euclidean")

    # librosa returns the path from end → start; flip to ascending.
    path = wp[::-1]

    # Collapse to one expected index per detected index: keep the closest
    # in time (handles the fan-out DTW leaves on the warp path).
    best: dict[int, tuple[int, float]] = {}
    for det_i, exp_i in path:
        det_i, exp_i = int(det_i), int(exp_i)
        err = abs(detected[det_i] - expected[exp_i])
        prev = best.get(det_i)
        if prev is None or err < prev[1]:
            best[det_i] = (exp_i, err)
    mapping = sorted((d, e) for d, (e, _) in best.items())

    # Quality measures how well the *shape* of the performance matches the
    # score, not the constant lead-in latency before the first note (that
    # reaction-time offset is musically irrelevant — a player who starts
    # 200ms after "record" but then plays perfectly is a 1.0, not a
    # failure). So subtract the median detected-minus-expected offset
    # before scoring the residual timing errors.
    offsets = [detected[d] - expected[e] for d, e in mapping]
    offset = float(np.median(offsets)) if offsets else 0.0
    residuals = [abs((detected[d] - offset) - expected[e]) for d, e in mapping]
    total_cost = float(sum(residuals))
    timing_quality = _quality_from_cost(total_cost, len(residuals), sec_per_beat)

    # Timing quality alone is blind to *coverage*: one perfectly-placed
    # onset against an 8-note score scores 1.0 on timing while 7 notes
    # went unheard. Weight by the fraction of expected notes actually
    # matched so a "played two bars then stopped / wrong page" take is
    # correctly flagged as broken rather than "steady".
    covered = len({e for _, e in mapping})
    coverage = covered / expected.size if expected.size else 0.0
    quality = timing_quality * coverage
    return AlignmentResult(
        mapping=mapping,
        cost=total_cost,
        quality=quality,
        n_detected=int(detected.size),
        n_expected=int(expected.size),
    )


def apply_fuzzy_match(
    alignment: AlignmentResult,
    detected: np.ndarray,
    expected: np.ndarray,
) -> CleanedAlignment:
    """Resolve count mismatches DTW leaves behind (§7).

    - Many-to-one: several detected onsets hit the same expected note.
      Keep the closest in time as the real note; the rest are
      re-attacks / added notes → `extra_detected`.
    - One-to-many: an expected note nobody landed on → `missed_expected`.
    """
    detected = np.asarray(detected, dtype=float)
    expected = np.asarray(expected, dtype=float)

    by_expected: dict[int, list[int]] = {}
    for det_i, exp_i in alignment.mapping:
        by_expected.setdefault(exp_i, []).append(det_i)

    matched: list[tuple[int, int]] = []
    extra: list[int] = []
    for exp_i, det_indices in by_expected.items():
        if len(det_indices) == 1:
            matched.append((det_indices[0], exp_i))
            continue
        # Many-to-one: the onset closest to the expected time wins.
        closest = min(det_indices, key=lambda d: abs(detected[d] - expected[exp_i]))
        matched.append((closest, exp_i))
        extra.extend(d for d in det_indices if d != closest)

    matched.sort()
    extra.sort()
    covered = {exp_i for _, exp_i in matched}
    missed = [i for i in range(expected.size) if i not in covered]

    return CleanedAlignment(
        matched=matched,
        missed_expected=missed,
        extra_detected=extra,
        quality=alignment.quality,
    )


def is_alignment_broken(quality: float, *, config: AudioConfig | None = None) -> bool:
    """True when quality is below the 'don't show anything' cutoff (§7).

    <0.4 → we ask the user to re-record instead of reporting garbage.
    (The softer <0.7 warn threshold is applied downstream, where we can
    still show results alongside a caveat.)
    """
    cfg = config or load_audio_config()
    return quality < cfg.alignment.broken_quality
