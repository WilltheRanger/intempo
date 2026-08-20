"""POST /v1/analyses/:id/corrections — "this was wrong".

The feedback loop from spec §7.5, which calls it the moat and says to ship it
from day one. The reasoning is worth restating because it shapes the schema:
the academic onset-detection algorithms are public, and labelled bowed-string
onset data is not. Corrections are the only route to that data.

They are also the only route out of the position Batch 3 is currently stuck in.
Its thresholds are the spec's starting values, untuned, because tuning needs a
human ear on real recordings — and this is the mechanism by which real ears
reach real recordings at any scale beyond one person's afternoon.

Both the app's verdict and the musician's are stored. Storing only the
correction would lose what it was correcting, which is the comparison the whole
dataset exists to make.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.auth import current_user_id, current_user_id_provisioned
from app.db import get_service_client

router = APIRouter(prefix="/analyses", tags=["corrections"])

#: What a musician can say about a measure. `unsure` is deliberately offered:
#: §7.5 warns that many corrections will come from people disagreeing with the
#: concept rather than catching a misfire, and a person who genuinely can't
#: remember is more useful in the data than one who guessed.
UserVerdict = Literal["on_tempo", "rushing", "dragging", "unsure"]

#: One take, not one measure at a time. A musician reviewing a verdict marks
#: what they noticed in one pass, and 24 round trips for 24 measures would be
#: the wrong shape for both the client and the table.
MAX_CORRECTIONS_PER_REQUEST = 200

COMMENT_MAX_LENGTH = 2000


class Correction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    measure_number: int = Field(ge=1)
    #: What the app said about this measure, so the pair is stored together.
    app_verdict: str = Field(min_length=1, max_length=64)
    user_verdict: UserVerdict
    comment: str | None = Field(default=None, max_length=COMMENT_MAX_LENGTH)


class CreateCorrectionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    corrections: list[Correction] = Field(min_length=1, max_length=MAX_CORRECTIONS_PER_REQUEST)


class CorrectionResponse(BaseModel):
    id: UUID
    analysis_id: UUID
    user_id: UUID
    measure_number: int
    app_verdict: str
    user_verdict: str
    comment: str | None = None
    created_at: datetime


def _service_client():
    client = get_service_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service-role client is not configured",
        )
    return client


def _assert_owns_analysis(analysis_id: UUID, user_id: UUID) -> None:
    """404 rather than 403 for someone else's analysis.

    Same convention as the rest of the API: an id that isn't yours is an id
    that doesn't exist, so probing can't confirm one is real.
    """
    response = (
        _service_client()
        .table("analyses")
        .select("id")
        .eq("id", str(analysis_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    )
    if not (response.data or []):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="analysis not found")


@router.post(
    "/{analysis_id}/corrections",
    response_model=list[CorrectionResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_corrections(
    analysis_id: UUID,
    body: CreateCorrectionsRequest,
    user_id: UUID = Depends(current_user_id_provisioned),
) -> list[CorrectionResponse]:
    """Record what the musician says actually happened.

    Appends rather than replaces. Someone who corrects a take, plays it again,
    and comes back to correct it differently has changed their mind, and both
    opinions are data — the second is not more true than the first, it is
    later. De-duplication, if it is ever wanted, belongs in whatever reads this
    table, where the full history is still available to reason about.
    """
    _assert_owns_analysis(analysis_id, user_id)

    rows: list[dict[str, Any]] = [
        {
            "analysis_id": str(analysis_id),
            "user_id": str(user_id),
            "measure_number": c.measure_number,
            "app_verdict": c.app_verdict,
            "user_verdict": c.user_verdict,
            "comment": c.comment,
        }
        for c in body.corrections
    ]

    inserted = _service_client().table("verdict_corrections").insert(rows).execute()
    written = inserted.data or []
    if not written:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to persist corrections",
        )
    return [CorrectionResponse.model_validate(row) for row in written]


@router.get("/{analysis_id}/corrections", response_model=list[CorrectionResponse])
async def list_corrections(
    analysis_id: UUID,
    user_id: UUID = Depends(current_user_id),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[CorrectionResponse]:
    """What this musician has already said about this take.

    So a client can show a measure as already corrected rather than inviting
    the same correction twice. Owner-scoped like everything else — the table
    has no SELECT policy at all, because the only other reader is the
    service-role retraining pipeline.
    """
    _assert_owns_analysis(analysis_id, user_id)

    response = (
        _service_client()
        .table("verdict_corrections")
        .select("*")
        .eq("analysis_id", str(analysis_id))
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return [CorrectionResponse.model_validate(row) for row in response.data or []]
