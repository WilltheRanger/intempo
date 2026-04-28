"""Score-audio alignment via Dynamic Time Warping.

Layer 2 of the analysis pipeline. Spec §7 + §7.5 problem 3 mitigations.

Public API:
- `compute_expected_onsets(score, target_bpm) -> np.ndarray`
- `align_dtw(detected, expected) -> AlignmentResult`
- `apply_fuzzy_match(alignment) -> CleanedAlignment`
- `is_alignment_broken(quality) -> bool`
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import librosa
import numpy as np

from app.config import settings
from app.services.score_schema import ScoreJson

# Whole-note duration table — note duration in quarter-note beats.
# Spec §6 enumerates: whole, half, quarter, eighth, sixteenth, thirty_second
# plus dotted_* variants.
_DURATION_BEATS = {
    "whole": 4.0,
    "dotted_whole": 6.0,
    "half": 2.0,
    "dotted_half": 3.0,
    "quarter": 1.0,
    "dotted_quarter": 1.5,
    "eighth": 0.5,
    "dotted_eighth": 0.75,
    "sixteenth": 0.25,
    "dotted_sixteenth": 0.375,
    "thirty_second": 0.125,
}


@dataclass(slots=True)
class AlignmentResult:
    """Raw output of `align_dtw` before fuzzy cleanup."""

    warping_path: list[tuple[int, int]]  # (detected_idx, expected_idx) pairs in time order
    cost: float
    quality_score: float  # 0-1; higher is better
    detected: np.ndarray
    expected: np.ndarray


@dataclass(slots=True)
class MatchedPair:
    """One detected onset matched to one expected onset."""

    detected_idx: int
    expected_idx: int
    detected_time_s: float
    expected_time_s: float


@dataclass(slots=True)
class CleanedAlignment:
    """Fuzzy-matched alignment: 1:1 pairs + lists of unmatched onsets."""

    matched: list[MatchedPair]
    missed_expected_idx: list[int] = field(default_factory=list)  # student skipped these notes
    extra_detected_idx: list[int] = field(default_factory=list)   # student played these but not in score
    quality_score: float = 0.0


def _alignment_cfg() -> dict[str, Any]:
    return settings.AUDIO.get("alignment", {})


def compute_expected_onsets(score: ScoreJson, target_bpm: float) -> np.ndarray:
    """Walk the score, accumulate note durations at `target_bpm`, return seconds-since-start.

    Rests still consume their duration (the player is silent for that long), so
    the expected onset of the note *after* a rest is shifted accordingly. Rests
    themselves don't produce an onset.
    """
    if target_bpm <= 0:
        raise ValueError(f"target_bpm must be positive, got {target_bpm}")
    seconds_per_beat = 60.0 / target_bpm

    times: list[float] = []
    cursor_beats = 0.0
    for measure in score.measures:
        for note in measure.notes:
            duration_beats = _DURATION_BEATS.get(note.duration)
            if duration_beats is None:
                # Unknown duration falls back to a quarter — defensive, prompt
                # forces the model to use one of the known values.
                duration_beats = 1.0
            if note.pitch != "rest":
                times.append(cursor_beats * seconds_per_beat)
            cursor_beats += duration_beats
    return np.asarray(times, dtype=np.float64)


def align_dtw(detected: np.ndarray, expected: np.ndarray) -> AlignmentResult:
    """Run DTW on the two onset-time sequences. Returns the warping path + quality.

    Empty sequences are handled gracefully: an empty detected array yields a
    quality of 0 (the player produced no notes; we can't align nothing).
    """
    detected = np.asarray(detected, dtype=np.float64)
    expected = np.asarray(expected, dtype=np.float64)

    if detected.size == 0 or expected.size == 0:
        return AlignmentResult(
            warping_path=[],
            cost=float("inf"),
            quality_score=0.0,
            detected=detected,
            expected=expected,
        )

    cfg = _alignment_cfg()
    band_rad = float(cfg.get("sakoe_chiba_band_rad", 0.20))

    # librosa.sequence.dtw expects 2D arrays (features × time). Reshape (n,) → (1, n).
    X = detected.reshape(1, -1)
    Y = expected.reshape(1, -1)
    D, wp = librosa.sequence.dtw(
        X=X,
        Y=Y,
        metric="euclidean",
        subseq=False,
        band_rad=band_rad,
    )
    # wp comes back in reverse chronological order with (detected_idx, expected_idx).
    # Cast to plain int tuples in time order.
    path = [(int(d), int(e)) for d, e in wp[::-1]]
    total_cost = float(D[-1, -1])

    # Quality score: normalize cost by path length and by the temporal scale of
    # the expected sequence. Lower cost = higher quality. Map to (0, 1] via
    # exp(-mean_cost_per_step / typical_inter_onset_gap).
    if expected.size > 1:
        typical_gap = float(np.median(np.diff(expected)))
    else:
        typical_gap = 0.5  # arbitrary fallback for single-note scores
    if typical_gap <= 0:
        typical_gap = 0.1
    mean_cost_per_step = total_cost / max(len(path), 1)
    quality_score = float(np.exp(-mean_cost_per_step / max(typical_gap, 1e-6)))
    quality_score = max(0.0, min(1.0, quality_score))

    return AlignmentResult(
        warping_path=path,
        cost=total_cost,
        quality_score=quality_score,
        detected=detected,
        expected=expected,
    )


def apply_fuzzy_match(alignment: AlignmentResult) -> CleanedAlignment:
    """Collapse the warping path into 1:1 pairs + lists of misses/extras.

    Spec §7 fuzzy matching:
    - Many-to-one (multiple detected → same expected): keep the one closest in
      time; the rest are extra notes.
    - One-to-many (one detected → multiple expected): keep the closest; the
      others are missed notes.
    """
    if not alignment.warping_path:
        return CleanedAlignment(matched=[], quality_score=alignment.quality_score)

    # Group by expected_idx; for each, pick the detected with min |Δt|.
    by_expected: dict[int, tuple[int, float]] = {}
    for det_idx, exp_idx in alignment.warping_path:
        det_t = float(alignment.detected[det_idx])
        exp_t = float(alignment.expected[exp_idx])
        delta = abs(det_t - exp_t)
        prev = by_expected.get(exp_idx)
        if prev is None or delta < prev[1]:
            by_expected[exp_idx] = (det_idx, delta)

    # Now each expected has exactly one detected. But a single detected may still
    # appear under multiple expecteds (when DTW one-to-many'd it). Resolve by
    # giving each detected to the expected it's closest to.
    detected_owner: dict[int, tuple[int, float]] = {}
    for exp_idx, (det_idx, delta) in by_expected.items():
        prev = detected_owner.get(det_idx)
        if prev is None or delta < prev[1]:
            detected_owner[det_idx] = (exp_idx, delta)

    matched: list[MatchedPair] = []
    matched_expected: set[int] = set()
    matched_detected: set[int] = set()
    for det_idx, (exp_idx, _delta) in sorted(detected_owner.items()):
        matched.append(
            MatchedPair(
                detected_idx=det_idx,
                expected_idx=exp_idx,
                detected_time_s=float(alignment.detected[det_idx]),
                expected_time_s=float(alignment.expected[exp_idx]),
            )
        )
        matched_expected.add(exp_idx)
        matched_detected.add(det_idx)

    missed = [i for i in range(len(alignment.expected)) if i not in matched_expected]
    extra = [i for i in range(len(alignment.detected)) if i not in matched_detected]
    matched.sort(key=lambda m: m.expected_idx)

    return CleanedAlignment(
        matched=matched,
        missed_expected_idx=missed,
        extra_detected_idx=extra,
        quality_score=alignment.quality_score,
    )


def is_alignment_broken(quality: float) -> bool:
    """True when alignment quality is below the refuse-to-analyze threshold."""
    cfg = _alignment_cfg()
    threshold = float(cfg.get("quality_refuse_below", 0.40))
    return quality < threshold


def quality_warn(quality: float) -> bool:
    """True when alignment quality is below the show-warning threshold."""
    cfg = _alignment_cfg()
    threshold = float(cfg.get("quality_warn_below", 0.70))
    return quality < threshold
