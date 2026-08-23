"""Tests for services/audio.py — the librosa wrapper layer."""

from __future__ import annotations

import numpy as np
import pytest

from app.services import audio as audio_svc
from app.tests.audio_helpers import evenly_spaced, synth_click_track, write_wav

SR = 22050


@pytest.mark.parametrize("n", [4, 8, 12, 16])
def test_detect_onsets_count_within_tolerance(n: int) -> None:
    # DoD: N onsets detected within ±2 of expected count.
    times = evenly_spaced(n, bpm=120.0)
    y = synth_click_track(times, sr=SR)
    onsets = audio_svc.detect_onsets(audio_svc.pre_emphasis(y), SR)
    assert abs(len(onsets) - n) <= 2


def test_detect_onsets_times_are_close() -> None:
    times = evenly_spaced(8, bpm=100.0)
    y = synth_click_track(times, sr=SR)
    onsets = audio_svc.detect_onsets(audio_svc.pre_emphasis(y), SR)
    assert len(onsets) == 8
    # Each detected onset within 40ms of the true attack.
    for detected, expected in zip(onsets, times):
        assert abs(detected - expected) < 0.04


def test_detect_onsets_on_silence_is_empty() -> None:
    y = np.zeros(SR * 2, dtype=np.float32)
    onsets = audio_svc.detect_onsets(audio_svc.pre_emphasis(y), SR)
    assert onsets.size == 0


def test_load_audio_returns_mono_and_sr(tmp_path) -> None:
    times = evenly_spaced(4, bpm=90.0)
    path = write_wav(tmp_path / "clip.wav", synth_click_track(times, sr=SR), sr=SR)
    y, sr = audio_svc.load_audio(path)
    assert sr == SR
    assert y.ndim == 1
    assert y.size > 0


def test_pre_emphasis_preserves_length() -> None:
    y = synth_click_track(evenly_spaced(4, 120.0), sr=SR)
    assert audio_svc.pre_emphasis(y).shape == y.shape


def test_high_pass_attenuates_low_frequency() -> None:
    t = np.arange(SR) / SR
    low = np.sin(2 * np.pi * 40 * t).astype(np.float32)  # 40 Hz — below cutoff
    filtered = audio_svc.high_pass(low, SR, cutoff_hz=80.0)
    assert np.max(np.abs(filtered)) < 0.5 * np.max(np.abs(low))
