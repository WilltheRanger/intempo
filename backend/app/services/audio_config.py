"""Loader for the audio-analysis tuning config (`backend/config.toml`).

Every threshold the pipeline uses — onset `delta`, tolerance bands,
alignment quality cutoffs — lives in `config.toml`, never hard-coded in
the services. That is what makes the Batch 3 tuning loop cheap: change a
number, re-run the fixtures, log it in TUNING_LOG.md; no code edit.

In production these values come from remote config (a Supabase row).
This module is the checked-in default and the shape everything else
imports. `load_audio_config()` is cached; pass an explicit path in tests
to load an alternate file.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

# backend/config.toml — two parents up from app/services/.
CONFIG_PATH = Path(__file__).resolve().parents[2] / "config.toml"


@dataclass(frozen=True)
class OnsetConfig:
    sr: int
    delta: float
    pre_max: int
    post_max: int
    wait_ms: int
    pre_emphasis_coef: float
    # double-bass overrides
    double_bass_delta: float
    double_bass_highpass_hz: float


@dataclass(frozen=True)
class ToleranceConfig:
    rushing_inner_pct: float
    rushing_mid_pct: float
    rushing_outer_pct: float
    dragging_inner_pct: float
    dragging_mid_pct: float
    dragging_outer_pct: float
    #: See `[tolerance.pulse]` in config.toml.
    disturbance_deviations: float = 6.0
    disturbance_floor_beats: float = 0.1667


@dataclass(frozen=True)
class TrendConfig:
    window: int


@dataclass(frozen=True)
class AlignmentConfig:
    warn_quality: float
    broken_quality: float
    sakoe_chiba_band: float
    slur_tolerance_pct: float


@dataclass(frozen=True)
class CalibrationConfig:
    min_duration_s: float
    max_duration_s: float
    min_peak_dbfs: float
    min_rms_dbfs: float
    min_onsets: int
    max_onsets: int
    ioi_cv_max: float
    octave_ambiguity_threshold: float
    bpm_min: float
    bpm_max: float


@dataclass(frozen=True)
class AudioConfig:
    onset: OnsetConfig
    tolerance: ToleranceConfig
    trend: TrendConfig
    alignment: AlignmentConfig
    calibration: CalibrationConfig


def _parse(raw: dict) -> AudioConfig:
    onset = raw["onset"]
    dbl = onset.get("double_bass", {})
    tol = raw["tolerance"]
    trend = raw["trend"]
    align = raw["alignment"]
    cal = raw["calibration"]
    return AudioConfig(
        onset=OnsetConfig(
            sr=int(onset["sr"]),
            delta=float(onset["delta"]),
            pre_max=int(onset["pre_max"]),
            post_max=int(onset["post_max"]),
            wait_ms=int(onset["wait_ms"]),
            pre_emphasis_coef=float(onset["pre_emphasis_coef"]),
            double_bass_delta=float(dbl.get("delta", onset["delta"])),
            double_bass_highpass_hz=float(dbl.get("highpass_hz", 80.0)),
        ),
        tolerance=ToleranceConfig(
            rushing_inner_pct=float(tol["rushing_inner_pct"]),
            rushing_mid_pct=float(tol["rushing_mid_pct"]),
            rushing_outer_pct=float(tol["rushing_outer_pct"]),
            dragging_inner_pct=float(tol["dragging_inner_pct"]),
            dragging_mid_pct=float(tol["dragging_mid_pct"]),
            dragging_outer_pct=float(tol["dragging_outer_pct"]),
            disturbance_deviations=float(
                tol.get("pulse", {}).get("disturbance_deviations", 6.0)
            ),
            disturbance_floor_beats=float(
                tol.get("pulse", {}).get("disturbance_floor_beats", 0.1667)
            ),
        ),
        trend=TrendConfig(window=int(trend["window"])),
        alignment=AlignmentConfig(
            warn_quality=float(align["warn_quality"]),
            broken_quality=float(align["broken_quality"]),
            sakoe_chiba_band=float(align["sakoe_chiba_band"]),
            slur_tolerance_pct=float(align["slur_tolerance_pct"]),
        ),
        calibration=CalibrationConfig(
            min_duration_s=float(cal["min_duration_s"]),
            max_duration_s=float(cal["max_duration_s"]),
            min_peak_dbfs=float(cal["min_peak_dbfs"]),
            min_rms_dbfs=float(cal["min_rms_dbfs"]),
            min_onsets=int(cal["min_onsets"]),
            max_onsets=int(cal["max_onsets"]),
            ioi_cv_max=float(cal["ioi_cv_max"]),
            octave_ambiguity_threshold=float(cal["octave_ambiguity_threshold"]),
            bpm_min=float(cal["bpm_min"]),
            bpm_max=float(cal["bpm_max"]),
        ),
    )


def load_audio_config_from(path: Path) -> AudioConfig:
    """Parse a specific config.toml (used by tests to load fixtures)."""
    with path.open("rb") as fh:
        raw = tomllib.load(fh)
    return _parse(raw)


@lru_cache
def load_audio_config() -> AudioConfig:
    """The process-wide default config, read once from `backend/config.toml`."""
    return load_audio_config_from(CONFIG_PATH)
