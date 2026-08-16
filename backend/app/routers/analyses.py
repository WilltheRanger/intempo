"""POST /v1/analyses (enqueue), GET /v1/analyses (list), GET /v1/analyses/:id (poll).

Owner-scoped like /v1/scores: service-role client for writes, explicit
`user_id` filter on every read. The POST returns immediately with
`status='queued'` and hands the real work to a FastAPI `BackgroundTask`
(`workers.analysis_runner.run_analysis`), which runs after the response
is sent — so the request stays well under the 500ms DoD.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.auth import current_user_id
from app.db import get_service_client
from app.models.analysis import BpmSource, MetronomeMode
from app.routers.upload import AUDIO_BUCKET
from app.workers.analysis_runner import run_analysis

router = APIRouter(prefix="/analyses", tags=["analyses"])


class CreateAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score_id: UUID
    audio_url: str = Field(min_length=1, max_length=2048)
    target_bpm: float = Field(ge=20, le=300)
    bpm_source: BpmSource
    metronome_mode: MetronomeMode = MetronomeMode.off


class CreateAnalysisResponse(BaseModel):
    analysis_id: UUID
    status: str


class AnalysisResponse(BaseModel):
    id: UUID
    user_id: UUID
    score_id: UUID
    status: str
    target_bpm: float
    bpm_source: str
    metronome_mode: str
    result_json: dict[str, Any] | None = None
    failure_reason: str | None = None
    alignment_quality: float | None = None
    created_at: str
    updated_at: str
    finished_at: str | None = None


def _service_client():
    client = get_service_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service-role client is not configured",
        )
    return client


def _assert_audio_url_owned_by(audio_url: str, user_id: UUID) -> None:
    """The audio URL must be a Supabase audio-uploads URL under this user's prefix.

    We validate at enqueue time so the worker can trust the stored URL and
    never downloads an arbitrary internet address.
    """
    parsed = urlparse(audio_url)
    if parsed.scheme not in {"https", "http"}:
        raise HTTPException(status_code=400, detail="audio_url must be http(s)")
    prefixes = (
        f"/storage/v1/object/sign/{AUDIO_BUCKET}/{user_id}/",
        f"/storage/v1/object/authenticated/{AUDIO_BUCKET}/{user_id}/",
        f"/storage/v1/object/public/{AUDIO_BUCKET}/{user_id}/",
    )
    if not any(parsed.path.startswith(p) for p in prefixes):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="audio_url must be a Supabase audio-uploads URL under your user prefix",
        )


def _assert_score_owned(client, score_id: UUID, user_id: UUID) -> None:
    res = (
        client.table("scores")
        .select("id")
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    )
    if not (res.data or []):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="score not found")


def _row_to_response(row: dict[str, Any]) -> AnalysisResponse:
    return AnalysisResponse(
        id=row["id"],
        user_id=row["user_id"],
        score_id=row["score_id"],
        status=row["status"],
        target_bpm=row["target_bpm"],
        bpm_source=row["bpm_source"],
        metronome_mode=row.get("metronome_mode", "off"),
        result_json=row.get("result_json"),
        failure_reason=row.get("failure_reason"),
        alignment_quality=row.get("alignment_quality"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        finished_at=row.get("finished_at"),
    )


@router.post("", response_model=CreateAnalysisResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_analysis(
    body: CreateAnalysisRequest,
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(current_user_id),
) -> CreateAnalysisResponse:
    _assert_audio_url_owned_by(body.audio_url, user_id)
    client = _service_client()
    _assert_score_owned(client, body.score_id, user_id)

    insert_payload = {
        "user_id": str(user_id),
        "score_id": str(body.score_id),
        "audio_url": body.audio_url,
        "target_bpm": body.target_bpm,
        "bpm_source": body.bpm_source.value,
        "metronome_mode": body.metronome_mode.value,
        "status": "queued",
    }
    inserted = client.table("analyses").insert(insert_payload).execute()
    rows = inserted.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="failed to enqueue analysis")

    analysis_id = rows[0]["id"]
    # Runs after the response is sent. run_analysis is sync, so FastAPI
    # executes it in a worker thread — the CPU-bound analyze() never
    # blocks the event loop.
    background_tasks.add_task(run_analysis, str(analysis_id))
    return CreateAnalysisResponse(analysis_id=analysis_id, status="queued")


@router.get("", response_model=list[AnalysisResponse])
async def list_analyses(
    user_id: UUID = Depends(current_user_id),
    score_id: UUID | None = Query(
        default=None, description="Only analyses of this score."
    ),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description="Only analyses in this state, e.g. `done`.",
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[AnalysisResponse]:
    """The caller's analyses, newest first.

    Insights aggregates across takes — how often a piece was played and
    which way it drifted — which a per-id endpoint can't answer without
    the client already knowing every id. Ordering and paging match
    /v1/scores so the two lists behave the same way.

    `analyses(user_id, created_at DESC)` is indexed, so the default page
    is an index scan.
    """
    query = (
        _service_client()
        .table("analyses")
        .select("*")
        .eq("user_id", str(user_id))
    )
    if score_id is not None:
        query = query.eq("score_id", str(score_id))
    if status_filter is not None:
        query = query.eq("status", status_filter)

    res = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return [_row_to_response(row) for row in (res.data or [])]


@router.get("/{analysis_id}", response_model=AnalysisResponse)
async def get_analysis(
    analysis_id: UUID,
    user_id: UUID = Depends(current_user_id),
) -> AnalysisResponse:
    res = (
        _service_client()
        .table("analyses")
        .select("*")
        .eq("id", str(analysis_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="analysis not found")
    return _row_to_response(rows[0])
