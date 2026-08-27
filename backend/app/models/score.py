from __future__ import annotations

from datetime import datetime
from typing import Any, Final, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

#: What a scan can be doing, and the only values written to
#: `scores.transcription_status`.
#:
#: **It had no home.** The four strings were scattered as bare literals across
#: the worker and the router while the app declared a closed union of exactly
#: four, so there was nothing to compare the app against — and a fifth state
#: added anywhere in the backend would have been a silent breaking change.
TranscriptionStatus = Literal["queued", "reading", "done", "failed"]

#: The two a worker is going to move off.
#:
#: `usePieces` polls a piece only while its row is in one of these, and stops
#: otherwise. That makes the set a contract, not a convenience: a new
#: in-progress state the app has not heard of is treated as terminal, so the
#: app stops asking and shows a scan stuck half-read forever, with no error
#: anywhere. It is the mirror of the `AnalysisStatus` failure
#: `test_client_enums.py` already guards — forty wasted polls in one direction,
#: none at all in the other.
TRANSCRIPTION_IN_PROGRESS: Final[frozenset[str]] = frozenset({"queued", "reading"})


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
