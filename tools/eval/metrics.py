"""Pure metric computations for the evaluation harness (JERA-563).

No audio, no `analyze()` call, no filesystem — every function here takes
plain numbers or small dataclasses and returns a number, so
`test_metrics.py` can hand-construct fixtures and pin the arithmetic down
without a synthesized take anywhere nearby. `harness.py` is the only caller
that feeds these real analysis output.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

log = logging.getLogger("intempo.eval")


@dataclass(frozen=True)
class PRF1:
    precision: float
    recall: float
    f1: float


def precision_recall_f1(true_positives: int, false_positives: int, false_negatives: int) -> PRF1:
    """Standard precision/recall/F1 from counts, with 0/0 defined as 1.0.

    An empty set agreeing with an empty set (no positives expected, none
    predicted) is a perfect match, not an undefined one — the convention
    this harness uses throughout rather than special-casing every caller.
    """
    predicted = true_positives + false_positives
    expected = true_positives + false_negatives
    precision = 1.0 if predicted == 0 else true_positives / predicted
    recall = 1.0 if expected == 0 else true_positives / expected
    f1 = 0.0 if (precision + recall) == 0 else 2 * precision * recall / (precision + recall)
    return PRF1(precision=precision, recall=recall, f1=f1)


def mean_absolute_error(errors: list[float]) -> float | None:
    """MAE over a list of signed errors; `None` on an empty list rather than NaN."""
    if not errors:
        return None
    return sum(abs(e) for e in errors) / len(errors)


def pct_within(errors: list[float], threshold: float) -> float | None:
    """Fraction of `|errors|` at or under `threshold`. `None` when `errors` is empty."""
    if not errors:
        return None
    return sum(1 for e in errors if abs(e) <= threshold) / len(errors)


def semitone_to_cents(semitones: float) -> float:
    """100 cents to the semitone, the only conversion this harness needs."""
    return semitones * 100.0


def match_onsets_by_time(
    expected_s: list[float], detected_s: list[float], tolerance_s: float
) -> tuple[int, int, int]:
    """Greedy nearest-neighbour onset matching within `tolerance_s`.

    Returns `(matched, false_positives, false_negatives)`. Greedy-nearest
    rather than an optimal assignment (e.g. Hungarian): onsets are already
    time-ordered and `tolerance_s` is small relative to the gap between
    notes in every fixture this harness runs, so nearest-available is the
    same answer an optimal match would give, for a fraction of the code.
    """
    expected_sorted = sorted(expected_s)
    detected_sorted = sorted(detected_s)
    used_detected = [False] * len(detected_sorted)
    matched = 0
    for exp in expected_sorted:
        best_idx = None
        best_gap = tolerance_s
        for i, det in enumerate(detected_sorted):
            if used_detected[i]:
                continue
            gap = abs(det - exp)
            if gap <= best_gap:
                best_gap = gap
                best_idx = i
        if best_idx is not None:
            used_detected[best_idx] = True
            matched += 1
    false_negatives = len(expected_sorted) - matched
    false_positives = len(detected_sorted) - matched
    return matched, false_positives, false_negatives


def alignment_accuracy(correct: int, total_expected: int) -> float | None:
    """Fraction of expected notes matched to the *correct* `global_index`.

    Distinct from onset timing accuracy: a note can land within the time
    tolerance of the wrong neighbour (e.g. after a missed note shifts
    everything by one) and still be wrong here. `None` when there was
    nothing expected to align.
    """
    if total_expected == 0:
        return None
    return correct / total_expected
