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


def compute_deltas(
    cleaned: CleanedAlignment,
    detected: np.ndarray,
    timeline: ExpectedTimeline,
    target_bpm: float,
    *,
    config: AudioConfig | None = None,
) -> list[Delta]:
    """Per matched note-pair, compute the timing delta in ms and % of beat.

    The recording's lead-in latency (reaction time before the first note)
    is not a timing error, so we set the origin at the first matched
    onset: its delta is defined as zero and every later note is measured
    as drift from that start. This makes gradual rushing/dragging show up
    as a growing delta, which is exactly what the trend + verdict key on.
    """
    cfg = config or load_audio_config()
    detected = np.asarray(detected, dtype=float)
    beat_ms = (60.0 / target_bpm) * 1000.0 if target_bpm > 0 else 500.0

    if not cleaned.matched:
        return []

    first_det, first_exp = cleaned.matched[0]
    origin_shift = detected[first_det] - timeline.onsets[first_exp]

    deltas: list[Delta] = []
    for det_i, exp_i in cleaned.matched:
        note = timeline.notes[exp_i]
        expected_ms = timeline.onsets[exp_i] * 1000.0
        actual_ms = (detected[det_i] - origin_shift) * 1000.0
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
    cfg = config or load_audio_config()
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
