"""POST/GET/PATCH/DELETE /v1/scores.

Owner-scoped via the JWT subject + service-role client. RLS on the
`scores` table guards anon-key callers; the backend uses service-role
for writes (RLS bypass) and explicitly filters by `user_id` on every
read so the same access rules apply at the API layer.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.auth import current_user_id, current_user_id_provisioned
from app.db import get_service_client
from app.routers.upload import SCORE_BUCKET
from app.services.ocr import OCRError, parse_sheet_music
from app.services.score_schema import Clef, ScoreJson

# Fetching the page lives in `services/page_image.py` so the transcription
# worker can reach it without importing this module, which imports the worker.
# Aliased back to the private names this module has always used them under, so
# nothing else here — or in the tests that reach for them — has to change.
from app.services.page_image import (  # noqa: E402  (grouped with app imports)
    SIGNED_DOWNLOAD_TTL_SECONDS,
    STORAGE_PREFIXES as _STORAGE_PREFIXES,
    download_image as _download_image,
    media_type_of as _media_type_of,
    object_key_from as _object_key_from,
    readable_url as _readable_url,
)

router = APIRouter(prefix="/scores", tags=["scores"])

log = logging.getLogger("intempo.scores")


class CreateScoreRequest(BaseModel):
    """A new piece, from a photograph or from typing.

    The two are mutually exclusive and the model enforces it rather than
    letting a caller send both and guess which won. With `image_url`, OCR reads
    the clef, time signature and tempo off the page; without it, the caller
    supplies them, because nothing else can.
    """

    model_config = ConfigDict(extra="forbid")

    #: Absent for a hand-entered piece. See `_MANUAL_FIELDS`.
    image_url: str | None = Field(default=None, min_length=1, max_length=2048)
    title: str = Field(min_length=1, max_length=200)
    composer: str | None = Field(default=None, max_length=200)
    #: e.g. "I. Adagio". Null for music that has no movements at all, which is
    #: most études and every caprice.
    movement: str | None = Field(default=None, min_length=1, max_length=200)

    #: Manual entry only. Rejected alongside `image_url` rather than silently
    #: ignored: a caller that sends both has misunderstood something, and
    #: overwriting what OCR read with what they guessed is the worse outcome.
    clef: Clef | None = None
    time_signature: str | None = Field(default=None, max_length=20)
    bpm_hint: int | None = Field(default=None, ge=20, le=300)

    @model_validator(mode="after")
    def _one_provenance(self) -> "CreateScoreRequest":
        supplied = [name for name in _MANUAL_FIELDS if getattr(self, name) is not None]
        if self.image_url is None:
            if self.clef is None:
                raise ValueError(
                    "a piece with no image_url is entered by hand and needs a clef"
                )
            return self
        if supplied:
            raise ValueError(
                f"{', '.join(supplied)} apply to a hand-entered piece; "
                "OCR reads them from the image, so omit them when image_url is set"
            )
        return self


#: Fields that only mean something for a hand-entered piece.
_MANUAL_FIELDS = ("clef", "time_signature", "bpm_hint")


class UpdateScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score_json: ScoreJson | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    composer: str | None = Field(default=None, max_length=200)
    movement: str | None = Field(default=None, max_length=200)


class ScoreResponse(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    composer: str | None = None
    movement: str | None = None
    #: What was uploaded. Historical: the signed upload URL, long expired.
    #: Never usable for display — see `image_url`. Null for a piece entered
    #: by hand, which was never photographed at all.
    source_image_url: str | None = None
    #: A freshly signed download URL for the sheet music, or null when the
    #: object key can't be recovered or storage isn't configured. This is the
    #: one to render.
    image_url: str | None = None
    image_url_expires_at: datetime | None = None
    score_json: dict[str, Any]
    shared_with_studio: UUID | None = None
    ocr_confidence: float | None = None
    created_at: str
    updated_at: str


#: The shapes a Supabase storage URL takes for one object, as path prefixes
#: before `<bucket>/<path>`. Both the ownership check and the object-key
#: extraction below read them, so a new shape is added in exactly one place.
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
    if not any(
        parsed.path.startswith(f"{prefix}{SCORE_BUCKET}/{user_id}/")
        for prefix in _STORAGE_PREFIXES
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="image_url must be a Supabase score-images URL under your user prefix",
        )


def _sign_downloads(keys: list[str]) -> dict[str, str]:
    """Object key → signed download URL, for as many as storage will give us.

    Batched: a library of forty scores is one storage call, not forty. Missing
    keys are simply absent from the result, and a signing failure degrades the
    whole batch to no images rather than failing the request — a list of scores
    with no thumbnails is a usable screen; a 500 is not.
    """
    if not keys:
        return {}
    client = get_service_client()
    if client is None:
        return {}

    bucket = client.storage.from_(SCORE_BUCKET)
    try:
        signed = bucket.create_signed_urls(keys, SIGNED_DOWNLOAD_TTL_SECONDS)
    except Exception:
        return {}

    out: dict[str, str] = {}
    for entry in signed or []:
        if not isinstance(entry, dict) or entry.get("error"):
            continue
        url = entry.get("signedUrl") or entry.get("signedURL") or entry.get("signed_url")
        path = entry.get("path")
        if url and path:
            # Supabase echoes the key back; it may or may not carry the bucket.
            out[str(path).removeprefix(f"{SCORE_BUCKET}/")] = str(url)
    return out


def _with_image_urls(rows: list[dict[str, Any]]) -> list[ScoreResponse]:
    """Rows to responses, signing every recoverable image in one call."""
    keys = {}
    for row in rows:
        key = _object_key_from(row.get("source_image_url") or "")
        if key:
            keys[row["id"]] = key

    signed = _sign_downloads(sorted(set(keys.values())))
    expires_at = datetime.now(tz=timezone.utc) + timedelta(seconds=SIGNED_DOWNLOAD_TTL_SECONDS)

    out = []
    for row in rows:
        url = signed.get(keys.get(row["id"], ""))
        out.append(_row_to_response(row, image_url=url, expires_at=expires_at if url else None))
    return out


def _service_client():
    client = get_service_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service-role client is not configured",
        )
    return client


def _row_to_response(
    row: dict[str, Any],
    *,
    image_url: str | None = None,
    expires_at: datetime | None = None,
) -> ScoreResponse:
    return ScoreResponse(
        id=row["id"],
        user_id=row["user_id"],
        title=row["title"],
        composer=row.get("composer"),
        movement=row.get("movement"),
        source_image_url=row["source_image_url"],
        image_url=image_url,
        image_url_expires_at=expires_at,
        score_json=row["score_json"],
        shared_with_studio=row.get("shared_with_studio"),
        ocr_confidence=row.get("ocr_confidence"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _transcribe(image_url: str, user_id: UUID) -> ScoreJson:
    """Photograph → notes. The original path, unchanged."""
    _assert_image_url_owned_by(image_url, user_id)
    fetch_url = _readable_url(image_url)
    # The endpoint the guard above just approved. Passed on so a redirect
    # cannot move the fetch somewhere the guard never saw. `httpx.URL.port`
    # fills in the scheme default, so this is compared against the same.
    approved = httpx.URL(fetch_url)
    image_bytes = _download_image(
        fetch_url, expected_origin=f"{approved.host}:{approved.port}"
    )
    media_type = _media_type_of(image_bytes, image_url)
    try:
        return parse_sheet_music(image_bytes, media_type=media_type)
    except OCRError as exc:
        raise HTTPException(status_code=422, detail=f"OCR failed: {exc}") from exc


def _hand_entered(body: CreateScoreRequest) -> ScoreJson:
    """What the musician typed, as a score with no notes in it.

    `measures` is empty and stays empty: this endpoint takes a title and a
    tempo, not a transcription, and there is no note entry anywhere in the app.
    A piece like this is a real library entry — it can be opened, favourited
    and practised against with the metronome — but the analysis pipeline has
    nothing to align a recording to, so it cannot produce a verdict. That
    limitation is the honest consequence of never having read the page, and
    `ocr_confidence = 0` records it: no notes were read, so nothing is claimed
    about any.
    """
    return ScoreJson(
        clef=body.clef,
        time_signature=body.time_signature,
        bpm_hint=body.bpm_hint,
        measures=[],
        repeats=[],
        ocr_confidence=0.0,
        notes_to_human="",
    )


@router.post("", response_model=ScoreResponse, status_code=status.HTTP_201_CREATED)
async def create_score(
    body: CreateScoreRequest,
    user_id: UUID = Depends(current_user_id_provisioned),
) -> ScoreResponse:
    manual = body.image_url is None
    score = _hand_entered(body) if manual else _transcribe(body.image_url, user_id)

    insert_payload = {
        "user_id": str(user_id),
        "title": body.title,
        "composer": body.composer,
        "movement": body.movement,
        "source_image_url": body.image_url,
        "score_json": score.model_dump(mode="json"),
        # Null rather than 0 for a hand-entered piece: the column answers "how
        # well did OCR read this", and for a piece that was never read the
        # answer is "it didn't", not "badly".
        "ocr_confidence": None if manual else score.ocr_confidence,
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
    # Signed like every other read, so a client can render the page it just
    # uploaded without a second request. This used to return an unsigned row,
    # which meant POST was the one response whose `image_url` was always null.
    return _with_image_urls(rows)[0]


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
    return _with_image_urls(response.data or [])


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
    return _with_image_urls(rows)[0]


@router.patch("/{score_id}", response_model=ScoreResponse)
async def update_score(
    score_id: UUID,
    body: UpdateScoreRequest,
    user_id: UUID = Depends(current_user_id),
) -> ScoreResponse:
    # `model_fields_set` rather than `is not None`, and the difference is a
    # whole feature: with a None check there is no way to *clear* a composer,
    # because "composer": null is indistinguishable from omitting it. The
    # request 200s with the old value still in place — a silent no-op, which
    # is the worst answer available. This asks what the client actually sent.
    sent = body.model_fields_set

    update: dict[str, Any] = {}
    if body.score_json is not None:
        update["score_json"] = body.score_json.model_dump(mode="json")
        update["ocr_confidence"] = body.score_json.ocr_confidence
    if "title" in sent:
        # Null is meaningful for a composer — anonymous, or traditional — but
        # not for a title. Refuse it rather than ignoring it.
        if body.title is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="title cannot be null; omit it to leave it unchanged",
            )
        update["title"] = body.title
    if "composer" in sent:
        update["composer"] = body.composer
    # Same `sent` treatment as the composer, and for the same reason: an
    # explicit null is how a movement gets cleared, and `is not None` would
    # make that indistinguishable from omitting the field.
    if "movement" in sent:
        update["movement"] = body.movement
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
    # Signed like every other read. A rename returning a null `image_url` made
    # the caller's freshly-updated piece lose its thumbnail until the next
    # list fetch.
    return _with_image_urls(rows)[0]


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
