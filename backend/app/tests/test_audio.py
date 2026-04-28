"""Onset-detection layer tests against synthetic audio fixtures."""

from __future__ import annotations

import numpy as np
import pytest

from app.services.audio import (
    detect_onsets,
    highpass_filter,
    load_audio,
    pre_emphasis,
)
from app.tests._audio_helpers import quarter_note_onsets, synth_audio


# ---- pre_emphasis ---------------------------------------------------------


def test_pre_emphasis_empty() -> None:
    out = pre_emphasis(np.array([], dtype=np.float32))
    assert out.size == 0


def test_pre_emphasis_first_sample_unchanged() -> None:
    y = np.array([0.5, 0.6, 0.7], dtype=np.float32)
    out = pre_emphasis(y, coef=0.9)
    assert out[0] == pytest.approx(0.5)
    assert out[1] == pytest.approx(0.6 - 0.9 * 0.5)
    assert out[2] == pytest.approx(0.7 - 0.9 * 0.6)


# ---- highpass_filter ------------------------------------------------------


def test_highpass_attenuates_dc() -> None:
    """A pure DC signal should be ~zero after a high-pass."""
    sr = 22050
    y = np.ones(sr, dtype=np.float32) * 0.5
    out = highpass_filter(y, sr, cutoff_hz=80.0)
    # filtfilt has edge artifacts; check the middle.
    assert np.max(np.abs(out[1000:-1000])) < 0.01


def test_highpass_passes_high_frequency() -> None:
    sr = 22050
    t = np.arange(sr) / sr
    y = np.sin(2 * np.pi * 1000 * t).astype(np.float32)
    out = highpass_filter(y, sr, cutoff_hz=80.0)
    # 1 kHz sine through a 80 Hz HPF should come through largely intact.
    assert np.max(np.abs(out[1000:-1000])) > 0.9


# ---- detect_onsets --------------------------------------------------------


def test_detect_onsets_empty_audio_returns_empty() -> None:
    out = detect_onsets(np.array([], dtype=np.float32), 22050)
    assert out.size == 0


def test_detect_onsets_finds_quarter_notes_at_120bpm() -> None:
    """8 quarter notes at 120 BPM = onsets at 0, 0.5, 1.0, ..., 3.5 s."""
    expected = quarter_note_onsets(8, bpm=120.0)
    y, sr = synth_audio(expected.tolist())
    detected = detect_onsets(pre_emphasis(y), sr)
    # Expect 8 ± 1 (the leading-silence trick should give us all 8).
    assert 7 <= detected.size <= 9, f"got {detected.size} onsets, expected 7-9"


def test_detect_onsets_timing_within_50ms_at_60bpm() -> None:
    """At 60 BPM the beat is 1.0 s; detection should be tight on clean attacks.

    Tolerance is 50 ms because at the configured hop_length=512 and sr=22050,
    onset times quantize to ~23 ms grid points, so the worst-case per-onset
    error is one full hop plus a bit. Tighter tolerance needs a smaller hop
    (which the tuning loop can change in `config.toml`).
    """
    expected = quarter_note_onsets(6, bpm=60.0)
    y, sr = synth_audio(expected.tolist())
    detected = detect_onsets(pre_emphasis(y), sr)
    detected_aligned = detected - 0.1  # leading_silence_s default
    for exp_t in expected:
        diffs = np.abs(detected_aligned - exp_t)
        assert diffs.min() < 0.05, (
            f"expected onset at {exp_t:.3f}s has nearest detected "
            f"{diffs.min()*1000:.1f}ms away (>50ms)"
        )


def test_min_inter_onset_filter_drops_close_pair() -> None:
    """Two bursts 30 ms apart collapse to ≤1 onset after the post-filter.

    Override pre_max/post_max so librosa's peak-pick doesn't suppress the
    pair before our post-filter sees it (defaults are tuned for sparse-onset
    music, ±465 ms suppression around each peak).
    """
    y, sr = synth_audio([0.5, 0.53])  # 30 ms apart
    detected = detect_onsets(pre_emphasis(y), sr, pre_max=2, post_max=2, wait=1)
    assert detected.size <= 1, f"expected ≤1 onset after min-gap filter, got {detected.size}"


def test_min_inter_onset_filter_keeps_well_spaced_pair() -> None:
    """Two bursts 200 ms apart should both be detected.

    Default pre_max/post_max (=20 frames each) suppresses peaks within ±465ms,
    which would eat the second onset before the post-filter — so override to
    smaller windows so we're actually testing the post-filter, not peak-pick.
    """
    y, sr = synth_audio([0.5, 0.7])
    detected = detect_onsets(pre_emphasis(y), sr, pre_max=2, post_max=2, wait=1)
    assert detected.size >= 2, f"expected ≥2 onsets for 200ms-spaced bursts, got {detected.size}"


def test_load_audio_reads_wav(tmp_path) -> None:
    """Round-trip a WAV file through soundfile + librosa."""
    import soundfile as sf

    sr = 22050
    y_in, _ = synth_audio([0.5, 1.0, 1.5], sr=sr)
    wav_path = tmp_path / "burst.wav"
    sf.write(str(wav_path), y_in, sr)

    y_out, sr_out = load_audio(wav_path)
    assert sr_out == sr
    assert y_out.shape == y_in.shape
    # Tolerate minor float-precision diffs from int16/float32 round-tripping.
    assert np.max(np.abs(y_out - y_in)) < 0.01
