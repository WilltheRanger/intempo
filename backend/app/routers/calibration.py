"""POST /v1/calibration — infer a target BPM from a short clip (§4).

Thin wrapper over `services.calibration.calibrate`: validate the audio
URL is the caller's, fetch it, decode, run the calibration logic, and
map the tagged outcome to a stable JSON shape the client branches on.
Errors are 200 responses with an `ok: false` + `code` + `message` (not
HTTP errors) — a too-quiet clip is a normal, expected outcome the UI
turns into a toast, not a failure the client has to special-case.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.auth import current_user_id
from app.config import settings
from app.routers.upload import AUDIO_BUCKET
from app.services import audio as audio_svc
from app.services.calibration import calibrate
from app.services.storage_origin import is_owned_storage_url, storage_origin
from app.workers.analysis_runner import AudioFetchError, download_audio

router = APIRouter(prefix="/calibration", tags=["calibration"])


class CalibrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audio_url: str = Field(min_length=1, max_length=2048)


class CalibrationResponse(BaseModel):
    ok: bool
    bpm: float | None = None
    alternates: list[float] | None = None
    warning: str | None = None
    code: str | None = None
    message: str | None = None


def _assert_audio_url_owned_by(audio_url: str, user_id: UUID) -> None:
    """Refuse anything that is not this deployment's storage, in this bucket,
    under this caller.

    **This used to check the path and not the host**, which read as an
    ownership check and was not one: anybody can serve
    `/storage/v1/object/sign/audio-uploads/<your id>/take.wav`. Measured before
    the fix, all three of these were accepted and then fetched by the server —
    `https://evil.example.com/...`, `http://169.254.169.254/...` and
    `http://127.0.0.1:8000/...` — and `download_audio` returned the upstream
    status in its error, so it also answered what was listening where.

    The rule and its tests are in `services/storage_origin`, shared with the
    image path so the two cannot drift apart again.
    """
    if not is_owned_storage_url(
        audio_url,
        bucket=AUDIO_BUCKET,
        user_id=user_id,
        expected_origin=storage_origin(settings.SUPABASE_URL),
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="audio_url must be a Supabase audio-uploads URL under your user prefix",
        )


@router.post("", response_model=CalibrationResponse)
def calibrate_tempo(
    body: CalibrationRequest,
    user_id: UUID = Depends(current_user_id),
) -> CalibrationResponse:
    _assert_audio_url_owned_by(body.audio_url, user_id)
    try:
        audio_bytes = download_audio(
            body.audio_url, expected_origin=storage_origin(settings.SUPABASE_URL)
        )
    except AudioFetchError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    y, sr = audio_svc.load_audio_bytes(audio_bytes)
    result = calibrate(y, sr)
    return CalibrationResponse(
        ok=result.ok,
        bpm=result.bpm,
        alternates=result.alternates,
        warning=result.warning,
        code=result.code,
        message=result.message,
    )
