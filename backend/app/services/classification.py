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

from app.services.alignment import CleanedAlignment, ExpectedTimeline
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


def _pulse_anchors(
    offsets: np.ndarray, beat_s: float, *, config: AudioConfig | None = None
) -> np.ndarray:
    """The reference each note's drift is measured from, note by note.

    **Two things look identical to a clock and are opposite to a musician.**
    Playing steadily a little fast is a *ramp*: every interval is slightly
    short, the offset grows note after note, and it must be reported — that is
    the entire product. Hesitating is a *step*: one or two intervals are much
    too long and then the pulse resumes, and reporting it as "every bar after
    this one dragged" is false. It was false, and it named eight bars in a take
    where one bar was long.

    Measured on twenty bars with bar 8 held a beat too long, the app said:

        m8 +29%  m9 +99%  m10 +100%  m11 +99%  m12 +100%  …  m15 +99%

    So the reference re-anchors after a *run* of intervals that departs from
    what this take otherwise does. The notes inside the run keep the drift —
    a bar genuinely played slow is dragging and has to say so — and the notes
    after it start again from where the musician actually is.

    A run, not a single interval, because a bar played 25% slow is four
    stretched intervals in a row, not one. Absorbing them individually would
    report the bar as clean, which is the opposite mistake.

    The two thresholds live in `[tolerance.pulse]`. They are far apart from
    what they have to separate — the rushing fixture drifts 8 ms a beat, note
    after note, while a bar held a quarter longer moves an interval by 208 ms —
    so neither sits near a decision, and both are starting values that want a
    real recording and an ear.
    """
    cfg = config or load_audio_config()
    anchors = np.empty(offsets.size, dtype=float)
    if offsets.size == 0:
        return anchors
    steps = np.diff(offsets, prepend=offsets[0])
    # The take's own habit, robustly: what a typical interval error looks like
    # here, immune to the handful that are the disturbance.
    centre = float(np.median(steps))
    spread = float(np.median(np.abs(steps - centre)))
    limit = max(
        cfg.tolerance.disturbance_deviations * spread,
        cfg.tolerance.disturbance_floor_beats * beat_s,
    )
    disturbed = np.abs(steps - centre) > limit

    anchor = offsets[0]
    for i in range(offsets.size):
        anchors[i] = anchor
        # Re-anchor once the run ends, so the last note of the disturbance
        # still carries it and the next note starts from where the player is.
        if disturbed[i] and (i + 1 >= offsets.size or not disturbed[i + 1]):
            anchor = offsets[i]
    return anchors


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
    anchors = _pulse_anchors(offsets, beat_ms / 1000.0, config=cfg)

    deltas: list[Delta] = []
    for position, (det_i, exp_i) in enumerate(cleaned.matched):
        note = timeline.notes[exp_i]
        expected_ms = timeline.onsets[exp_i] * 1000.0
        actual_ms = (detected[det_i] - anchors[position]) * 1000.0
        delta_ms = actual_ms - expected_ms
        delta_pct = (delta_ms / beat_ms) * 100.0 if beat_ms else 0.0
        band = classify_band(delta_pct, config=cfg)
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


def generate_verdict(
    deltas: list[Delta],
    target_bpm: float,
    *,
    config: AudioConfig | None = None,
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

    # No meaningful run (everything within tolerance, or a run of 1).
    if best_len < 2:
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

    return Verdict(
        text=text,
        direction=Direction.rush if rushing else Direction.drag,
        start_measure=start_m,
        end_measure=end_m,
        avg_bpm_delta=float(bpm_delta),
    )
