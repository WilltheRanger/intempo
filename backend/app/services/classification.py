"""Layer 3 of the audio pipeline: matched onsets → deltas, bands, verdict.

Given the cleaned alignment, this module answers the two questions the
user actually cares about:
  - per note: "did I rush or drag this note, and by how much?"
    (`compute_deltas` + `classify_band`)
  - overall: "am I systematically drifting across the page?"
    (`rolling_trend` + `generate_verdict`)

Sign convention throughout: delta_ms = actual - expected. Negative means
the note landed EARLY = rushing = "ahead"; positive means LATE =
dragging = "behind". The trend/verdict flip this to rush-positive so
"ahead" reads as a positive number, matching spec §4.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Literal

import numpy as np

from app.services.alignment import CleanedAlignment, ExpectedTimeline, pulse_anchors
from app.services.score_schema import TempoSpan
from app.services.audio_config import AudioConfig, load_audio_config


class Band(str, Enum):
    on = "on"  # within tolerance — green
    slight = "slight"  # slight rush/drag — yellow
    rush_drag = "rush_drag"  # clear rush/drag — orange
    severe = "severe"  # severe — red


class Direction(str, Enum):
    rush = "rush"  # ahead / early
    drag = "drag"  # behind / late
    on = "on"  # within the inner tolerance band


#: Why a note's deviation was not measured against a time the page states.
#:
#: A closed set rather than a sentence, so the app writes the words a musician
#: reads and the pipeline only says which case it is. The three are genuinely
#: different things — a tempo change is the page withdrawing the steady beat, a
#: fermata is the page handing one length to the player, an ornament is *this
#: code* having guessed — and only the last is a limitation rather than
#: notation.
UntimedReason = Literal["tempo_change", "fermata", "ornament"]


@dataclass
class Delta:
    global_index: int
    measure_number: int
    expected_ms: float
    actual_ms: float
    delta_ms: float  # actual - expected (negative = rushing)
    delta_pct: float  # delta_ms as % of one beat (signed)
    band: Band
    direction: Direction
    is_slur_interior: bool
    #: A written tempo change covers this note's measure.
    #:
    #: `band` and `direction` are forced to `on` here, and that is not a
    #: softening — it is a refusal to answer a question the page has made
    #: meaningless. The bands measure distance from a steady beat; `rit.` says
    #: the beat stops being steady. What replaces them is `uneven_measures`,
    #: which asks whether the *change* was made smoothly.
    under_tempo_change: bool = False
    #: The slowing or speeding lurched at this note, rather than flowing.
    #: Always false outside a tempo change.
    uneven: bool = False
    #: This note's deviation was measured against a time the **page states**.
    #:
    #: False for the four cases `band` is forced to `on` for, which are not the
    #: same reason wearing four names: a `rit.` says the beat stops being
    #: steady; a fermata says one length is not written down at all; an ornament
    #: and the note it decorates are placed by `ORNAMENT_SHARE`, a number this
    #: code invented. In every one of them the deviation is real and it is not
    #: an error, so anything that averages, plots or judges deltas has to be
    #: able to leave them out — and `under_tempo_change` alone only covered the
    #: first. Default True so a `Delta` built without it behaves as before.
    timed: bool = True
    #: Which of those it was, when `timed` is false. `None` when it is true.
    #:
    #: **The app said "Not timed" and stopped there**, which reads as the app
    #: failing rather than as the page speaking. It is not the same sentence as
    #: "this bar is held" — one is an apology and the other is a reading. The
    #: reason was known at exactly this line and thrown away one field short of
    #: the screen that needed it.
    untimed_reason: UntimedReason | None = None
    #: Which stretch of the musician's pulse this note was measured in: it
    #: counts up each time the reference re-anchors (`pulse_anchors`, and a
    #: skip in a pairing made by pitch). Deltas are drift *within* a stretch,
    #: so anything fitting a line through them — `insights.steadiness` — has
    #: to fit one per stretch: across a re-anchor the delta jumps, and one line
    #: through the jump measured the jump.
    pulse: int = 0


def classify_band(delta_pct: float, *, config: AudioConfig | None = None) -> Band:
    """Classify a signed per-beat % deviation into a tolerance band (§4).

    Thresholds are asymmetric: rushing and dragging have independent
    inner/mid/outer cutoffs (humans tolerate dragging more). The sign of
    `delta_pct` selects which set to use.
    """
    cfg = config or load_audio_config()
    tol = cfg.tolerance
    magnitude = abs(delta_pct)
    if delta_pct < 0:  # rushing / ahead
        inner, mid, outer = tol.rushing_inner_pct, tol.rushing_mid_pct, tol.rushing_outer_pct
    else:  # dragging / behind
        inner, mid, outer = tol.dragging_inner_pct, tol.dragging_mid_pct, tol.dragging_outer_pct
    if magnitude <= inner:
        return Band.on
    if magnitude <= mid:
        return Band.slight
    if magnitude <= outer:
        return Band.rush_drag
    return Band.severe


def _direction(delta_pct: float, band: Band) -> Direction:
    if band is Band.on:
        return Direction.on
    return Direction.rush if delta_pct < 0 else Direction.drag


#: How far one interval's growth may depart from the take's own habit before
#: the change reads as a lurch rather than a slowing.
#:
#: Deliberately the same shape as the pulse threshold, and for the same reason:
#: an even ritardando lengthens each interval by about the same amount, so the
#: thing being detected is one interval that lengthens far more than this
#: player usually does. Measured, as mean deviation from a fitted curve:
#: an even rit. reads 9 ms where a good player's jitter reads 8, and a lurch
#: reads 44.
def uneven_measures(
    cleaned: CleanedAlignment,
    detected: np.ndarray,
    timeline: ExpectedTimeline,
    *,
    config: AudioConfig | None = None,
) -> set[int]:
    """Measures where a written tempo change was made unevenly.

    **Why not a curve fit.** Removing a quadratic separates an even change from
    a lurching one cleanly — 9 ms against 44 — but it cannot say *where*.
    Holding one bar back gave per-bar residuals of 39, 91, 162, 213 across four
    bars: the bar *after* the disturbance read worse than the bar that lurched,
    because a global fit smears a local fault across the whole span. That is
    the same failure as fitting one line across a hesitation.

    So this measures how much each interval **grew**, against what this take
    usually does — `pulse_anchors` one derivative up. An even slowing lengthens
    each interval by about the same amount, so a lurch is an interval that
    grows far more than its neighbours did.

    Only notes the score marks are considered. A take with no written change
    returns nothing, and this is never a reason to call a note late: it answers
    a different question from the tolerance bands and never overrides them.
    """
    cfg = config or load_audio_config()
    positions = [
        index
        for index, (_, exp_i) in enumerate(cleaned.matched)
        if timeline.notes[exp_i].under_tempo_change
    ]
    # Two intervals are the least that can have a change between them, so three
    # notes are the least that can be uneven.
    if len(positions) < 4:
        return set()

    times = np.array(
        [detected[cleaned.matched[p][0]] for p in positions], dtype=float
    )
    gaps = np.diff(times)
    growth = np.diff(gaps)
    centre = float(np.median(growth))
    spread = float(np.median(np.abs(growth - centre)))
    limit = max(
        cfg.tolerance.disturbance_deviations * spread,
        cfg.tolerance.disturbance_floor_beats * float(np.median(gaps)),
    )

    uneven: set[int] = set()
    for offset, value in enumerate(growth):
        if abs(value - centre) > limit:
            # `growth[k]` compares the interval ending at note k+2 with the one
            # before it, so the note that lurched is k+2.
            note = timeline.notes[cleaned.matched[positions[offset + 2]][1]]
            uneven.add(note.measure_number)
    return uneven


def skipped_ahead(
    matched: list[tuple[int, int]],
    detected: np.ndarray,
    onsets: np.ndarray,
) -> list[int]:
    """Where in `matched` the take went straight past written notes.

    Positions `p` such that `matched[p]` is the first pair after a run of
    written notes nobody played — and nobody *waited through*: the attack
    arrives one of the take's own intervals after the last one, not after the
    written length of the notes in between.

    **A skipped bar is not rushing.** Skip bar 4 and every note from bar 5 on
    arrives a bar early against the page. Measured before this: "You rushed
    bars 4–5 by 171 BPM" on a take whose every note was steady. A note that
    was played and not *heard* is the other case, and stays as it was: its
    time was spent, so the next attack arrives where the page puts it.

    Read against the take's own pace (the median of its per-interval rates,
    as `alignment._residuals` reads it), so practising at half speed does not
    turn every gap into a skip: at a gap, a skip is closer to one played
    interval than to the whole written span.
    """
    if len(matched) < 3:
        return []
    det = np.array([detected[d] for d, _ in matched], dtype=float)
    exp = np.array([onsets[e] for _, e in matched], dtype=float)
    written_steps = np.diff(exp)
    usable = written_steps > 0
    if not usable.any():
        return []
    pace = float(np.median(np.diff(det)[usable] / written_steps[usable]))
    if not np.isfinite(pace) or pace <= 0:
        return []
    skips: list[int] = []
    for p in range(1, len(matched)):
        e1, e2 = matched[p - 1][1], matched[p][1]
        if e2 - e1 < 2:
            continue
        written = float(onsets[e2] - onsets[e1])
        one = float(onsets[e1 + 1] - onsets[e1])
        played = float(det[p] - det[p - 1]) / pace
        # Nearer to one interval than to the whole span: the notes between
        # were gone past, not waited through.
        if played < (written + one) / 2:
            skips.append(p)
    return skips


def skipped_notes(
    matched: list[tuple[int, int]],
    detected: np.ndarray,
    onsets: np.ndarray,
) -> set[int]:
    """The written notes a take went straight past (`skipped_ahead`)."""
    return {
        e
        for p in skipped_ahead(matched, detected, onsets)
        for e in range(matched[p - 1][1] + 1, matched[p][1])
    }


def compute_deltas(
    cleaned: CleanedAlignment,
    detected: np.ndarray,
    timeline: ExpectedTimeline,
    target_bpm: float,
    *,
    config: AudioConfig | None = None,
    by_pitch: bool = False,
) -> list[Delta]:
    """Per matched note-pair, compute the timing delta in ms and % of beat.

    The recording's lead-in latency (reaction time before the first note) is
    not a timing error, so the origin sits where the take starts: the level its
    opening notes agree on, and every later note is measured as drift from that
    start. Read from several notes rather than from the first alone, because
    one note's error used to be copied onto all the others — see
    `alignment._settled_level`.
    Gradual rushing therefore shows up as a *growing* delta, which is what the
    trend and the verdict key on, and it has to stay that way — the rushing
    fixture drifts 8 ms a beat, and anything that measures each note against
    only its neighbour reports that as steady.

    The origin is not fixed for the whole take, though. It follows the
    musician's pulse across a break in it — see `_pulse_anchors` — and, for a
    pairing made by pitch (`by_pitch`), across a bar the take skipped — see
    `skipped_ahead`. Only by pitch: a timing pairing that lost notes to a live
    room looks exactly like one that went past them, and only the pitches can
    say which it was.
    """
    cfg = config or load_audio_config()
    detected = np.asarray(detected, dtype=float)
    beat_ms = (60.0 / target_bpm) * 1000.0 if target_bpm > 0 else 500.0

    if not cleaned.matched:
        return []

    offsets = np.array(
        [detected[d] - timeline.onsets[e] for d, e in cleaned.matched], dtype=float
    )
    # The level each stretch sits at is read from the notes whose written time
    # the page states — see `alignment._settled_level`. An ornament, the note
    # it decorates, a note arriving after a fermata, a note under a `rit.` or a
    # slur: none of them is a claim about where the beat is.
    usable = np.array(
        [
            not (
                timeline.notes[e].under_tempo_change
                or timeline.notes[e].after_fermata
                or timeline.notes[e].is_grace_note
                or timeline.notes[e].after_grace_note
                or timeline.notes[e].is_slur_interior
            )
            for _, e in cleaned.matched
        ],
        dtype=bool,
    )
    positions = np.array([timeline.onsets[e] for _, e in cleaned.matched], dtype=float)
    # Each stretch between two skips is its own pulse: the jump across a skip
    # is where the page went, not where the player's beat did.
    skips = skipped_ahead(cleaned.matched, detected, timeline.onsets) if by_pitch else []
    bounds = [0, *skips, offsets.size]
    anchors = np.concatenate(
        [
            pulse_anchors(
                offsets[a:b],
                beat_ms / 1000.0,
                config=cfg,
                positions=positions[a:b],
                usable=usable[a:b],
            )
            for a, b in zip(bounds[:-1], bounds[1:], strict=True)
        ]
    )

    uneven = uneven_measures(cleaned, detected, timeline, config=cfg)

    # A new stretch wherever the reference moves.
    pulse = np.concatenate([[0], np.cumsum(np.diff(anchors) != 0)]) if anchors.size else anchors
    deltas: list[Delta] = []
    for position, (det_i, exp_i) in enumerate(cleaned.matched):
        note = timeline.notes[exp_i]
        expected_ms = timeline.onsets[exp_i] * 1000.0
        actual_ms = (detected[det_i] - anchors[position]) * 1000.0
        delta_ms = actual_ms - expected_ms
        # A share of *this bar's* beat: under a "meno mosso" the beat is longer,
        # and the same few milliseconds are a smaller part of it.
        note_beat_ms = note.beat_s * 1000.0 if note.beat_s else beat_ms
        delta_pct = (delta_ms / note_beat_ms) * 100.0 if note_beat_ms else 0.0
        # Under a written change the grid bands are not softened, they are
        # refused: they measure distance from a steady beat and the page has
        # said the beat is not steady. Forcing `on` here is also what keeps a
        # screen from painting a rushing colour on a bar that was played
        # exactly as marked, and what keeps `generate_verdict`'s run-finder —
        # which skips notes inside tolerance — away from them.
        # A fermata is the same refusal for a narrower reason. `rit.` says the
        # beat stops being steady; a fermata says *this one length is not
        # written down at all* — the mark exists precisely to hand it to the
        # player. So the interval after it cannot be measured against a written
        # value, and `pulse_anchors` cannot help: it cannot tell a hold from a
        # hesitation, and for a hesitation keeping the drift is right.
        # A grace note is the third case, and the narrowest: the page prints
        # the ornament without stating when it sounds, so both it and the note
        # it decorates are placed here by an assumption this code made — see
        # `ORNAMENT_SHARE`. Timing a musician against a number we invented is
        # the one thing that would be worse than not placing them at all.
        # **Ordered, and the order is a statement about what to say first.** A
        # note can be under a `rit.` *and* after a fermata; the tempo change is
        # the broader fact — it covers a passage rather than one length — so it
        # is named first. The ornament pair comes last because it is the
        # narrowest: it describes two notes, not a bar.
        reason: UntimedReason | None = (
            "tempo_change"
            if note.under_tempo_change
            else "fermata"
            if note.after_fermata
            else "ornament"
            if note.is_grace_note or note.after_grace_note
            else None
        )
        timed = reason is None
        band = classify_band(delta_pct, config=cfg) if timed else Band.on
        deltas.append(
            Delta(
                global_index=note.global_index,
                measure_number=note.measure_number,
                expected_ms=round(expected_ms, 2),
                actual_ms=round(actual_ms, 2),
                delta_ms=round(delta_ms, 2),
                delta_pct=round(delta_pct, 2),
                band=band,
                direction=_direction(delta_pct, band),
                is_slur_interior=note.is_slur_interior,
                pulse=int(pulse[position]),
                untimed_reason=reason,
                under_tempo_change=note.under_tempo_change,
                uneven=note.measure_number in uneven,
                timed=timed,
            )
        )
    return deltas


def rolling_trend(
    deltas: list[Delta] | list[float],
    *,
    window: int | None = None,
    config: AudioConfig | None = None,
) -> list[float]:
    """Rolling mean of the rush-positive per-beat deviation (§4).

    Accepts either `Delta` objects or a raw list of signed %-of-beat
    values. Output is rush-positive (ahead = +), length equal to the
    input, using an expanding window until `window` samples are
    available (so the first few notes still get a value).

    Two kinds of note are excluded. **Slur-interior** ones, because their
    timing is musically free. And notes that were **not timed** at all, for a
    stronger reason: `compute_deltas` refuses to band them — a `rit.`, a
    fermata, an ornament and the note it decorates — so their deviation is real
    and is not an error. Leaving them in drew a trend line diving at the end of
    any piece that closes with a `rit.`, on the same screen whose measure list
    says those bars were not timed.

    `timed` rather than `under_tempo_change`: this excluded the ritardando and
    left the fermata and the ornament in, which is the same mistake one name
    narrower.
    """
    cfg = config or load_audio_config()
    win = window if window is not None else cfg.trend.window

    if deltas and isinstance(deltas[0], Delta):
        values = [
            -d.delta_pct  # rush-positive
            for d in deltas
            if not d.is_slur_interior and d.timed
        ]
    else:
        values = [float(v) for v in deltas]  # type: ignore[arg-type]

    if not values:
        return []
    arr = np.asarray(values, dtype=float)
    out: list[float] = []
    for i in range(arr.size):
        start = max(0, i - win + 1)
        out.append(round(float(arr[start : i + 1].mean()), 2))
    return out


@dataclass
class Verdict:
    text: str
    direction: Direction
    start_measure: int | None = None
    end_measure: int | None = None
    avg_bpm_delta: float | None = None


@dataclass(frozen=True)
class BarTempi:
    """The tempo each bar was played at, and the tempo of any run of them.

    `by_bar` is what the verdict's charts draw (`insights.tempo_by_bar`);
    `across(first, last)` fits bars `first` to `last` as one stretch
    (`insights.tempo_across_bars`) — the figure a sentence about that run
    quotes. Built for a take by `analysis.bar_pacing`.
    """

    by_bar: Mapping[int, float]
    across: Callable[[int, int], float | None]
    #: The tempo each bar is judged against, where the page changes it
    #: ("meno mosso", a new metronome mark: `score_schema.targets_by_measure`).
    #: A bar not listed is judged against the take's target.
    targets: Mapping[int, float] = field(default_factory=dict)

    def target(self, bar: int, target_bpm: float) -> float:
        return self.targets.get(bar, target_bpm)


#: The fewest consecutive notes that make a drift worth naming on their own.
#:
#: **Two was enough, and two is what chance produces.** A take with no drift
#: at all — only the timing spread of a good player, each note independently a
#: few milliseconds either side — was told it rushed or dragged on 14 of 40
#: seeds at a 12 ms spread and 29 of 40 at 18 ms, every time on the strength of
#: two notes that happened to fall just outside the inner band on the same
#: side. Four in a row is where that stops happening by chance and a bar of
#: genuine rushing still clears it.
MIN_VERDICT_RUN = 4

#: Bands past the middle one. A shorter run still counts when every note in it
#: is this far out — two notes a fifth of a beat late are a real lurch, and
#: chance does not put two consecutive notes there.
_CLEAR_BANDS = frozenset({Band.rush_drag, Band.severe})


def _run_is_worth_naming(run: list[Delta]) -> bool:
    """Long enough, or far enough out, that chance does not explain it."""
    if len(run) >= MIN_VERDICT_RUN:
        return True
    return len(run) >= 2 and all(d.band in _CLEAR_BANDS for d in run)


@dataclass(frozen=True)
class _BarRun:
    first: int
    last: int
    rushing: bool


@dataclass(frozen=True)
class _Edges:
    """The bars at each end of a take given to settling in and winding down.

    **The owner, 2026-09-25**: "it takes time to count tempo and same with the
    end". A musician comes in off a count-in and finds the beat over the first
    bar or two, and eases off over the last notes. The verdict line named both
    as the take's problem — "Bars 1–2 went at 89." over a take on the beat
    from bar 3 to the end — and, where a real run in the middle was the same
    length, named them instead of it, being the earlier.

    So a run of bars, or of notes, lying wholly inside the first or the last
    `settling_bars` bars the take played is not named. One reaching past them
    is, whole and from bar 1: three slow bars from the top are a tempo, not an
    entrance. The ends shrink on a short take so that at least one bar is
    neither — on a three-bar passage only bars 1 and 3 are ends. The chart
    still draws every bar as it was played; only the sentence is spared.
    """

    start: frozenset[int]
    end: frozenset[int]

    def hold(self, bars: set[int]) -> bool:
        """Whether these bars lie wholly inside one end."""
        return bool(bars) and (bars <= self.start or bars <= self.end)


def _edges(judged: list[Delta], settling_bars: int) -> _Edges:
    # The bars the take played, a written tempo change included: the bar
    # before a closing "rit." is not the end.
    played = sorted(
        {d.measure_number for d in judged if d.timed or d.under_tempo_change}
    )
    size = min(settling_bars, (len(played) - 1) // 2)
    if size <= 0:
        return _Edges(frozenset(), frozenset())
    return _Edges(frozenset(played[:size]), frozenset(played[-size:]))


def _longest_bar_run(
    judged: list[Delta],
    tempi: BarTempi,
    target_bpm: float,
    config: AudioConfig,
    edges: _Edges,
) -> tuple[_BarRun | None, frozenset[int]]:
    """The longest run of bars played off the target the same way, by the
    tempo each bar was played at — the numbers the verdict's chart draws.

    **Why bars and not notes** (the owner, 2026-09-25, choosing "match the
    graph"). The note rule reads drift from the target held since the first
    note, so in a take played steadily slow every note is behind and the run
    is simply the longest stretch between two re-anchors: "You dragged bars
    1–12 by 7 BPM" under a chart whose bars 18–25 sat at 78 against 104. A
    bar's own tempo says where the take was off, and by how much, the way the
    chart shows it.

    Each bar is banded exactly as the bar card bands it — `(1 − bpm/target) ×
    100`, the number `lib/verdict/barTempo.ts` classifies, in this module's
    sign (positive is behind). Bars with nothing timed or under a written
    tempo change are left out rather than counted as on tempo, as untimed
    notes are in the note rule: the page asked for another tempo there, or
    there was nothing to time. A run must hold `MIN_VERDICT_RUN` timed notes,
    and one bar alone is named only when it is clearly out
    (`_CLEAR_BANDS`) — a single bar's tempo is the least certain on the chart.
    The longest run by bars wins; then by notes; then the earlier.

    A run wholly inside the take's first or last bars is settling in or
    winding down, and is passed over (`_Edges`). The second value is the bars
    passed over that way, which the note rule must leave out too.
    """
    timed: dict[int, int] = defaultdict(int)
    changed: set[int] = set()
    for d in judged:
        if d.under_tempo_change:
            changed.add(d.measure_number)
        if d.timed:
            timed[d.measure_number] += 1

    bars: list[tuple[int, int, Band, int]] = []  # bar, sign, band, timed notes
    for bar, bpm in sorted(tempi.by_bar.items()):
        if bpm <= 0 or not timed.get(bar) or bar in changed:
            continue
        pct = (1.0 - bpm / tempi.target(bar, target_bpm)) * 100.0
        band = classify_band(pct, config=config)
        sign = 0 if band is Band.on else (1 if pct > 0 else -1)
        bars.append((bar, sign, band, timed[bar]))

    best: _BarRun | None = None
    best_key = (0, 0)
    spared: set[int] = set()
    i = 0
    while i < len(bars):
        sign = bars[i][1]
        if sign == 0:
            i += 1
            continue
        j = i
        while j + 1 < len(bars) and bars[j + 1][1] == sign:
            j += 1
        run = bars[i : j + 1]
        notes = sum(n for *_, n in run)
        where = {bar for bar, *_ in run}
        if edges.hold(where):
            spared |= where
            i = j + 1
            continue
        worth = notes >= MIN_VERDICT_RUN and (
            len(run) >= 2 or run[0][2] in _CLEAR_BANDS
        )
        if worth and (len(run), notes) > best_key:
            best_key = (len(run), notes)
            best = _BarRun(first=run[0][0], last=run[-1][0], rushing=sign < 0)
        i = j + 1
    return best, frozenset(spared)


#: How many notes after the opening the take's settled level is read from.
_SETTLED_NOTES = 3


def _without_spared_ends(
    timed: list[Delta], spared: frozenset[int], edges: _Edges, config: AudioConfig
) -> list[Delta]:
    """The notes the note rule reads once an entrance or ending is spared.

    The spared bars' own notes go: the note rule may not name what the bar
    rule passed over — a take on tempo that eased off over its last two bars
    was otherwise "Bars 1–8 went at 96."

    And after a spared entrance, the rest is measured from where the take
    settled. Deltas are drift from the take's level at its first notes, so an
    entrance off the tempo is carried into every note after it: a first bar
    at 86 against 100 leaves the rest a third of a beat behind, however well
    they kept time, and the note rule read that as "Bars 1–12 fell behind."
    The level the take settled at is taken off the notes that follow in the
    same stretch of pulse (a re-anchor has already done this for any later
    one), and they are banded again.
    """
    kept = [d for d in timed if d.measure_number not in spared]
    entrance = spared & edges.start
    # Read from after the whole entrance: with bar 1 on the beat and bar 2
    # spared, bar 1's notes sit before the lag and would read it as none.
    settled = [d for d in kept if entrance and d.measure_number > max(entrance)]
    if not settled:
        return kept
    pulse = settled[0].pulse
    same = [d for d in settled if d.pulse == pulse]
    level_pct = float(np.median([d.delta_pct for d in same[:_SETTLED_NOTES]]))
    level_ms = float(np.median([d.delta_ms for d in same[:_SETTLED_NOTES]]))
    out: list[Delta] = []
    for d in kept:
        if d.pulse != pulse or d.measure_number <= max(entrance):
            out.append(d)
            continue
        pct = d.delta_pct - level_pct
        band = classify_band(pct, config=config)
        out.append(
            replace(
                d,
                delta_pct=pct,
                delta_ms=d.delta_ms - level_ms,
                band=band,
                direction=_direction(pct, band),
            )
        )
    return out


def run_tempo_difference(
    run: list[Delta], before: Delta | None, target_bpm: float
) -> float | None:
    """How much faster than the target the run was played, in BPM.

    **This is a tempo, and what it replaced was not.** The verdict used to say
    `target_bpm × mean(|delta_pct|) / 100`, and `delta_pct` is how far a note
    sits from its place on the grid — a *position*, which a small tempo
    difference keeps adding to for as long as it lasts. Measured on 32 quarters
    played steadily at 63 against a target of 60: "You rushed across measures
    1–8 by an average of **48 BPM**", on the same result whose `insights`
    said, correctly, 63.0. The error grew with the length of the piece.

    So the figure is the pace across the run: the slope of the drift against
    the written time, fitted over the run and the note just before it — the
    last one that was still with the beat, which is where the getting-ahead
    began. A slope of −0.05 means every written second took 0.95, so the
    passage went at `target / 0.95`.

    `None` when there is nothing to fit — fewer than two points, or no written
    time between them.
    """
    points = ([before] if before is not None else []) + run
    if len(points) < 2 or target_bpm <= 0:
        return None
    written = np.array([d.expected_ms for d in points], dtype=float)
    drift = np.array([d.delta_ms for d in points], dtype=float)
    if float(np.ptp(written)) <= 0:
        return None
    slope, _ = np.polyfit(written, drift, 1)
    pace = 1.0 + float(slope)
    if pace <= 0:
        return None
    return target_bpm / pace - target_bpm


def describe_tempo_change(
    deltas: list[Delta], spans: list[TempoSpan]
) -> str | None:
    """What the written tempo change did, in the page's own words, or None.

    Quotes the printed marking — "rit.", "poco rall." — rather than
    paraphrasing it, because that is what the musician is looking at. The
    schema keeps `text` for exactly this.

    Says nothing at all when the change was made evenly *and* nothing else in
    the take needs saying: a musician who did what the page asked does not need
    to be told they did. The caller decides whether that silence stands alone.
    """
    if not spans:
        return None
    uneven = sorted({d.measure_number for d in deltas if d.uneven})
    if not uneven:
        return None

    covering = next(
        (
            span
            for span in spans
            if span.start_measure <= uneven[0] <= span.end_measure
        ),
        spans[0],
    )
    # Verbatim, dot included. "rit." is how it is printed and how a musician
    # reads it; stripping the abbreviation's own full stop gives "your rit
    # lurched", which is not English.
    marking = covering.text.strip() or {
        "ritardando": "ritardando",
        "accelerando": "accelerando",
    }.get(covering.kind, "tempo change")
    where = (
        f"bar {uneven[0]}"
        if len(uneven) == 1
        else "bars " + ", ".join(str(n) for n in uneven[:-1]) + f" and {uneven[-1]}"
    )
    # No figure. The page did not say how much to slow, so there is no target
    # to be a number away from — the only honest claim is that it lurched, and
    # where.
    return f"Your {marking} lurched at {where}."


def generate_verdict(
    deltas: list[Delta],
    target_bpm: float,
    *,
    config: AudioConfig | None = None,
    tempo_spans: list[TempoSpan] | None = None,
    tempi: BarTempi | None = None,
) -> Verdict:
    """One-line human verdict from the largest same-direction run (§4).

    **Given the take's bar tempi, the run is of bars** — the longest stretch
    the chart below the sentence shows off the target, and the figure is the
    tempo that stretch was played at (`_longest_bar_run`). The note rule below
    is what is said without them, and when no run of bars is worth naming:
    a take held a few percent slow is on tempo bar by bar yet a beat behind
    by the end, and the title above the sentence says it dragged.

    We surface the longest contiguous run of notes that drift the same
    way (all rushing or all dragging, ignoring notes inside tolerance and
    slur interiors) and phrase it in BPM, never percentages — musicians
    think in BPM (§3.5 language rules). The BPM figure is the tempo the run
    was actually played at against the target — see `run_tempo_difference`
    — and a run has to be long enough that chance does not explain it — see
    `MIN_VERDICT_RUN`.

    Notes that were not timed — a `rit.`, a fermata, an ornament — are left
    out of the run-finding altogether rather than counted as on the beat.
    Their band is `on` by refusal, not by measurement, so letting one break a
    run would split a rushed passage at every ornament in it.
    """
    judged = [d for d in deltas if not d.is_slur_interior]
    if not judged:
        return Verdict(text="Not enough clear notes to judge.", direction=Direction.on)
    lurch = describe_tempo_change(deltas, tempo_spans or [])
    cfg = config or load_audio_config()
    edges = _edges(judged, cfg.tolerance.settling_bars)
    spared: frozenset[int] = frozenset()

    if tempi is not None and target_bpm > 0:
        by_bars, spared = _longest_bar_run(judged, tempi, target_bpm, cfg, edges)
        if by_bars is not None:
            played = tempi.across(by_bars.first, by_bars.last)
            # Against the tempo the run was meant at: inside a "meno mosso" at
            # 88, a stretch at 100 ran ahead, however it compares with 104.
            meant = tempi.target(by_bars.first, target_bpm)
            return _run_verdict(
                rushing=by_bars.rushing,
                start_m=by_bars.first,
                end_m=by_bars.last,
                difference=None if played is None else played - meant,
                target_bpm=meant,
                lurch=lurch,
            )

    # The note rule is geometry over deltas already banded — unless the bar
    # rule spared an entrance or an ending, whose notes it then leaves out,
    # banding what follows a spared entrance from where the take settled.
    timed = [d for d in judged if d.timed]
    if spared:
        timed = _without_spared_ends(timed, spared, edges, cfg)

    # Sign per note: +1 rushing, -1 dragging, 0 within tolerance.
    signs = [
        -1 if d.direction is Direction.rush else (1 if d.direction is Direction.drag else 0)
        for d in timed
    ]

    best_start = best_end = -1
    best_len = 0
    i = 0
    n = len(signs)
    while i < n:
        if signs[i] == 0:
            i += 1
            continue
        j = i
        while j + 1 < n and signs[j + 1] == signs[i]:
            j += 1
        if (
            (j - i + 1) > best_len
            and _run_is_worth_naming(timed[i : j + 1])
            # Settling in and winding down, as for bars (`_Edges`).
            and not edges.hold({d.measure_number for d in timed[i : j + 1]})
        ):
            best_len, best_start, best_end = j - i + 1, i, j
        i = j + 1

    # No meaningful run: everything within tolerance, or nothing chance could
    # not have produced.
    if best_len == 0:
        if lurch:
            return Verdict(text=lurch, direction=Direction.on)
        if tempo_spans:
            # The change was made evenly and nothing else needs saying. Naming
            # it is the point: without it, a musician who has just played a
            # ritardando reads "steady tempo" and wonders whether the app
            # noticed the page at all.
            marking = tempo_spans[0].text.strip() or "tempo change"
            return Verdict(
                text=f"Steady, and your {marking} flowed.",
                direction=Direction.on,
            )
        return Verdict(
            text="Steady all the way through.",
            direction=Direction.on,
        )

    run = timed[best_start : best_end + 1]
    return _run_verdict(
        rushing=run[0].direction is Direction.rush,
        start_m=run[0].measure_number,
        end_m=run[-1].measure_number,
        difference=run_tempo_difference(
            run, timed[best_start - 1] if best_start > 0 else None, target_bpm
        ),
        target_bpm=target_bpm,
        lurch=lurch,
    )


def _run_verdict(
    *,
    rushing: bool,
    start_m: int,
    end_m: int,
    difference: float | None,
    target_bpm: float,
    lurch: str | None,
) -> Verdict:
    """The sentence for a run, whichever rule found it.

    **Where, and the tempo — never the verb again.** It is read under a title
    that already says which way ("You dragged throughout"), and the owner
    found the screen saying it three times (2026-09-25): the title, "You
    dragged bars 13–25 by 23 BPM.", and "You slowed down by 15 BPM." So the
    sentence adds only what the title cannot: the bars, and the tempo they
    went at — the number the chart below it plots, rather than a gap the
    musician has to subtract. "Bars", because every screen of the app says
    bars.
    """
    # The figure is only said when it agrees with the direction and survives
    # rounding. A run that got ahead of the beat at its first note and then
    # held the tempo exactly *was* rushed, and its pace across the run is still
    # nearer the target than one BPM — a tempo equal to the target says
    # nothing, and one on the other side of it would contradict the title.
    bpm_delta: int | None = None
    if difference is not None and (difference > 0) == rushing:
        bpm_delta = round(abs(difference)) or None

    where = f"Bar {start_m}" if start_m == end_m else f"Bars {start_m}–{end_m}"
    if bpm_delta is not None:
        text = f"{where} went at {round(target_bpm + difference)}."
    else:
        # Early or late at the tempo: there is no tempo to quote, only a side.
        text = f"{where} {'ran ahead' if rushing else 'fell behind'}."
    if lurch:
        # Two things happened and both are worth saying. The drift comes first
        # because it is the one the tolerance bands measured.
        text = f"{text} {lurch}"

    return Verdict(
        text=text,
        direction=Direction.rush if rushing else Direction.drag,
        start_measure=start_m,
        end_measure=end_m,
        avg_bpm_delta=None if bpm_delta is None else float(bpm_delta),
    )
