"""Tests for metrics.py — pure arithmetic, no audio, no analyze()."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from metrics import (
    alignment_accuracy,
    match_onsets_by_time,
    mean_absolute_error,
    pct_within,
    precision_recall_f1,
    semitone_to_cents,
)


def test_precision_recall_f1_perfect() -> None:
    result = precision_recall_f1(true_positives=5, false_positives=0, false_negatives=0)
    assert result.precision == 1.0
    assert result.recall == 1.0
    assert result.f1 == 1.0


def test_precision_recall_f1_mixed() -> None:
    result = precision_recall_f1(true_positives=3, false_positives=1, false_negatives=2)
    assert result.precision == 0.75
    assert result.recall == 0.6
    assert round(result.f1, 4) == round(2 * 0.75 * 0.6 / (0.75 + 0.6), 4)


def test_precision_recall_f1_empty_is_perfect_not_undefined() -> None:
    result = precision_recall_f1(true_positives=0, false_positives=0, false_negatives=0)
    assert (result.precision, result.recall, result.f1) == (1.0, 1.0, 1.0)


def test_precision_recall_f1_no_true_positives() -> None:
    result = precision_recall_f1(true_positives=0, false_positives=2, false_negatives=2)
    assert result.precision == 0.0
    assert result.recall == 0.0
    assert result.f1 == 0.0


def test_mean_absolute_error_basic() -> None:
    assert mean_absolute_error([10.0, -10.0, 5.0]) == (10 + 10 + 5) / 3


def test_mean_absolute_error_empty_is_none() -> None:
    assert mean_absolute_error([]) is None


def test_pct_within_threshold() -> None:
    assert pct_within([5.0, 15.0, 25.0, -8.0], 10.0) == 0.5


def test_pct_within_empty_is_none() -> None:
    assert pct_within([], 10.0) is None


def test_semitone_to_cents() -> None:
    assert semitone_to_cents(1.0) == 100.0
    assert semitone_to_cents(0.5) == 50.0
    assert semitone_to_cents(-0.2) == -20.0


def test_match_onsets_by_time_all_matched() -> None:
    matched, fp, fn = match_onsets_by_time([0.0, 1.0, 2.0], [0.01, 0.98, 2.02], tolerance_s=0.05)
    assert (matched, fp, fn) == (3, 0, 0)


def test_match_onsets_by_time_missed_and_extra() -> None:
    # expected 3 onsets; detector found only 2 of them plus one spurious one far away
    matched, fp, fn = match_onsets_by_time(
        [0.0, 1.0, 2.0], [0.0, 2.0, 5.0], tolerance_s=0.05
    )
    assert matched == 2
    assert fn == 1  # the onset at 1.0 was never detected
    assert fp == 1  # the onset at 5.0 doesn't correspond to anything expected


def test_match_onsets_by_time_outside_tolerance_does_not_match() -> None:
    matched, fp, fn = match_onsets_by_time([0.0], [0.2], tolerance_s=0.05)
    assert (matched, fp, fn) == (0, 1, 1)


def test_alignment_accuracy_basic() -> None:
    assert alignment_accuracy(correct=4, total_expected=5) == 0.8


def test_alignment_accuracy_no_expected_is_none() -> None:
    assert alignment_accuracy(correct=0, total_expected=0) is None
