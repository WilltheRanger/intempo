"""Per-note classification + rolling trend + verdict generation.

Layer 3 of the analysis pipeline. Spec §4 tolerance bands + spec §4
rolling-average trend detection + spec §7.5 problem 5 phrase-first
reporting.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

import numpy as np
import pandas as pd

from app.config import settings
from app.services.alignment import CleanedAlignment


class Band(str, Enum):
    on = "on"
    slight_rush = "slight_rush"
    slight_drag = "slight_drag"
    rushing = "rushing"
    dragging = "dragging"
    severe_rushing = "severe_rushing"
    severe_dragging = "severe_dragging"


# Sign convention used everywhere in this module:
#   delta_ms > 0  → student played LATE  (dragging)
#   delta_ms < 0  → student played EARLY (rushing)
# Same sign for delta_pct (percent of beat duration).


@dataclass(slots=True)
class Delta:
    note_index: int          # index into the expected-onset sequence
    detected_time_s: float
    expected_time_s: float
    delta_ms: float          # +late / -early
    delta_pct: float         # delta_ms / beat_ms × 100
    band: Band


@dataclass(slots=True)
class Verdict:
    headline: str            # one-line summary, e.g. "You rushed in measures 8–12 by ~6 BPM."
    overall: Band            # the dominant band over the whole piece
    largest_run_pct: float   # peak rolling-trend value
    largest_run_start_idx: int
    largest_run_end_idx: int


def _classification_cfg() -> dict[str, Any]:
    return settings.AUDIO.get("classification", {})


def classify_band(delta_pct: float) -> Band:
    """Map a signed % deviation to a tolerance band.

    Bands are symmetric by default per spec §4; the tuning appendix says real
    values are usually asymmetric — adjust `on_pct` / `slight_pct` / `heavy_pct`
    in `config.toml` after listening tests.
    """
    cfg = _classification_cfg()
    on = float(cfg.get("on_pct", 5.0))
    slight = float(cfg.get("slight_pct", 10.0))
    heavy = float(cfg.get("heavy_pct", 20.0))

    abs_pct = abs(delta_pct)
    rushing = delta_pct < 0  # early = rushing
    if abs_pct <= on:
        return Band.on
    if abs_pct <= slight:
        return Band.slight_rush if rushing else Band.slight_drag
    if abs_pct <= heavy:
        return Band.rushing if rushing else Band.dragging
    return Band.severe_rushing if rushing else Band.severe_dragging


def compute_deltas(alignment: CleanedAlignment, target_bpm: float) -> list[Delta]:
    """Per-matched-note deviations + tolerance-band classification."""
    if target_bpm <= 0:
        raise ValueError(f"target_bpm must be positive, got {target_bpm}")
    beat_ms = 60_000.0 / target_bpm
    out: list[Delta] = []
    for pair in alignment.matched:
        delta_ms = (pair.detected_time_s - pair.expected_time_s) * 1000.0
        delta_pct = (delta_ms / beat_ms) * 100.0
        out.append(
            Delta(
                note_index=pair.expected_idx,
                detected_time_s=pair.detected_time_s,
                expected_time_s=pair.expected_time_s,
                delta_ms=delta_ms,
                delta_pct=delta_pct,
                band=classify_band(delta_pct),
            )
        )
    return out


def rolling_trend(delta_pcts: list[float] | np.ndarray, window: int | None = None) -> list[float]:
    """Pandas rolling mean over the per-note % deviations. Spec §4.

    Returns a list of length len(delta_pcts), with NaN for early positions
    (less than `window` samples available) replaced with the partial mean.
    """
    cfg = _classification_cfg()
    if window is None:
        window = int(cfg.get("rolling_window_notes", 8))
    arr = np.asarray(delta_pcts, dtype=np.float64)
    if arr.size == 0:
        return []
    series = pd.Series(arr)
    rolled = series.rolling(window=window, min_periods=1).mean()
    return [float(x) for x in rolled.to_numpy()]


def _largest_same_sign_run(values: list[float]) -> tuple[int, int, float]:
    """Find the longest contiguous run of same-sign values; return (start, end, peak).

    `peak` is the value (signed) of the largest-magnitude entry inside the run.
    Empty input returns (0, 0, 0.0).
    """
    if not values:
        return (0, 0, 0.0)
    best_start = best_end = 0
    best_len = 0
    best_peak = 0.0
    cur_start = 0
    cur_sign = 0
    for i, v in enumerate(values):
        sign = 1 if v > 0 else (-1 if v < 0 else 0)
        if sign == 0:
            cur_sign = 0
            cur_start = i + 1
            continue
        if sign != cur_sign:
            cur_sign = sign
            cur_start = i
        run_len = i - cur_start + 1
        if run_len > best_len:
            best_len = run_len
            best_start = cur_start
            best_end = i
            best_peak = max(values[cur_start : i + 1], key=abs)
    return (best_start, best_end, best_peak)


def generate_verdict(
    deltas: list[Delta],
    classifications: list[Band],
    target_bpm: float,
    *,
    score_measures: list[Any] | None = None,
) -> Verdict:
    """Natural-language one-line verdict, spec §4 example:
    'You rushed in measures 8–12 by an average of 4 BPM.'"""

    if not deltas:
        return Verdict(
            headline="No notes were matched to the score — the recording may be empty or unreadable.",
            overall=Band.on,
            largest_run_pct=0.0,
            largest_run_start_idx=0,
            largest_run_end_idx=0,
        )

    rolled = rolling_trend([d.delta_pct for d in deltas])
    start_idx, end_idx, peak_pct = _largest_same_sign_run(rolled)

    # Map the note-index span to measure numbers (1-indexed, inclusive) when
    # the score is available.
    measure_span: tuple[int, int] | None = None
    if score_measures:
        note_to_measure = _build_note_to_measure_map(score_measures)
        if note_to_measure:
            start_note = deltas[start_idx].note_index
            end_note = deltas[end_idx].note_index
            measure_span = (
                note_to_measure.get(start_note, 1),
                note_to_measure.get(end_note, 1),
            )

    overall_band = _dominant_band(classifications)

    if abs(peak_pct) < float(_classification_cfg().get("on_pct", 5.0)):
        headline = "You held tempo within tolerance across the recording."
    else:
        direction = "rushed" if peak_pct < 0 else "dragged"
        bpm_delta = abs(peak_pct) / 100.0 * target_bpm
        if measure_span and measure_span[0] != measure_span[1]:
            where = f"in measures {measure_span[0]}–{measure_span[1]}"
        elif measure_span:
            where = f"around measure {measure_span[0]}"
        else:
            where = f"across notes {start_idx + 1}–{end_idx + 1}"
        headline = (
            f"You {direction} {where} by an average of "
            f"{bpm_delta:.1f} BPM ({abs(peak_pct):.1f}% of beat)."
        )

    return Verdict(
        headline=headline,
        overall=overall_band,
        largest_run_pct=peak_pct,
        largest_run_start_idx=start_idx,
        largest_run_end_idx=end_idx,
    )


def _dominant_band(classifications: list[Band]) -> Band:
    """The band that occurs most often. Ties break in favor of the more-extreme band."""
    if not classifications:
        return Band.on
    counts: dict[Band, int] = {}
    for b in classifications:
        counts[b] = counts.get(b, 0) + 1
    severity = {
        Band.on: 0,
        Band.slight_rush: 1,
        Band.slight_drag: 1,
        Band.rushing: 2,
        Band.dragging: 2,
        Band.severe_rushing: 3,
        Band.severe_dragging: 3,
    }
    return max(counts.items(), key=lambda kv: (kv[1], severity[kv[0]]))[0]


def _build_note_to_measure_map(measures: list[Any]) -> dict[int, int]:
    """Build {note_index → measure_number} from a ScoreJson.measures list."""
    out: dict[int, int] = {}
    note_idx = 0
    for measure in measures:
        for note in getattr(measure, "notes", []):
            if getattr(note, "pitch", None) != "rest":
                out[note_idx] = int(getattr(measure, "measure_number", 0))
                note_idx += 1
    return out
