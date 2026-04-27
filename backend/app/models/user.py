from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserTier(str, Enum):
    free = "free"
    pro = "pro"
    teacher = "teacher"
    student_via_teacher = "student_via_teacher"


class UserRole(str, Enum):
    student = "student"
    teacher = "teacher"


class User(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    tier: UserTier = UserTier.free
    role: UserRole = UserRole.student
    studio_id: UUID | None = None
    baseline_profile: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class MeResponse(BaseModel):
    """Public payload returned by GET /v1/me."""

    id: UUID
    email: EmailStr
    tier: UserTier
    role: UserRole
    studio_id: UUID | None = None
