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

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services import pending_uploads
from app.auth import current_user_id, current_user_id_provisioned
from app.routers.deps import require_service_client
from app.services.audio_storage import (
    SIGNED_AUDIO_DOWNLOAD_TTL_SECONDS,
    AudioStorageError,
    InvalidAudioReference,
    durable_audio_reference,
    owned_audio_key,
    readable_audio_url,
)
from app.services.tier_limits import tier_of, usage_for
from app.models.analysis import (
    MAX_TARGET_BPM,
    MIN_TARGET_BPM,
    BpmSource,
    Instrument,
    MetronomeMode,
)
from app.models.assignment import AssignmentStatus
from app.routers.upload import AUDIO_BUCKET
from app.workers.dispatch import start_analysis

router = APIRouter(prefix="/analyses", tags=["analyses"])


class CreateAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score_id: UUID
    #: New clients send the durable object key returned by /upload/audio.
    #: The legacy URL remains accepted while installed builds age out.
    audio_key: str | None = Field(default=None, min_length=1, max_length=2048)
    audio_url: str | None = Field(default=None, min_length=1, max_length=2048)
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
    #: The teacher-tier assignment this take answers, if any.
    #:
    #: **The column and its index have existed since `001` and nothing ever
    #: wrote them**, so `002`'s `"teacher reads assignment analyses"` policy —
    #: the only route by which a teacher sees a student's take at all — matched
    #: no row. This field is what makes the weekly loop visible from the
    #: teacher's side.
    #:
    #: Null for every take a musician records for themselves, which is every
    #: take so far. Validated at enqueue against the assignment's student, its
    #: piece and its status; migration 023 holds the same three rules in the
    #: database, because this router is where they belong and also where a
    #: wrong `.eq()` lives.
    assignment_id: UUID | None = None

    @model_validator(mode="after")
    def _one_audio_reference(self) -> "CreateAnalysisRequest":
        if (self.audio_key is None) == (self.audio_url is None):
            raise ValueError("send exactly one of audio_key or audio_url")
        return self

    def audio_reference(self) -> str:
        return self.audio_key or self.audio_url or ""


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
    #: The assignment this take answers, or null for a take the musician
    #: recorded for themselves. Added to this model rather than only to the
    #: row, because a client that cannot tell an assigned take from a personal
    #: one cannot show the difference — and `_WITHOUT_RESULT` is derived from
    #: these fields, so the light projection picks it up with no second edit.
    assignment_id: UUID | None = None
    result_json: dict[str, Any] | None = None
    failure_reason: str | None = None
    alignment_quality: float | None = None
    #: Which leg of the pipeline an in-flight run has reached, or null.
    #:
    #: Advisory, and the client must treat it that way: `status` says whether
    #: an analysis is finished and this says nothing about that. Null on a row
    #: written before the runner started, on a deployment whose table predates
    #: the column, and on every finished row. An unrecognised value is a
    #: pipeline this client is older than, not an error.
    stage: str | None = None
    created_at: str
    updated_at: str
    finished_at: str | None = None


class RecordingPlaybackResponse(BaseModel):
    """A short-lived, private read permission for one saved take."""

    url: str
    expires_in: int


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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="score not found"
        )
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


def _assert_assignment_open_for(
    client: Any, assignment_id: UUID, user_id: UUID, score_id: UUID
) -> None:
    """Refuse an assignment that is not this musician's, not this piece, or put away.

    The same three rules migration 023 enforces in the database, checked here
    because this is where the actor is known and where a refusal can say which
    of the three it was. The trigger cannot: it sees a service-role connection
    and `auth.uid()` is NULL on it, so its messages name the rule rather than
    the caller. Neither is redundant — 023's header gives the argument.

    **A 404 for both "no such assignment" and "not yours".** Distinguishing
    them would let anyone with an id confirm that an assignment exists in a
    studio they are not in, which is the kind of answer an enumeration wants.
    `_assert_score_owned` is written the same way and for the same reason.
    """
    res = (
        client.table("assignments")
        .select("id, score_id, status")
        .eq("id", str(assignment_id))
        .eq("student_user_id", str(user_id))
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="assignment not found"
        )
    row = rows[0]
    if str(row.get("score_id")) != str(score_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="that assignment is for a different piece",
        )
    if row.get("status") == AssignmentStatus.archived.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="that assignment has been archived",
        )


#: Every column `AnalysisResponse` reads **except** `result_json`.
#:
#: **Derived from the model rather than typed out**, because a projection that
#: has to be kept in step with a response model by hand is a projection that
#: will not be: a field added above and forgotten here would come back null
#: from the light path and be perfectly valid, which is the worst kind of
#: wrong. Every field name is also the column name, and
#: `test_analyses_api.py` and `test_readiness_columns.py` hold that against the
#: migrations.
_WITHOUT_RESULT = ", ".join(
    name for name in AnalysisResponse.model_fields if name != "result_json"
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
        assignment_id=row.get("assignment_id"),
        result_json=row.get("result_json"),
        failure_reason=row.get("failure_reason"),
        alignment_quality=row.get("alignment_quality"),
        stage=row.get("stage"),
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


@router.post(
    "", response_model=CreateAnalysisResponse, status_code=status.HTTP_202_ACCEPTED
)
def create_analysis(
    body: CreateAnalysisRequest,
    user_id: UUID = Depends(current_user_id_provisioned),
) -> CreateAnalysisResponse:
    client = require_service_client()
    try:
        audio_reference = durable_audio_reference(body.audio_reference(), user_id)
    except InvalidAudioReference as exc:
        # The storage helper also runs in the standalone worker image, which
        # deliberately does not install FastAPI. Translate its plain domain
        # error at the web boundary rather than importing the web framework
        # into worker code.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    score_row = _assert_score_owned(client, body.score_id, user_id)
    _assert_measure_in_score(score_row, body.from_measure)
    if body.assignment_id is not None:
        _assert_assignment_open_for(client, body.assignment_id, user_id, body.score_id)

    # One uploaded object is one take. If the POST response was lost, the
    # recording screen retries with the same key; return the existing row
    # rather than charging quota twice or running the same audio twice.
    existing = (
        client.table("analyses")
        .select("*")
        .eq("user_id", str(user_id))
        .eq("score_id", str(body.score_id))
        .eq("audio_url", audio_reference)
        .limit(1)
        .execute()
    ).data or []
    if existing:
        row = existing[0]
        # **The retry path had to learn about the assignment, and this is the
        # defect that reading it found.** One uploaded object is one take, so a
        # POST whose response was lost comes back with the same `audio_key` and
        # is answered from the row already written. That answer predates
        # `assignment_id`: a first attempt that reached the server without one
        # and a retry that carries one would return the untouched row, leaving
        # the take unattached — and `002`'s teacher read policy then matches
        # nothing, which is the whole failure this field exists to end. Silent,
        # and only on the retry, so a person would see it as "some takes reach
        # my teacher and some do not".
        held = row.get("assignment_id")
        if body.assignment_id is not None and held is None:
            updated = (
                client.table("analyses")
                .update({"assignment_id": str(body.assignment_id)})
                .eq("id", row["id"])
                .execute()
            ).data or []
            if updated:
                row = updated[0]
        elif body.assignment_id is not None and str(held) != str(body.assignment_id):
            # The same recording answering two assignments is not a retry, and
            # quietly returning the first attachment would hide it. Neither is
            # it the client's to resolve by guessing, so it is named.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="that recording is already submitted to another assignment",
            )
        # A request with no assignment never clears one the row already holds:
        # an older client retrying must not detach a take from its assignment.
        return CreateAnalysisResponse(
            analysis_id=row["id"],
            status=row["status"],
        )

    # Only a genuinely new take spends quota. A retry of a row already written
    # above has to remain retriable even when that row used the final allowance.
    _assert_within_quota(client, user_id)

    insert_payload = {
        "user_id": str(user_id),
        "score_id": str(body.score_id),
        # The column name predates durable keys. Its value is now a token-free
        # private-storage reference; the worker signs it immediately before GET.
        "audio_url": audio_reference,
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
    # Written only when there is one, like the two keys above. The column has
    # existed since `001`, so unlike them this carries no half-applied-schema
    # risk; the shape is kept because a payload that names only what was asked
    # for is the one this file already reasons in.
    if body.assignment_id is not None:
        insert_payload["assignment_id"] = str(body.assignment_id)
    try:
        inserted = client.table("analyses").insert(insert_payload).execute()
    except Exception as exc:  # noqa: BLE001 — see below for the one case kept
        # **A deployment that has not run migration 015 must refuse the bar,
        # not the take, and must say so in words a musician can act on.** The
        # precedent (012, `skip_long_rests`) had no path here at all: an insert
        # naming a column the table does not have is a raw 500, and the app
        # shows "something went wrong" for a request that was entirely
        # reasonable. Worse would be quietly dropping the key and analysing
        # from bar 1 — that is the misalignment this whole feature exists to
        # prevent, reintroduced by a missing column. So: the take is refused,
        # the reason names the one thing the musician can change, and
        # `/v1/ready` names the migration for whoever runs the server.
        if body.from_measure is not None and "from_measure" in str(exc):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Recording from a chosen bar isn't available on this server "
                    "yet. Start the take from bar 1."
                ),
            ) from exc
        raise
    rows = inserted.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="failed to enqueue analysis")

    analysis_id = rows[0]["id"]
    # A row points at the audio now. Same rule and same ordering as
    # `create_score`: claimed after the insert, never before, or a failed
    # submit would strand the take's audio.
    # **The canonical reference, not the request field.** `audio_key` and
    # `audio_url` are two spellings of one object and only one of them is sent;
    # `durable_audio_reference` is what the row stores, so it is what has to be
    # claimed. Reading `body.audio_url` here would silently claim nothing for
    # every new client, and the take's audio would be swept an hour later.
    pending_uploads.claim(AUDIO_BUCKET, _object_keys_in([audio_reference]))
    # Where this runs is `dispatch`'s business, not this endpoint's.
    start_analysis(str(analysis_id))
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
    include_result: bool = Query(
        default=True,
        description=(
            "Send the per-note analysis with each row. Say false when you only "
            "need the rows — it is by far the largest field."
        ),
    ),
) -> list[AnalysisResponse]:
    """The caller's analyses, newest first.

    Insights aggregates across takes — how often a piece was played and
    which way it drifted — which a per-id endpoint can't answer without
    the client already knowing every id. Ordering and paging match
    /v1/scores so the two lists behave the same way.

    `analyses(user_id, created_at DESC)` is indexed, so the default page
    is an index scan.

    **`include_result=false` exists because `result_json` dwarfs everything
    else in the row.** Measured against the real response models at 200 takes
    a page: **214 bytes per note**, so a 200-note take is 52 KB and a 400-note
    take is 105 KB — and a full page of either is **10 to 20 MB**. The app's
    "when did I last play this" map reads exactly two fields out of that,
    `score_id` and `created_at`, about four kilobytes' worth, on every Library
    open.

    It narrows the **SQL projection**, not just the response. Dropping the
    field after Postgres has already sent it would leave the expensive half of
    the transfer exactly where it was — the database read is billed too.
    """
    query = (
        require_service_client()
        .table("analyses")
        .select("*" if include_result else _WITHOUT_RESULT)
        .eq("user_id", str(user_id))
    )
    if score_id is not None:
        query = query.eq("score_id", str(score_id))
    if status_filter is not None:
        query = query.eq("status", status_filter)

    res = (
        query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    )
    return [_row_to_response(row) for row in (res.data or [])]


@router.get("/{analysis_id}", response_model=AnalysisResponse)
def get_analysis(
    analysis_id: UUID,
    user_id: UUID = Depends(current_user_id),
) -> AnalysisResponse:
    res = (
        require_service_client()
        .table("analyses")
        .select("*")
        .eq("id", str(analysis_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="analysis not found"
        )
    return _row_to_response(rows[0])


@router.get("/{analysis_id}/recording", response_model=RecordingPlaybackResponse)
def get_analysis_recording(
    analysis_id: UUID,
    response: Response,
    user_id: UUID = Depends(current_user_id),
) -> RecordingPlaybackResponse:
    """Sign the caller's own practice recording for immediate playback.

    The analyses table keeps a durable, token-free storage reference. Returning
    that value would not play, and returning a permanent public URL would turn
    private practice into public media. This endpoint owner-scopes the row and
    creates a fresh one-hour read permission only when the musician opens the
    take.

    The response itself must never be cached: the URL is a bearer credential,
    even though it is short-lived.
    """
    client = require_service_client()
    rows = (
        client.table("analyses")
        .select("audio_url, playback_key, audio_reclaimed_at")
        .eq("id", str(analysis_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    ).data or []
    # **The compressed copy first, the original as the fallback.** Once a take
    # has been judged its WAV is replaced by an Opus a fraction of the size
    # (`services/take_archive`), and `playback_key` is where that went.
    #
    # Null is three states and they all want this same answer: a row written
    # before migration 018, a take still being analysed, and one whose
    # transcode failed. In each of them the WAV is still there, so falling back
    # is not a degraded path — it is the only path those rows ever had.
    row = rows[0] if rows else {}
    reference = row.get("playback_key") or row.get("audio_url")
    # **A reclaimed take has an `audio_url` and no object behind it.** The
    # column keeps naming the upload the row was created from (018 says why),
    # so falling through here would sign a key that is gone — and
    # `create_signed_url` failing is an `AudioStorageError`, which this reports
    # as 503 *temporarily* unavailable. It is not temporary; the WAV was
    # deleted on purpose a day after the take failed
    # (`take_archive.sweep_unjudged_takes`). 404 is the answer 018 already
    # names for a take whose audio is gone, and `TakePlayback` reads an error
    # as "unavailable" and stops drawing a player.
    if row.get("audio_reclaimed_at") and not row.get("playback_key"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="recording not found",
        )
    if not reference:
        # One answer for an unknown take, somebody else's take, and an old row
        # whose audio is absent. Do not reveal which IDs belong to whom.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="recording not found",
        )

    try:
        # Rows are owner-scoped above, and new writes already enforce this.
        # Check the storage prefix again at the read boundary so an imported or
        # corrupted historical row cannot sign another account's object.
        owned_audio_key(str(reference), user_id)
        url = readable_audio_url(client, str(reference))
    except InvalidAudioReference as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="recording not found",
        ) from exc
    except AudioStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="recording is temporarily unavailable",
        ) from exc

    response.headers["Cache-Control"] = "private, no-store"
    return RecordingPlaybackResponse(
        url=url,
        expires_in=SIGNED_AUDIO_DOWNLOAD_TTL_SECONDS,
    )
