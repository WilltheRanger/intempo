"""Loader for the audio-analysis tuning config (`backend/config.toml`).

The thresholds a tuning session turns — onset `delta`, the tolerance bands,
the alignment quality cutoffs — live in `config.toml` rather than in the
services, which is what makes the Batch 3 loop cheap: change a number, re-run
the fixtures, log it in TUNING_LOG.md; no code edit.

**That is not the same as "every number in the pipeline is here", and this
docstring used to say it was.** Measured 2026-09-04: eleven decision constants
live in Python, each with a measured rationale in its own comment —
`ORNAMENT_SHARE`, `MIN_TEMPO_RATIO` / `MAX_TEMPO_RATIO`,
`MIN_ONSETS_TO_ESTIMATE_TEMPO`, `MAX_EDGE_TRIM`, `MIN_TRIM_GAIN`,
`POSITION_WEIGHT`, `POSITION_CAP_GAPS`, `_GAP_CORE_LOW` / `_GAP_CORE_HIGH`
(`alignment.py`) and `TAKE_TOO_LONG_RATIO` (`analysis.py`). Most sit in a
measured flat region and are structure rather than knobs — `POSITION_WEIGHT`'s
comment says anything from 0.25 to 2.0 behaves the same. `ORNAMENT_SHARE` is
the exception worth knowing about: its comment says it was *"chosen against two
synthetic takes and no real recording, which is the honest limit on it"*, so it
is a value the tuning session should look at and it is not in this file.

Two fields here turn nothing at all; `test_tuning_knobs.py` names them and
`config.toml` says so beside each.

In production these values come from remote config (a Supabase row).
This module is the checked-in default and the shape everything else
imports. `load_audio_config()` is cached; pass an explicit path in tests
to load an alternate file.
"""

from __future__ import annotations

import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

# backend/config.toml — two parents up from app/services/.
CONFIG_PATH = Path(__file__).resolve().parents[2] / "config.toml"


@dataclass(frozen=True)
class InstrumentOnset:
    """The two onset settings that depend on which instrument was played.

    `highpass_hz` of 0 means no filter, which is what the three treble
    instruments get today.
    """

    delta: float
    highpass_hz: float


@dataclass(frozen=True)
class OnsetConfig:
    sr: int
    delta: float
    pre_max: int
    post_max: int
    wait_ms: int
    pre_emphasis_coef: float
    # The older spelling of the bass row, kept because a deployment's
    # remote-config row may still send only this. `instruments` is what the
    # pipeline reads; this seeds the bass entry when the table is absent.
    double_bass_delta: float
    double_bass_highpass_hz: float
    #: Per instrument, keyed by the `Instrument` enum's values.
    #:
    #: **Empty is a valid config and not an error.** A remote-config row
    #: written before this table existed sends no `[onset.instrument]`, and
    #: such a deployment must keep reading takes exactly as it did — so
    #: `for_instrument` falls back to the flat `delta` and the bass override,
    #: which is precisely the old behaviour.
    instruments: Mapping[str, InstrumentOnset] = field(default_factory=dict)
    #: See `[onset.recovery]` in config.toml. Defaulted so a deployment whose
    #: remote-config row predates them keeps loading.
    recovery_search_share: float = 0.25
    recovery_floor_ratio: float = 0.015


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
class IntakeConfig:
    """See `[intake]` in config.toml. What a file has to be to be decoded."""

    max_duration_s: float = 600.0


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
    #: Defaulted, so a deployment whose remote-config row predates the upload
    #: feature keeps loading rather than failing to parse a config it has
    #: always been able to read.
    intake: IntakeConfig = IntakeConfig()


def _parse(raw: dict) -> AudioConfig:
    onset = raw["onset"]
    dbl = onset.get("double_bass", {})
    rec = onset.get("recovery", {})
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
            instruments={
                name: InstrumentOnset(
                    delta=float(row.get("delta", onset["delta"])),
                    highpass_hz=float(row.get("highpass_hz", 0.0)),
                )
                for name, row in (onset.get("instrument") or {}).items()
                if isinstance(row, dict)
            },
            recovery_search_share=float(rec.get("search_share", 0.25)),
            recovery_floor_ratio=float(rec.get("floor_ratio", 0.015)),
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
        intake=IntakeConfig(
            max_duration_s=float(raw.get("intake", {}).get("max_duration_s", 600.0)),
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
