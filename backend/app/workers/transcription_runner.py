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
from datetime import datetime, timezone

from fastapi import HTTPException

from app.db import get_service_client
from app.services.ocr import OCRError, parse_sheet_music
from app.services.ocr.pipeline import STAGE_CONFIRMING, STAGE_ENGINE, STAGE_READING
from app.services.page_image import download_image, media_type_of, readable_url

log = logging.getLogger("intempo.transcription")


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


#: What each pipeline stage is called on a screen someone is watching.
#:
#: Deliberately not the provider's name. "claude-sonnet-4-6" tells a musician
#: nothing they can act on and quite a lot they did not ask about; what they
#: want to know is that something is happening and roughly what. The provider
#: is in the log line either way, which is where the person debugging it looks.
_HUMAN_STAGES = {
    STAGE_ENGINE: "Finding the staves",
    STAGE_CONFIRMING: "Checking the reading",
}

#: The step before the pipeline starts, which the pipeline therefore cannot
#: report: getting the photograph out of storage.
STAGE_FETCHING = "Fetching the page"
STAGE_READING_HUMAN = "Reading the notation"


def _human_stage(stage: str) -> str:
    if stage.startswith(f"{STAGE_READING}:"):
        return STAGE_READING_HUMAN
    return _HUMAN_STAGES.get(stage, STAGE_READING_HUMAN)


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
        score = parse_sheet_music(
            image_bytes,
            media_type=media_type_of(image_bytes, image_url),
            on_stage=report,
        )
    except HTTPException as exc:
        # `page_image` speaks in HTTP status codes because its other caller is
        # a request handler. Here only the sentence matters.
        log.warning("transcription %s: could not fetch the page: %s", score_id, exc.detail)
        _fail(client, score_id, "The photograph could not be fetched from storage.")
        return
    except OCRError as exc:
        log.warning("transcription %s: %s", score_id, exc)
        _fail(
            client,
            score_id,
            "The notation could not be read from this photograph. "
            "A flatter, better-lit shot of the page usually fixes it.",
        )
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
