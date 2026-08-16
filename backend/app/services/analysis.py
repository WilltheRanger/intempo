"""Orchestrator: ties audio → alignment → classification into `analyze()`.

Public entry point for Batch 3. Synchronous by design — Batch 4 wraps
this in FastAPI `BackgroundTasks` (and later Celery). The return value is
a Pydantic model so it serializes to the `analyses.result_json` column
cleanly and deterministically.

Flow (spec §4 pseudocode):
    load → pre-emphasis → onset detect → expected onsets → DTW →
    (bail if broken) → fuzzy match → deltas → bands → trend → verdict
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from app.services import audio as audio_svc
from app.services.alignment import (
    align_dtw,
    apply_fuzzy_match,
    build_timeline,
    is_alignment_broken,
)
from app.services.audio_config import AudioConfig, load_audio_config
from app.services.classification import (
    Band,
    Delta,
    Direction,
    compute_deltas,
    generate_verdict,
    rolling_trend,
)
from app.services.score_schema import ScoreJson

Status = Literal["ok", "alignment_failed", "no_onsets"]


class PerNote(BaseModel):
    global_index: int
    measure_number: int
    delta_ms: float
    delta_pct: float
    band: Band
    direction: Direction
    is_slur_interior: bool


class PerMeasure(BaseModel):
    measure_number: int
    note_count: int
    avg_delta_pct: float
    worst_band: Band
    direction: Direction


class AnalysisResult(BaseModel):
    status: Status
    quality: float = Field(ge=0.0, le=1.0)
    low_confidence: bool = False  # quality below warn threshold — show a caveat
    verdict: str
    verdict_direction: Direction = Direction.on
    per_note: list[PerNote] = Field(default_factory=list)
    per_measure: list[PerMeasure] = Field(default_factory=list)
    trend: list[float] = Field(default_factory=list)
    n_detected_onsets: int = 0
    n_expected_onsets: int = 0
    n_missed_notes: int = 0
    n_extra_notes: int = 0


_BAND_SEVERITY = {Band.on: 0, Band.slight: 1, Band.rush_drag: 2, Band.severe: 3}


def _summarize_measures(deltas: list[Delta]) -> list[PerMeasure]:
    by_measure: dict[int, list[Delta]] = defaultdict(list)
    for d in deltas:
        if d.is_slur_interior:
            continue  # interior slur notes are not timed individually
        by_measure[d.measure_number].append(d)

    summaries: list[PerMeasure] = []
    for measure_number in sorted(by_measure):
        group = by_measure[measure_number]
        avg_pct = float(np.mean([d.delta_pct for d in group]))
        worst = max(group, key=lambda d: _BAND_SEVERITY[d.band])
        if avg_pct < 0:
            direction = Direction.rush
        elif avg_pct > 0:
            direction = Direction.drag
        else:
            direction = Direction.on
        summaries.append(
            PerMeasure(
                measure_number=measure_number,
                note_count=len(group),
                avg_delta_pct=round(avg_pct, 2),
                worst_band=worst.band,
                direction=direction,
            )
        )
    return summaries


def analyze(
    audio: str | Path | tuple[np.ndarray, int],
    score: ScoreJson,
    target_bpm: float,
    *,
    double_bass: bool = False,
    config: AudioConfig | None = None,
) -> AnalysisResult:
    """Analyze a recording against a score at a target tempo.

    `audio` is either a path to load, or an already-decoded `(waveform,
    sample_rate)` tuple — the Batch 4 worker decodes storage bytes once
    and passes the waveform straight through, avoiding a second decode.

    Returns a graceful `alignment_failed` / `no_onsets` result rather than
    raising when the input can't be trusted — the caller turns status into
    the right user-facing state.
    """
    cfg = config or load_audio_config()

    if isinstance(audio, tuple):
        y, sr = audio
    else:
        y, sr = audio_svc.load_audio(audio, sr=cfg.onset.sr)
    if double_bass:
        y = audio_svc.high_pass(y, sr, cfg.onset.double_bass_highpass_hz)
    onsets = audio_svc.detect_onsets(
        audio_svc.pre_emphasis(y, config=cfg), sr, double_bass=double_bass, config=cfg
    )

    timeline = build_timeline(score, target_bpm)
    expected = timeline.onsets

    if onsets.size == 0 or expected.size == 0:
        return AnalysisResult(
            status="no_onsets",
            quality=0.0,
            verdict="We couldn't hear any notes to analyze — try re-recording a bit louder.",
            n_detected_onsets=int(onsets.size),
            n_expected_onsets=int(expected.size),
        )

    raw = align_dtw(onsets, expected, target_bpm=target_bpm, config=cfg)
    if is_alignment_broken(raw.quality, config=cfg):
        return AnalysisResult(
            status="alignment_failed",
            quality=round(raw.quality, 3),
            verdict=(
                "We had trouble matching your recording to the score — "
                "check you're on the right piece and re-record."
            ),
            n_detected_onsets=raw.n_detected,
            n_expected_onsets=raw.n_expected,
        )

    cleaned = apply_fuzzy_match(raw, onsets, expected)
    deltas = compute_deltas(cleaned, onsets, timeline, target_bpm, config=cfg)
    trend = rolling_trend(deltas, config=cfg)
    verdict = generate_verdict(deltas, target_bpm, config=cfg)

    per_note = [
        PerNote(
            global_index=d.global_index,
            measure_number=d.measure_number,
            delta_ms=d.delta_ms,
            delta_pct=d.delta_pct,
            band=d.band,
            direction=d.direction,
            is_slur_interior=d.is_slur_interior,
        )
        for d in deltas
    ]

    return AnalysisResult(
        status="ok",
        quality=round(raw.quality, 3),
        low_confidence=raw.quality < cfg.alignment.warn_quality,
        verdict=verdict.text,
        verdict_direction=verdict.direction,
        per_note=per_note,
        per_measure=_summarize_measures(deltas),
        trend=trend,
        n_detected_onsets=raw.n_detected,
        n_expected_onsets=raw.n_expected,
        n_missed_notes=len(cleaned.missed_expected),
        n_extra_notes=len(cleaned.extra_detected),
    )
