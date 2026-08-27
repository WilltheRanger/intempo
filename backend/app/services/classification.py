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

from dataclasses import dataclass
from enum import Enum

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


def compute_deltas(
    cleaned: CleanedAlignment,
    detected: np.ndarray,
    timeline: ExpectedTimeline,
    target_bpm: float,
    *,
    config: AudioConfig | None = None,
) -> list[Delta]:
    """Per matched note-pair, compute the timing delta in ms and % of beat.

    The recording's lead-in latency (reaction time before the first note) is
    not a timing error, so the origin sits at the first matched onset: its
    delta is zero and every later note is measured as drift from that start.
    Gradual rushing therefore shows up as a *growing* delta, which is what the
    trend and the verdict key on, and it has to stay that way — the rushing
    fixture drifts 8 ms a beat, and anything that measures each note against
    only its neighbour reports that as steady.

    The origin is not fixed for the whole take, though. It follows the
    musician's pulse across a break in it — see `_pulse_anchors`.
    """
    cfg = config or load_audio_config()
    detected = np.asarray(detected, dtype=float)
    beat_ms = (60.0 / target_bpm) * 1000.0 if target_bpm > 0 else 500.0

    if not cleaned.matched:
        return []

    offsets = np.array(
        [detected[d] - timeline.onsets[e] for d, e in cleaned.matched], dtype=float
    )
    anchors = pulse_anchors(offsets, beat_ms / 1000.0, config=cfg)

    uneven = uneven_measures(cleaned, detected, timeline, config=cfg)

    deltas: list[Delta] = []
    for position, (det_i, exp_i) in enumerate(cleaned.matched):
        note = timeline.notes[exp_i]
        expected_ms = timeline.onsets[exp_i] * 1000.0
        actual_ms = (detected[det_i] - anchors[position]) * 1000.0
        delta_ms = actual_ms - expected_ms
        delta_pct = (delta_ms / beat_ms) * 100.0 if beat_ms else 0.0
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
        band = (
            Band.on
            if note.under_tempo_change or note.after_fermata
            else classify_band(delta_pct, config=cfg)
        )
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
                under_tempo_change=note.under_tempo_change,
                uneven=note.measure_number in uneven,
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
    available (so the first few notes still get a value). Slur-interior
    notes are excluded — their timing is musically free.
    """
    cfg = config or load_audio_config()
    win = window if window is not None else cfg.trend.window

    if deltas and isinstance(deltas[0], Delta):
        values = [-d.delta_pct for d in deltas if not d.is_slur_interior]  # rush-positive
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
    marking = covering.text.strip() or (
        "ritardando" if covering.kind == "ritardando" else "accelerando"
    )
    where = (
        f"bar {uneven[0]}"
        if len(uneven) == 1
        else "bars " + ", ".join(str(n) for n in uneven[:-1]) + f" and {uneven[-1]}"
    )
    # No figure. The page did not say how much to slow, so there is no target
    # to be a number away from — the only honest claim is that it lurched, and
    # where.
    return f"Your {marking} lurched at {where} rather than flowing."


def generate_verdict(
    deltas: list[Delta],
    target_bpm: float,
    *,
    config: AudioConfig | None = None,
    tempo_spans: list[TempoSpan] | None = None,
) -> Verdict:
    """One-line human verdict from the largest same-direction run (§4).

    We surface the longest contiguous run of notes that drift the same
    way (all rushing or all dragging, ignoring notes inside tolerance and
    slur interiors) and phrase it in BPM, never percentages — musicians
    think in BPM (§3.5 language rules). The BPM figure is an
    approximation: target_bpm scaled by the run's mean %-of-beat drift.
    """
    # No config is read here — the run-finding below is pure geometry over
    # deltas that were already banded using it. `config` stays in the signature
    # because every function in this module takes it, and a caller having to
    # remember which ones actually use it is worse than an ignored argument.
    timed = [d for d in deltas if not d.is_slur_interior]
    if not timed:
        return Verdict(text="Not enough clear notes to judge your timing.", direction=Direction.on)

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
        if (j - i + 1) > best_len:
            best_len, best_start, best_end = j - i + 1, i, j
        i = j + 1

    lurch = describe_tempo_change(deltas, tempo_spans or [])

    # No meaningful run (everything within tolerance, or a run of 1).
    if best_len < 2:
        if lurch:
            return Verdict(text=lurch, direction=Direction.on)
        if tempo_spans:
            # The change was made evenly and nothing else needs saying. Naming
            # it is the point: without it, a musician who has just played a
            # ritardando reads "steady tempo" and wonders whether the app
            # noticed the page at all.
            marking = tempo_spans[0].text.strip() or "tempo change"
            return Verdict(
                text=(
                    "Steady tempo, and your "
                    f"{marking} flowed evenly."
                ),
                direction=Direction.on,
            )
        return Verdict(
            text="Steady tempo — you held it within tolerance across the piece.",
            direction=Direction.on,
        )

    run = timed[best_start : best_end + 1]
    rushing = run[0].direction is Direction.rush
    mean_pct = float(np.mean([abs(d.delta_pct) for d in run]))
    bpm_delta = round(target_bpm * mean_pct / 100.0)
    start_m = run[0].measure_number
    end_m = run[-1].measure_number
    verb = "rushed" if rushing else "dragged"

    if start_m == end_m:
        where = f"in measure {start_m}"
    else:
        where = f"across measures {start_m}–{end_m}"
    text = f"You {verb} {where} by an average of {bpm_delta} BPM."
    if lurch:
        # Two things happened and both are worth saying. The drift comes first
        # because it is the one the tolerance bands measured.
        text = f"{text} {lurch}"

    return Verdict(
        text=text,
        direction=Direction.rush if rushing else Direction.drag,
        start_measure=start_m,
        end_measure=end_m,
        avg_bpm_delta=float(bpm_delta),
    )
