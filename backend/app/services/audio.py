"""Audio loading + onset detection.

Layer 1 of the analysis pipeline (spec §4 "Three threshold layers").
Every threshold lives in `config.toml`; this module just reads them
and calls the librosa primitives. Tunable knobs:

- `delta`: librosa.onset.onset_detect peak-pick threshold
- `pre_max` / `post_max`: peak-pick window
- `wait`: minimum frames between onsets
- `hop_length`: STFT hop
- `pre_emphasis_coef`: high-pass-y boost before onset detection
- `min_inter_onset_ms`: post-detection minimum gap (vibrato + pizz ring)
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import librosa
import numpy as np
import scipy.signal

from app.config import settings


def _audio_cfg() -> dict[str, Any]:
    return settings.AUDIO.get("audio", {})


def _onset_cfg() -> dict[str, Any]:
    return settings.AUDIO.get("onset", {})


def load_audio(path: str | Path, sr: int | None = None) -> tuple[np.ndarray, int]:
    """Load mono audio at the configured sample rate. Returns (waveform, sr)."""
    target_sr = sr if sr is not None else int(_audio_cfg().get("sample_rate", 22050))
    y, sr_actual = librosa.load(str(path), sr=target_sr, mono=True)
    return y.astype(np.float32, copy=False), int(sr_actual)


def pre_emphasis(y: np.ndarray, coef: float | None = None) -> np.ndarray:
    """First-order high-pass pre-emphasis: y[n] -= coef * y[n-1]."""
    if coef is None:
        coef = float(_audio_cfg().get("pre_emphasis_coef", 0.97))
    if y.size == 0:
        return y
    out = np.empty_like(y)
    out[0] = y[0]
    out[1:] = y[1:] - coef * y[:-1]
    return out


def highpass_filter(y: np.ndarray, sr: int, cutoff_hz: float | None = None, order: int = 4) -> np.ndarray:
    """Butterworth high-pass for double-bass mode (rejects sub-fundamental rumble + room modes)."""
    if cutoff_hz is None:
        cutoff_hz = float(_audio_cfg().get("highpass_cutoff_hz", 60.0))
    if y.size == 0:
        return y
    nyquist = sr / 2.0
    sos = scipy.signal.butter(order, cutoff_hz / nyquist, btype="highpass", output="sos")
    return scipy.signal.sosfiltfilt(sos, y).astype(np.float32, copy=False)


def detect_onsets(
    y: np.ndarray,
    sr: int,
    *,
    delta: float | None = None,
    pre_max: int | None = None,
    post_max: int | None = None,
    wait: int | None = None,
    hop_length: int | None = None,
    min_inter_onset_ms: float | None = None,
) -> np.ndarray:
    """Detect onsets, return seconds. Reads config.toml defaults; explicit args override.

    The post-filter strips onsets closer together than `min_inter_onset_ms` —
    this is the spec §5 mitigation for vibrato wobble and pizzicato string-ring
    phantom onsets.
    """
    cfg = _onset_cfg()
    delta = float(cfg.get("delta", 0.07)) if delta is None else delta
    pre_max = int(cfg.get("pre_max", 20)) if pre_max is None else pre_max
    post_max = int(cfg.get("post_max", 20)) if post_max is None else post_max
    wait = int(cfg.get("wait", 10)) if wait is None else wait
    hop_length = int(cfg.get("hop_length", 512)) if hop_length is None else hop_length
    min_inter_onset_ms = (
        float(cfg.get("min_inter_onset_ms", 60.0))
        if min_inter_onset_ms is None
        else min_inter_onset_ms
    )

    if y.size == 0:
        return np.array([], dtype=np.float64)

    onset_envelope = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    frames = librosa.onset.onset_detect(
        onset_envelope=onset_envelope,
        sr=sr,
        hop_length=hop_length,
        delta=delta,
        pre_max=pre_max,
        post_max=post_max,
        wait=wait,
        units="frames",
    )
    if frames.size == 0:
        return np.array([], dtype=np.float64)
    times = librosa.frames_to_time(frames, sr=sr, hop_length=hop_length)
    return _enforce_min_gap(times, min_inter_onset_ms / 1000.0)


def _enforce_min_gap(times: np.ndarray, min_gap_s: float) -> np.ndarray:
    """Drop any onset that comes within `min_gap_s` of the previous accepted one."""
    if times.size <= 1 or min_gap_s <= 0:
        return times
    kept = [float(times[0])]
    for t in times[1:]:
        if (t - kept[-1]) >= min_gap_s:
            kept.append(float(t))
    return np.asarray(kept, dtype=np.float64)
