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


# --- the recording beginning is not a note ---------------------------------

def _room_tone_then_notes(
    onsets: list[float], *, sr: int = SR, floor: float = 2e-3, seed: int = 5
) -> np.ndarray:
    """A take with a noise floor, which is every take made in a room."""
    rng = np.random.default_rng(seed)
    y = np.zeros(int(sr * (max(onsets) + 1.5)), dtype=np.float32)
    for onset in onsets:
        n = int(sr * 0.6)
        t = np.arange(n) / sr
        env = (1 - np.exp(-t / 0.02)) * np.exp(-t / 0.35)
        env *= np.minimum(1.0, (n - np.arange(n)) / (0.1 * sr))
        tone = sum(a * np.sin(2 * np.pi * 110 * k * t) for k, a in [(1, 1.0), (2, 0.5), (3, 0.25)])
        start = int(onset * sr)
        y[start : start + n] += (env * tone * 0.3).astype(np.float32)
    return y + rng.normal(0, floor, y.shape).astype(np.float32)


def test_the_start_of_a_noisy_recording_is_not_itself_an_onset() -> None:
    """Onset strength is spectral flux, and at the first frames the STFT has
    nothing to compare against but its own zero-padding. The step from that
    padding into the room's noise floor is a large positive flux — the
    *recording beginning* looks exactly like a note starting.

    Deterministic, not occasional: it fired at **0.070 s** on every take with
    any noise floor at all, three frames in, at 41% of the envelope's maximum.
    Only a signal beginning in perfect digital silence escaped it, which is why
    all six synthetic fixtures missed it and every real recording would have
    had it.

    It was the first onset, so it became the alignment origin. On a dead-on-time
    bass take it displaced the first note, pushed the rest onto the wrong bars,
    and reported "you dragged by 74 BPM" to somebody playing perfectly.

    The claim here is exact and no larger than the fix: nothing is detected
    inside the region the STFT's padding reaches. Noise elsewhere in the take
    can still trigger a false onset — that is `delta` against a real room's
    noise floor, and it needs real recordings. See `TUNING_LOG.md`.
    """
    contaminated_s = 2048 / 512 * 512 / SR  # n_fft // hop frames, in seconds
    played = [1.0 + i for i in range(6)]
    detected = audio_svc.detect_onsets(_room_tone_then_notes(played), SR)

    assert len(detected), "nothing detected at all"
    assert detected[0] > contaminated_s, (
        f"an onset fired at {detected[0]:.3f}s, inside the {contaminated_s:.3f}s "
        "the STFT's own padding reaches"
    )
    # And every real note is still found, whatever else the noise adds.
    for onset in played:
        assert any(abs(d - onset) < 0.1 for d in detected), f"lost the note at {onset}s"


def test_a_note_just_past_the_boundary_is_still_heard() -> None:
    """The guard against over-correcting. Only the frames the padding actually
    reaches are silenced — `n_fft // hop_length`, 93 ms here — so a fixture
    whose first click lands at 200 ms is still detected. The synthetic corpus
    starts at 200 ms, which makes this a real constraint rather than a
    hypothetical one."""
    detected = audio_svc.detect_onsets(_room_tone_then_notes([0.2, 1.2, 2.2]), SR)
    assert len(detected) == 3, f"a note at 200ms was lost: {detected}"
    assert detected[0] < 0.5
