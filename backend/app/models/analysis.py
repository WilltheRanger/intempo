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


class Instrument(str, Enum):
    """What the musician plays.

    The four bowed strings, matching the app's own `Instrument` type. It is
    what the recording *is*, and the pipeline reads it to decide how to look
    for note onsets — the low register of a double bass needs a lower detection
    threshold than a violin, because the note swells in rather than snapping in
    and most of its energy sits where the detector is weakest.

    Deliberately the instrument and not a `double_bass: bool`. How each
    instrument should be treated is still being tuned against real recordings;
    a flag would freeze today's answer into the data.
    """

    violin = "violin"
    viola = "viola"
    cello = "cello"
    double_bass = "double_bass"


class AnalysisStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    done = "done"
    failed = "failed"
    failed_recoverable = "failed_recoverable"


#: The tempo range this app will judge a performance against, in BPM.
#:
#: **One definition, because it is a contract with the client.** The app has to
#: know it too — a stepper that offers 310 produces a 422 the musician cannot
#: act on, and one that stops at 200 refuses a tempo the analysis would have
#: handled. It was written out three times here (`Analysis`, `Assignment`,
#: `CreateAnalysisRequest`) and mirrored a fourth time in
#: `mobile/src/data/practiceTempo.ts`, each with nothing pointing at the
#: others; `test_tempo_range.py` now holds all four together.
#:
#: Distinct from `config.toml [calibration] bpm_min/bpm_max`, which is the
#: range the tempo *detector* searches when nobody has typed a number. That is
#: narrower on purpose and answers a different question.
MIN_TARGET_BPM = 20
MAX_TARGET_BPM = 300

class Analysis(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    score_id: UUID
    audio_url: str
    target_bpm: float = Field(ge=MIN_TARGET_BPM, le=MAX_TARGET_BPM)
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
