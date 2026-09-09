"""Tests for services/audio_svc.py — the librosa wrapper layer."""

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
    for detected, expected in zip(onsets, times, strict=True):
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
    onsets: list[float],
    *,
    sr: int = SR,
    floor: float = 2e-3,
    seed: int = 5,
    decay: float = 0.35,
    length: float = 0.6,
) -> np.ndarray:
    """A take with a noise floor, which is every take made in a room."""
    rng = np.random.default_rng(seed)
    y = np.zeros(int(sr * (max(onsets) + 1.5)), dtype=np.float32)
    for onset in onsets:
        n = int(sr * length)
        t = np.arange(n) / sr
        env = (1 - np.exp(-t / 0.008)) * np.exp(-t / decay)
        env *= np.minimum(1.0, (n - np.arange(n)) / (min(0.1, length / 4) * sr))
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


# --- the window the score implies ------------------------------------------

def test_the_peak_window_is_capped_for_slow_music() -> None:
    """Notes a second apart need no narrowing, so slow music is untouched — the
    whole tuning corpus sits here and every number in it is unchanged."""
    assert audio_svc.peak_window_frames(1.0, SR) == 20
    assert audio_svc.peak_window_frames(None, SR) == 20


def test_the_peak_window_narrows_for_fast_music() -> None:
    """A window wider than the gap between two notes means the quieter of them
    is never reported. At a fixed 20 frames — ±464 ms — that made sixteenths
    undetectable above 32 BPM, and most étude writing invisible."""
    assert audio_svc.peak_window_frames(0.5, SR) == 10   # eighths at 60
    assert audio_svc.peak_window_frames(0.15, SR) == 3   # sixteenths at 100
    assert audio_svc.peak_window_frames(0.01, SR) == 1   # never below one frame


def test_sixteenths_at_a_real_tempo_are_detected() -> None:
    """The ceiling, as arithmetic rather than opinion.

    Thirty-two sixteenths at 100 BPM are 150 ms apart. Told what to expect the
    detector finds all of them; at the fixed window it found four.
    """
    gap = 0.15
    played = [0.4 + i * gap for i in range(32)]
    y = _room_tone_then_notes(played, decay=gap * 0.7, length=gap * 0.9)

    told = audio_svc.detect_onsets(y, SR, min_gap_s=gap)
    untold = audio_svc.detect_onsets(y, SR)

    found = sum(1 for t in played if np.any(np.abs(told - t) < 0.06))
    assert found == 32, f"only {found} of 32 sixteenths detected"
    assert sum(1 for t in played if np.any(np.abs(untold - t) < 0.06)) < 10, (
        "the fixed window was supposed to be the problem"
    )


class TestBlockingKeepsTheResultAndDropsTheMemory:
    """Both of these hold the whole recording in memory and throw nearly all of
    it away, on a 512 MB instance.

    Measured on a fourteen-minute take: the high-pass cost **377 MB** to filter
    75 MB of audio, and the onset envelope cost **540 MB** to produce **0.15 MB**
    of output. A take much over three minutes was an out-of-memory kill — the
    worker dies, the row is swept up as stuck, and the musician is told
    something went wrong.

    Both are computed a block at a time now. The tests that matter are the ones
    saying the answer did not change.
    """

    @staticmethod
    def _clip():
        from pathlib import Path

        corpus = Path(__file__).resolve().parents[3] / "fixtures" / "audio"
        for name in ("01_detache_clean.wav", "01_detache_clean.synthetic.wav"):
            if (corpus / name).exists():
                return audio_svc.load_audio(corpus / name, sr=22050)
        pytest.skip("no corpus audio")

    def test_the_filter_gives_the_same_answer_block_by_block(self) -> None:
        """Exactly the same, not nearly.

        An IIR filter forgets: the slowest pole here sits at radius 0.991, so
        its impulse response is down to a millionth within about 70 ms, and the
        overlap is a second. Measured against filtering the whole signal at
        once, on real audio: zero difference at one second, 6e-22 at a quarter.
        """
        import numpy as np
        from scipy.signal import butter, sosfiltfilt

        y, sr = self._clip()
        sos = butter(4, 80.0 / (0.5 * sr), btype="highpass", output="sos")
        whole = sosfiltfilt(sos, y).astype(np.float32)

        blocked = audio_svc.high_pass(y, sr, 80.0)

        assert blocked.shape == whole.shape
        assert float(np.abs(blocked - whole).max()) == 0.0

    def test_the_filter_actually_blocks_on_a_long_signal(self) -> None:
        """Otherwise the test above passes by taking the single-block path."""
        import numpy as np

        long_enough = np.zeros(
            (audio_svc._FILTER_BLOCK_S + 3 * audio_svc._FILTER_OVERLAP_S) * 22050,
            dtype=np.float32,
        )
        assert audio_svc.high_pass(long_enough, 22050, 80.0).shape == long_enough.shape

    def test_the_envelope_matches_librosa_frame_for_frame(self, monkeypatch) -> None:
        """Two references have to be global and both are easy to miss.

        `power_to_db` defaults to `ref=np.max` *and* then clips to `top_db`
        below the maximum of whatever it was handed. Taken per block, every
        block lands on its own scale — which showed up as a 0.13 difference on
        an envelope whose maximum is 14, and would have moved onsets.
        """
        import librosa
        import numpy as np

        y, sr = self._clip()
        theirs = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)

        # Forced into many blocks. Without this the corpus clip fits in one,
        # every reference is trivially global, and the test cannot fail — which
        # is what a mutation check found: taking the fixed reference back out
        # left this green.
        monkeypatch.setattr(audio_svc, "_ENVELOPE_BLOCK_FRAMES", 64)
        ours = audio_svc.onset_envelope(y, sr)

        assert ours.shape == theirs.shape
        assert float(np.abs(ours - theirs).max()) < 1e-4

    def test_the_onsets_do_not_move_even_with_absurd_blocks(self, monkeypatch) -> None:
        """The claim that actually matters. A block small enough to be silly is
        the strongest form of it — if stitching were wrong anywhere, this is
        where it would show."""
        import numpy as np

        y, sr = self._clip()
        before = audio_svc.detect_onsets(y, sr, min_gap_s=1.0)

        monkeypatch.setattr(audio_svc, "_ENVELOPE_BLOCK_FRAMES", 64)
        after = audio_svc.detect_onsets(y, sr, min_gap_s=1.0)

        assert before.size == after.size
        assert np.allclose(before, after)
