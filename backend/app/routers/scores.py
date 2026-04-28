"""POST/GET/PATCH/DELETE /v1/scores.

Owner-scoped via the JWT subject + service-role client. RLS on the
`scores` table guards anon-key callers; the backend uses service-role
for writes (RLS bypass) and explicitly filters by `user_id` on every
read so the same access rules apply at the API layer.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.auth import current_user_id
from app.db import get_service_client
from app.routers.upload import SCORE_BUCKET
from app.services.ocr import OCRError, parse_sheet_music
from app.services.score_schema import ScoreJson

router = APIRouter(prefix="/scores", tags=["scores"])

# Cap how big an image we'll pull from a signed URL before bailing.
# Matches the score-images bucket's 10 MB limit, with headroom.
MAX_IMAGE_BYTES = 12 * 1024 * 1024

# Default download timeout in seconds. Spec wants the whole flow under 10s,
# OCR is the slow part — keep download tight so it doesn't eat the budget.
IMAGE_DOWNLOAD_TIMEOUT = 6.0


class CreateScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image_url: str = Field(min_length=1, max_length=2048)
    title: str = Field(min_length=1, max_length=200)
    composer: str | None = Field(default=None, max_length=200)


class UpdateScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score_json: ScoreJson | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    composer: str | None = Field(default=None, max_length=200)


class ScoreResponse(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    composer: str | None = None
    source_image_url: str
    score_json: dict[str, Any]
    shared_with_studio: UUID | None = None
    ocr_confidence: float | None = None
    created_at: str
    updated_at: str


def _media_type_for(url: str) -> str:
    """Best-effort image media type from the URL's path extension."""
    path = urlparse(url).path.lower()
    if path.endswith(".png"):
        return "image/png"
    if path.endswith(".webp"):
        return "image/webp"
    if path.endswith(".heic"):
        return "image/heic"
    return "image/jpeg"


def _assert_image_url_owned_by(image_url: str, user_id: UUID) -> None:
    """The signed URL must point at the score-images bucket under the user's prefix.

    Supabase signed URLs look like:
      https://<project>.supabase.co/storage/v1/object/sign/<bucket>/<path>?token=...
    For this user's image:
      <bucket> = "score-images"
      <path>   = "<user_id>/<uuid>.<ext>"
    Anything else gets 403 — we never download arbitrary internet URLs.
    """
    parsed = urlparse(image_url)
    if parsed.scheme not in {"https", "http"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="image_url must be http(s)",
        )
    expected_prefix = f"/storage/v1/object/sign/{SCORE_BUCKET}/{user_id}/"
    expected_authenticated_prefix = f"/storage/v1/object/authenticated/{SCORE_BUCKET}/{user_id}/"
    expected_public_prefix = f"/storage/v1/object/public/{SCORE_BUCKET}/{user_id}/"
    if not (
        parsed.path.startswith(expected_prefix)
        or parsed.path.startswith(expected_authenticated_prefix)
        or parsed.path.startswith(expected_public_prefix)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="image_url must be a Supabase score-images URL under your user prefix",
        )


def _download_image(image_url: str) -> bytes:
    try:
        with httpx.Client(timeout=IMAGE_DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
            response = client.get(image_url)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"failed to download image: {exc}",
        ) from exc
    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"image download returned status {response.status_code}",
        )
    body = response.content
    if len(body) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"image is larger than {MAX_IMAGE_BYTES} bytes",
        )
    return body


def _service_client():
    client = get_service_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service-role client is not configured",
        )
    return client


def _row_to_response(row: dict[str, Any]) -> ScoreResponse:
    return ScoreResponse(
        id=row["id"],
        user_id=row["user_id"],
        title=row["title"],
        composer=row.get("composer"),
        source_image_url=row["source_image_url"],
        score_json=row["score_json"],
        shared_with_studio=row.get("shared_with_studio"),
        ocr_confidence=row.get("ocr_confidence"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.post("", response_model=ScoreResponse, status_code=status.HTTP_201_CREATED)
async def create_score(
    body: CreateScoreRequest,
    user_id: UUID = Depends(current_user_id),
) -> ScoreResponse:
    _assert_image_url_owned_by(body.image_url, user_id)
    image_bytes = _download_image(body.image_url)
    media_type = _media_type_for(body.image_url)

    try:
        score = parse_sheet_music(image_bytes, media_type=media_type)
    except OCRError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"OCR failed: {exc}",
        ) from exc

    insert_payload = {
        "user_id": str(user_id),
        "title": body.title,
        "composer": body.composer,
        "source_image_url": body.image_url,
        "score_json": score.model_dump(mode="json"),
        "ocr_confidence": score.ocr_confidence,
    }
    inserted = (
        _service_client().table("scores").insert(insert_payload).execute()
    )
    rows = inserted.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to persist score",
        )
    return _row_to_response(rows[0])


@router.get("", response_model=list[ScoreResponse])
async def list_scores(
    user_id: UUID = Depends(current_user_id),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[ScoreResponse]:
    response = (
        _service_client()
        .table("scores")
        .select("*")
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return [_row_to_response(r) for r in response.data or []]


@router.get("/{score_id}", response_model=ScoreResponse)
async def get_score(
    score_id: UUID,
    user_id: UUID = Depends(current_user_id),
) -> ScoreResponse:
    response = (
        _service_client()
        .table("scores")
        .select("*")
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    )
    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="score not found")
    return _row_to_response(rows[0])


@router.patch("/{score_id}", response_model=ScoreResponse)
async def update_score(
    score_id: UUID,
    body: UpdateScoreRequest,
    user_id: UUID = Depends(current_user_id),
) -> ScoreResponse:
    update: dict[str, Any] = {}
    if body.score_json is not None:
        update["score_json"] = body.score_json.model_dump(mode="json")
        update["ocr_confidence"] = body.score_json.ocr_confidence
    if body.title is not None:
        update["title"] = body.title
    if body.composer is not None:
        update["composer"] = body.composer
    if not update:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="patch body must include at least one field",
        )

    response = (
        _service_client()
        .table("scores")
        .update(update)
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
        .execute()
    )
    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="score not found")
    return _row_to_response(rows[0])


@router.delete("/{score_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_score(
    score_id: UUID,
    user_id: UUID = Depends(current_user_id),
) -> Response:
    client = _service_client()

    # The schema declares analyses.score_id with ON DELETE RESTRICT, so a
    # delete with dependent analyses will surface as a Postgres FK error.
    # Convert that to 409 with a clear message rather than the SDK's 500.
    try:
        deleted = (
            client.table("scores")
            .delete()
            .eq("id", str(score_id))
            .eq("user_id", str(user_id))
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        if "violates foreign key" in msg or "foreign key constraint" in msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="score has dependent analyses; delete those first (soft-delete is V2)",
            ) from exc
        raise

    if not (deleted.data or []):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="score not found")

    return Response(status_code=status.HTTP_204_NO_CONTENT)
