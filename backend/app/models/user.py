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


class Instrument(str, Enum):
    """The four the app is written for. Mirrors `Instrument` in the app's
    `data/types.ts` and the CHECK on `users.instrument` (migration 009)."""

    violin = "violin"
    viola = "viola"
    cello = "cello"
    double_bass = "double_bass"


class MeResponse(BaseModel):
    """Public payload returned by GET /v1/me."""

    id: UUID
    email: EmailStr
    tier: UserTier
    role: UserRole
    studio_id: UUID | None = None
    analyses: UsageResponse | None = None

    #: What they play, or **null because nobody has asked yet**.
    #:
    #: Never defaulted here. `violin` in this field has to mean a person chose
    #: violin — the same rule `ScoreJson.clef` follows, and for the same
    #: reason: an assumed value that looks identical to a stated one is worse
    #: than an absent one. The app falls back to its device preference while
    #: this is null, and says so.
    instrument: Instrument | None = None
    #: What to call them. Null is a legitimate final answer — someone who
    #: skipped the question has answered it.
    display_name: str | None = None
    #: A freshly signed URL for the profile picture, or null. Signed per
    #: response because the stored value is an object key, not a URL.
    avatar_url: str | None = None
    #: When onboarding was completed **or skipped**. Null means the screen has
    #: not been shown, and that is the only thing that decides whether to show
    #: it.
    onboarded_at: datetime | None = None


class UpdateMeRequest(BaseModel):
    """PATCH /v1/me — the profile fields a musician owns.

    Every field is optional and **an explicit null clears**, the same contract
    `UpdateScoreRequest` uses: omitting a field leaves it alone, sending null
    is a real answer. Someone removing their photograph or their name has to
    have a way to say so.
    """

    model_config = ConfigDict(extra="forbid")

    instrument: Instrument | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    #: The object key returned by the avatar upload, not a URL. Null removes
    #: the picture.
    avatar_key: str | None = None
    #: Set by the client when the onboarding screen is finished or skipped.
    #: Only ever true — there is no route back to "never asked".
    onboarded: bool | None = None
