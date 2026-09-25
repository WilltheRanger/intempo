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

from collections.abc import Callable

import numpy as np
from pydantic import BaseModel

from app.services.alignment import MAX_TEMPO_RATIO, MIN_TEMPO_RATIO

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
    #: The single most unusual thing about this take, ranked across all of the
    #: above, or `None` when nothing clears its own threshold. `None` is the
    #: common case and is the point — see `lead_finding`.
    lead: "Finding | None" = None

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


def steadiness(
    delta_pcts: list[float],
    *,
    positions: list[float] | None = None,
    pulses: list[int] | None = None,
) -> float | None:
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

    **And detrended per stretch of the pulse** (`pulses`, from
    `Delta.pulse`), against written time (`positions`) rather than note count.
    The deltas re-anchor where the musician's pulse breaks, so one line through
    a take with a pause in it was a line through a sawtooth: the owner's take
    of 2026-09-25, steady at 90 against 104 with two pauses, scored 140 — the
    most "uneven" take this app had measured — and was told "Right on average,
    uneven note to note." A stretch too short for a line of its own counts
    around its own mean.
    """
    if len(delta_pcts) < MIN_NOTES_FOR_INSIGHT:
        return None
    return float(np.std(detrended(delta_pcts, positions=positions, pulses=pulses)))


def detrended(
    delta_pcts: list[float],
    *,
    positions: list[float] | None = None,
    pulses: list[int] | None = None,
) -> np.ndarray:
    """Each delta's departure from its own stretch's line — see `steadiness`.

    What a note did against the musician's own pulse, rather than against a
    target tempo held from the first note. Grouping raw deltas by note value
    compared *where in the take* each value fell: on the owner's take at 90
    against 104, the half notes come late in the page and were "lagging" by
    210% of a beat.
    """
    series = np.asarray(delta_pcts, dtype=float)
    x = (
        np.asarray(positions, dtype=float)
        if positions is not None and len(positions) == series.size
        else np.arange(series.size, dtype=float)
    )
    groups = (
        np.asarray(pulses)
        if pulses is not None and len(pulses) == series.size
        else np.zeros(series.size, dtype=int)
    )
    residuals = np.empty_like(series)
    for group in np.unique(groups):
        mask = groups == group
        if mask.sum() >= 3 and float(np.ptp(x[mask])) > 0:
            slope, intercept = np.polyfit(x[mask], series[mask], 1)
            residuals[mask] = series[mask] - (slope * x[mask] + intercept)
        else:
            residuals[mask] = series[mask] - float(np.mean(series[mask]))
    return residuals


#: A bar is timed from its own notes and the first note of the next bar, so
#: the length of its last note counts; one with fewer borrows the bar before.
#:
#: **Five, measured** (2026-09-25, after the owner asked whether the chart
#: should be smoothed). On forty synthetic takes of the owner's piece — a
#: known tempo in every bar, 25 ms of onset jitter, one note in twelve
#: unmatched — three points missed the true tempo by 1.6 BPM on average and
#: by 2.2 on the bars holding one or two notes; five missed by 0.7 and 0.6,
#: and still found a step from 102 to 87 within a BPM or so of either side.
#: Six borrowed across the step and missed it by 9.5. Smoothing the drawn
#: line instead — three bars, weighted by notes — was worse than doing
#: nothing: 5.9 BPM at the 90th percentile against 3.0, because it spreads a
#: real change over the bars beside it. Two was never enough: a tempo from
#: one interval is one note's timing, and a last note paired early read the
#: owner's final bar as 264 BPM.
MIN_NOTES_FOR_BAR_TEMPO = 5


def _pacing(
    written: list[float],
    played: list[float],
    bars: list[int],
    new_stretch: list[bool] | None,
) -> tuple[np.ndarray, Callable[[np.ndarray], float | None]]:
    """The notes' bar numbers in written order, and the pace of any window of
    them — what `tempo_by_bar` and `tempo_across_bars` both fit.

    The window is indices into that order. The pace is seconds played per
    second written: the median slope between every two of the window's notes
    (Theil–Sen), within a stretch, over gaps a believable tempo explains.
    """
    w = np.asarray(written, dtype=float)
    p = np.asarray(played, dtype=float)
    b = np.asarray(bars)
    order = np.argsort(w, kind="stable")
    w, p, b = w[order], p[order], b[order]
    breaks = (
        np.asarray(new_stretch, dtype=bool)[order]
        if new_stretch is not None and len(new_stretch) == w.size
        else np.zeros(w.size, dtype=bool)
    )
    stretch = np.cumsum(breaks)

    def pace(idx: np.ndarray) -> float | None:
        slopes = []
        for i, a in enumerate(idx):
            for c in idx[i + 1 :]:
                if stretch[a] != stretch[c]:
                    continue
                dw, dp = w[c] - w[a], p[c] - p[a]
                if dw > 0 and dp > 0 and MIN_TEMPO_RATIO <= dw / dp <= MAX_TEMPO_RATIO:
                    slopes.append(dp / dw)
        return float(np.median(slopes)) if slopes else None

    return b, pace


def tempo_by_bar(
    written: list[float],
    played: list[float],
    bars: list[int],
    target_bpm: float,
    *,
    new_stretch: list[bool] | None = None,
) -> dict[int, float]:
    """The tempo each bar was played at, in BPM, keyed by bar number.

    **What the verdict's charts plot**, at the owner's request (2026-09-25):
    "have the graph show in a scale of BPM". The per-note deltas are drift
    from where each note would fall at the target tempo from the first note
    on, so a take held steadily at 90 against 104 grows a beat late every
    seven beats — 773% of a beat by bar 24 — and a chart of them sits on its
    floor from bar 2. A bar's own tempo is the same take said the way a
    musician hears it: bars 1–6 at 102, slowing to 87 by bar 9, back to 105.

    `written` and `played` are paired notes' written and played times in
    seconds, in written order; `bars` their bar numbers. Each bar is its notes
    plus the next bar's first note — downbeat to downbeat — and one with fewer
    than `MIN_NOTES_FOR_BAR_TEMPO` points borrows the bars before it, or the
    bars after when the take has none before. `new_stretch` marks notes the
    page does not time from the note before (after a fermata: the held length
    is not written); the fit is pooled within stretches, so a fermata is not
    read as the bar dragging.

    **Robust, because a real take is noisy.** The slope is Theil–Sen's — the
    median of the slopes between every two of the window's notes — rather than
    least squares, and a pair whose gap implies a tempo outside
    `alignment.MIN_TEMPO_RATIO`–`MAX_TEMPO_RATIO` of the target (the range the
    matcher itself believes) is left out: that gap is a stop or a skip, not a
    pace. Least squares on the owner's take (2026-09-25) read its last bar,
    reached with two notes unheard, as 142 BPM, and a bar with one stray
    attack as 148.

    **Not smoothed afterwards**, on purpose: see `MIN_NOTES_FOR_BAR_TEMPO`.
    Thin bars borrow notes instead, so a real change stays where it happened.
    """
    if target_bpm <= 0 or len(written) < 2:
        return {}
    b, pace = _pacing(written, played, bars, new_stretch)

    def downbeat_to_downbeat(k: int) -> np.ndarray:
        idx = np.flatnonzero(b == numbers[k])
        following = np.flatnonzero(b == numbers[k + 1])[:1] if k + 1 < len(numbers) else idx[:0]
        return np.concatenate([idx, following])

    tempi: dict[int, float] = {}
    numbers = list(dict.fromkeys(b.tolist()))
    for k, bar in enumerate(numbers):
        window = downbeat_to_downbeat(k)
        back = k - 1
        while window.size < MIN_NOTES_FOR_BAR_TEMPO and back >= 0:
            window = np.concatenate([np.flatnonzero(b == numbers[back]), window])
            back -= 1
        # The opening bars have nothing before them to borrow, and a piece
        # that opens on a held note would otherwise start its chart at bar 3.
        ahead = k + 1
        while window.size < MIN_NOTES_FOR_BAR_TEMPO and ahead < len(numbers):
            window = np.union1d(window, downbeat_to_downbeat(ahead))
            ahead += 1
        slope = pace(window) if window.size >= MIN_NOTES_FOR_BAR_TEMPO else None
        if slope is not None:
            tempi[int(bar)] = round(target_bpm / slope, 1)
    return tempi


def tempo_across_bars(
    written: list[float],
    played: list[float],
    bars: list[int],
    target_bpm: float,
    first: int,
    last: int,
    *,
    new_stretch: list[bool] | None = None,
) -> float | None:
    """The tempo bars `first` to `last` were played at together, in BPM.

    The same fit as `tempo_by_bar`, over every note of the stretch and the
    next bar's first — what the verdict line quotes for the run of bars it
    names, so its figure is the pace across the run rather than an average of
    the chart's points. `None` when the stretch holds too few notes to say.
    """
    if target_bpm <= 0 or len(written) < 2:
        return None
    b, pace = _pacing(written, played, bars, new_stretch)
    inside = np.flatnonzero((b >= first) & (b <= last))
    if inside.size == 0:
        return None
    after = np.flatnonzero(b > last)[:1]
    window = np.concatenate([inside, after])
    if window.size < MIN_NOTES_FOR_BAR_TEMPO:
        return None
    slope = pace(window)
    return None if slope is None else round(target_bpm / slope, 1)


def insights_for(
    matched: list[tuple[int, int]],
    detected: np.ndarray,
    expected: np.ndarray,
    target_bpm: float,
    delta_pcts: list[float],
    by_note: list[tuple[float, float]] | None = None,
    *,
    target_bpm_for_lead: float | None = None,
    positions: list[float] | None = None,
    pulses: list[int] | None = None,
) -> Insights:
    """Everything above, or an empty `Insights` for a take too small to describe.

    Every field is independently `None`-able rather than the whole object
    being optional: a twelve-note take has a pace and a spread but no
    trustworthy drift, and reporting nothing because one of three is unknowable
    would throw away the two that are.
    """
    played = played_tempo(matched, detected, expected, target_bpm)
    # Note values against the musician's own pulse, not the target's: see
    # `detrended`. Only when the two lists are the same notes, which is how
    # `analyze` builds them.
    if (
        by_note
        and positions is not None
        and len(by_note) == len(delta_pcts) >= MIN_NOTES_FOR_INSIGHT
    ):
        residuals = detrended(delta_pcts, positions=positions, pulses=pulses)
        by_note = [
            (beats, float(r)) for (beats, _), r in zip(by_note, residuals, strict=True)
        ]
    values = timing_by_note_value(by_note or [])
    built = Insights(
        by_note_value=values,
        standout_value=standout_note_value(values),
        played_bpm=None if played is None else round(played, 1),
        tempo_difference_bpm=None if played is None else round(played - target_bpm, 1),
        drift_bpm=(
            lambda d: None if d is None else round(d, 1)
        )(tempo_drift(matched, detected, expected, target_bpm)),
        steadiness_pct=(
            lambda s: None if s is None else round(s, 1)
        )(steadiness(delta_pcts, positions=positions, pulses=pulses)),
    )
    # Ranked last, because it ranks the fields above and cannot be computed
    # until they exist. Returned on a copy rather than mutated, so `Insights`
    # stays something a caller can rely on not changing under them.
    return built.model_copy(
        update={"lead": lead_finding(built, target_bpm_for_lead or target_bpm)}
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



#: What counts as "worth saying" for each candidate, in its own units.
#:
#: **The ranking is only as good as these.** "Furthest from normal" is
#: meaningless across quantities measured in different things — 12 BPM of drift
#: and 11% of a beat of note-value spread are not comparable numbers — so each
#: candidate is divided by the point at which it *starts* being worth a
#: sentence, and the ranking is in multiples of that. A candidate scoring below
#: 1.0 is not reported at all.
#:
#: Every one is a starting value that wants real recordings and an ear, like
#: everything in `[tolerance]`. They are chosen to be roughly equally
#: noticeable rather than equally large:
#:
#:   * **Tempo difference**, as a fraction of the target. 5% is 3 BPM at 60 and
#:     8 at 160 — about where a musician notices a piece is not at the speed
#:     they set.
#:   * **Drift**, lower, because changing speed within one take is a worse
#:     habit than holding a different one and is harder to feel from inside.
#:   * **Note value**, reusing the standout threshold, since a value has
#:     already had to clear it to be a candidate.
#:   * **Steadiness**, at the tolerance bands' own `inner` figure: departure
#:     from your own pace by more than the app calls "on" for a single note.
NOTABLE_TEMPO_SHARE = 0.05
NOTABLE_DRIFT_SHARE = 0.04
NOTABLE_STEADINESS_PCT = 5.0


class Finding(BaseModel):
    """The one thing most worth saying about a take, beyond its verdict."""

    #: Which measurement produced it, for a screen that wants to style or
    #: link them differently. Never shown as-is.
    kind: str
    #: A finished sentence, in the second person, in a musician's units.
    text: str
    #: How many times its own "worth saying" threshold this cleared. Carried
    #: so a screen can choose to stay quiet below some bar of its own, and so
    #: the ranking is inspectable rather than a black box.
    weight: float


def lead_finding(insights: Insights, target_bpm: float) -> Finding | None:
    """The single most unusual thing about this take, or nothing.

    **One finding, chosen per take rather than by fixed priority.** A take
    whose real story is the sixteenths should not lead with a 2 BPM tempo
    difference that nobody would notice, which is what a fixed order gives on
    exactly the takes where the extra sentence would have earned its place.

    Returns `None` when nothing clears its threshold, and that is the common
    case by design: a musician who played the piece at the tempo they set,
    evenly, has already been told so by the verdict, and a second line
    repeating it in other words teaches them that this part of the screen is
    furniture.
    """
    if target_bpm <= 0:
        return None

    candidates: list[Finding] = []

    difference = insights.tempo_difference_bpm
    if difference is not None and insights.played_bpm is not None:
        weight = abs(difference) / (target_bpm * NOTABLE_TEMPO_SHARE)
        candidates.append(
            Finding(
                kind="tempo",
                # The number they set is named, because the finding is the gap
                # between two tempi and one of them is theirs.
                text=(
                    f"You played at {insights.played_bpm:.0f}, "
                    f"not {target_bpm:.0f}."
                ),
                weight=weight,
            )
        )

    drift = insights.drift_bpm
    if drift is not None:
        weight = abs(drift) / (target_bpm * NOTABLE_DRIFT_SHARE)
        direction = "sped up" if drift > 0 else "slowed down"
        candidates.append(
            Finding(
                kind="drift",
                text=f"You {direction} by {abs(drift):.0f} BPM.",
                weight=weight,
            )
        )

    standout = insights.standout_value
    if standout is not None:
        others = [v for v in insights.by_note_value if v is not standout]
        weight_total = sum(v.note_count for v in others)
        baseline = (
            sum(v.mean_delta_pct * v.note_count for v in others) / weight_total
            if weight_total
            else 0.0
        )
        gap = standout.mean_delta_pct - baseline
        name = standout.label or f"{standout.beats:g}-beat notes"
        candidates.append(
            Finding(
                kind="note_value",
                text=(
                    f"Your {name} ran ahead."
                    if gap < 0
                    else f"Your {name} lagged."
                ),
                weight=abs(gap) / NOTE_VALUE_STANDOUT_PCT,
            )
        )

    spread = insights.steadiness_pct
    if spread is not None:
        candidates.append(
            Finding(
                kind="steadiness",
                text="Right on average, uneven note to note.",
                weight=spread / NOTABLE_STEADINESS_PCT,
            )
        )

    worth_saying = [c for c in candidates if c.weight > 1.0]
    if not worth_saying:
        return None
    # **"Right on average" is not said of a take whose average was off.** The
    # owner's take at 90 against 104 (2026-09-25) led with it: its spread
    # cleared its threshold seven times over, the tempo three — real playing
    # is far less even than the synthetic takes `NOTABLE_STEADINESS_PCT` was
    # set against. A tempo worth saying is a tempo the sentence would deny.
    if any(c.kind == "tempo" for c in worth_saying):
        worth_saying = [c for c in worth_saying if c.kind != "steadiness"]
    return max(worth_saying, key=lambda c: c.weight)


# `Insights` names `NoteValueTiming` and `Finding` before either is defined,
# which pydantic resolves only when asked. Done here rather than by
# reordering, because the reading order — the summary first, then the parts it
# is made of — is the order somebody opening this file wants.
Insights.model_rebuild()
