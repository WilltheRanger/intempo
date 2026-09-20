"""`/v1/studios` — how a teacher comes to have a studio, and a student to be in one.

**Nothing could make a user a teacher.** `assignments.py`'s `_teacher_or_403`
requires `users.role = 'teacher'` and a `users.studio_id`; no endpoint set
either, and nothing created a `studios` row. So the six assignment endpoints
were unreachable in practice on the commit that added them — complete, tested,
and impossible to call. These four are the way in.

    POST /v1/studios        create one, and become its teacher
    GET  /v1/studios/mine   the studio this account is in, with seats used
    POST /v1/studios/join   join by invite code
    POST /v1/studios/leave  leave, and go back to the tier you came from

**The promotion is one write, because `001`'s CHECK will not have it any other
way**: `role <> 'teacher' OR (tier = 'teacher' AND studio_id IS NOT NULL)`.
Setting the role first and the tier second is a row the database refuses in
between, which is the correct behaviour and the reason all three move together
here.

**Joining only raises a `free` account.** `tier_limits.UNLIMITED_TIERS` already
covers `student_via_teacher`, so the grant is what stops a studio student
meeting `FREE_MONTHLY_ANALYSES = 3` in their second week. A `pro` account keeps
`pro`: it is already unlimited and it is *paid*, and overwriting it would mean
a musician who joins their teacher's studio silently loses the subscription
they are being billed for. Leaving reverses only what joining set, for the
same reason — `free` on the way out is right for someone joining raised from
`free`, and wrong for everyone else.

**The owner cannot leave.** `me.py` already refuses to delete an account that
owns a studio, with the reason that `001` RESTRICTs deleting a studio owner and
that removing the studio would take its students' assignments with it. The same
argument applies to walking out of one, so the same refusal is given.
"""

from __future__ import annotations

import secrets
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.auth import current_user_id, current_user_id_provisioned
from app.models.user import UserRole, UserTier
from app.routers.deps import require_service_client

router = APIRouter(prefix="/studios", tags=["studios"])

#: `001` requires exactly six characters. **No `I`, `L`, `O`, `0` or `1`**,
#: because this is read off one screen and typed into another — usually by a
#: child, sometimes from a photograph of a whiteboard. A code that cannot be
#: transcribed is a code that generates support mail rather than sign-ups.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CODE_LENGTH = 6

#: Attempts before giving up on a free code. 31^6 is about 887 million, so a
#: collision needs either extraordinary luck or a table far larger than this
#: product will ever have; five tries turns "unlucky" into "impossible" without
#: pretending the unique index is not the real guard.
_CODE_ATTEMPTS = 5


class CreateStudioRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    #: `001` defaults this to 25 and caps it at 500. Mirrored rather than left
    #: to the database so an out-of-range value is a 422 naming the field
    #: instead of a 500 from a CHECK.
    seat_limit: int = Field(default=25, ge=1, le=500)


class JoinStudioRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Case-insensitive on the way in: the generated alphabet is upper case and
    #: a phone will happily offer a lower-case keyboard.
    invite_code: str = Field(min_length=_CODE_LENGTH, max_length=_CODE_LENGTH)


class StudioResponse(BaseModel):
    id: UUID
    name: str
    seat_limit: int
    #: Members other than the owner. A teacher is not one of their own seats.
    seats_used: int
    #: **Only ever sent to the owner.** A student who could read it could
    #: enrol strangers into their teacher's studio, spending seats the teacher
    #: is paying for on people they have never met.
    invite_code: str | None = None
    #: Which side of it this account is on, so a client needs no second call to
    #: know whether to show a teacher's view or a student's.
    role: str
    created_at: str


class LeaveStudioResponse(BaseModel):
    tier: str


def _user_row(client: Any, user_id: UUID) -> dict[str, Any]:
    rows = (
        client.table("users")
        .select("id, role, tier, studio_id")
        .eq("id", str(user_id))
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        # `current_user_id_provisioned` upserts the row before any handler
        # runs, so this is a deployment fault rather than a request fault.
        raise HTTPException(status_code=500, detail="account row is missing")
    return rows[0]


def _seats_used(client: Any, studio_id: Any, owner_user_id: Any) -> int:
    members = (
        client.table("users")
        .select("id")
        .eq("studio_id", str(studio_id))
        .execute()
    ).data or []
    return len([m for m in members if str(m.get("id")) != str(owner_user_id)])


def _fresh_code(client: Any) -> str:
    """A six-character code no studio holds yet.

    Checked before inserting *and* guarded by `001`'s unique index, which is
    the one that actually decides. Two callers can pass this check with the
    same code; the second insert then fails, which is the correct outcome and
    the reason this is a convenience rather than a lock.
    """
    for _ in range(_CODE_ATTEMPTS):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))
        taken = (
            client.table("studios")
            .select("id")
            .eq("invite_code", code)
            .limit(1)
            .execute()
        ).data or []
        if not taken:
            return code
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="could not allocate an invite code; try again",
    )


@router.post("", response_model=StudioResponse, status_code=status.HTTP_201_CREATED)
def create_studio(
    body: CreateStudioRequest,
    user_id: UUID = Depends(current_user_id_provisioned),
) -> StudioResponse:
    client = require_service_client()
    me = _user_row(client, user_id)
    if me.get("studio_id"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="this account is already in a studio",
        )

    # **This endpoint is two writes and cannot be one, so it has to be safe to
    # repeat.** The studio must exist before `users.studio_id` can reference
    # it, and PostgREST gives no transaction across two calls. If the promotion
    # below fails — a dropped connection, a restart — the studio row exists and
    # its owner is still `studio_id`-less, so the check above passes and a
    # retry would create a *second* studio, leaving the first orphaned with
    # nothing pointing at it.
    #
    # The same shape as the take-retry defect in `analyses.create_analysis`:
    # an operation answered from state that does not record the whole attempt.
    # So the retry finishes the first attempt instead of starting another.
    orphan = (
        client.table("studios")
        .select("*")
        .eq("owner_user_id", str(user_id))
        .limit(1)
        .execute()
    ).data or []
    if orphan:
        studio = orphan[0]
        client.table("users").update(
            {
                "role": UserRole.teacher.value,
                "tier": UserTier.teacher.value,
                "studio_id": str(studio["id"]),
            }
        ).eq("id", str(user_id)).execute()
        return StudioResponse(
            id=studio["id"],
            name=studio["name"],
            seat_limit=studio["seat_limit"],
            seats_used=_seats_used(client, studio["id"], user_id),
            invite_code=studio["invite_code"],
            role=UserRole.teacher.value,
            created_at=studio["created_at"],
        )

    inserted = (
        client.table("studios")
        .insert(
            {
                "owner_user_id": str(user_id),
                "name": body.name,
                "seat_limit": body.seat_limit,
                "invite_code": _fresh_code(client),
            }
        )
        .execute()
    ).data or []
    if not inserted:
        raise HTTPException(status_code=500, detail="failed to create studio")
    studio = inserted[0]

    # **All three columns in one write.** `001`'s CHECK — `role <> 'teacher' OR
    # (tier = 'teacher' AND studio_id IS NOT NULL)` — refuses every
    # intermediate state, so there is no order in which to do this in two
    # steps. The studio exists first because `users.studio_id` references it.
    client.table("users").update(
        {
            "role": UserRole.teacher.value,
            "tier": UserTier.teacher.value,
            "studio_id": str(studio["id"]),
        }
    ).eq("id", str(user_id)).execute()

    return StudioResponse(
        id=studio["id"],
        name=studio["name"],
        seat_limit=studio["seat_limit"],
        seats_used=0,
        invite_code=studio["invite_code"],
        role=UserRole.teacher.value,
        created_at=studio["created_at"],
    )


@router.get("/mine", response_model=StudioResponse)
def my_studio(user_id: UUID = Depends(current_user_id)) -> StudioResponse:
    """The studio this account is in.

    A separate read rather than a field on `/v1/me`, because the seat count is
    a query over `users` and `/v1/me` is what the app blocks its first screen
    on. A teacher also needs somewhere to come back to for the invite code:
    `create_studio` returns it once, and without this endpoint the only way to
    see it again would be to make another studio.
    """
    client = require_service_client()
    me = _user_row(client, user_id)
    studio_id = me.get("studio_id")
    if not studio_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="not in a studio"
        )

    rows = (
        client.table("studios")
        .select("*")
        .eq("id", str(studio_id))
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="not in a studio"
        )
    studio = rows[0]
    is_owner = str(studio.get("owner_user_id")) == str(user_id)
    return StudioResponse(
        id=studio["id"],
        name=studio["name"],
        seat_limit=studio["seat_limit"],
        seats_used=_seats_used(client, studio["id"], studio.get("owner_user_id")),
        invite_code=studio["invite_code"] if is_owner else None,
        role=UserRole.teacher.value if is_owner else UserRole.student.value,
        created_at=studio["created_at"],
    )


@router.post("/join", response_model=StudioResponse)
def join_studio(
    body: JoinStudioRequest,
    user_id: UUID = Depends(current_user_id_provisioned),
) -> StudioResponse:
    client = require_service_client()
    me = _user_row(client, user_id)
    if me.get("studio_id"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="this account is already in a studio",
        )

    rows = (
        client.table("studios")
        .select("*")
        .eq("invite_code", body.invite_code.strip().upper())
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no studio has that code"
        )
    studio = rows[0]

    used = _seats_used(client, studio["id"], studio.get("owner_user_id"))
    if used >= int(studio["seat_limit"]):
        # The teacher's to resolve, not the student's, so the message says
        # whose problem it is rather than asking them to try again.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="that studio is full; ask your teacher for a seat",
        )

    # **Only a `free` account is raised.** `pro` is already unlimited and it is
    # paid for; overwriting it would take away a subscription the musician is
    # still being billed for. See the module docstring.
    payload: dict[str, Any] = {"studio_id": str(studio["id"])}
    if me.get("tier") == UserTier.free.value:
        payload["tier"] = UserTier.student_via_teacher.value
    client.table("users").update(payload).eq("id", str(user_id)).execute()

    return StudioResponse(
        id=studio["id"],
        name=studio["name"],
        seat_limit=studio["seat_limit"],
        seats_used=used + 1,
        invite_code=None,
        role=UserRole.student.value,
        created_at=studio["created_at"],
    )


@router.post("/leave", response_model=LeaveStudioResponse)
def leave_studio(
    user_id: UUID = Depends(current_user_id_provisioned),
) -> LeaveStudioResponse:
    """Leave the studio, and give back only what joining granted.

    **Not implementing this would have been a standing revenue hole**:
    `student_via_teacher` is in `UNLIMITED_TIERS`, so a student who joined a
    studio and left kept unlimited analyses for ever, on an account nobody is
    paying for.

    Reverses exactly what `join_studio` set. An account that was `pro` before
    it joined is still `pro`; one that was raised from `free` goes back to
    `free`. Anything else — a `teacher`, an account that arrived already
    `pro` — keeps its tier untouched, because joining never changed it.
    """
    client = require_service_client()
    me = _user_row(client, user_id)
    studio_id = me.get("studio_id")
    if not studio_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="not in a studio"
        )

    owned = (
        client.table("studios")
        .select("id")
        .eq("id", str(studio_id))
        .eq("owner_user_id", str(user_id))
        .limit(1)
        .execute()
    ).data or []
    if owned:
        # The same refusal `me.py` gives for deleting the account: `001`
        # RESTRICTs removing a studio owner, and losing the studio would take
        # its students' assignments with it.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This account owns the studio. Transfer or close it before "
                "leaving."
            ),
        )

    payload: dict[str, Any] = {"studio_id": None}
    if me.get("tier") == UserTier.student_via_teacher.value:
        payload["tier"] = UserTier.free.value
    updated = (
        client.table("users").update(payload).eq("id", str(user_id)).execute()
    ).data or []
    tier = (updated[0].get("tier") if updated else None) or me.get("tier")
    return LeaveStudioResponse(tier=str(tier))
