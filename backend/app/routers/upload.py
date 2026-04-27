"""Presigned upload URLs for audio + score images.

Spec §Batch 1: clients PUT directly to Supabase Storage. We never
stream large files through FastAPI — that hits body limits and ties
up workers (spec common-pitfall #2).

Each call returns:
  {
    "upload_url": "<signed PUT url>",
    "public_url":  "<canonical url after upload finishes>",
    "object_key":  "<user_id>/<random>.<ext>",
    "expires_at":  "<iso8601>",
  }

The client uploads with `PUT <upload_url>` (no auth header, no body
transformations). Buckets are private; reads happen later through
`/v1/scores/:id` and `/v1/analyses/:id` which sign download URLs.
"""

from __future__ import annotations

import re
import uuid as _uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import current_user_id
from app.db import get_service_client

router = APIRouter(prefix="/upload", tags=["upload"])

AUDIO_BUCKET = "audio-uploads"
SCORE_BUCKET = "score-images"
SIGNED_URL_TTL_SECONDS = 60 * 5  # 5 minutes is plenty for a single PUT.

_ALLOWED_AUDIO_EXTS = {"wav", "m4a", "mp3", "ogg", "webm", "flac"}
_ALLOWED_IMAGE_EXTS = {"jpg", "jpeg", "png", "heic", "webp"}
_EXT_PATTERN = re.compile(r"^[a-z0-9]{1,8}$")


class UploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)


class UploadResponse(BaseModel):
    upload_url: str
    public_url: str
    object_key: str
    expires_at: datetime


def _extract_ext(filename: str, allowed: set[str]) -> str:
    if "." not in filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="filename must have an extension",
        )
    ext = filename.rsplit(".", 1)[1].lower()
    if not _EXT_PATTERN.match(ext):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid extension",
        )
    if ext not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"extension '{ext}' is not allowed",
        )
    return ext


def _sign_upload(bucket: str, object_key: str) -> dict[str, Any]:
    client = get_service_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service-role client is not configured",
        )
    storage = client.storage.from_(bucket)
    # Supabase python SDK exposes create_signed_upload_url on the bucket; the
    # exact method name varies by version, so we check both.
    if hasattr(storage, "create_signed_upload_url"):
        signed = storage.create_signed_upload_url(object_key)
    elif hasattr(storage, "create_signed_url"):  # pragma: no cover - older SDK
        signed = storage.create_signed_url(object_key, SIGNED_URL_TTL_SECONDS)
    else:  # pragma: no cover - unsupported SDK
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase storage client does not support signed uploads",
        )
    if isinstance(signed, dict):
        return signed
    return {"signedURL": str(signed)}


def _make_response(bucket: str, object_key: str, signed: dict[str, Any]) -> UploadResponse:
    upload_url = (
        signed.get("signedUrl")
        or signed.get("signedURL")
        or signed.get("upload_url")
        or signed.get("url")
    )
    if not upload_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase did not return a signed URL",
        )
    public_url = signed.get("publicUrl") or f"{bucket}/{object_key}"
    return UploadResponse(
        upload_url=str(upload_url),
        public_url=str(public_url),
        object_key=object_key,
        expires_at=datetime.now(tz=timezone.utc) + timedelta(seconds=SIGNED_URL_TTL_SECONDS),
    )


def _build_object_key(user_id: UUID, ext: str) -> str:
    return f"{user_id}/{_uuid.uuid4()}.{ext}"


@router.post("/audio", response_model=UploadResponse)
async def upload_audio(
    body: UploadRequest,
    user_id: UUID = Depends(current_user_id),
) -> UploadResponse:
    ext = _extract_ext(body.filename, _ALLOWED_AUDIO_EXTS)
    object_key = _build_object_key(user_id, ext)
    signed = _sign_upload(AUDIO_BUCKET, object_key)
    return _make_response(AUDIO_BUCKET, object_key, signed)


@router.post("/score-image", response_model=UploadResponse)
async def upload_score_image(
    body: UploadRequest,
    user_id: UUID = Depends(current_user_id),
) -> UploadResponse:
    ext = _extract_ext(body.filename, _ALLOWED_IMAGE_EXTS)
    object_key = _build_object_key(user_id, ext)
    signed = _sign_upload(SCORE_BUCKET, object_key)
    return _make_response(SCORE_BUCKET, object_key, signed)
