from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class Score(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str = Field(min_length=1, max_length=200)
    composer: str | None = None
    source_image_url: str
    score_json: dict[str, Any]
    shared_with_studio: UUID | None = None
    ocr_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    created_at: datetime
    updated_at: datetime
