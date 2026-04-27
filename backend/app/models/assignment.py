from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AssignmentStatus(str, Enum):
    assigned = "assigned"
    in_progress = "in_progress"
    submitted = "submitted"
    reviewed = "reviewed"
    archived = "archived"


class Assignment(BaseModel):
    """Teacher-tier assignment.

    Schema lands in the MVP migration so the columns exist for telemetry / FK
    integrity, but no MVP endpoint reads or writes assignments. The teacher
    tier endpoints arrive in Batch 12.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    studio_id: UUID
    teacher_user_id: UUID
    student_user_id: UUID
    score_id: UUID
    target_bpm: float = Field(ge=20, le=300)
    due_at: datetime | None = None
    teacher_instructions: str | None = None
    status: AssignmentStatus = AssignmentStatus.assigned
    submitted_analysis_id: UUID | None = None
    teacher_review_notes: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
