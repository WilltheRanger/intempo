"""POST/GET/PATCH/DELETE /v1/scores.

Owner-scoped via the JWT subject + service-role client. RLS on the
`scores` table guards anon-key callers; the backend uses service-role
for writes (RLS bypass) and explicitly filters by `user_id` on every
read so the same access rules apply at the API layer.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import urlparse
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Response,
    status,
)
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.ocr.validate import MeasureFinding, validate_measures

from app.auth import current_user_id, current_user_id_provisioned
from app.config import settings
from app.routers.deps import require_service_client
from app.services import pending_uploads
from app.services import reading_rate
from app.services.transcription_budget import (
    EXHAUSTED_MESSAGE,
    has_room,
    next_run_count,
)
from app.services.audio_storage import InvalidAudioReference, owned_audio_key
from app.services.buckets import AUDIO_BUCKET, SCORE_BUCKET
from app.services.ocr.musicxml import MusicXMLError, score_json_from_musicxml
from app.workers.dispatch import start_transcription
from app.services.score_pages import (
    display_keys,
    page_keys,
    pages_of,
    select_with_pages,
)
from app.services.score_schema import (
    Clef,
    ScoreJson,
    clear_unwritable_where_rewritten,
)
from app.services.training import (
    corrections_between,
    may_keep_corrections,
    rows_for,
)

# Fetching the page lives in `services/page_image.py` so the transcription
# worker can reach it without importing this module, which imports the worker;
# signing a page for display lives in `services/display_urls.py` because it is
# a memo with a lock and a bound, not request handling. What is left here is
# recognising a storage URL and deciding which keys a response needs.
#
# Imported as a module, not a name: `pending_uploads` beside it is the same,
# and a test or the concurrency probe swapping the signer out has one place to
# do it rather than one per importer.
from app.services import display_urls
from app.services.page_image import object_key_from as _object_key_from

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
    #:
    #: **The single-page form, kept for the app that is already installed.**
    #: `image_urls` is the one to send; this is what a build from before
    #: multi-page scanning has.
    image_url: str | None = Field(default=None, min_length=1, max_length=2048)
    #: Every page reference (durable object key or legacy URL), in page order.
    #:
    #: Order is the caller's, settled before it uploads anything
    #: (`lib/scan/drag.ts`), so there is no ordering decision here to get wrong.
    image_urls: list[str] | None = Field(default=None)
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
        if self.image_url is not None and self.image_urls is not None:
            # Rejected rather than merged, the same stance this model already
            # takes on `clef` alongside `image_url`: a caller sending both has
            # misunderstood something, and picking one silently means the pages
            # that were dropped are discovered later, by a musician, on a piece
            # that is missing half its music.
            raise ValueError(
                "send image_urls for a scan; image_url is the single-page form "
                "and the two cannot both be given"
            )
        if self.image_urls is not None:
            if not self.image_urls:
                raise ValueError("image_urls cannot be empty; omit it for a hand-entered piece")
            if len(self.image_urls) > MAX_PAGES:
                raise ValueError(
                    f"a scan may hold at most {MAX_PAGES} pages; "
                    f"this one has {len(self.image_urls)}"
                )
            for url in self.image_urls:
                if not url or len(url) > 2048:
                    raise ValueError("every entry in image_urls must be a page reference")
        if self.pages() == []:
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

    def pages(self) -> list[str]:
        """Page references in order. Empty means the piece was entered by hand."""
        if self.image_urls is not None:
            return list(self.image_urls)
        return [self.image_url] if self.image_url else []


class AttachScorePagesRequest(BaseModel):
    """Photographs to read into an existing scoreless library entry."""

    model_config = ConfigDict(extra="forbid")

    image_url: str | None = Field(default=None, min_length=1, max_length=2048)
    image_urls: list[str] | None = Field(default=None)

    @model_validator(mode="after")
    def _one_page_form(self) -> "AttachScorePagesRequest":
        if self.image_url is not None and self.image_urls is not None:
            raise ValueError(
                "send image_urls for a scan; image_url is the single-page form "
                "and the two cannot both be given"
            )
        pages = self.pages()
        if not pages:
            raise ValueError("attach at least one page")
        if len(pages) > MAX_PAGES:
            raise ValueError(
                f"a scan may hold at most {MAX_PAGES} pages; "
                f"this one has {len(pages)}"
            )
        if any(not url or len(url) > 2048 for url in pages):
            raise ValueError("every attached page must be a page reference")
        return self

    def pages(self) -> list[str]:
        if self.image_urls is not None:
            return list(self.image_urls)
        return [self.image_url] if self.image_url else []


#: The most pages one scan may hold.
#:
#: **A ceiling on the bill, stated as a choice rather than measured** — the
#: same kind of number as `_MAX_SYSTEMS_TO_READ`, and the honest thing is to
#: say which it is. Each page is read separately, so an unbounded list is an
#: unbounded read against a metered container, and a request is the wrong place
#: to discover that.
#:
#: Twelve because a part longer than that is a book rather than a part, and a
#: book is several pieces in this library — one per movement — which is how a
#: musician would file it anyway. Nothing was measured to arrive at it; if a
#: real part turns out to need more, raise it, and say so here.
MAX_PAGES = 12


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
    #: The clef this part is actually in, when the caller knows better than the
    #: file does.
    #:
    #: **Optional, and it wins.** A notation file usually states its clef and
    #: is then authoritative — but not always: an engine's output can be wrong,
    #: and plenty of files state nothing at all, in which case the reading is
    #: `null` rather than a guess.
    #:
    #: Not a way to force a part into the clef its instrument "should" use.
    #: A double bass **solo** part is written in *treble*, and a bass or cello
    #: part drops into tenor for a high passage — reading treble on a bass
    #: player's page is frequently the correct answer, not a mistake to
    #: override. This exists for when the person holding the page knows the
    #: reading is wrong, which is the only thing that beats what the file says.
    clef: Clef | None = None
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
    #: Correct the clef without resending the whole transcription.
    #:
    #: The clef lives inside `score_json`, so this was already *possible* by
    #: sending the entire score back — which means reading it, editing one
    #: field, and writing hundreds of notes to change a word, with every
    #: concurrent edit in between lost. This changes the one field.
    #:
    #: An explicit `null` clears it, which is a real answer: `ScoreJson.clef` is
    #: nullable precisely so a part can be unlabelled rather than mislabelled.
    #:
    #: Whoever reads the page can be wrong about this in either direction. A
    #: double bass solo part is written in *treble*, and a bass or cello part
    #: goes into tenor for a high passage — so neither the engine nor the
    #: instrument settles it, and the player does.
    clef: Clef | None = None


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
    #:
    #: One name per branch of `MeasureFinding.describe()`, because that is what
    #: the app relies on: it prints `detail` verbatim for every kind except
    #: `"beats"`, which is the one wording allowed to promise arithmetic. A
    #: fault mapped to the wrong name is a true sentence under a false heading.
    kind: Literal["beats", "tie", "tuplet", "density", "unwritable", "adrift"]
    #: A sentence fit to show a musician, not an exception string.
    detail: str


class ScoreResponse(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    composer: str | None = None
    movement: str | None = None
    #: Durable private-storage reference for new rows; historical rows may
    #: still carry an expired signed upload URL. Never render this directly —
    #: see `image_url`. Null for a piece entered by hand.
    source_image_url: str | None = None
    #: A freshly signed download URL for the sheet music, or null when the
    #: object key can't be recovered or storage isn't configured. This is the
    #: one to render.
    image_url: str | None = None
    image_url_expires_at: datetime | None = None
    #: How many pages this scan holds. 0 for a piece entered by hand and for
    #: one whose photographs have been discarded.
    #:
    #: A count rather than a list of signed URLs, for now. Signing every page
    #: of every row would turn a library listing into one storage call per
    #: page; `image_url` still signs page one, which is what any screen draws
    #: today. When a screen needs to show page three, this becomes a list —
    #: the count is what tells it there is a page three at all.
    page_count: int = 0
    #: Every page of the scan, signed and in page order.
    #:
    #: **`page_count` used to be the whole answer, and nothing read it.** It was
    #: added so a client could know a page three existed; the note beside it
    #: said the list would follow "when a screen needs to show page three". The
    #: piece screen's own row says *"The pages this piece was read from"* and
    #: showed exactly one, silently — so a musician who photographed a four-page
    #: part could not look at the bar flagged on page three.
    #:
    #: The cost objection that kept it a count no longer describes this code:
    #: `display_urls` batches, so signing every page is the same
    #: single storage call as signing its first. Populated only when reading one
    #: piece, not on the library listing — see `_with_image_urls`.
    #:
    #: `image_url` stays, and stays first here: it is what every listing and
    #: thumbnail draws, and a client that never learns about this field keeps
    #: working unchanged.
    image_urls: list[str] = Field(default_factory=list)
    #: The notation. **Null when the caller asked for the rows without it** —
    #: `GET /v1/scores?include_score=false` — and for a row whose column is
    #: genuinely empty. A client cannot tell those apart and does not need to:
    #: `transcription_status` is what says whether notation is coming, and
    #: `GET /v1/scores/{id}` is the authority on what it is.
    score_json: dict[str, Any] | None = None
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
    #: When the photograph was *kept* at accept time because the owner agreed it
    #: could be used to improve the reader. Null everywhere else, including for
    #: an accepted score whose delete merely failed — see migration 013 for why
    #: those two must not look the same.
    page_image_retained_at: datetime | None = None
    created_at: str
    updated_at: str


def _owned_image_key(reference: str, user_id: UUID) -> str:
    """Return the durable object key named by an owned page reference.

    New clients send the key returned by the upload endpoint. It does not
    expire, so a slow multi-page upload and the time spent naming a piece cannot
    invalidate page one before the score is created. Older installed clients
    still send a signed upload URL; its path contains the same key and remains
    accepted.

    The service-role client can read every object, so ownership is checked here
    before the reference is stored. A valid key has exactly one owner segment
    and one generated filename — nested paths and URL-like strings are refused
    instead of being normalised into a different object.
    """
    parsed = urlparse(reference)
    if parsed.scheme:
        if parsed.scheme not in {"https", "http"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="page reference must be an object key or an http(s) storage URL",
            )
        key = _object_key_from(reference)
    else:
        if (
            parsed.netloc
            or reference.startswith(("/", "\\"))
            or any(mark in reference for mark in ("?", "#"))
        ):
            key = None
        else:
            key = reference.removeprefix(f"{SCORE_BUCKET}/")

    owner, separator, filename = (key or "").partition("/")
    if (
        owner != str(user_id)
        or not separator
        or not filename
        or "/" in filename
        or "\\" in filename
        or filename in {".", ".."}
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="page reference must name a score image owned by your account",
        )
    return key


def _durable_image_url(reference: str, user_id: UUID) -> str:
    """Canonical private-storage URL stored on the score row.

    It carries no token. Every reader extracts the key and signs a fresh
    download URL, so this value remains useful after the five-minute upload
    permission has expired.
    """
    key = _owned_image_key(reference, user_id)
    return (
        f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/authenticated/"
        f"{SCORE_BUCKET}/{key}"
    )


def _object_keys_in(urls: list[str]) -> list[str]:
    """The storage keys inside a list of upload references, skipping any that
    are not one — a hand-entered piece has none, and a malformed reference is
    already refused by validation."""
    keys = [_object_key_from(url or "") for url in urls]
    return [key for key in keys if key]


def _with_image_urls(
    rows: list[dict[str, Any]], *, all_pages: bool = False
) -> list[ScoreResponse]:
    """Rows to responses, signing every recoverable image in one call.

    `all_pages` is off for the library listing and on for reading one piece.
    The *call* costs the same either way — the signer batches — but forty rows
    of four pages is forty extra URLs in a payload nothing on that screen
    draws, and the listing draws page one. Reading a single piece is where a
    musician looks at the photographs, and where they need all of them.

    **A discarded photograph is not signed.** Signing does not check that the
    object exists, so a row whose page was deleted by `POST /:id/accept` went on
    being handed a perfectly well-formed URL that 404s — and the app has no way
    to tell that from a slow download. What a musician saw on a piece they had
    accepted was a large empty box where the photograph used to be, an "Original"
    tab that showed nothing, and no explanation. The row already records that the
    page is gone; this is that record being believed.

    `source_image_url` is deliberately left alone on the row. It still holds the
    key, which is what `_object_key_from` needs if the deletion has to be
    audited — the response is the only place the absence has to show.
    """
    keys: dict[Any, list[str]] = {}
    for row in rows:
        if row.get("page_image_discarded_at"):
            continue
        # **Every page, or just the first.** `pages_of` is the one function that
        # knows the three shapes a scan comes in; page one is simply its first
        # element, so both callers read the same list.
        page_urls = pages_of(row) if all_pages else pages_of(row)[:1]
        found = _object_keys_in(page_urls)
        if found:
            keys[row["id"]] = found

    # Still one storage call for the whole request, however many pages it
    # covers: `signed_display_urls` takes a list and `create_signed_urls` is
    # batched. That is what makes signing every page of a single piece cost the
    # same as signing its first — and it is why `page_count`'s note about "one
    # storage call per page" no longer describes this code.
    signed = display_urls.signed_display_urls(
        sorted({key for found in keys.values() for key in found})
    )

    out = []
    for row in rows:
        found = keys.get(row["id"], [])
        urls = [signed[key][0] for key in found if key in signed]
        # One expiry for all of them: the same batch, the same TTL. Reported as
        # the earliest, because a reused URL may carry less life than a fresh
        # one and the response must not promise more than the shortest keeps.
        expiries = [signed[key][1] for key in found if key in signed]
        out.append(
            _row_to_response(
                row,
                image_url=urls[0] if urls else None,
                expires_at=min(expiries) if expiries else None,
                image_urls=urls,
            )
        )
    return out




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
        # First, because it is the only one that is not a doubt about the
        # reading: the page was read and this schema had no name for what was
        # on it. A bar can carry it *and* run short, and the missing notes are
        # usually why — `describe()` says both.
        out.append(
            MeasureConcern(
                measure_number=finding.measure_number,
                kind=_concern_kind(finding),
                detail=finding.describe(),
            )
        )
    return out


def _concern_kind(finding: MeasureFinding) -> str:
    """Which of `describe()`'s branches wrote this finding's sentence.

    **`kind` names the branch, and that is the whole invariant.** The app
    prints `detail` verbatim for every kind except `"beats"`, which is the one
    wording allowed to promise arithmetic — it becomes "doesn't add up to the
    time signature". So a fault mapped to `"beats"` is a true sentence under a
    false heading.

    `out_of_line` used to fall past this ladder into the `else`. It is set
    **only where no metre could be read**, so a bar flagged for being out of
    step with the rest of the page was reported to the musician as
    disagreeing with a time signature the server had just said it could not
    read. Its own sentence — the right one — was in `detail` all along.

    Extracted from `_concerns_for` so the mapping can be exercised one fault at
    a time: `test_every_fault_a_measure_can_carry_has_its_own_concern_kind`
    reads `MeasureFinding`'s fields, so a *new* flag added without a branch
    here fails instead of quietly becoming `"beats"`.

    The order is `describe()`'s order. `unwritable` leads for the reason stated
    there: it is often the cause of whatever else is wrong with the bar, and
    `describe()` prefixes it rather than choosing between the two sentences.
    """
    if finding.unwritable_notes:
        return "unwritable"
    if finding.broken_ties:
        return "tie"
    if finding.tuplet_faults:
        return "tuplet"
    if finding.too_dense:
        return "density"
    if finding.out_of_line:
        return "adrift"
    return "beats"


#: Both moved to `services/score_pages` on 2026-09-17, when the sweep for
#: unreadable scans became a third caller. The names stay private here so the
#: eleven call sites below read as they always did.
_page_keys = page_keys
_display_keys = display_keys


def _consents_to_training(user_id: UUID) -> bool:
    """Whether this account has agreed their corrections may be kept.

    **Never raises, and a failure is a no.** Every caller is in the middle of
    doing the thing the musician actually asked for — saving a bar, accepting a
    reading — and none of them may fail because a consent lookup did. The rule
    itself is in `services/training.py`; what is here is the fetch, and the
    decision that a fetch which did not work means no.
    """
    try:
        rows = (
            require_service_client()
            .table("users")
            .select("training_consent_at")
            .eq("id", str(user_id))
            .limit(1)
            .execute()
        ).data or []
    except Exception:  # noqa: BLE001 — pre-013 database, or storage of any kind down
        log.warning("could not read training consent for %s", user_id, exc_info=True)
        return False
    return may_keep_corrections(rows[0] if rows else None)


def _record_corrections(
    *,
    user_id: UUID,
    score_id: UUID,
    stored: dict[str, Any],
    before: ScoreJson | None,
    after: ScoreJson,
) -> None:
    """Keep what the musician just fixed, if they have agreed we may.

    **Never raises.** A correction is a by-product of the save, not the point of
    it: the musician asked for their bar to be stored and it has been. Losing
    one training row is a cost worth paying without them ever knowing; failing
    their save to record one is not.

    `before` is None when the previous reading could not be read back — a row
    that has since gone, or JSON that no longer validates. There is then no
    prediction to pair the correction with, and a correction with nothing on the
    other side of it is not a training example.
    """
    if before is None:
        return
    try:
        changes = corrections_between(before, after)
        if not changes:
            return
        keys = _page_keys(stored)
        rows = rows_for(
            changes,
            user_id=str(user_id),
            score_id=str(score_id),
            reader=stored.get("transcription_reader"),
            # The page the bar was read from is not knowable per bar — nothing
            # carries a measure's position on the page — so page one is the
            # honest pointer for a single-page scan and the best available for
            # a multi-page one. See the column comment in migration 013.
            page_image_key=keys[0] if keys else None,
        )
        require_service_client().table("training_corrections").insert(rows).execute()
        log.info(
            "kept %d correction(s) for score %s", len(rows), score_id
        )
    except Exception:  # noqa: BLE001 — pre-013 database, or anything at all
        log.warning(
            "could not record corrections for score %s", score_id, exc_info=True
        )


def _score_before_edit(score_id: UUID, user_id: UUID) -> tuple[dict[str, Any], ScoreJson | None]:
    """The stored row and its reading, for comparison against what is incoming.

    Returns the raw row as well, because the correction needs two things from it
    that the parsed score does not carry: which chain read it, and which object
    the page lives in.
    """
    def run(columns: str):
        return (
            require_service_client()
            .table("scores")
            .select(columns)
            .eq("id", str(score_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )

    # **Two narrowings, not one.** `select_with_pages` already handles a
    # database without 011's page array; `transcription_reader` is 013 and has
    # the same window in front of it, because Render deploys `main`
    # automatically while migrations here are applied by hand. Asking PostgREST
    # for a column that does not exist fails the *whole* request, so a save
    # would start 500ing the moment this shipped and before the migration ran.
    rows: list[dict[str, Any]] = []
    for base in ("score_json, transcription_reader", "score_json"):
        try:
            result = select_with_pages(run, base)
        except Exception:  # noqa: BLE001 — try the narrower shape, then give up
            continue
        rows = result.data or []
        break
    else:
        log.warning("could not read score %s before an edit", score_id)
        return {}, None
    if not rows:
        return {}, None
    row = rows[0]
    try:
        return row, ScoreJson.model_validate(row.get("score_json") or {})
    except Exception:  # noqa: BLE001 — a row written before a schema change
        return row, None


def _insert_score(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Insert the row, dropping the page array if the database has no column.

    **Same window as `score_pages.PAGE_COLUMNS`, on the write side.** Render
    deploys from `main` automatically and `011` is applied by hand in the
    Supabase editor, so this code is live before the column is. An insert
    naming a column that does not exist fails the whole request — which would
    turn "your scan reads page one only for a day" into "you cannot add a piece
    at all", on the one endpoint the app cannot work without.

    Page one is already in `source_image_url`, so the narrower insert loses the
    later pages and nothing else. That is the same thing every scan did last
    week, and it is recoverable — `POST /:id/transcribe` re-reads the row once
    the column arrives.
    """
    client = require_service_client()
    try:
        return client.table("scores").insert(payload).execute().data or []
    except Exception:  # noqa: BLE001 — retry once without the newest column
        if "source_image_urls" not in payload:
            raise
        log.warning(
            "scores: `source_image_urls` was refused on insert; writing page "
            "one only. Apply backend/app/migrations/011_score_pages.sql."
        )
        narrower = {k: v for k, v in payload.items() if k != "source_image_urls"}
        return client.table("scores").insert(narrower).execute().data or []


def _assert_reading_rate(user_id: UUID) -> None:
    """Refuse to start a reading this account is asking for too fast.

    **A cost guard, not a product limit** — see `services/reading_rate` for why
    the numbers are where they are, and `services/tier_limits` for what a free
    account is actually entitled to. The three endpoints that reach
    `start_transcription` are the only ones that spend money per call, and this
    is the only thing standing between a client stuck in a retry loop and the
    vision API bill.

    **429 with `Retry-After`**, which is the answer that says *not yet* rather
    than *no*. 403 would be wrong — nothing here is about permission — and a
    409 would say the piece is busy, which it is not.

    Called by the handler rather than wired as a `Depends`, because
    `create_score` serves a photographed piece and a hand-entered one through
    one route and only knows which after it has read the body. A hand-entered
    piece and a MusicXML import cost nothing and are never counted.
    """
    # Resolved through the module, not bound at import. `from ... import
    # readings` binds the object into this namespace, so replacing the
    # process-wide limiter — which is exactly what the test fixture does to keep
    # one test's readings out of the next one's — would silently have no effect
    # here. The same rule `deps.py` learned about `get_service_client`.
    decision = reading_rate.readings.check(str(user_id))
    if decision.allowed:
        return
    log.info("refused a reading for %s; %ss to wait", user_id, decision.retry_after)
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=reading_rate.BUSY_MESSAGE,
        headers={"Retry-After": str(decision.retry_after)},
    )


#: The columns a score row needs to become a `ScoreResponse`, minus the notation.
#:
#: **Written out rather than derived from `ScoreResponse.model_fields`**, which
#: is how `/v1/analyses` does it — that shortcut works there because every field
#: of an `AnalysisResponse` is also a column. Half of a `ScoreResponse` is not:
#: `image_url`, `image_urls`, `image_url_expires_at`, `page_count` and
#: `concerns` are all computed here, and `source_image_urls` is a column that is
#: not a field at all. A derived list would ask Postgres for five columns that
#: do not exist and miss the one `pages_of` reads.
#:
#: So the list is the *reads* below, and `test_scores_router.py` holds it
#: there behaviourally: it fetches fully-populated rows both ways and asserts
#: the two responses differ in `score_json` and `concerns` and nowhere else. A
#: column dropped from here shows up as a field that lost its value, which is
#: the failure this projection could otherwise cause silently.
_WITHOUT_SCORE = ", ".join(
    (
        "id",
        "user_id",
        "title",
        "composer",
        "movement",
        "source_image_url",
        "source_image_urls",
        "shared_with_studio",
        "ocr_confidence",
        "transcription_status",
        "transcription_stage",
        "transcription_error",
        "transcription_accepted_at",
        "page_image_discarded_at",
        "created_at",
        "updated_at",
    )
)


def _row_to_response(
    row: dict[str, Any],
    *,
    image_url: str | None = None,
    expires_at: datetime | None = None,
    image_urls: list[str] | None = None,
) -> ScoreResponse:
    return ScoreResponse(
        id=row["id"],
        user_id=row["user_id"],
        title=row["title"],
        composer=row.get("composer"),
        movement=row.get("movement"),
        source_image_url=row["source_image_url"],
        image_url=image_url,
        image_urls=image_urls or ([image_url] if image_url else []),
        image_url_expires_at=expires_at,
        page_count=len(pages_of(row)),
        score_json=row.get("score_json"),
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
    A piece like this is a real library entry — it can be opened and named —
    but the app has no score-only metronome route and the analysis pipeline has
    nothing to align a recording to, so it cannot yet be practised or produce a
    verdict. That limitation is the honest consequence of never having read the
    page, and `ocr_confidence = 0` records it: no notes were read, so nothing is
    claimed about any.
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
def create_score(
    body: CreateScoreRequest,
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
    references = body.pages()
    manual = not references
    if not manual:
        # Before anything is written, so a refusal leaves no half-made piece.
        _assert_reading_rate(user_id)
    # Canonicalise every page before anything is written. The returned values
    # are durable private-storage URLs with no upload token; old signed URLs
    # and new object keys converge on the same stored form.
    pages = [
        _durable_image_url(reference, user_id) for reference in references
    ]

    score = _hand_entered(body) if manual else _awaiting_transcription()

    insert_payload = {
        "user_id": str(user_id),
        "title": body.title,
        "composer": body.composer,
        "movement": body.movement,
        # **Both, deliberately.** The array is the truth; the single column is
        # page one, kept written so that a worker or a reader from before
        # migration 011 still finds a photograph instead of a piece with no
        # scan at all. It is dropped in a later migration once nothing reads
        # it — expand now, contract later.
        "source_image_url": pages[0] if pages else None,
        "source_image_urls": pages or None,
        "score_json": score.model_dump(mode="json"),
        # Null rather than 0 for a hand-entered piece: the column answers "how
        # well did OCR read this", and for a piece that was never read the
        # answer is "it didn't", not "badly". Null for a queued one too, and
        # for the same reason — it has not been read *yet*.
        "ocr_confidence": None,
        # A hand-entered piece is finished the moment it is written; there is
        # nothing to read and never will be.
        "transcription_status": "done" if manual else "queued",
        # The first reading is a reading. Leaving it at the column's default of
        # 0 would quietly make the ceiling one higher than it says, which is
        # the kind of off-by-one a limit is worst at carrying.
        "transcription_runs": 0 if manual else 1,
    }
    rows = _insert_score(insert_payload)
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to persist score",
        )

    # **Claimed only after the row exists.** A row now points at these objects,
    # so the sweeper must leave them alone — and clearing them before the
    # insert would strand every object of a save that then failed, which is one
    # of the three cases `pending_uploads` was written for.
    pending_uploads.claim(SCORE_BUCKET, _object_keys_in(body.pages()))

    if not manual:
        # After the insert, so the worker cannot look for a row that is not
        # there yet.
        #
        # It used to say "and after the response is sent, which is what
        # `BackgroundTasks` guarantees" — and this handler took a
        # `BackgroundTasks` it never added anything to. `start_transcription`
        # puts the id on a queue that reader threads drain, so a worker can
        # pick it up before this function returns; the insert above is what
        # makes that safe, and the only ordering claim worth making.
        start_transcription(str(rows[0]["id"]))

    # Signed like every other read, so a client can render the page it just
    # uploaded without a second request. This used to return an unsigned row,
    # which meant POST was the one response whose `image_url` was always null.
    return _with_image_urls(rows)[0]


@router.post("/{score_id}/transcription", response_model=ScoreResponse)
def attach_score_pages(
    score_id: UUID,
    body: AttachScorePagesRequest,
    user_id: UUID = Depends(current_user_id),
) -> ScoreResponse:
    """Read sheet music into an existing scoreless or failed piece.

    A manual library entry keeps a title and intended tempo, but it has no notes
    for recording analysis or score playback to follow. This turns that same
    entry into a photographed score instead of forcing the musician to create a
    duplicate and lose the details already attached to it.

    A failed first reading is the other scoreless state. New photographs replace
    its unreadable pages in the same row, so the recovery action does not create a
    second copy of the piece. A failed *re-reading* of a score that still has
    measures is not replaceable here: those usable notes may already have
    practice history behind them and must not be erased by a photograph retry.
    """
    _assert_reading_rate(user_id)
    pages = [
        _durable_image_url(reference, user_id)
        for reference in body.pages()
    ]

    client = require_service_client()
    existing = (
        client.table("scores")
        .select("*")
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    ).data or []
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="score not found"
        )

    row = existing[0]
    state = row.get("transcription_status") or "done"
    if state in {"queued", "reading"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="this piece is already being read",
        )
    measures = (row.get("score_json") or {}).get("measures") or []
    replacing_failed_pages = state == "failed" and not measures
    if measures or (pages_of(row) and not replacing_failed_pages):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="this piece already has notation",
        )

    # Kept until the row points at the replacements. If the write loses a race,
    # the original photographs remain available for the winning retry and the
    # newly uploaded pages remain pending for the ordinary sweeper.
    replaced_keys = _page_keys(row) if replacing_failed_pages else []

    pending_score = _awaiting_transcription().model_dump(mode="json")
    previous_score = row.get("score_json") or {}
    # Keep the manual setup visible while the worker reads. The transcription
    # replaces these fields when it finishes, but dropping the entered tempo in
    # the queued response makes Today jump to a generic default in the meantime.
    #
    # `_MANUAL_FIELDS` rather than the same three names typed again: it is the
    # one place that says which fields a person supplies and OCR overwrites,
    # and a fourth added there and not here would vanish from the musician's
    # screen for exactly as long as the reading takes — the failure this loop
    # exists to prevent, reintroduced one field at a time.
    for field in _MANUAL_FIELDS:
        pending_score[field] = previous_score.get(field)

    update = {
        "source_image_url": pages[0],
        "source_image_urls": pages,
        "score_json": pending_score,
        "ocr_confidence": None,
        "transcription_status": "queued",
        "transcription_stage": None,
        "transcription_error": None,
        "transcription_accepted_at": None,
        "page_image_discarded_at": None,
        # **Reset, not incremented.** These are new photographs, and the
        # ceiling counts readings of *one* photograph — the refusal at the top
        # of it says the answer is a clearer picture, so arriving with a
        # clearer picture has to be an answer. A musician who takes the advice
        # and is refused anyway would have been told to do something that does
        # not work.
        "transcription_runs": 1,
    }
    update_query = (
        client.table("scores")
        .update(update)
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
    )
    if replacing_failed_pages:
        # Compare both facts that authorised replacement. "Try reading again"
        # can race this request from another tab; once it changes the state, a
        # late photograph must not overwrite the reading it started. Comparing
        # the old first page also lets only one of two photograph retries win.
        update_query = update_query.eq("transcription_status", "failed").eq(
            "source_image_url", row.get("source_image_url")
        )
    updated = update_query.execute().data or []
    if not updated:
        raise HTTPException(
            status_code=(
                status.HTTP_409_CONFLICT
                if replacing_failed_pages
                else status.HTTP_404_NOT_FOUND
            ),
            detail=(
                "this piece changed while the replacement pages were uploading; "
                "open it and check the current reading"
                if replacing_failed_pages
                else "score not found"
            ),
        )

    # The row points at them now, same as `create_score`.
    new_keys = _object_keys_in(pages)
    pending_uploads.claim(SCORE_BUCKET, new_keys)

    # The old photographs are now unreachable. Remove them immediately; if
    # storage is temporarily unavailable, put each one into the same durable
    # pending registry used for an abandoned upload so the sweeper can retry.
    # Never remove a key reused by an older client as its replacement.
    for key in sorted(set(replaced_keys) - set(new_keys)):
        if not _remove_object(client, key):
            pending_uploads.record(user_id, SCORE_BUCKET, key)

    start_transcription(str(score_id))
    return _with_image_urls(updated)[0]


@router.post("/import", response_model=ScoreResponse, status_code=status.HTTP_201_CREATED)
def import_score(
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
        if body.clef is not None:
            # Stated by the person, so it outranks the file — which covers the
            # missing case as well as the wrong one, so it is the only rule
            # here. Passing it as `clef_fallback` too was a second mechanism
            # for the same job: mutation testing could not kill it, because
            # nothing reaches it that this line has not already settled.
            score = score.model_copy(update={"clef": body.clef})
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
        require_service_client()
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
def list_scores(
    user_id: UUID = Depends(current_user_id),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    include_score: bool = Query(
        default=True,
        description=(
            "Send the notation with each row. Say false when you only need the "
            "pieces — it is by far the largest field."
        ),
    ),
) -> list[ScoreResponse]:
    """The caller's scores, newest first.

    **`include_score=false` exists because `score_json` dwarfs the rest of the
    row.** Measured against the reader's own stored output: **111 to 130 bytes a
    note**, so an ordinary study of three or four hundred notes is 35 to 50 KB —
    and the app does not fetch one page of these, it pages through the *whole*
    library on every Library open, because search filters the array it is given
    and piece fifty-one would otherwise be unfindable. A hundred pieces is
    several megabytes, repeated every time the tab is opened past
    `STALE_TIME_MS`. The library grid draws a title, a composer and a
    photograph, and has never drawn a note.

    It narrows the **SQL projection**, not just the response, for the same
    reason as `/v1/analyses`: dropping the field after Postgres has already sent
    it leaves the expensive half of the transfer where it was, and the database
    read is billed too.

    Two fields go quiet with it, both correctly. `score_json` is null, and
    `concerns` is empty — the concerns are *computed from* the notation, so
    without it there is nothing to compute, and running the measure validator
    over every row of a library listing was never work that screen asked for.
    `GET /v1/scores/{id}` is where both are answered.
    """
    response = (
        require_service_client()
        .table("scores")
        .select("*" if include_score else _WITHOUT_SCORE)
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return _with_image_urls(response.data or [])


class CurrentScoreResponse(BaseModel):
    """The piece Today offers, and when it was last played."""

    score: ScoreResponse | None
    #: When the newest take of it was recorded; null for a piece never played.
    last_practiced_at: datetime | None = None


@router.get("/current", response_model=CurrentScoreResponse)
def current_score(user_id: UUID = Depends(current_user_id)) -> CurrentScoreResponse:
    """The piece to continue, in one request.

    **The app used to work this out itself in two sequential requests** — the
    newest take, then the score it names — and only after `/v1/me` had
    answered, so Today's title and Practice button waited on three round trips
    in a row after signing in. The owner saw it: "they take like 2 seconds to
    load and just appear all of a sudden" (2026-09-23). Here it is two indexed
    reads next to the database instead of two trips across the internet.

    The rule is the app's own, unchanged: the piece most recently *played*
    (`analyses(user_id, created_at DESC)`, indexed), falling back to the newest
    score for someone who has never recorded, or to nothing for an empty
    library. A take whose score has since been deleted falls back the same way.

    **Declared before `/{score_id}`**, which would otherwise take the path and
    refuse "current" as a malformed UUID.
    """
    client = require_service_client()
    latest = (
        client.table("analyses")
        .select("score_id,created_at")
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    ).data or []
    if latest and latest[0].get("score_id"):
        played = (
            client.table("scores")
            .select("*")
            .eq("id", str(latest[0]["score_id"]))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        ).data or []
        if played:
            return CurrentScoreResponse(
                score=_with_image_urls(played, all_pages=True)[0],
                last_practiced_at=latest[0].get("created_at"),
            )

    newest = (
        client.table("scores")
        .select("*")
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    ).data or []
    return CurrentScoreResponse(
        score=_with_image_urls(newest, all_pages=True)[0] if newest else None,
        last_practiced_at=None,
    )


@router.get("/{score_id}", response_model=ScoreResponse)
def get_score(
    score_id: UUID,
    user_id: UUID = Depends(current_user_id),
) -> ScoreResponse:
    response = (
        require_service_client()
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
    # Every page: this is the screen where a musician looks at what was read.
    return _with_image_urls(rows, all_pages=True)[0]


@router.patch("/{score_id}", response_model=ScoreResponse)
def update_score(
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
    # The reading as it stands, fetched once and used for two things: clearing
    # the unwritable count on a rewritten bar, and — only where the musician has
    # agreed to it — recording what they changed. Fetched only when a
    # `score_json` is actually incoming, so renaming a piece still costs no
    # extra round trip.
    keeping = False
    stored_row: dict[str, Any] = {}
    previous: ScoreJson | None = None
    if body.score_json is not None:
        keeping = _consents_to_training(user_id)
        if keeping or any(m.unwritable_notes for m in body.score_json.measures):
            stored_row, previous = _score_before_edit(score_id, user_id)

    if body.score_json is not None:
        # A bar the musician has just rewritten no longer carries what the
        # *reading* lost in it — see `clear_unwritable_where_rewritten`. The
        # stored score is read for the comparison, and only when the incoming
        # one actually claims something was unwritable, so an ordinary save
        # costs no extra round trip.
        incoming = clear_unwritable_where_rewritten(
            body.score_json,
            stored_row.get("score_json")
            if any(m.unwritable_notes for m in body.score_json.measures)
            else None,
        )
        update["score_json"] = incoming.model_dump(mode="json")
        update["ocr_confidence"] = incoming.ocr_confidence
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
    if "clef" in sent and body.score_json is None:
        # Read-modify-write of the one field, and only when the caller has not
        # sent a whole `score_json` — if they have, theirs already carries a
        # clef and two sources for one field is how they disagree.
        current = (
            require_service_client()
            .table("scores")
            .select("score_json")
            .eq("id", str(score_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
        rows = current.data or []
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="score not found"
            )
        stored = rows[0].get("score_json") or {}
        update["score_json"] = {**stored, "clef": body.clef}
    if not update:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="patch body must include at least one field",
        )

    response = (
        require_service_client()
        .table("scores")
        .update(update)
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
        .execute()
    )
    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="score not found")

    # **After the save, never before it.** A correction is evidence that the
    # save happened; writing one first would leave a training row describing an
    # edit that then 404'd. `_record_corrections` swallows its own failures for
    # the same reason — the musician asked for their bar to be stored, and it
    # has been.
    if keeping and body.score_json is not None:
        _record_corrections(
            user_id=user_id,
            score_id=score_id,
            stored=stored_row,
            before=previous,
            after=incoming,
        )

    # Signed like every other read. A rename returning a null `image_url` made
    # the caller's freshly-updated piece lose its thumbnail until the next
    # list fetch.
    return _with_image_urls(rows)[0]


@router.post("/{score_id}/accept", response_model=ScoreResponse)
def accept_transcription(
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
    client = require_service_client()
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

    # **The photograph is kept only where a person has said it may be.**
    #
    # 007 deletes on accept, and every reason it gives still stands — a page is
    # megabytes of JPEG whose one remaining purpose has just been served. What
    # changed is that there is now a second purpose, and it is not one this
    # code may assume: the page plus the corrections made against it is the
    # training example that makes the reader better next time.
    #
    # So this is 007 with a consent gate in front of it. No consent and nothing
    # here behaves differently in any way. `page_image_retained_at` records the
    # keeping as a deliberate act, because an accepted row whose photograph is
    # still present is otherwise indistinguishable from one whose delete failed.
    if _consents_to_training(user_id):
        patch["page_image_retained_at"] = _now_iso()
        log.info("keeping the photograph of %s: the owner consented", score_id)
        return _accepted(client, score_id, user_id, patch)

    # **Every page, not the first.** Accepting a three-page scan used to
    # discard page one and leave pages two and three in the bucket with no row
    # naming them, no accept path and no delete path — the orphaned-upload hole
    # this file already documents, multiplied by the length of the part.
    keys = _page_keys(row)
    # The display copies too, and their absence must not stop the discard —
    # the same rule and the same reasoning as `discard_pages_of`, which is the
    # other half of this decision. Attempted before the `all` below so a page
    # whose photograph goes cannot leave its derivative behind on the one path
    # that returns early.
    for key in _display_keys(row):
        _remove_object(client, key)
    if keys and all(_remove_object(client, key) for key in keys):
        # Nulled together with the discard timestamp, never apart. A row that
        # still names an object that has been deleted would sign download URLs
        # for a file that 404s, which reads to the app as "signing is broken"
        # rather than "the photograph is gone".
        #
        # **`all`, and only after every one of them went.** A partial discard
        # that nulled the columns would strand whatever storage refused, in
        # exactly the way this is meant to prevent; leaving the row intact
        # keeps every remaining page reachable by `DELETE /:id`, which is the
        # one path that can still clean them up.
        patch["source_image_url"] = None
        if "source_image_urls" in row:
            # Only when the row actually carries it. `select("*")` returns what
            # the database has, so on a deployment where 011 has not been
            # applied the key is absent — and naming it in the update would
            # fail the whole request, turning "accepting discards page one" into
            # "accepting is broken".
            patch["source_image_urls"] = None
        patch["page_image_discarded_at"] = _now_iso()

    return _accepted(client, score_id, user_id, patch)


def _accepted(
    client, score_id: UUID, user_id: UUID, patch: dict[str, Any]
) -> ScoreResponse:
    """Write the acceptance, narrowing if the database predates a column.

    Both exits from `accept_transcription` come through here, so the retaining
    branch and the discarding one cannot drift apart about what a written
    acceptance looks like.

    `page_image_retained_at` is 013 and Render deploys before the migrations
    here are applied by hand, so naming it on a database that has not got it
    would turn "accepting keeps the photograph" into "accepting is broken" for
    the length of that window — the same failure the `source_image_urls` guard
    a few lines up exists to prevent, and the reason that guard is written as it
    is.
    """
    for attempt in (patch, {k: v for k, v in patch.items() if k != "page_image_retained_at"}):
        try:
            updated = (
                client.table("scores")
                .update(attempt)
                .eq("id", str(score_id))
                .eq("user_id", str(user_id))
                .execute()
            ).data or []
        except Exception:  # noqa: BLE001 — pre-013 column; retry without it
            if attempt is not patch:
                raise
            log.warning(
                "accepting %s without page_image_retained_at; 013 looks unapplied",
                score_id,
            )
            continue
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="failed to record the acceptance",
            )
        return _with_image_urls(updated)[0]
    raise HTTPException(  # pragma: no cover — the loop returns or raises
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="failed to record the acceptance",
    )


def discard_pages_of(client, score: dict[str, Any]) -> bool:
    """Delete one score's photographs and record it, returning whether they went.

    Public because withdrawal of training consent has to do exactly what accept
    does — `routers/me.py` calls it for every score whose page was retained.
    Two copies of "remove the objects, then null the columns, but only if every
    object actually went" is two chances to get the ordering wrong, and getting
    it wrong strands a photograph that nothing can reach again.

    Returns False and writes nothing when storage refused, which leaves
    `page_image_retained_at` set — so the row still says a photograph is being
    kept, and a later attempt can still find it. That is the honest state, and
    it is better than a row claiming the file is gone while it sits in the
    bucket.
    """
    keys = _page_keys(score)
    if keys and not all(_remove_object(client, key) for key in keys):
        return False

    # **The display copies go too, and their absence must not stop this.**
    #
    # Every reason to delete a photograph is a reason to delete the smaller
    # copy of it: a musician withdrawing training consent has not agreed to a
    # 1568px version staying in the bucket.
    #
    # But the strictness above is about a row claiming a photograph is gone
    # while it sits in storage, and a derivative that was never written is a
    # different thing entirely — every page scanned before `store_display_copy`
    # existed has none, and nothing backfills them. Failing the discard for
    # that would leave `page_image_retained_at` set on a score whose
    # photographs really did go, which is the false state this function exists
    # to prevent, arrived at from the other side. So: attempted for all,
    # logged by `_remove_object`, and never fatal.
    for key in _display_keys(score):
        _remove_object(client, key)

    patch: dict[str, Any] = {
        "source_image_url": None,
        "page_image_discarded_at": _now_iso(),
        "page_image_retained_at": None,
        "updated_at": _now_iso(),
    }
    if "source_image_urls" in score:
        patch["source_image_urls"] = None
    try:
        client.table("scores").update(patch).eq("id", str(score["id"])).execute()
    except Exception:  # noqa: BLE001 — the objects are gone either way
        log.warning(
            "discarded the pages of %s but could not update the row",
            score.get("id"),
            exc_info=True,
        )
        return False
    return True


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
def retranscribe(
    score_id: UUID,
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

    **The refusal is the write, not the read before it.** It was a SELECT
    followed by an unconditional UPDATE, which only holds if no second request
    arrives inside the round trip — and one does: the retry sits on
    ``EmptyState``'s button, which stays pressable while the first request is
    in flight. Two taps both read ``failed``, both passed this check, both
    wrote ``queued`` and both spawned a worker, so one page was read twice, in
    parallel, on two containers and two model bills, with the two runs
    interleaving their writes to the same row. The worse ending is not the
    money: run A finishes ``done`` with good notes and run B, a minute later,
    hits a rate limit and stamps the row ``failed`` — burying a reading that
    had worked.

    Allowed for a *successful* reading as well as a failed one. A musician
    looking at a transcription they can see is wrong should not have to fail
    first to ask for another go.
    """
    _assert_reading_rate(user_id)
    client = require_service_client()
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
    # **The ceiling, and this is the only endpoint that needs one.** Every
    # other refusal above is about the row's state; this one is about the bill.
    # A reading is a vision-model call per page, and until 017 nothing counted
    # them — the concurrency guard below stops two taps starting two workers,
    # and does nothing at all about the same tap arriving a thousand times.
    #
    # 409 rather than 429: this ceiling is per page and permanent, so waiting
    # changes
    # nothing. This page is finished, which is a conflict with its state, and
    # `transcription_runs` is that state.
    if not has_room(row):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=EXHAUSTED_MESSAGE,
        )

    # Compare-and-set: the same condition the check above states, applied where
    # it actually settles the race. `transcription_status` is NOT NULL with a
    # CHECK over the four values (migration 006), so these two are exactly the
    # complement of "already being read" — there is no null or unknown state to
    # fall through the filter.
    updated = (
        client.table("scores")
        .update(
            {
                "transcription_status": "queued",
                "transcription_stage": None,
                "transcription_error": None,
                # Computed from the row read above rather than incremented in
                # the database, which supabase-py cannot express — and safe for
                # exactly the reason the status filter below exists: two racing
                # requests both read the same count and both write the same
                # successor, but only one gets past the compare-and-set, so the
                # count advances once per reading that actually starts.
                "transcription_runs": next_run_count(row),
                "updated_at": _now_iso(),
            }
        )
        .eq("id", str(score_id))
        .eq("user_id", str(user_id))
        .in_("transcription_status", ["done", "failed"])
        .execute()
    ).data or []
    if not updated:
        # The row was found a moment ago and is scoped by id and user, so the
        # only thing that can have changed is the status: another request got
        # here first. Same answer as the check above, for the same reason.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="this page is already being read",
        )

    start_transcription(str(score_id))
    return _with_image_urls(updated)[0]


@router.delete("/{score_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_score(
    score_id: UUID,
    user_id: UUID = Depends(current_user_id),
) -> Response:
    """Permanently remove a piece, its practice history, and stored media.

    The initial schema deliberately uses RESTRICT from assignments and analyses
    to scores. That protects history from an accidental bare row delete, but it
    also meant the consumer-facing action stopped working as soon as someone
    had practised the piece. This endpoint performs the complete owned cleanup
    explicitly, in dependency order, and remains compatible with that deployed
    schema.

    Database work happens before storage removal. A failed or interrupted
    request can therefore be retried without a row pointing at bytes that were
    already destroyed. The sequence is idempotent at every dependent step:
    assignments, analyses, then the score.
    """
    client = require_service_client()

    # Inventory everything while its owner row still exists. The ownership
    # check is the boundary for all later score-id-only deletes, including
    # assignments that do not themselves carry the score owner's user id.
    existing = select_with_pages(
        lambda columns: (
            client.table("scores")
            .select(columns)
            .eq("id", str(score_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        ),
        "",
    ).data or []
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="score not found",
        )

    page_keys = _page_keys(existing[0])
    try:
        analysis_rows = (
            client.table("analyses")
            .select("audio_url, playback_key")
            .eq("score_id", str(score_id))
            .eq("user_id", str(user_id))
            .execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001 - no destructive action happened
        log.exception("could not inventory recordings for score %s", score_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not prepare this piece for deletion. Try again.",
        ) from exc

    audio_keys: list[str] = []
    for row in analysis_rows:
        # **Both references, because a judged take has two.** The WAV is
        # replaced by an Opus once the analysis finishes and `playback_key`
        # names it (`services/take_archive`); collecting only `audio_url`
        # would delete the piece and leave every compressed recording behind,
        # which is the leak this whole change exists to close.
        #
        # Usually only one of the two still exists — the transcode removes the
        # original — and asking storage to remove a key that is already gone is
        # not an error there.
        for field in ("audio_url", "playback_key"):
            reference = row.get(field)
            if not isinstance(reference, str) or not reference:
                continue
            try:
                audio_keys.append(owned_audio_key(reference, user_id))
            except InvalidAudioReference:
                # A legacy or malformed row must not become authority to delete
                # an arbitrary storage object. The database history can still go.
                log.warning(
                    "analysis for score %s has an unreadable %s",
                    score_id,
                    field,
                )
    audio_keys = list(dict.fromkeys(audio_keys))

    try:
        # assignments.score_id and analyses.score_id are both RESTRICT. The
        # former may also point at one of these analyses as its submission; its
        # FK is SET NULL, but the assignment itself is about the piece and goes.
        client.table("assignments").delete().eq(
            "score_id", str(score_id)
        ).execute()
        client.table("analyses").delete().eq(
            "score_id", str(score_id)
        ).eq("user_id", str(user_id)).execute()
        deleted = (
            client.table("scores")
            .delete()
            .eq("id", str(score_id))
            .eq("user_id", str(user_id))
            .execute()
        )
    except Exception as exc:  # noqa: BLE001 - provider errors vary
        log.exception("piece deletion stopped before score %s was removed", score_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "This piece could not be fully removed. Try again; completed "
                "cleanup steps will not be repeated."
            ),
        ) from exc

    if not (deleted.data or []):
        # The ownership read succeeded but the final delete matched nothing:
        # another request won the race. It owns media cleanup, so do not remove
        # objects on the strength of this stale snapshot.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="score not found",
        )

    # The database is now the truth the app reads. Storage cleanup is best
    # effort, matching account deletion: failure must not resurrect a library
    # entry, and every key was recovered and ownership-checked before the rows
    # disappeared.
    if audio_keys:
        try:
            client.storage.from_(AUDIO_BUCKET).remove(audio_keys)
        except Exception as exc:  # noqa: BLE001 - deletion already committed
            log.error(
                "score %s was deleted but %d recording(s) remain: %s",
                score_id,
                len(audio_keys),
                exc,
            )

    for key in page_keys:
        if not _remove_object(client, key):
            log.warning(
                "score %s was deleted but its page image %s was not",
                score_id,
                key,
            )

    return Response(status_code=status.HTTP_204_NO_CONTENT)
