from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class BpmSource(str, Enum):
    manual = "manual"
    calibration_clip = "calibration_clip"


class MetronomeMode(str, Enum):
    off = "off"
    visual = "visual"
    haptic = "haptic"
    audio_with_headphones = "audio_with_headphones"


class AnalysisStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    done = "done"
    failed = "failed"
    failed_recoverable = "failed_recoverable"


class Analysis(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    score_id: UUID
    audio_url: str
    target_bpm: float = Field(ge=20, le=300)
    bpm_source: BpmSource
    metronome_mode: MetronomeMode = MetronomeMode.off
    result_json: dict[str, Any] | None = None
    status: AnalysisStatus = AnalysisStatus.queued
    failure_reason: str | None = None
    alignment_quality: float | None = Field(default=None, ge=0.0, le=1.0)
    llm_fallback_used: bool = False
    assignment_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None = None
