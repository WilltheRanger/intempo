"""Layer 1 of the audio pipeline: waveform → onset timestamps.

Thin, testable wrappers around librosa. No alignment or classification
here — this module only answers "when did a note attack happen?" and
"what tempo did they play at?" Every tunable number comes from
`audio_config`, never a literal in this file (Batch 3 tuning rule).

Spec references: §4 signal-processing table, §7.5 problem 1 (bass onset
clarity), §4 calibration-clip flow.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import librosa
import numpy as np
from scipy.signal import butter, sosfiltfilt

from app.services.audio_config import AudioConfig, load_audio_config


def load_audio(path: str | Path, *, sr: int | None = None) -> tuple[np.ndarray, int]:
    """Load an audio file as mono at the configured sample rate.

    22.05 kHz mono is plenty for onset detection and halves CPU vs 44.1k
    (§4). We deliberately do NOT peak-normalize here — normalization eats
    real onsets (Batch 3 pitfall).
    """
    cfg = load_audio_config()
    target_sr = sr if sr is not None else cfg.onset.sr
    y, out_sr = librosa.load(str(path), sr=target_sr, mono=True)
    return y, int(out_sr)


def load_audio_bytes(
    data: bytes, *, sr: int | None = None, suffix: str = ".audio"
) -> tuple[np.ndarray, int]:
    """Load audio from an in-memory blob (as fetched from storage).

    librosa reads WAV/FLAC/OGG straight from a buffer, but the AAC/m4a
    the mobile client uploads needs a real file on disk for the
    audioread/ffmpeg fallback — so we spill to a temp file and load that.
    (ffmpeg must be present in the deployed image for compressed formats;
    documented in DECISIONS.md.)
    """
    with tempfile.NamedTemporaryFile(suffix=suffix) as fh:
        fh.write(data)
        fh.flush()
        return load_audio(fh.name, sr=sr)


def pre_emphasis(y: np.ndarray, *, config: AudioConfig | None = None) -> np.ndarray:
    """Boost high frequencies before onset detection.

    Sharpens note attacks, which especially helps the broad, slow-attack
    onsets of the low register (§4, §7.5).
    """
    cfg = config or load_audio_config()
    return librosa.effects.preemphasis(y, coef=cfg.onset.pre_emphasis_coef)


def high_pass(y: np.ndarray, sr: int, cutoff_hz: float) -> np.ndarray:
    """Zero-phase Butterworth high-pass.

    Used in double-bass mode: detecting onsets in the high partials of a
    bass note is more reliable than in the boomy fundamental, and it
    rejects room-mode reverb tails that fake onsets (§7.5 problem 1/3).
    """
    nyquist = 0.5 * sr
    normalized = min(cutoff_hz / nyquist, 0.99)
    sos = butter(4, normalized, btype="highpass", output="sos")
    return sosfiltfilt(sos, y).astype(np.float32, copy=False)


def detect_onsets(
    y: np.ndarray,
    sr: int,
    *,
    double_bass: bool = False,
    config: AudioConfig | None = None,
) -> np.ndarray:
    """Return onset timestamps (seconds) via `librosa.onset.onset_detect`.

    Uses the peak-pick parameters from config (`delta`, `pre_max`,
    `post_max`, `wait`). `wait` enforces a minimum inter-onset gap, which
    suppresses the double/triple triggers a ringing pizzicato string
    produces (§7 problem 4). In `double_bass` mode we drop `delta` and
    high-pass first (caller is expected to pass an already-filtered `y`;
    this only swaps the peak-pick threshold).
    """
    cfg = config or load_audio_config()
    onset = cfg.onset
    delta = onset.double_bass_delta if double_bass else onset.delta
    # librosa wants `wait` in frames; convert from milliseconds.
    hop_length = 512  # librosa onset default
    n_fft = 2048  # librosa onset default
    wait_frames = max(1, int(round((onset.wait_ms / 1000.0) * sr / hop_length)))

    strength = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)

    # The first frames are silenced because their input is not audio.
    #
    # Onset strength is spectral flux: each frame compared with the one before
    # it. At the very start there is no frame before, so the STFT compares
    # against its own zero-padding, and the step from padding into the room's
    # noise floor is a large positive flux — the *recording beginning* looks
    # exactly like a note starting.
    #
    # It is not subtle and it is not rare. On a take with any noise floor at
    # all it fires at 0.070 s, every time, three frames in, at 41% of the
    # envelope's maximum. Only a signal beginning in perfect digital silence
    # escapes it, which is why the synthetic fixtures never showed it and why
    # every real recording will.
    #
    # It is the first onset, so it became the alignment origin, and everything
    # downstream inherited the error: on a dead-on-time bass take it took the
    # place of the first note, pushed the remaining notes onto the wrong bars
    # and reported "you dragged by 74 BPM" to somebody playing perfectly.
    #
    # `n_fft // hop_length` frames — 93 ms here — is exactly the region the
    # padding reaches and no more. Nobody starts playing within 93 ms of
    # tapping record; a synthetic fixture that does is what the tests below
    # cover explicitly.
    contaminated = n_fft // hop_length
    strength[:contaminated] = 0.0

    frames = librosa.onset.onset_detect(
        onset_envelope=strength,
        sr=sr,
        units="frames",
        hop_length=hop_length,
        delta=delta,
        pre_max=onset.pre_max,
        post_max=onset.post_max,
        wait=wait_frames,
        backtrack=False,
    )
    times = librosa.frames_to_time(frames, sr=sr, hop_length=hop_length)
    return np.asarray(times, dtype=float)
