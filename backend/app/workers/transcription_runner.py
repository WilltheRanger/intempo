"""Reading the photographed page, after the response has gone out.

The mirror of `analysis_runner.py`, and a plain sync function for the same
reasons: FastAPI runs one in Starlette's threadpool, so a call that blocks for
half a minute never touches the event loop, the Supabase client is sync anyway,
and the body is shaped so the Celery migration is a decorator and a `.delay`.

**Why this exists at all.** OCR used to run inside `POST /v1/scores`. That is a
request held open for as long as a vision model takes to read a page — ten
seconds on a good day, past a minute when the host has to wake up first — and
everything about it was fragile in the way that only shows up on a phone.
Backgrounding the app kills the fetch. Losing signal loses the work, not just
the answer. And for the whole of it the musician has a spinner that looks
identical to a hang, which is precisely what they reported: "the pipeline gets
stuck."

None of that is fixed by making OCR faster, because none of it is about speed.
It is about a long job being attached to a connection. So the row is written
first, the connection ends, and this fills the notes in.
"""

from __future__ import annotations

import logging
import re
import threading
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.config import settings
from app.db import get_service_client
from app.services.ocr import OCRError, parse_sheet_music
from app.services.ocr.pipeline import (
    STAGE_CONFIRMING,
    STAGE_READING,
    STAGE_SPLITTING,
)
from app.services.page_image import download_image, prepare_for_model, readable_url

log = logging.getLogger("intempo.transcription")

#: How many pages may be read at once, process-wide.
#:
#: **A memory ceiling, not a throughput knob.** `BackgroundTasks` runs sync
#: work in Starlette's threadpool, which holds 40 threads — so without this,
#: forty people scanning at once means forty simultaneous transcriptions.
#: Measured at ~81 MB per in-flight scan on the vision path alone, mostly
#: Pillow decode buffers: a 12 MP photograph is ~36 MB as RGB before anything
#: copies it. Forty of those is 3.2 GB, on an instance that has 512 MB.
#:
#: A scan waiting here stays `queued`, which is not a euphemism — it is queued,
#: and the screen already has words for that.
_scan_slots = threading.BoundedSemaphore(max(1, settings.TRANSCRIPTION_MAX_CONCURRENT))


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


#: What each pipeline stage is called on a screen someone is watching.
#:
#: Deliberately not the provider's name. "claude-sonnet-4-6" tells a musician
#: nothing they can act on and quite a lot they did not ask about; what they
#: want to know is that something is happening and roughly what. The provider
#: is in the log line either way, which is where the person debugging it looks.
_HUMAN_STAGES = {
    STAGE_SPLITTING: "Finding the staves",
    STAGE_CONFIRMING: "Checking the bar counts",
}

#: The step before the pipeline starts, which the pipeline therefore cannot
#: report: getting the photograph out of storage.
STAGE_FETCHING = "Fetching the page"
STAGE_READING_HUMAN = "Reading the notation"

#: What the pipeline says when it has finished a stave, e.g.
#: `reading:system 3 of 7`. Matched rather than string-compared because the two
#: numbers are the point.
_SYSTEM_COUNT = re.compile(rf"^{re.escape(STAGE_READING)}:system (\d+) of (\d+)$")


def _human_stage(stage: str) -> str:
    """The words that go on the screen for one pipeline stage.

    **A stave count is real measured progress and is said out loud.** A page is
    read one stave at a time now, so a five-minute read reports seven times
    instead of once, and collapsing all of it to "Reading the notation" left a
    musician watching a still bar for minutes — which is the failure this
    reporting exists to prevent, not a cosmetic shortfall. The worker knows it
    has finished 3 of 7; nothing here estimates anything.

    The provider's name is still never shown. "claude-sonnet-5" tells a
    musician nothing they can act on and quite a lot they did not ask about,
    and it is in the log line either way, which is where the person debugging
    it looks.
    """
    counted = _SYSTEM_COUNT.match(stage)
    if counted:
        return f"Reading stave {counted.group(1)} of {counted.group(2)}"
    if stage.startswith(f"{STAGE_READING}:"):
        return STAGE_READING_HUMAN
    return _HUMAN_STAGES.get(stage, STAGE_READING_HUMAN)



#: What the pipeline says, and what it means for the person holding the page.
#:
#: **The default used to be the only answer, and it was a guess.** Every failed
#: read said "A flatter, better-lit shot of the page usually fixes it" —
#: including for a photograph that was perfectly sharp and had simply run past
#: the output cap. Sending someone back to re-photograph a page that was never
#: the problem is worse than saying nothing: it is confident, actionable and
#: wrong, and they will do it, and it will fail again the same way.
#:
#: So the reason is derived from what actually happened, and the photograph is
#: only blamed when nothing more specific is known.
_FAILURE_REASONS: tuple[tuple[str, str], ...] = (
    (
        "cut off",
        "This page has more notes than one reading can hold. Photographing "
        "fewer bars at a time — a system or two — gets through it.",
    ),
    (
        "rate limit",
        "The transcription service is busy. This usually clears in a minute or "
        "two; the piece is in your library and can be read again.",
    ),
    (
        "api key",
        "The transcription service is not configured. This is a fault on our "
        "side, not with your page.",
    ),
    (
        "media type",
        "That image format could not be read. A JPEG or PNG works.",
    ),
    (
        "image",
        "That photograph could not be sent for reading. Try taking it again.",
    ),
)

_UNKNOWN_REASON = (
    "The notation could not be read from this photograph. A flatter, "
    "better-lit shot of the page usually fixes it."
)


def _why_it_failed(detail: str) -> str:
    """Turn the pipeline's own account into something worth acting on.

    Underscores are flattened to spaces before matching: these strings come
    from several places — exception text, environment variable names, SDK error
    classes — and `GEMINI_API_KEY` and "api key" are the same fact written two
    ways. Matching the prose form only would have silently missed the one that
    actually appears in the log.
    """
    haystack = detail.lower().replace("_", " ")
    for needle, reason in _FAILURE_REASONS:
        if needle in haystack:
            return reason
    return _UNKNOWN_REASON


def run_transcription(score_id: str) -> None:
    """Read the page for one score row and write the notes into it.

    Never raises. Every exit writes a terminal state to the row, because the
    one outcome the screen cannot recover from is a row that stays `reading`
    forever — a musician watching that has no way to tell a slow page from a
    dead worker, and no button that helps.
    """
    client = get_service_client()
    if client is None:
        log.error("transcription %s: no service-role client configured", score_id)
        return

    row = _fetch_score(client, score_id)
    if row is None:
        log.error("transcription %s: row missing", score_id)
        return

    image_url = row.get("source_image_url")
    if not image_url:
        _fail(client, score_id, "There was no photograph to read.")
        return

    # Wait for a slot before claiming to be reading anything. The row stays
    # `queued` while it waits, which is the truth rather than a euphemism —
    # and it means a second person scanning during a busy minute sees "queued"
    # rather than a progress bar that has not moved.
    with _scan_slots:
        _read_page(client, score_id, image_url)


def _read_page(client, score_id: str, image_url: str) -> None:
    _update(
        client,
        score_id,
        {"transcription_status": "reading", "transcription_stage": STAGE_FETCHING},
    )

    def report(stage: str) -> None:
        _update(client, score_id, {"transcription_stage": _human_stage(stage)})

    try:
        fetch_url = readable_url(image_url)
        image_bytes = download_image(fetch_url)
        # Normalise before anything reads it. A page arrives from a phone
        # rotated by an EXIF flag, several megabytes, and 3000-4000px on the
        # long edge — none of which any provider was ever tested against, and
        # every one of which fails in a way that says nothing about the page.
        # See `prepare_for_model`.
        page, media_type = prepare_for_model(image_bytes)
        # The prepared page is what gets *read* whole and what the systems are
        # detected on; the crops are cut from the photograph itself, so each
        # system spends the whole size budget on its own long edge. See
        # `crop_systems`' `source` — without it a crop carries no more detail
        # than the page it came from, which is the entire point of the cut.
        score = parse_sheet_music(
            page, media_type=media_type, on_stage=report, source=image_bytes
        )
    except HTTPException as exc:
        # `page_image` speaks in HTTP status codes because its other caller is
        # a request handler. Here only the sentence matters.
        log.warning("transcription %s: could not fetch the page: %s", score_id, exc.detail)
        _fail(client, score_id, "The photograph could not be fetched from storage.")
        return
    except OCRError as exc:
        log.warning("transcription %s: %s", score_id, exc)
        _fail(client, score_id, _why_it_failed(str(exc)))
        return
    except Exception:  # noqa: BLE001 — anything at all beats a row stuck reading
        log.exception("transcription %s: internal error", score_id)
        _fail(client, score_id, "Something went wrong reading this page.")
        return

    _update(
        client,
        score_id,
        {
            "score_json": score.model_dump(mode="json"),
            "ocr_confidence": score.ocr_confidence,
            "transcription_status": "done",
            "transcription_stage": None,
            "transcription_error": None,
        },
    )
    log.info(
        "transcription %s: %d measures, confidence %.2f",
        score_id,
        len(score.measures),
        score.ocr_confidence,
    )


def _fetch_score(client, score_id: str) -> dict | None:
    res = (
        client.table("scores")
        .select("id, user_id, source_image_url")
        .eq("id", score_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _update(client, score_id: str, patch: dict) -> None:
    """Write one patch, and never let a failed write end the run.

    A stage update is a courtesy to whoever is watching; losing one costs a
    line of text. Losing the transcription because storage hiccuped while
    reporting progress would be an absurd trade, so this swallows rather than
    raises — and the terminal writes are logged loudly enough to notice.
    """
    try:
        client.table("scores").update({**patch, "updated_at": _now_iso()}).eq(
            "id", score_id
        ).execute()
    except Exception:  # noqa: BLE001
        log.warning("transcription %s: could not write %s", score_id, sorted(patch), exc_info=True)


def _fail(client, score_id: str, reason: str) -> None:
    _update(
        client,
        score_id,
        {
            "transcription_status": "failed",
            "transcription_stage": None,
            "transcription_error": reason,
        },
    )


#: How long a read may sit before it is presumed dead.
#:
#: Generous on purpose. A page is read in ten to fifteen seconds, but a scan
#: can wait behind `TRANSCRIPTION_MAX_CONCURRENT` — legitimately, and for as
#: long as the queue ahead of it takes — and a sweeper that cannot tell waiting
#: from dead would fail a page that was about to be read.
STUCK_AFTER = timedelta(minutes=10)


def sweep_stuck_transcriptions(client=None, *, now: datetime | None = None) -> int:
    """Fail reads that stopped happening. Returns how many were swept.

    **The hole this fills, reported from a phone.** A musician photographed a
    page, left the screen, and came back to "Reading the notation" with the
    progress bar part-filled — permanently. Nothing was reading it. Nothing was
    ever going to.

    `run_transcription` runs in `BackgroundTasks`, which is to say *in the web
    process*, so anything that ends the process ends the read: a deploy, the
    OOM reaper, or — the one that actually happened — a free-tier instance
    spinning down after fifteen minutes idle, which is exactly what leaving the
    screen brings about, because the polling that was keeping it awake stops
    with you.

    The row is left `reading` and `usePiece` polls it forever. Analyses have
    had a sweeper for this since Batch 4; scores never got one, and the failure
    is worse here — an analysis can be recorded again in a minute, while a
    scan that dies has already spent the photograph, the upload and the model
    call.

    Swept to `failed` rather than back to `queued`: nothing would pick a
    requeued row up, since the only thing that starts a read is the request
    that created the score. `failed` is a state the app already renders, with
    "Try reading it again" on it, which starts a new one.
    """
    client = client or get_service_client()
    if client is None:
        return 0
    cutoff = ((now or datetime.now(tz=timezone.utc)) - STUCK_AFTER).isoformat()
    try:
        res = (
            client.table("scores")
            .update(
                {
                    "transcription_status": "failed",
                    "transcription_stage": None,
                    "transcription_error": (
                        "Reading this page stopped before it finished — the "
                        "server restarted while it was working. The photograph "
                        "is still here; try reading it again."
                    ),
                    "updated_at": _now_iso(),
                }
            )
            .in_("transcription_status", ["queued", "reading"])
            .lt("updated_at", cutoff)
            .execute()
        )
    except Exception:  # noqa: BLE001 — one sweep, not every sweep
        log.exception("stuck-transcription sweep failed")
        return 0
    swept = len(res.data or [])
    if swept:
        log.info("swept %d stuck transcription(s) to failed", swept)
    return swept
