"""Tests for services/alignment.py — expected onsets, DTW, fuzzy matching."""

from __future__ import annotations

import numpy as np

from app.services.alignment import (
    align_dtw,
    apply_fuzzy_match,
    build_timeline,
    compute_expected_onsets,
    is_alignment_broken,
)
from app.services.score_schema import Measure, Note, ScoreJson, Slur


def _score(measures: list[Measure]) -> ScoreJson:
    return ScoreJson(clef="treble", time_signature="4/4", ocr_confidence=0.9, measures=measures)


def test_expected_onsets_quarter_notes_at_120() -> None:
    # 4 quarter notes at 120 BPM → 0.5s apart, starting at 0.
    score = _score([Measure(measure_number=1, notes=[Note(pitch="A4", duration="quarter")] * 4)])
    onsets = compute_expected_onsets(score, target_bpm=120.0)
    assert np.allclose(onsets, [0.0, 0.5, 1.0, 1.5])


def test_expected_onsets_mixed_durations() -> None:
    # half (2 beats) + two eighths (0.5 each) + quarter, at 120 BPM.
    notes = [
        Note(pitch="A4", duration="half"),
        Note(pitch="B4", duration="eighth"),
        Note(pitch="C4", duration="eighth"),
        Note(pitch="D4", duration="quarter"),
    ]
    score = _score([Measure(measure_number=1, notes=notes)])
    onsets = compute_expected_onsets(score, target_bpm=120.0)
    # onsets at beats 0, 2, 2.5, 3 → seconds 0, 1.0, 1.25, 1.5
    assert np.allclose(onsets, [0.0, 1.0, 1.25, 1.5])


def test_rests_advance_clock_but_emit_no_onset() -> None:
    notes = [
        Note(pitch="A4", duration="quarter"),
        Note(pitch="rest", duration="quarter"),
        Note(pitch="B4", duration="quarter"),
    ]
    score = _score([Measure(measure_number=1, notes=notes)])
    onsets = compute_expected_onsets(score, target_bpm=120.0)
    # Two sounded notes; the rest occupies beat 1 so the second lands at 1.0s.
    assert np.allclose(onsets, [0.0, 1.0])


def test_tied_note_is_not_reattacked() -> None:
    notes = [
        Note(pitch="A4", duration="quarter", tied_to_next=True),
        Note(pitch="A4", duration="quarter"),
        Note(pitch="B4", duration="quarter"),
    ]
    score = _score([Measure(measure_number=1, notes=notes)])
    onsets = compute_expected_onsets(score, target_bpm=120.0)
    # First+second are tied → one onset at 0; B4 at beat 2 → 1.0s.
    assert np.allclose(onsets, [0.0, 1.0])


def test_slur_interior_is_flagged() -> None:
    notes = [Note(pitch="A4", duration="quarter")] * 4
    measure = Measure(measure_number=1, notes=notes, slurs=[Slur(start_note_index=0, end_note_index=3)])
    timeline = build_timeline(_score([measure]), target_bpm=120.0)
    flags = [(n.is_slur_boundary, n.is_slur_interior) for n in timeline.notes]
    assert flags == [(True, False), (False, True), (False, True), (True, False)]


def test_align_dtw_perfect_is_identity() -> None:
    expected = np.array([0.0, 0.5, 1.0, 1.5, 2.0])
    result = align_dtw(expected.copy(), expected, target_bpm=120.0)
    assert result.mapping == [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4)]
    assert result.quality > 0.95


def test_align_dtw_uniform_rush_keeps_monotonic_mapping() -> None:
    expected = np.array([0.0, 0.5, 1.0, 1.5, 2.0])
    detected = expected * 0.95  # rushed 5%
    result = align_dtw(detected, expected, target_bpm=120.0)
    assert result.mapping == [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4)]


def test_fuzzy_match_flags_extra_detected_note() -> None:
    expected = np.array([0.0, 0.5, 1.0])
    # An extra false-trigger onset near the first note.
    detected = np.array([0.0, 0.05, 0.5, 1.0])
    result = align_dtw(detected, expected, target_bpm=120.0)
    cleaned = apply_fuzzy_match(result, detected, expected)
    assert len(cleaned.matched) == 3
    assert len(cleaned.extra_detected) == 1
    assert not cleaned.missed_expected


def test_fuzzy_match_flags_missed_note() -> None:
    expected = np.array([0.0, 0.5, 1.0, 1.5])
    detected = np.array([0.0, 0.5, 1.5])  # skipped the note at 1.0
    result = align_dtw(detected, expected, target_bpm=120.0)
    cleaned = apply_fuzzy_match(result, detected, expected)
    assert 2 in cleaned.missed_expected  # expected index 2 (t=1.0) unmatched


def test_is_alignment_broken_threshold() -> None:
    assert is_alignment_broken(0.3) is True
    assert is_alignment_broken(0.5) is False


def test_align_empty_inputs_are_broken() -> None:
    result = align_dtw(np.array([]), np.array([0.0, 0.5]), target_bpm=120.0)
    assert result.quality == 0.0
    assert is_alignment_broken(result.quality) is True
