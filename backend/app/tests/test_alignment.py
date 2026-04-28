"""DTW alignment + fuzzy match tests on synthetic onset arrays."""

from __future__ import annotations

import numpy as np
import pytest

from app.services.alignment import (
    align_dtw,
    apply_fuzzy_match,
    compute_expected_onsets,
    is_alignment_broken,
    quality_warn,
)
from app.tests._audio_helpers import quarter_note_onsets, synth_score, synth_score_with_durations


# ---- compute_expected_onsets ---------------------------------------------


def test_expected_onsets_quarter_notes_at_120bpm() -> None:
    score = synth_score(n_quarter_notes=4)
    out = compute_expected_onsets(score, target_bpm=120.0)
    np.testing.assert_allclose(out, [0.0, 0.5, 1.0, 1.5])


def test_expected_onsets_skips_rests_but_advances_clock() -> None:
    """Rests don't produce an onset but the next note's time still shifts."""
    score = synth_score_with_durations(["quarter", "quarter", "quarter", "quarter"])
    # Make the second note a rest by editing the model.
    score.measures[0].notes[1].pitch = "rest"
    out = compute_expected_onsets(score, target_bpm=60.0)
    # Beats: note(0)=0, rest(1)=1, note(2)=2, note(3)=3 → onsets at 0, 2, 3
    np.testing.assert_allclose(out, [0.0, 2.0, 3.0])


def test_expected_onsets_dotted_durations() -> None:
    score = synth_score_with_durations(["dotted_quarter", "eighth", "half"])
    out = compute_expected_onsets(score, target_bpm=60.0)
    # Beats: 0, 1.5, 2.0; at 60 BPM = same in seconds.
    np.testing.assert_allclose(out, [0.0, 1.5, 2.0])


def test_expected_onsets_rejects_zero_bpm() -> None:
    with pytest.raises(ValueError):
        compute_expected_onsets(synth_score(), target_bpm=0)


# ---- align_dtw -----------------------------------------------------------


def test_align_dtw_perfect_match_high_quality() -> None:
    expected = quarter_note_onsets(8, bpm=120.0)
    detected = expected.copy()
    result = align_dtw(detected, expected)
    assert result.quality_score > 0.95, f"expected near-1.0 quality, got {result.quality_score}"
    assert len(result.warping_path) >= 8


def test_align_dtw_uniform_5pct_rush_still_good_quality() -> None:
    expected = quarter_note_onsets(8, bpm=120.0)
    detected = expected * 0.95  # play 5% faster (rush)
    result = align_dtw(detected, expected)
    assert result.quality_score > 0.5, (
        f"5% rush should still align reasonably; quality={result.quality_score}"
    )


def test_align_dtw_empty_detected_returns_zero_quality() -> None:
    expected = quarter_note_onsets(8, bpm=120.0)
    result = align_dtw(np.array([]), expected)
    assert result.quality_score == 0.0
    assert result.warping_path == []


def test_align_dtw_garbage_detected_low_quality() -> None:
    """Random nonsense onsets should not produce a high alignment quality."""
    rng = np.random.default_rng(0)
    expected = quarter_note_onsets(8, bpm=120.0)
    detected = np.sort(rng.uniform(0, 4, 8) * 10)  # spread over 0–40s, way off-scale
    result = align_dtw(detected, expected)
    assert result.quality_score < 0.5, (
        f"garbage detected should have low quality; got {result.quality_score}"
    )


# ---- apply_fuzzy_match ---------------------------------------------------


def test_fuzzy_match_perfect_alignment() -> None:
    expected = quarter_note_onsets(4, bpm=120.0)
    detected = expected.copy()
    cleaned = apply_fuzzy_match(align_dtw(detected, expected))
    assert len(cleaned.matched) == 4
    assert cleaned.missed_expected_idx == []
    assert cleaned.extra_detected_idx == []
    for i, pair in enumerate(cleaned.matched):
        assert pair.detected_idx == i
        assert pair.expected_idx == i


def test_fuzzy_match_missed_note() -> None:
    """Player skipped one note in the middle of the score."""
    expected = quarter_note_onsets(5, bpm=60.0)         # 5 expected
    detected = np.delete(expected, 2)                   # 4 detected (skipped #3)
    cleaned = apply_fuzzy_match(align_dtw(detected, expected))
    assert len(cleaned.matched) == 4
    assert 2 in cleaned.missed_expected_idx, (
        f"expected to flag index 2 as missed; got missed={cleaned.missed_expected_idx}"
    )


def test_fuzzy_match_extra_note() -> None:
    """Player added one note not in the score (e.g. nervous re-attack)."""
    expected = quarter_note_onsets(4, bpm=60.0)
    detected = np.sort(np.append(expected, 1.7))  # extra note at 1.7 s
    cleaned = apply_fuzzy_match(align_dtw(detected, expected))
    assert len(cleaned.matched) == 4
    assert len(cleaned.extra_detected_idx) >= 1, (
        f"expected at least one extra-detected index; got {cleaned.extra_detected_idx}"
    )


def test_fuzzy_match_uniform_rush_keeps_all_pairs() -> None:
    expected = quarter_note_onsets(4, bpm=120.0)
    detected = expected * 0.95  # 5% rush
    cleaned = apply_fuzzy_match(align_dtw(detected, expected))
    assert len(cleaned.matched) == 4
    assert cleaned.missed_expected_idx == []
    assert cleaned.extra_detected_idx == []


# ---- is_alignment_broken / quality_warn ----------------------------------


def test_is_alignment_broken_below_threshold() -> None:
    assert is_alignment_broken(0.0)
    assert is_alignment_broken(0.39)
    assert not is_alignment_broken(0.41)
    assert not is_alignment_broken(1.0)


def test_quality_warn_below_threshold() -> None:
    assert quality_warn(0.69)
    assert not quality_warn(0.71)
