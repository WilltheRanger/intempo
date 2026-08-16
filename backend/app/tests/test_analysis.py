"""Tests for services/analysis.py — the end-to-end orchestrator."""

from __future__ import annotations

import json

from app.services.analysis import analyze
from app.services.score_schema import Measure, Note, ScoreJson
from app.tests.audio_helpers import evenly_spaced, synth_click_track, write_wav

SR = 22050


def _eight_quarter_note_score() -> ScoreJson:
    return ScoreJson(
        clef="treble",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(measure_number=1, notes=[Note(pitch="A4", duration="quarter")] * 4),
            Measure(measure_number=2, notes=[Note(pitch="A4", duration="quarter")] * 4),
        ],
    )


def test_analyze_clean_recording_is_ok_and_steady(tmp_path) -> None:
    score = _eight_quarter_note_score()
    # Play exactly on the 120 BPM grid the score expects.
    times = evenly_spaced(8, bpm=120.0)
    path = write_wav(tmp_path / "clean.wav", synth_click_track(times, sr=SR), sr=SR)

    result = analyze(path, score, target_bpm=120.0)

    assert result.status == "ok"
    assert result.quality > 0.9
    assert result.low_confidence is False
    assert len(result.per_note) == 8
    assert result.verdict_direction.value == "on"


def test_analyze_rushing_recording_reports_rushed(tmp_path) -> None:
    score = _eight_quarter_note_score()
    times = evenly_spaced(8, bpm=132.0)  # faster than target → rushing
    path = write_wav(tmp_path / "rush.wav", synth_click_track(times, sr=SR), sr=SR)

    result = analyze(path, score, target_bpm=120.0)

    assert result.status == "ok"
    assert "rushed" in result.verdict
    assert result.verdict_direction.value == "rush"


def test_analyze_result_serializes_to_json(tmp_path) -> None:
    score = _eight_quarter_note_score()
    times = evenly_spaced(8, bpm=120.0)
    path = write_wav(tmp_path / "clip.wav", synth_click_track(times, sr=SR), sr=SR)

    result = analyze(path, score, target_bpm=120.0)

    payload = json.loads(result.model_dump_json())
    assert payload["status"] == "ok"
    assert isinstance(payload["per_note"], list)
    assert isinstance(payload["trend"], list)
    assert isinstance(payload["verdict"], str)


def test_analyze_silence_returns_no_onsets(tmp_path) -> None:
    import numpy as np

    score = _eight_quarter_note_score()
    silence = np.zeros(SR * 2, dtype="float32")
    path = write_wav(tmp_path / "silent.wav", silence, sr=SR)

    result = analyze(path, score, target_bpm=120.0)

    assert result.status == "no_onsets"
    assert result.n_detected_onsets == 0


def test_analyze_partial_take_fails_alignment_gracefully(tmp_path) -> None:
    # Score expects 8 notes; the player got two notes in and stopped
    # (wrong page, or gave up). Coverage is far too low to trust, so we
    # refuse to report rather than inventing a verdict from two onsets.
    score = _eight_quarter_note_score()
    times = [0.2, 0.7]
    path = write_wav(tmp_path / "partial.wav", synth_click_track(times, sr=SR), sr=SR)

    result = analyze(path, score, target_bpm=120.0)

    assert result.status == "alignment_failed"
    assert result.quality < 0.4


def test_analyze_runs_well_under_15_seconds(tmp_path) -> None:
    import time

    score = _eight_quarter_note_score()
    times = evenly_spaced(8, bpm=120.0)
    path = write_wav(tmp_path / "perf.wav", synth_click_track(times, sr=SR), sr=SR)

    started = time.perf_counter()
    analyze(path, score, target_bpm=120.0)
    assert time.perf_counter() - started < 15.0  # DoD: <15s per fixture pair
