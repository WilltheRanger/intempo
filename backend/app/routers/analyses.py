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

from app.services import pending_uploads
from app.auth import current_user_id, current_user_id_provisioned
from app.services.tier_limits import tier_of, usage_for
from app.db import get_service_client
from app.models.analysis import (
    MAX_TARGET_BPM,
    MIN_TARGET_BPM,
    BpmSource,
    Instrument,
    MetronomeMode,
)
from app.routers.upload import AUDIO_BUCKET
from app.workers.dispatch import start_analysis

router = APIRouter(prefix="/analyses", tags=["analyses"])


class CreateAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score_id: UUID
    audio_url: str = Field(min_length=1, max_length=2048)
    target_bpm: float = Field(ge=MIN_TARGET_BPM, le=MAX_TARGET_BPM)
    bpm_source: BpmSource
    metronome_mode: MetronomeMode = MetronomeMode.off
    #: What the musician plays, so onset detection can be set for it.
    #:
    #: Optional, and null means "not stated" rather than any particular
    #: instrument — an older client sends nothing, and guessing on its behalf
    #: would apply bass settings to a violin or the reverse.
    instrument: Instrument | None = None
    #: The musician practised with the long rests shortened, so judge the take
    #: against a score shortened the same way.
    #:
    #: **Not a display preference.** Measured on an otherwise perfect take,
    #: skipping a rest the timeline still contains takes alignment quality from
    #: **1.000 to 0.000** — `alignment_failed`, "check you're on the right
    #: piece" — and that is as true of a two-bar rest as a twenty-bar one. So it
    #: has to reach the worker or the take is unanalysable.
    #:
    #: Defaults false, which is every client that has never heard of it and
    #: every take recorded before it existed.
    skip_long_rests: bool = False
    #: The bar the musician entered on, as numbered on the page.
    #:
    #: Null means from the beginning, which is what every take before this
    #: field meant. Validated against the score at enqueue rather than trusted:
    #: a bar the piece does not have would build a timeline with nothing in it
    #: and report `alignment_failed` — "check you're on the right piece" — for
    #: a take of exactly the right piece.
    from_measure: int | None = Field(default=None, ge=1)


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
    instrument: str | None = None
    #: Whether this take was played with the long rests shortened. Null on a
    #: deployment whose `analyses` table predates the column.
    skip_long_rests: bool | None = None
    from_measure: int | None = None
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


def _object_keys_in(urls: list[str]) -> list[str]:
    """The `{user}/{uuid}.{ext}` keys inside a list of storage URLs.

    The path after the bucket name, which is the only part storage cares
    about — and the same shape `scores._object_key_from` recovers, arrived at
    from the other direction because these URLs are the ones the client was
    handed rather than ones this service signed.
    """
    keys: list[str] = []
    for url in urls:
        path = urlparse(url or "").path
        marker = f"/{AUDIO_BUCKET}/"
        if marker in path:
            keys.append(path.split(marker, 1)[1].lstrip("/"))
    return keys


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


def _assert_score_owned(client, score_id: UUID, user_id: UUID) -> dict[str, Any]:
    """The score row, or 404. Returned rather than discarded so the caller can
    ask questions of it — `from_measure` has to be checked against the bars the
    piece actually has, and re-fetching the same row to do it would be a second
    round trip for a value already in hand."""
    res = (
        client.table("scores")
        .select("id, score_json")
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="score not found")
    return rows[0]


def _assert_measure_in_score(row: dict[str, Any], from_measure: int | None) -> None:
    """Refuse a bar the piece does not have, while it can still be said.

    Left to the worker this becomes `alignment_failed` and *"check you're on
    the right piece"* — for a take of exactly the right piece, entered at a bar
    that is not on it. The app only offers bars the score contains, so reaching
    this means something is out of step, and saying so is more use than a
    verdict nobody can act on.

    A score still being read has no measures yet and no bar can be checked
    against it; that take is refused by the worker on its own terms, so this
    stays quiet rather than inventing a second reason.
    """
    if from_measure is None:
        return
    measures = ((row.get("score_json") or {}).get("measures")) or []
    if not measures:
        return
    if not any(m.get("measure_number") == from_measure for m in measures):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"this piece has no bar {from_measure}",
        )


def _row_to_response(row: dict[str, Any]) -> AnalysisResponse:
    return AnalysisResponse(
        id=row["id"],
        user_id=row["user_id"],
        score_id=row["score_id"],
        status=row["status"],
        target_bpm=row["target_bpm"],
        bpm_source=row["bpm_source"],
        metronome_mode=row.get("metronome_mode", "off"),
        # None for every row written before the column existed, and for a
        # client that did not say. Not defaulted to anything — see migration 008.
        instrument=row.get("instrument"),
        # Null on a deployment whose table predates the column — which is not
        # the same as false, and the verdict screen can say so if it ever needs
        # to explain why a take was judged against the whole page.
        skip_long_rests=row.get("skip_long_rests"),
        from_measure=row.get("from_measure"),
        result_json=row.get("result_json"),
        failure_reason=row.get("failure_reason"),
        alignment_quality=row.get("alignment_quality"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        finished_at=row.get("finished_at"),
    )


def _assert_within_quota(client: Any, user_id: UUID) -> None:
    """Free accounts get three analyses a calendar month (spec Batch 8, step 2).

    The 403 body is structured rather than prose because the client has to act
    on it — show how many are left and offer the upgrade — and parsing a
    sentence to do that is how copy changes become bugs.

    Checked before the row is inserted, so a refused analysis leaves nothing
    behind and doesn't itself count toward the month.
    """
    usage = usage_for(client, user_id, tier_of(client, user_id))
    if not usage.exhausted:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "tier_limit",
            "limit": usage.limit,
            "used": usage.used,
            "tier": usage.tier,
            "resets_at": usage.period_end.isoformat(),
        },
    )


@router.post("", response_model=CreateAnalysisResponse, status_code=status.HTTP_202_ACCEPTED)
def create_analysis(
    body: CreateAnalysisRequest,
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(current_user_id_provisioned),
) -> CreateAnalysisResponse:
    _assert_audio_url_owned_by(body.audio_url, user_id)
    client = _service_client()
    score_row = _assert_score_owned(client, body.score_id, user_id)
    _assert_measure_in_score(score_row, body.from_measure)
    _assert_within_quota(client, user_id)

    insert_payload = {
        "user_id": str(user_id),
        "score_id": str(body.score_id),
        "audio_url": body.audio_url,
        "target_bpm": body.target_bpm,
        "bpm_source": body.bpm_source.value,
        "metronome_mode": body.metronome_mode.value,
        "instrument": body.instrument.value if body.instrument else None,
        "status": "queued",
    }
    # **Written only when it is true**, so a deployment whose `analyses` table
    # predates migration 012 is unaffected until someone actually skips a rest —
    # and when they do, the insert fails loudly rather than the take being
    # analysed against silence the musician was told to skip. A wrong verdict is
    # worse than an error at submit.
    if body.skip_long_rests:
        insert_payload["skip_long_rests"] = True
    if body.from_measure is not None:
        insert_payload["from_measure"] = body.from_measure
    inserted = client.table("analyses").insert(insert_payload).execute()
    rows = inserted.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="failed to enqueue analysis")

    analysis_id = rows[0]["id"]
    # A row points at the audio now. Same rule and same ordering as
    # `create_score`: claimed after the insert, never before, or a failed
    # submit would strand the take's audio.
    pending_uploads.claim(AUDIO_BUCKET, _object_keys_in([body.audio_url]))
    # Where this runs is `dispatch`'s business, not this endpoint's.
    start_analysis(str(analysis_id), background_tasks)
    return CreateAnalysisResponse(analysis_id=analysis_id, status="queued")


@router.get("", response_model=list[AnalysisResponse])
def list_analyses(
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
def get_analysis(
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
