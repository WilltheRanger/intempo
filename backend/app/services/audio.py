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
    wait_frames = max(1, int(round((onset.wait_ms / 1000.0) * sr / hop_length)))
    times = librosa.onset.onset_detect(
        y=y,
        sr=sr,
        units="time",
        hop_length=hop_length,
        delta=delta,
        pre_max=onset.pre_max,
        post_max=onset.post_max,
        wait=wait_frames,
        backtrack=False,
    )
    return np.asarray(times, dtype=float)


def estimate_bpm(
    y: np.ndarray,
    sr: int,
    *,
    config: AudioConfig | None = None,
) -> float | None:
    """Infer BPM from a short calibration clip (§4 calibration flow).

    Tries `librosa.beat.beat_track` first; if that returns something out
    of musical range or fails, falls back to 60 / median inter-onset
    interval. Returns None when neither yields a plausible tempo — the
    caller then routes the user to manual entry (§4 calibration edge
    cases), rather than surfacing a garbage number.
    """
    cfg = config or load_audio_config()
    cal = cfg.calibration

    def _plausible(bpm: float) -> bool:
        return bool(np.isfinite(bpm)) and cal.bpm_min <= bpm <= cal.bpm_max

    try:
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(np.atleast_1d(tempo)[0])
        if _plausible(bpm):
            return round(bpm, 1)
    except Exception:  # noqa: BLE001 — any librosa failure → try the fallback
        pass

    onsets = detect_onsets(pre_emphasis(y, config=cfg), sr, config=cfg)
    if onsets.size >= 2:
        median_ioi = float(np.median(np.diff(onsets)))
        if median_ioi > 0:
            bpm = 60.0 / median_ioi
            if _plausible(bpm):
                return round(bpm, 1)
    return None
