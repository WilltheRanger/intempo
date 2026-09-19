"""What the pipeline already knows about a take and has never said out loud.

Three numbers, none of which needed a new signal — each falls out of data the
alignment computes and discards.

**The pace they actually played at.** `_residuals` fits
`rate, offset = np.polyfit(...)` on every single analysis and returns only the
residuals; `rate` is the take's own pace against the written one. Measured
against takes synthesised at known tempi, `target_bpm / rate` recovers the
played tempo **exactly** — 75.0, 66.7, 60.0, 54.5 and 48.0 BPM against a
target of 60 — so this is not an estimate that needs hedging. A musician who
set 92 and played 100 has never been told so.

**Whether they held it.** A take that starts at 72 and ends at 78 has sped up,
and the verdict as it stands says only that the average was fast. Speeding up
through a passage is one of the commonest things a practising musician does
and one of the hardest to notice from inside.

**How evenly.** The verdict reports the *mean* of the per-note deltas, and two
takes with the same mean are not the same take: ±5 ms every note is control,
while an average of zero made of ±40 ms swings is not. The spread is what
separates them and it is already sitting in `PerNote.delta_pct`.

Expressed as a percentage of one beat wherever it is a timing spread, because
that is the unit the tolerance bands already use and the only one that
compares across tempi — 30 ms is tight at 60 BPM and loose at 160.

A module with tests rather than arithmetic inside `analyze`, for the reason
`CLAUDE.md` §3 gives: "did this report the tempo they actually played" is
exactly the kind of thing that is wrong by a factor somewhere and looks
plausible on every screen it reaches.
"""

from __future__ import annotations

import numpy as np
from pydantic import BaseModel

#: Below this many matched notes, none of these are reported at all.
#:
#: A line through three points is not a pace and a spread over three deltas is
#: not a habit. The alignment already refuses takes this small for its own
#: reasons; this is the independent floor for *describing* one, and it is
#: deliberately higher than the two points a fit mathematically needs.
MIN_NOTES_FOR_INSIGHT = 8

#: How much of the take each end of the drift comparison uses.
#:
#: Thirds rather than halves, so the two windows do not touch: a musician who
#: settles in the middle and holds it should not read as drift because the two
#: halves share their boundary. The middle third is deliberately ignored.
DRIFT_WINDOW_SHARE = 1 / 3


class Insights(BaseModel):
    """What can honestly be said about a take beyond its verdict.

    A pydantic model rather than a dataclass, unlike `AlignmentResult` beside
    it, because this one is *serialised* — it is nested in `AnalysisResult` and
    reaches the app. Defining it here and mirroring it there would be two
    declarations of the same four fields, which is how the second one stops
    being updated.
    """

    #: The pace actually played, in the same beat unit as the target.
    played_bpm: float | None = None
    #: Played minus target. Positive is faster than asked for.
    tempo_difference_bpm: float | None = None
    #: Last third's pace minus the first third's. Positive is speeding up.
    drift_bpm: float | None = None
    #: Spread of the per-note timing deltas, as a percentage of one beat.
    #: Low is even playing, whatever the average was.
    steadiness_pct: float | None = None
    #: The take split by written note value, longest first.
    by_note_value: list["NoteValueTiming"] = []
    #: The one written value that behaves differently from the rest, if any —
    #: "your quarters are fine and your sixteenths run away".
    standout_value: "NoteValueTiming | None" = None

    def as_dict(self) -> dict:
        return self.model_dump()


def _pace(detected: np.ndarray, expected: np.ndarray) -> float | None:
    """Seconds of recording per second of written music, by least squares.

    Returns `None` rather than a number when the written times do not span
    anything — a take matched entirely onto one written instant has no pace,
    and `polyfit` would happily return a slope for it.
    """
    if detected.size < 2 or float(np.ptp(expected)) <= 0:
        return None
    slope, _ = np.polyfit(expected, detected, 1)
    return float(slope) if slope > 0 else None


def played_tempo(
    matched: list[tuple[int, int]],
    detected: np.ndarray,
    expected: np.ndarray,
    target_bpm: float,
) -> float | None:
    """The tempo the musician actually played, in BPM.

    A slope of 1.2 means every written second took 1.2 recorded seconds, so
    the take is slower than written by that factor and the pace is
    `target / 1.2`. Verified exact against synthesised takes at five known
    tempi; see the module docstring.

    Only the matched pairs, because an unmatched detection is by definition
    not a note whose written time is known, and including it would fit a line
    through a point that has no x-coordinate.
    """
    if len(matched) < MIN_NOTES_FOR_INSIGHT or target_bpm <= 0:
        return None

    det = np.array([detected[d] for d, _ in matched], dtype=float)
    exp = np.array([expected[e] for _, e in matched], dtype=float)
    slope = _pace(det, exp)
    return None if slope is None else target_bpm / slope


def tempo_drift(
    matched: list[tuple[int, int]],
    detected: np.ndarray,
    expected: np.ndarray,
    target_bpm: float,
) -> float | None:
    """How much faster the end of the take is than its beginning, in BPM.

    Positive means speeding up. Measured as the pace of the last third minus
    the pace of the first third, with the middle third ignored so the two
    windows cannot share a boundary and report a settled take as drifting.

    **This is not the same as playing fast**, and the difference is the point.
    A take played evenly at 100 against a target of 92 has a large tempo
    difference and no drift; one that starts at 92 and finishes at 108 has
    roughly the same average and is the take that needs work. The verdict as
    it stands cannot tell them apart.

    `None` when either window is too short to have a pace of its own — which
    is a stricter requirement than the overall figure, and deliberately so:
    a drift number computed from four notes at each end would move with any
    single mistimed note.
    """
    if len(matched) < 3 * MIN_NOTES_FOR_INSIGHT or target_bpm <= 0:
        return None

    window = int(len(matched) * DRIFT_WINDOW_SHARE)
    if window < MIN_NOTES_FOR_INSIGHT:
        return None

    def pace_of(pairs: list[tuple[int, int]]) -> float | None:
        det = np.array([detected[d] for d, _ in pairs], dtype=float)
        exp = np.array([expected[e] for _, e in pairs], dtype=float)
        slope = _pace(det, exp)
        return None if slope is None else target_bpm / slope

    opening = pace_of(matched[:window])
    closing = pace_of(matched[-window:])
    if opening is None or closing is None:
        return None
    return closing - opening


def steadiness(delta_pcts: list[float]) -> float | None:
    """How much the timing varies around the take's *own* pace, in % of a beat.

    The number the verdict cannot carry. Two takes averaging zero are not the
    same take: one is ±5 ms a note and the other swings ±40, and only the
    second has something to practise. A standard deviation because that is the
    shape of the question — how far from your own line are you, typically —
    rather than a range, which one bad note owns.

    **Detrended first, and the first version was not.** Measured end to end, a
    take played *perfectly evenly* at 75 BPM against a target of 60 scored
    138.5 — worse than one with genuine ±60 ms swings, which scored 6.0. The
    reason is that playing at a steady different tempo makes the delta grow
    note after note, so the raw spread is dominated by a slope and the figure
    merely restates `tempo_difference_bpm` in another unit. Removing the line
    leaves the thing a musician would call unsteadiness: departure from their
    own pace, whatever pace they chose.

    Percentage of a beat rather than milliseconds, matching `Tolerance`: 30 ms
    is tight at 60 BPM and loose at 160, so a figure in milliseconds cannot be
    compared with the same musician's take last week at a different tempo,
    which is the comparison this exists to make possible.
    """
    if len(delta_pcts) < MIN_NOTES_FOR_INSIGHT:
        return None

    series = np.asarray(delta_pcts, dtype=float)
    index = np.arange(series.size, dtype=float)
    slope, intercept = np.polyfit(index, series, 1)
    return float(np.std(series - (slope * index + intercept)))


def insights_for(
    matched: list[tuple[int, int]],
    detected: np.ndarray,
    expected: np.ndarray,
    target_bpm: float,
    delta_pcts: list[float],
    by_note: list[tuple[float, float]] | None = None,
) -> Insights:
    """Everything above, or an empty `Insights` for a take too small to describe.

    Every field is independently `None`-able rather than the whole object
    being optional: a twelve-note take has a pace and a spread but no
    trustworthy drift, and reporting nothing because one of three is unknowable
    would throw away the two that are.
    """
    played = played_tempo(matched, detected, expected, target_bpm)
    values = timing_by_note_value(by_note or [])
    return Insights(
        by_note_value=values,
        standout_value=standout_note_value(values),
        played_bpm=None if played is None else round(played, 1),
        tempo_difference_bpm=None if played is None else round(played - target_bpm, 1),
        drift_bpm=(
            lambda d: None if d is None else round(d, 1)
        )(tempo_drift(matched, detected, expected, target_bpm)),
        steadiness_pct=(
            lambda s: None if s is None else round(s, 1)
        )(steadiness(delta_pcts)),
    )


#: How many notes of one written value before it is worth reporting.
#:
#: Higher than `MIN_NOTES_FOR_INSIGHT`, because this is a *comparison* between
#: groups rather than a description of one: telling a musician "you rush your
#: sixteenths" off four sixteenths is telling them about four notes.
MIN_NOTES_PER_VALUE = 6

#: How far a note value's average must sit from the take's own average before
#: it is called out, in percent of a beat.
#:
#: A starting value that wants a real recording and an ear, like everything in
#: `[tolerance]`. It is deliberately above the tolerance bands' `inner` 5.0:
#: the claim being made is not "these notes were off" — the verdict already
#: says that — but "these notes were off *differently from the rest*", which
#: has to clear the noise between groups before it is worth a sentence.
NOTE_VALUE_STANDOUT_PCT = 6.0

#: Written lengths in beats, and what a musician calls them.
#:
#: A table rather than arithmetic on the beat count, because the names are not
#: derivable — 1.5 beats is a dotted quarter only in a simple metre, and the
#: honest thing for anything unlisted is to say nothing rather than invent a
#: name. Unmatched values are grouped and reported by their beat count.
_NOTE_VALUE_NAMES: dict[float, str] = {
    4.0: "whole notes",
    3.0: "dotted half notes",
    2.0: "half notes",
    1.5: "dotted quarter notes",
    1.0: "quarter notes",
    0.75: "dotted eighth notes",
    0.5: "eighth notes",
    0.375: "dotted sixteenth notes",
    0.25: "sixteenth notes",
    0.125: "thirty-second notes",
}


class NoteValueTiming(BaseModel):
    """How one written note value was timed, across the whole take."""

    beats: float
    #: What a musician calls it, or `None` for a length with no plain name.
    label: str | None = None
    note_count: int
    #: Mean timing delta for this value, in percent of a beat. Negative is early.
    mean_delta_pct: float


def timing_by_note_value(
    per_note: list[tuple[float, float]],
) -> list[NoteValueTiming]:
    """The take split by what was written, longest value first.

    **The insight a metronome cannot give.** A metronome tells a musician they
    were fast; it cannot tell them *their quarters were fine and their
    sixteenths ran away*, which is the difference between "practise this" and
    "practise this bit, slowly". The pipeline has always known the written
    length of every note and has never grouped by it.

    `per_note` is `(beats, delta_pct)` for the timed notes only — the same set
    the verdict is built from, so the two cannot disagree about which notes
    counted.
    """
    grouped: dict[float, list[float]] = {}
    for beats, delta_pct in per_note:
        grouped.setdefault(round(float(beats), 4), []).append(float(delta_pct))

    out = [
        NoteValueTiming(
            beats=beats,
            label=_NOTE_VALUE_NAMES.get(beats),
            note_count=len(deltas),
            mean_delta_pct=round(float(np.mean(deltas)), 1),
        )
        for beats, deltas in grouped.items()
        if len(deltas) >= MIN_NOTES_PER_VALUE
    ]
    return sorted(out, key=lambda v: v.beats, reverse=True)


def standout_note_value(
    values: list[NoteValueTiming],
) -> NoteValueTiming | None:
    """The one written value that behaves differently from the rest, if any.

    **Different from the take's own average, not different from zero.** A take
    that rushed throughout has every value rushing, and naming one of them
    would be reporting the verdict twice under a new heading. What is worth a
    sentence is the value that departs from what this musician did everywhere
    else — the sixteenths in an otherwise steady take.

    Needs at least two groups to compare, and the comparison excludes the
    candidate from the baseline it is measured against, so a value that
    dominates the page cannot make itself stand out from an average it
    supplies most of.
    """
    if len(values) < 2:
        return None

    best: NoteValueTiming | None = None
    best_gap = NOTE_VALUE_STANDOUT_PCT

    for candidate in values:
        others = [v for v in values if v is not candidate]
        weight = sum(v.note_count for v in others)
        if weight == 0:
            continue
        baseline = sum(v.mean_delta_pct * v.note_count for v in others) / weight
        gap = abs(candidate.mean_delta_pct - baseline)
        if gap > best_gap:
            best, best_gap = candidate, gap

    return best


# `Insights` names `NoteValueTiming` before it is defined, which pydantic
# resolves only when asked. Done here rather than by reordering, because the
# reading order — the summary first, then the breakdown it contains — is the
# order somebody opening this file wants.
Insights.model_rebuild()
