"""POST/GET/PATCH/DELETE /v1/scores.

Owner-scoped via the JWT subject + service-role client. RLS on the
`scores` table guards anon-key callers; the backend uses service-role
for writes (RLS bypass) and explicitly filters by `user_id` on every
read so the same access rules apply at the API layer.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import urlparse
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Response,
    status,
)
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.ocr.validate import validate_measures

from app.auth import current_user_id, current_user_id_provisioned
from app.db import get_service_client
from app.routers.upload import SCORE_BUCKET
from app.services.ocr.musicxml import MusicXMLError, score_json_from_musicxml
from app.workers.transcription_runner import run_transcription
from app.services.score_schema import Clef, ScoreJson

# Fetching the page lives in `services/page_image.py` so the transcription
# worker can reach it without importing this module, which imports the worker.
# What is left here is what a *request* still needs: recognising a storage URL,
# and signing readable ones for display.
from app.services.page_image import (
    SIGNED_DOWNLOAD_TTL_SECONDS,
    STORAGE_PREFIXES as _STORAGE_PREFIXES,
    object_key_from as _object_key_from,
)

router = APIRouter(prefix="/scores", tags=["scores"])

log = logging.getLogger("intempo.scores")


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


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


class ImportScoreRequest(BaseModel):
    """A piece from a notation file rather than a photograph.

    The third provenance, beside the camera and typing it in. A MusicXML file
    carries the durations exactly — no OCR, no model, no cost — which is the
    whole point: `alignment.py` builds its timeline from durations, and a file
    that states them cannot misread them.

    It is **not** a replacement for the camera. Plenty of music reaches a
    musician as paper, and nothing here retires the photograph path.
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    composer: str | None = Field(default=None, max_length=200)
    movement: str | None = Field(default=None, max_length=200)
    #: The MusicXML document itself. Uncompressed: `.mxl` is a zip and
    #: unpacking one is the client's job, since it already has the file open.
    musicxml: str = Field(min_length=1, max_length=8_000_000)
    #: Which part to read, by id (`P3`) or by printed name ("Violoncello").
    #: Required for a multi-part file — see `_choose_part` for why guessing is
    #: worse than refusing.
    part: str | None = Field(default=None, max_length=100)


class UpdateScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score_json: ScoreJson | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    composer: str | None = Field(default=None, max_length=200)
    movement: str | None = Field(default=None, max_length=200)


class MeasureConcern(BaseModel):
    """One measure the reading cannot vouch for, and why, in a musician's terms.

    **Computed here and sent, rather than recomputed by the client.** The app
    had its own beat-sum check in `notation/reading.ts`, which was fine while
    beat sums were the only test. Three more have since been added — broken
    ties, tuplet ratios that contradict their bracket, and note density far
    above the page — and every one of them can fire on a measure whose beats add
    up **exactly**. So the app silently stopped showing whole categories of
    fault: a slur written as a tie sums to 4.0, the backend flags it, and
    nothing appeared on the screen or offered a way to fix it.

    Porting the checks would have made a fifth implementation of a validator
    that has already drifted three times in a week. This is the other direction:
    the server does the arithmetic once and says what it found.
    """

    measure_number: int
    #: Which test failed, for a client that wants to group or filter.
    kind: Literal["beats", "tie", "tuplet", "density"]
    #: A sentence fit to show a musician, not an exception string.
    detail: str


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
    #: `queued` → `reading` → `done` | `failed`. Always `done` for a piece
    #: entered by hand, and for every score written before OCR moved to a
    #: worker — so a client can treat "no notes and status done" as the honest
    #: "this piece has none" rather than "wait a moment".
    #: Measures the reading cannot vouch for. Empty for a clean page, and for a
    #: piece with no notes yet — there is nothing to check until it is read.
    concerns: list[MeasureConcern] = Field(default_factory=list)
    transcription_status: str = "done"
    #: The step the worker last reported, in words fit to put on screen, or
    #: null once it has finished. Free text on purpose: the steps follow the
    #: shape of the provider chain, and pinning them to an enum would make
    #: adding a provider a migration.
    transcription_stage: str | None = None
    #: Why the reading failed, if it did. Null at every other time.
    transcription_error: str | None = None
    #: When the musician confirmed the reading is right. Null until they do.
    transcription_accepted_at: datetime | None = None
    #: When the photograph was deleted from storage. Null while it is still
    #: there — including for an accepted score whose delete failed, which is a
    #: real state and not the same as a finished one.
    page_image_discarded_at: datetime | None = None
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


def _concerns_for(score_json: Any) -> list[MeasureConcern]:
    """Run the validator over a stored score, tolerating anything in the column.

    Never raises. A row that cannot be validated is a row with nothing to say
    about it, and a listing of the whole library must not fail because one score
    predates a schema change.
    """
    try:
        score = ScoreJson.model_validate(score_json or {})
    except Exception:  # noqa: BLE001 — an unreadable row simply has no concerns
        return []

    out: list[MeasureConcern] = []
    for finding in validate_measures(score):
        if not finding.is_problem:
            continue
        if finding.broken_ties:
            kind = "tie"
        elif finding.tuplet_faults:
            kind = "tuplet"
        elif finding.too_dense:
            kind = "density"
        else:
            kind = "beats"
        out.append(
            MeasureConcern(
                measure_number=finding.measure_number,
                kind=kind,
                detail=finding.describe(),
            )
        )
    return out


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
        concerns=_concerns_for(row.get("score_json")),
        # Defaulted rather than indexed: a row read back from a database that
        # has not run migration 006 yet has no such column, and a library that
        # 500s during a deploy is a worse failure than one that says every
        # piece is finished — which, before 006, every piece was.
        transcription_status=row.get("transcription_status") or "done",
        transcription_stage=row.get("transcription_stage"),
        transcription_error=row.get("transcription_error"),
        transcription_accepted_at=row.get("transcription_accepted_at"),
        page_image_discarded_at=row.get("page_image_discarded_at"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _awaiting_transcription() -> ScoreJson:
    """The score a photographed piece holds until the worker has read it.

    Empty, and honestly so. `score_json` is NOT NULL and the row exists from
    the moment the request is accepted, so something has to be in the column
    for the minute or so before the notes are. An empty transcription is not a
    placeholder invented for that: it is exactly what a hand-entered piece
    holds, and every reader in the app already copes with a piece that has no
    notes. `transcription_status` is what distinguishes "none yet" from "none
    ever", and it is the only thing that should be consulted for the
    difference.

    `ocr_confidence = 0.0` for the same reason it is 0 on a hand-entered
    piece: nothing has been read, so nothing is claimed about anything.
    """
    return ScoreJson(measures=[], repeats=[], ocr_confidence=0.0, notes_to_human="")


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
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(current_user_id_provisioned),
) -> ScoreResponse:
    """Create the piece, and — if it came from a photograph — start reading it.

    **This used to run OCR inline and return the notes.** It no longer does,
    and the reason is not speed: a vision model reading a page takes tens of
    seconds no matter where it runs, and holding a request open for that is
    what broke. Backgrounding the app killed the fetch; a dropped connection
    lost the work rather than just the answer; and the app could show nothing
    but a spinner, which is indistinguishable from a hang.

    So the row is written immediately — a real library entry, with the title
    the musician gave it — and `transcription_status` says what is happening to
    it. The client polls the row it already has. Same shape as `/v1/analyses`,
    for the same reason.

    Still 201 with the row, not 202 with an id: the piece genuinely exists when
    this returns, and everything except its notes is already usable.
    """
    manual = body.image_url is None
    if not manual:
        # Before anything is written. A URL that isn't this user's object is a
        # 403 the caller can act on, and a row that could never be transcribed
        # should not be created to discover that in a worker.
        _assert_image_url_owned_by(body.image_url, user_id)

    score = _hand_entered(body) if manual else _awaiting_transcription()

    insert_payload = {
        "user_id": str(user_id),
        "title": body.title,
        "composer": body.composer,
        "movement": body.movement,
        "source_image_url": body.image_url,
        "score_json": score.model_dump(mode="json"),
        # Null rather than 0 for a hand-entered piece: the column answers "how
        # well did OCR read this", and for a piece that was never read the
        # answer is "it didn't", not "badly". Null for a queued one too, and
        # for the same reason — it has not been read *yet*.
        "ocr_confidence": None,
        # A hand-entered piece is finished the moment it is written; there is
        # nothing to read and never will be.
        "transcription_status": "done" if manual else "queued",
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

    if not manual:
        # After the insert, so the worker cannot look for a row that is not
        # there yet, and after the response is sent, which is what
        # `BackgroundTasks` guarantees.
        background_tasks.add_task(run_transcription, str(rows[0]["id"]))

    # Signed like every other read, so a client can render the page it just
    # uploaded without a second request. This used to return an unsigned row,
    # which meant POST was the one response whose `image_url` was always null.
    return _with_image_urls(rows)[0]


@router.post("/import", response_model=ScoreResponse, status_code=status.HTTP_201_CREATED)
async def import_score(
    body: ImportScoreRequest,
    user_id: UUID = Depends(current_user_id_provisioned),
) -> ScoreResponse:
    """Create a piece from a MusicXML file.

    Synchronous, unlike the camera path, and for a good reason: parsing XML is
    milliseconds and involves no model, so there is nothing to background and
    nothing to poll. The row comes back `done` with its notes already in it.

    **`ocr_confidence` is null, not 1.0.** Every "we don't know" mechanism in
    this app — the caveat lines, the review prompt, the accept-before-discard
    rule — keys off that number, and a file is not *confident*, it is
    *stated*. Writing 1.0 would quietly convert a system that admits
    uncertainty into one that claims certainty it was never asked about. Null
    is what the column already means for a piece that was never read.
    """
    try:
        score = score_json_from_musicxml(body.musicxml, part=body.part)
    except MusicXMLError as exc:
        # The converter's message names the parts a multi-part file holds, so
        # the client can offer them rather than make the musician guess.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not score.measures:
        raise HTTPException(
            status_code=422,
            detail="that file has no measures in it",
        )

    inserted = (
        _service_client()
        .table("scores")
        .insert(
            {
                "user_id": str(user_id),
                "title": body.title,
                "composer": body.composer,
                "movement": body.movement,
                # Never photographed, so there is nothing to sign or discard.
                "source_image_url": None,
                "score_json": score.model_dump(mode="json"),
                "ocr_confidence": None,
                "transcription_status": "done",
            }
        )
        .execute()
    ).data or []
    if not inserted:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to persist score",
        )
    return _with_image_urls(inserted)[0]


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


@router.post("/{score_id}/accept", response_model=ScoreResponse)
async def accept_transcription(
    score_id: UUID,
    user_id: UUID = Depends(current_user_id),
) -> ScoreResponse:
    """The musician says the reading is right, and the photograph is discarded.

    **The delete is the consequence of a person looking, and of nothing else.**
    Discarding on a successful OCR run would be discarding on the pipeline's own
    say-so, and the pipeline is the thing the photograph exists to check —
    `ocr_confidence` is a model marking its own homework, and beat sums catch
    arithmetic rather than wrong notes. Neither substitutes for a musician
    reading the stave against the page.

    Irreversible, and refused in every state where it would destroy something
    still needed: a reading still in flight has nothing to accept, and a failed
    one needs its photograph precisely because there is no transcription to
    replace it with.

    Idempotent. Accepting twice is a double tap or a retried request, not an
    error, and the second call finds the object already gone.
    """
    client = _service_client()
    rows = (
        client.table("scores")
        .select("*")
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="score not found")
    row = rows[0]

    state = row.get("transcription_status") or "done"
    if state != "done":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "this page is still being read; there is nothing to accept yet"
                if state in {"queued", "reading"}
                else "this page could not be read, so its photograph is the only "
                "record of it and is not discarded"
            ),
        )

    patch: dict[str, Any] = {
        "transcription_accepted_at": _now_iso(),
        "updated_at": _now_iso(),
    }

    key = _object_key_from(row.get("source_image_url") or "")
    if key is not None and _remove_object(client, key):
        # Nulled together with the discard timestamp, never apart. A row that
        # still names an object that has been deleted would sign download URLs
        # for a file that 404s, which reads to the app as "signing is broken"
        # rather than "the photograph is gone".
        patch["source_image_url"] = None
        patch["page_image_discarded_at"] = _now_iso()

    updated = (
        client.table("scores")
        .update(patch)
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
        .execute()
    ).data or []
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to record the acceptance",
        )
    return _with_image_urls(updated)[0]


def _remove_object(client, key: str) -> bool:
    """Delete one object, reporting whether it actually went.

    False rather than an exception when storage refuses. The acceptance is the
    musician's decision and it stands either way; what must not happen is the
    row claiming a file was discarded that is still sitting in the bucket. The
    object is then still there to be discarded on a later attempt.
    """
    try:
        client.storage.from_(SCORE_BUCKET).remove([key])
    except Exception as exc:  # noqa: BLE001 — storage down, key gone, permissions
        log.warning("could not discard %s after acceptance: %s", key, exc)
        return False
    return True


@router.post("/{score_id}/transcribe", response_model=ScoreResponse)
async def retranscribe(
    score_id: UUID,
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(current_user_id),
) -> ScoreResponse:
    """Read the page again.

    **A failed reading had no way back but the camera.** The photograph was
    still in storage and still perfectly good — the failure was a rate limit, a
    truncated response, a model having a bad minute — and the only thing the
    app could offer was "photograph it again", which re-uploads several
    megabytes to solve a problem the megabytes were never the cause of.

    Refused for a page still being read, so a second tap does not start a
    second worker on the same row; both would write to it and the last one home
    would win. Refused for a page whose photograph was discarded on acceptance,
    because there is nothing left to read.

    Allowed for a *successful* reading as well as a failed one. A musician
    looking at a transcription they can see is wrong should not have to fail
    first to ask for another go.
    """
    client = _service_client()
    rows = (
        client.table("scores")
        .select("*")
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="score not found")
    row = rows[0]

    state = row.get("transcription_status") or "done"
    if state in {"queued", "reading"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="this page is already being read",
        )
    if not row.get("source_image_url"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "the photograph for this piece was discarded when you accepted the "
                "reading, so there is nothing left to read again"
            ),
        )

    updated = (
        client.table("scores")
        .update(
            {
                "transcription_status": "queued",
                "transcription_stage": None,
                "transcription_error": None,
                "updated_at": _now_iso(),
            }
        )
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
        .execute()
    ).data or []
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to queue the re-read",
        )

    background_tasks.add_task(run_transcription, str(score_id))
    return _with_image_urls(updated)[0]


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
