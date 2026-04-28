"""Top-level orchestrator: audio → onsets → DTW → deltas → verdict.

Public API (used by Batch 4's /v1/analyses runner):
- `analyze(audio_path, score, target_bpm) -> AnalysisResult`
- `analyze_with_diagnostics(audio_path, score, target_bpm) -> AnalysisDiagnostics`
  (extra fields the tuning dashboard needs)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from app.config import settings
from app.services.alignment import (
    align_dtw,
    apply_fuzzy_match,
    compute_expected_onsets,
    is_alignment_broken,
    quality_warn,
)
from app.services.audio import detect_onsets, highpass_filter, load_audio, pre_emphasis
from app.services.classification import (
    Band,
    Delta,
    Verdict,
    classify_band,
    compute_deltas,
    generate_verdict,
    rolling_trend,
)
from app.services.score_schema import ScoreJson


# ---- Result models --------------------------------------------------------


class PerNoteResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note_index: int
    measure_number: int | None
    detected_time_s: float
    expected_time_s: float
    delta_ms: float
    delta_pct: float
    band: Band


class PerMeasureResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    measure_number: int
    avg_delta_ms: float
    avg_delta_pct: float
    band: Band


class VerdictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    headline: str
    overall: Band
    largest_run_pct: float
    largest_run_start_idx: int
    largest_run_end_idx: int


class AnalysisResult(BaseModel):
    """Final result of `analyze()`. Serializable to JSON for the analyses table."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "alignment_failed", "no_audio"]
    quality: float = Field(ge=0.0, le=1.0)
    quality_warning: bool = False
    target_bpm: float
    per_note: list[PerNoteResult] = Field(default_factory=list)
    per_measure: list[PerMeasureResult] = Field(default_factory=list)
    trend: list[float] = Field(default_factory=list)
    missed_notes: list[int] = Field(default_factory=list)
    extra_notes: list[int] = Field(default_factory=list)
    verdict: VerdictModel | None = None
    failure_reason: str | None = None


# ---- Diagnostics (dashboard-only) ----------------------------------------


@dataclass(slots=True)
class AnalysisDiagnostics:
    """Everything the tuning dashboard needs to plot a single fixture run.

    Not a Pydantic model because it ships numpy arrays that we want to keep
    as-is (the dashboard converts to plain lists at render time).
    """

    waveform: np.ndarray              # float32, mono
    sample_rate: int
    detected_onsets_s: np.ndarray     # 1D float
    expected_onsets_s: np.ndarray     # 1D float
    matched_pairs: list[tuple[int, int]]  # (detected_idx, expected_idx)
    missed_expected_idx: list[int]
    extra_detected_idx: list[int]
    deltas_ms: list[float]
    delta_pcts: list[float]
    bands: list[Band]
    rolling_trend_pcts: list[float]
    alignment_quality: float
    verdict: Verdict | None
    target_bpm: float
    config_snapshot: dict[str, Any]


# ---- Orchestrator ---------------------------------------------------------


def _build_per_note(deltas: list[Delta], note_to_measure: dict[int, int]) -> list[PerNoteResult]:
    return [
        PerNoteResult(
            note_index=d.note_index,
            measure_number=note_to_measure.get(d.note_index),
            detected_time_s=d.detected_time_s,
            expected_time_s=d.expected_time_s,
            delta_ms=d.delta_ms,
            delta_pct=d.delta_pct,
            band=d.band,
        )
        for d in deltas
    ]


def _build_per_measure(per_note: list[PerNoteResult]) -> list[PerMeasureResult]:
    """Average delta per measure, classified into a single band."""
    by_measure: dict[int, list[PerNoteResult]] = {}
    for n in per_note:
        if n.measure_number is None:
            continue
        by_measure.setdefault(n.measure_number, []).append(n)
    out: list[PerMeasureResult] = []
    for m_num in sorted(by_measure):
        rows = by_measure[m_num]
        avg_ms = float(np.mean([r.delta_ms for r in rows]))
        avg_pct = float(np.mean([r.delta_pct for r in rows]))
        out.append(
            PerMeasureResult(
                measure_number=m_num,
                avg_delta_ms=avg_ms,
                avg_delta_pct=avg_pct,
                band=classify_band(avg_pct),
            )
        )
    return out


def _note_to_measure_map(score: ScoreJson) -> dict[int, int]:
    out: dict[int, int] = {}
    note_idx = 0
    for measure in score.measures:
        for note in measure.notes:
            if note.pitch != "rest":
                out[note_idx] = measure.measure_number
                note_idx += 1
    return out


def analyze(
    audio_path: str | Path,
    score: ScoreJson,
    target_bpm: float,
    *,
    apply_highpass: bool = False,
) -> AnalysisResult:
    """Full pipeline. Returns an `AnalysisResult` ready to JSON-serialize."""
    y, sr = load_audio(audio_path)
    if y.size == 0:
        return AnalysisResult(
            status="no_audio",
            quality=0.0,
            target_bpm=target_bpm,
            failure_reason="empty audio",
        )

    if apply_highpass:
        y = highpass_filter(y, sr)
    pre = pre_emphasis(y)
    detected = detect_onsets(pre, sr)
    expected = compute_expected_onsets(score, target_bpm)

    if expected.size == 0:
        return AnalysisResult(
            status="no_audio",
            quality=0.0,
            target_bpm=target_bpm,
            failure_reason="score has no notes",
        )

    raw = align_dtw(detected, expected)
    if is_alignment_broken(raw.quality_score):
        return AnalysisResult(
            status="alignment_failed",
            quality=raw.quality_score,
            target_bpm=target_bpm,
            failure_reason=(
                f"alignment quality {raw.quality_score:.2f} below refuse threshold"
            ),
        )

    cleaned = apply_fuzzy_match(raw)
    deltas = compute_deltas(cleaned, target_bpm)
    classifications = [d.band for d in deltas]
    trend = rolling_trend([d.delta_pct for d in deltas])
    verdict = generate_verdict(
        deltas, classifications, target_bpm, score_measures=score.measures
    )

    note_to_measure = _note_to_measure_map(score)
    per_note = _build_per_note(deltas, note_to_measure)
    per_measure = _build_per_measure(per_note)

    return AnalysisResult(
        status="ok",
        quality=raw.quality_score,
        quality_warning=quality_warn(raw.quality_score),
        target_bpm=target_bpm,
        per_note=per_note,
        per_measure=per_measure,
        trend=trend,
        missed_notes=cleaned.missed_expected_idx,
        extra_notes=cleaned.extra_detected_idx,
        verdict=VerdictModel(
            headline=verdict.headline,
            overall=verdict.overall,
            largest_run_pct=verdict.largest_run_pct,
            largest_run_start_idx=verdict.largest_run_start_idx,
            largest_run_end_idx=verdict.largest_run_end_idx,
        ),
    )


def analyze_with_diagnostics(
    audio_path: str | Path,
    score: ScoreJson,
    target_bpm: float,
    *,
    apply_highpass: bool = False,
) -> AnalysisDiagnostics:
    """Same flow as `analyze`, but returns everything the tuning dashboard plots.

    Always runs end-to-end (no early-return on alignment failure) — the dashboard
    needs to *show* the failure, not hide it.
    """
    y, sr = load_audio(audio_path)
    if apply_highpass:
        y = highpass_filter(y, sr)
    pre = pre_emphasis(y)
    detected = detect_onsets(pre, sr)
    expected = compute_expected_onsets(score, target_bpm)

    raw = align_dtw(detected, expected)
    cleaned = apply_fuzzy_match(raw)
    deltas = compute_deltas(cleaned, target_bpm)
    classifications = [d.band for d in deltas]
    trend = rolling_trend([d.delta_pct for d in deltas])
    verdict = generate_verdict(
        deltas, classifications, target_bpm, score_measures=score.measures
    ) if deltas else None

    return AnalysisDiagnostics(
        waveform=y,
        sample_rate=sr,
        detected_onsets_s=detected,
        expected_onsets_s=expected,
        matched_pairs=[(p.detected_idx, p.expected_idx) for p in cleaned.matched],
        missed_expected_idx=cleaned.missed_expected_idx,
        extra_detected_idx=cleaned.extra_detected_idx,
        deltas_ms=[d.delta_ms for d in deltas],
        delta_pcts=[d.delta_pct for d in deltas],
        bands=[d.band for d in deltas],
        rolling_trend_pcts=trend,
        alignment_quality=raw.quality_score,
        verdict=verdict,
        target_bpm=target_bpm,
        config_snapshot={
            "audio": settings.AUDIO.get("audio", {}),
            "onset": settings.AUDIO.get("onset", {}),
            "alignment": settings.AUDIO.get("alignment", {}),
            "classification": settings.AUDIO.get("classification", {}),
        },
    )
