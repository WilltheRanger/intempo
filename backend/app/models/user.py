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


class UsageResponse(BaseModel):
    """Where this account stands against its monthly quota.

    On `/v1/me` so a client can show "2 of 3 used" without first being refused.
    A paywall that only appears at the moment of refusal is a paywall that
    ambushes someone who has just finished playing.
    """

    #: Analyses created this calendar month.
    used: int
    #: Null for tiers with no quota — a distinct value rather than a very large
    #: number the client has to recognise as meaning unlimited.
    limit: int | None = None
    remaining: int | None = None
    #: When the count goes back to zero. UTC, first instant of next month.
    resets_at: datetime


class MeResponse(BaseModel):
    """Public payload returned by GET /v1/me."""

    id: UUID
    email: EmailStr
    tier: UserTier
    role: UserRole
    studio_id: UUID | None = None
    analyses: UsageResponse | None = None
