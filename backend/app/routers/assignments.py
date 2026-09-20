"""`/v1/assignments` — the teacher↔student loop the schema has always had room for.

`001` created `studios` and `assignments` with their indexes, status CHECKs and
`updated_at` trigger; `002` gave both sides policies, including
`"teacher reads assignment analyses"`; `models/assignment.py` says in its own
docstring that **no MVP endpoint reads or writes one**. `me.py` already reads
both tables for the data export and `scores.py` already cascades them on
delete. Everything existed except a way in.

These six endpoints are that way in: a teacher assigns a passage, the student
submits a take against it, the teacher reviews, and either side can see the
takes grouped by what makes two of them comparable.

**Four rules this file does not enforce alone.** The status graph, the
immutable identity columns, a submitted analysis belonging to the assignment's
own student, and a take naming only an assignment that is its owner's and its
piece's — those are triggers, in migrations 022, 023 and 024. This router
checks the same things where the actor is known and a refusal can say *which*
rule failed and to whom; the triggers hold when it doesn't, because they are
the only control that applies to the service-role connection every write here
uses. Neither is redundant; 022's header gives the argument.

**Every handler is a plain `def`.** `docs/subsystems.md` records what happened
the last time they were not: every endpoint was `async def`, none awaited, all
of them called Supabase synchronously, and the API served one request at a
time. `test_no_blocking_handlers.py` asserts it.

**The assignment's piece has to be one the student owns**, and that is a
product constraint rather than a preference: `POST /v1/analyses` refuses a
score the caller does not own (`_assert_score_owned`), so a take can never be
submitted against a teacher-supplied edition. `scores.shared_with_studio` and
its policy in `002` anticipate studio-shared scores, and the analysis path has
never been able to accept one. Assigning a piece the student has scanned works
today; a teacher distributing their own edition to twenty students needs that
path opened first, and doing it here would mean relaxing ownership on every
take submission. Called out rather than worked around — see `create_assignment`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.auth import current_user_id, current_user_id_provisioned
from app.models.analysis import MAX_TARGET_BPM, MIN_TARGET_BPM
from app.models.assignment import AssignmentStatus
from app.models.user import UserRole
from app.routers.deps import require_service_client

router = APIRouter(prefix="/assignments", tags=["assignments"])

#: What a teacher may write when reviewing, and what they may set when
#: assigning. Bounded because both reach a database column with no length
#: limit of its own and a screen that has to render them.
_INSTRUCTIONS_MAX = 2000
_NOTES_MAX = 4000


class CreateAssignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    student_user_id: UUID
    score_id: UUID
    target_bpm: float = Field(ge=MIN_TARGET_BPM, le=MAX_TARGET_BPM)
    due_at: datetime | None = None
    teacher_instructions: str | None = Field(default=None, max_length=_INSTRUCTIONS_MAX)


class SubmitAssignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: The take that answers this assignment. Must be the student's own and of
    #: the assignment's piece — checked here, and again by 022's trigger on the
    #: assignment side and 023's on the analysis side.
    analysis_id: UUID


class ReviewAssignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    teacher_review_notes: str | None = Field(default=None, max_length=_NOTES_MAX)


class AssignmentResponse(BaseModel):
    id: UUID
    studio_id: UUID
    teacher_user_id: UUID
    student_user_id: UUID
    score_id: UUID
    target_bpm: float
    due_at: str | None = None
    teacher_instructions: str | None = None
    status: str
    submitted_analysis_id: UUID | None = None
    teacher_review_notes: str | None = None
    reviewed_at: str | None = None
    created_at: str
    updated_at: str


class AssignmentTake(BaseModel):
    """One take against this assignment's piece, as the delta view sees it."""

    id: UUID
    status: str
    target_bpm: float
    from_measure: int | None = None
    #: Null until the take is `done`. Two takes are comparable only when this
    #: matches, which is what the grouping below is.
    comparison_key: str | None = None
    #: Whether this take is the one the assignment currently names.
    submitted: bool = False
    created_at: str
    #: The whole verdict, so the client's own comparison can run over it.
    result_json: dict[str, Any] | None = None


class AssignmentTakeGroup(BaseModel):
    """Takes that are like-for-like comparable, newest first.

    **The key is read from the row, never recomputed.** The worker stamps
    `comparison_key()` into `result_json` at analysis time, folding in the
    score, the tempo, the instrument, the metronome mode, `from_measure`,
    `skip_long_rests` **and the tuning config**. Calling the function here
    would compute today's key against today's thresholds, so a take analysed
    before a tuning change would be grouped away from the key it actually
    carries — and the app decides comparability from the stored value
    (`mobile/src/lib/insights/comparison.ts`). Two answers to one question is
    the failure; the row is the answer.
    """

    comparison_key: str | None
    takes: list[AssignmentTake]


class AssignmentTakesResponse(BaseModel):
    """**Selection and grouping, not the metric.**

    The deviation a screen shows is computed by `compareLatest` in
    `lib/insights/comparison.ts`, which also requires matching tempo and an
    identical bar shape and is the one implementation with tests over it.
    Re-deriving it here would be a second implementation of a rule that
    already exists, free to drift from the one the app renders. So this returns
    the takes the comparison should run over, grouped by the only thing the
    server knows better than the client — which rows there are.
    """

    assignment_id: UUID
    groups: list[AssignmentTakeGroup]


_COLUMNS = ", ".join(AssignmentResponse.model_fields)


def _row_to_response(row: dict[str, Any]) -> AssignmentResponse:
    return AssignmentResponse(**{name: row.get(name) for name in AssignmentResponse.model_fields})


def _teacher_or_403(client: Any, user_id: UUID) -> dict[str, Any]:
    """The caller's user row, or a 403 that says what they are not.

    A studio is what a teacher assigns *from*, so `studio_id` is as necessary
    as the role — and `001`'s CHECK already ties the two together with the
    tier, so a row with one and not the other cannot exist. Read rather than
    assumed because the role is what decides every branch below it.
    """
    rows = (
        client.table("users")
        .select("id, role, studio_id")
        .eq("id", str(user_id))
        .limit(1)
        .execute()
    ).data or []
    row = rows[0] if rows else {}
    if row.get("role") != UserRole.teacher.value or not row.get("studio_id"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="only a teacher with a studio can assign work",
        )
    return row


def _assignment_for(
    client: Any, assignment_id: UUID, user_id: UUID
) -> tuple[dict[str, Any], str]:
    """The assignment and which side of it the caller is on, or 404.

    **404 rather than 403 for someone who is neither party**, the same choice
    `_assert_score_owned` makes: distinguishing "no such assignment" from "not
    yours" lets anyone holding an id confirm that it exists inside a studio
    they are not in.
    """
    rows = (
        client.table("assignments")
        .select("*")
        .eq("id", str(assignment_id))
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="assignment not found"
        )
    row = rows[0]
    if str(row.get("teacher_user_id")) == str(user_id):
        return row, UserRole.teacher.value
    if str(row.get("student_user_id")) == str(user_id):
        return row, UserRole.student.value
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="assignment not found"
    )


def _require(row: dict[str, Any], role: str, wanted: str, action: str) -> None:
    if role != wanted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"only the {wanted} can {action}",
        )


@router.post("", response_model=AssignmentResponse, status_code=status.HTTP_201_CREATED)
def create_assignment(
    body: CreateAssignmentRequest,
    user_id: UUID = Depends(current_user_id_provisioned),
) -> AssignmentResponse:
    client = require_service_client()
    teacher = _teacher_or_403(client, user_id)
    studio_id = teacher["studio_id"]

    student = (
        client.table("users")
        .select("id, studio_id")
        .eq("id", str(body.student_user_id))
        .limit(1)
        .execute()
    ).data or []
    if not student or str(student[0].get("studio_id")) != str(studio_id):
        # One message for "no such person" and "not in your studio", so a
        # teacher cannot enumerate accounts by assigning work to them.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="that student is not in your studio",
        )

    # **The piece must be the student's own.** `POST /v1/analyses` refuses a
    # score the caller does not own, so an assignment on anyone else's score
    # could never receive a take — it would be created successfully and be
    # impossible to answer, which is worse than a refusal here. See the module
    # docstring for what opening teacher-supplied editions would cost.
    owned = (
        client.table("scores")
        .select("id")
        .eq("id", str(body.score_id))
        .eq("user_id", str(body.student_user_id))
        .limit(1)
        .execute()
    ).data or []
    if not owned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "that piece is not in the student's library, so they could not "
                "record against it"
            ),
        )

    payload: dict[str, Any] = {
        "studio_id": str(studio_id),
        "teacher_user_id": str(user_id),
        "student_user_id": str(body.student_user_id),
        "score_id": str(body.score_id),
        "target_bpm": body.target_bpm,
        "status": AssignmentStatus.assigned.value,
    }
    if body.due_at is not None:
        payload["due_at"] = body.due_at.isoformat()
    if body.teacher_instructions is not None:
        payload["teacher_instructions"] = body.teacher_instructions

    inserted = (client.table("assignments").insert(payload).execute()).data or []
    if not inserted:
        raise HTTPException(status_code=500, detail="failed to create assignment")
    return _row_to_response(inserted[0])


@router.get("", response_model=list[AssignmentResponse])
def list_assignments(
    user_id: UUID = Depends(current_user_id),
    assignment_status: AssignmentStatus | None = Query(
        default=None,
        alias="status",
        description="Only assignments in this state.",
    ),
) -> list[AssignmentResponse]:
    """Every assignment this account is a party to, either side.

    Two queries rather than one `or_`: the supabase-py filter builder spells
    disjunction as a PostgREST string, and two indexed equality reads —
    `assignments_student_status_idx` and `assignments_teacher_status_idx`, both
    from `001` — are cheaper to read and cheaper to be right about than one
    hand-built predicate. A teacher who is also somebody's student sees both
    sets, which is why the ids are de-duplicated.
    """
    client = require_service_client()
    seen: dict[str, dict[str, Any]] = {}
    for column in ("student_user_id", "teacher_user_id"):
        query = client.table("assignments").select("*").eq(column, str(user_id))
        if assignment_status is not None:
            query = query.eq("status", assignment_status.value)
        for row in (query.execute()).data or []:
            seen[str(row["id"])] = row
    rows = sorted(seen.values(), key=lambda r: str(r.get("created_at") or ""), reverse=True)
    return [_row_to_response(row) for row in rows]


@router.get("/{assignment_id}", response_model=AssignmentResponse)
def get_assignment(
    assignment_id: UUID,
    user_id: UUID = Depends(current_user_id),
) -> AssignmentResponse:
    client = require_service_client()
    row, _role = _assignment_for(client, assignment_id, user_id)
    return _row_to_response(row)


@router.post("/{assignment_id}/submit", response_model=AssignmentResponse)
def submit_assignment(
    assignment_id: UUID,
    body: SubmitAssignmentRequest,
    user_id: UUID = Depends(current_user_id_provisioned),
) -> AssignmentResponse:
    """The student's half of the loop: this take is my answer.

    Legal from `assigned`, `in_progress` and — since 024 — `reviewed`, which is
    a student answering feedback with a better take. 022 had refused that edge
    and left `reviewed` with no way forward, which would have made the weekly
    loop a one-shot.
    """
    client = require_service_client()
    row, role = _assignment_for(client, assignment_id, user_id)
    _require(row, role, UserRole.student.value, "submit a take")

    if row.get("status") == AssignmentStatus.archived.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="that assignment has been archived",
        )

    analysis = (
        client.table("analyses")
        .select("id, user_id, score_id")
        .eq("id", str(body.analysis_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    ).data or []
    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="take not found"
        )
    if str(analysis[0].get("score_id")) != str(row.get("score_id")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="that take is of a different piece",
        )

    updated = (
        client.table("assignments")
        .update(
            {
                "submitted_analysis_id": str(body.analysis_id),
                "status": AssignmentStatus.submitted.value,
            }
        )
        .eq("id", str(assignment_id))
        .execute()
    ).data or []
    if not updated:
        raise HTTPException(status_code=500, detail="failed to submit")
    return _row_to_response(updated[0])


@router.post("/{assignment_id}/review", response_model=AssignmentResponse)
def review_assignment(
    assignment_id: UUID,
    body: ReviewAssignmentRequest,
    user_id: UUID = Depends(current_user_id_provisioned),
) -> AssignmentResponse:
    """The teacher's half: I have read the take and here is what to do next.

    Only from `submitted`, because a review is a review *of* a submission —
    the one thing 024 deliberately did not loosen. `reviewed_at` is written
    with the status because `001`'s CHECK requires it and would otherwise
    refuse the row.
    """
    client = require_service_client()
    row, role = _assignment_for(client, assignment_id, user_id)
    _require(row, role, UserRole.teacher.value, "review a take")

    if row.get("status") != AssignmentStatus.submitted.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="there is no submitted take to review",
        )

    payload: dict[str, Any] = {
        "status": AssignmentStatus.reviewed.value,
        "reviewed_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    if body.teacher_review_notes is not None:
        payload["teacher_review_notes"] = body.teacher_review_notes

    updated = (
        client.table("assignments")
        .update(payload)
        .eq("id", str(assignment_id))
        .execute()
    ).data or []
    if not updated:
        raise HTTPException(status_code=500, detail="failed to review")
    return _row_to_response(updated[0])


@router.get("/{assignment_id}/takes", response_model=AssignmentTakesResponse)
def assignment_takes(
    assignment_id: UUID,
    user_id: UUID = Depends(current_user_id),
) -> AssignmentTakesResponse:
    """Every take this assignment has drawn, grouped by what makes two of them
    comparable. Readable by both parties — the teacher's view of progress and
    the student's are the same view.

    Takes are selected by `assignment_id`, not by piece: a take the student
    recorded for themselves on the same score is their own business and is not
    part of the assignment's record. `analyses_assignment_idx` from `001` is a
    partial index on exactly that column, which is the read this endpoint is.
    """
    client = require_service_client()
    row, _role = _assignment_for(client, assignment_id, user_id)

    takes = (
        client.table("analyses")
        .select("id, status, target_bpm, from_measure, created_at, result_json")
        .eq("assignment_id", str(assignment_id))
        .execute()
    ).data or []

    submitted_id = str(row.get("submitted_analysis_id") or "")
    grouped: dict[str | None, list[AssignmentTake]] = {}
    for take in takes:
        result = take.get("result_json") or None
        key = (result or {}).get("comparison_key")
        grouped.setdefault(key, []).append(
            AssignmentTake(
                id=take["id"],
                status=take["status"],
                target_bpm=take["target_bpm"],
                from_measure=take.get("from_measure"),
                comparison_key=key,
                submitted=str(take["id"]) == submitted_id,
                created_at=take["created_at"],
                result_json=result,
            )
        )

    groups = [
        AssignmentTakeGroup(
            comparison_key=key,
            takes=sorted(items, key=lambda t: t.created_at, reverse=True),
        )
        # `None` last: takes still queued, or failed, have no key and no
        # comparison to be part of, but a screen still has to say they exist.
        for key, items in sorted(grouped.items(), key=lambda kv: (kv[0] is None, kv[0] or ""))
    ]
    return AssignmentTakesResponse(assignment_id=assignment_id, groups=groups)
