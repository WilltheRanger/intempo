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

from app.models.score import TRANSCRIPTION_IN_PROGRESS
from app.config import settings
from app.db import get_service_client
from app.services.ocr import OCRError, parse_sheet_music
from app.services.ocr.tempo_marks import with_tempo_marks
from app.services.ocr.pages import join_pages
from app.services.score_pages import PAGE_COLUMNS, pages_of
from app.services.storage_origin import storage_origin
from app.services.ocr.pipeline import (
    STAGE_CONFIRMING,
    STAGE_READING,
    STAGE_SPLITTING,
)
from app.services.page_image import (
    download_image,
    object_key_from,
    prepare_for_model,
    readable_url,
    store_display_copy,
    too_small_to_read,
)

log = logging.getLogger("intempo.transcription")

#: How many pages may be read at once, process-wide.
#:
#: **A memory ceiling, not a throughput knob.** This work reached here through
#: `BackgroundTasks` when the limit was written — Starlette's threadpool, 40
#: threads, no count kept — so without it, forty people scanning at once meant
#: forty simultaneous transcriptions. `dispatch._reading` is the pool now and
#: sizes itself from this same number; the ceiling is enforced twice, at the
#: door and around the work.
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


def _reading_page(page_number: int, total: int) -> str:
    """The words for the page a multi-page scan is on — `Reading page 2 of 3`.

    **A count, in the words, because there is no other way to say it.** A scan
    is every page of one part and they are read one after another, so a
    seven-page part is seven times the wait a one-page part was. All of it used
    to report "Reading the notation" — true from the first page to the last, and
    a bar that did not move once across the whole of it. The comment in
    `_read_one_page` called that "a limitation rather than a design" and named
    this as the fix, waiting on the UI gate; the gate was given on 2026-08-29.

    The app reads the count as pages *finished*, so this places the bar at
    `(n - 1) / total` of the reading band — page 2 means page 1 is read and page
    2 has not started. See `fixtures/stages/parity.json`, which both sides are
    tested against.
    """
    return f"Reading page {page_number} of {total}"


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
        # An imported file, not a photograph — so the default advice about a
        # flatter, better-lit shot is not merely unhelpful here, it describes
        # a step that does not exist in this flow. The refusal itself is
        # deliberate: `score_json_from_musicxml` will not expand XML entities,
        # because a small file defining nested ones expands to gigabytes and
        # takes the API down. Re-exporting is the real way out, and every
        # notation program writes entity-free MusicXML.
        # Lowercase, because `_why_it_failed` lowercases the haystack and
        # not the needle — a capitalised needle matches nothing, ever,
        # which is the third time this table has been given one that
        # could not fire.
        "defines xml entities",
        "This file defines XML entities, which InTempo does not read. Exporting "
        "it again from your notation software produces one it can.",
    ),
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
    #: Every way the *server* can be wrong, before the photograph is blamed.
    #:
    #: These are the ones that matter most, because the default answer sends a
    #: musician back to re-photograph a page — and on a configuration fault they
    #: will do it, and it will fail again, and again. Measured against the
    #: running service: three of these four reached the default.
    (
        "not installed",
        "This page could not be read because the machine that reads them could "
        "not be reached. That is a fault on our side, not with your "
        "photograph — the photograph is still here, so try reading it again "
        "in a few minutes.",
    ),
    (
        "api key",
        "The transcription service is not configured. This is a fault on our "
        "side, not with your page.",
    ),
    (
        "authentication",
        "The transcription service rejected our credentials. This is a fault "
        "on our side, not with your page.",
    ),
    (
        "no usable provider",
        "The transcription service is not configured correctly. This is a "
        "fault on our side — your page is fine, and re-photographing it will "
        "not help.",
    ),
    (
        "chain is empty",
        "The transcription service is not configured correctly. This is a "
        "fault on our side — your page is fine, and re-photographing it will "
        "not help.",
    ),
    (
        # The third member of that family, and it was missing while its two
        # siblings above were here. `OCR_PROVIDER_CHAIN=gpt4v` on a deployment
        # is a typo in an environment variable, and every scan on it told the
        # musician their photograph was the problem.
        "unknown provider",
        "The transcription service is not configured correctly. This is a "
        "fault on our side — your page is fine, and re-photographing it will "
        "not help.",
    ),
    (
        # **The predictable runtime failure of this reader.** homr peaks at
        # 1350 MB, measured, which is why it runs on Modal and not on the API
        # host. A container that runs out of memory arrives here as an
        # exception name and text, through the `{type(exc).__name__}: {exc}`
        # channel that can carry anything — so the specific one worth naming is
        # the one the sizing note predicts.
        "out of memory",
        "The machine that reads pages ran out of room on this one. That is a "
        "fault on our side, not with your photograph — the photograph is "
        "still here, so try reading it again.",
    ),
    (
        # Reached only through homr: `score_json_from_musicxml` is run on the
        # reader's *own* output, so unparseable XML here is the reader
        # misbehaving. The import route raises the same words at a musician's
        # file, but that path answers with a 422 and never reaches this table.
        "not parseable as xml",
        "The reader produced notation this app could not read back. That is a "
        "fault on our side, not with your photograph — try reading it again.",
    ),
    (
        # `join_pages` with nothing to join. An internal invariant, and a
        # musician cannot photograph their way out of one.
        "nothing to join",
        "Something went wrong assembling this scan. That is a fault on our "
        "side, not with your photographs — try reading it again.",
    ),
    #: The two ways a page can be *found* and still not be readable. Both say
    #: so, because the default sends the musician back to re-photograph a page
    #: that will fail the same way — and both name a route that exists, which
    #: is the rule the 413 message broke.
    (
        # homr raises this after its segmentation has found staff-line ink and
        # its notehead model has found **zero noteheads on the whole page**
        # (`homr/main.py`, before the staff check, which is why a sideways page
        # does not land here — that one raises "No staffs found" and is
        # re-tried turned). Measured on `05_handwritten_messy`, and pre-
        # processing the page — 2x upscale, autocontrast, both — moved it not
        # at all. It is a limit of the model on handwriting, not a photograph
        # that came out badly, so the default sentence would send a musician
        # back to the stand for a page that cannot get past this however well
        # it is shot.
        "noteheads",
        "The staves on this page were found but none of the notes on them "
        "were. Handwritten music is the usual cause — this reader is trained "
        "on printed notation. Importing a MusicXML file, or entering the piece "
        "by hand, both work.",
    ),
    (
        "came out empty",
        "Most of this page came back blank — its barlines were found but the "
        "notes between them were not. Handwritten or faint pages are the usual "
        "cause. A darker, sharper photograph is worth one try; after that, "
        "importing a MusicXML file or entering the piece by hand both work.",
    ),
    (
        "could be read as music",
        "The notation on this page was found but could not be read — none of "
        "its bars came out as music that adds up. Handwritten or heavily "
        "marked pages are the usual cause. Importing a MusicXML file, or "
        "entering the piece by hand, both work.",
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

    Underscores **and hyphens** are flattened to spaces before matching: these
    strings come from several places — exception text, environment variable
    names, SDK error classes, HTTP header names — and `GEMINI_API_KEY`,
    `x-api-key` and "api key" are the same fact written three ways. Matching the
    prose form only would have silently missed the one that actually appears in
    the log.

    The hyphen was the half of that argument that never got written down, and it
    cost exactly what the argument predicts: an Anthropic `AuthenticationError:
    invalid x-api-key` — a wrong or expired key, entirely our fault — fell
    through to "a flatter, better-lit shot of the page usually fixes it".
    """
    haystack = detail.lower().replace("_", " ").replace("-", " ")
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

    pages = pages_of(row)
    if not pages:
        _fail(client, score_id, "There was no photograph to read.")
        return

    # Wait for a slot before claiming to be reading anything. The row stays
    # `queued` while it waits, which is the truth rather than a euphemism —
    # and it means a second person scanning during a busy minute sees "queued"
    # rather than a progress bar that has not moved.
    with _scan_slots:
        _read_pages(client, score_id, pages)


#: Said when this process has no reader in it at all.
#:
#: The chain is homr alone, and homr is installed **only in the Modal
#: container** — so on the API host there is now nothing that can read a page.
#: That is the accepted cost of dropping the vision backup, and the one thing
#: it must not do is arrive as `_UNKNOWN_REASON`: "a flatter, better-lit shot
#: of the page usually fixes it" is a confident wrong reason that sends a
#: musician to re-photograph a page for a fault that is entirely ours, and this
#: project has shipped that sentence for a server fault twice already.
_NO_READER_HERE = (
    "This page could not be read because the machine that reads them could not "
    "be reached. That is a fault on our side, not with your photograph — the "
    "photograph is still here, so try reading it again in a few minutes."
)


def _nothing_here_can_read() -> bool:
    """True when not one provider in the configured chain exists in this process.

    Checked **before the page is downloaded**. The alternative is to fetch
    several megabytes, prepare them, and then discover that the only provider
    named is not installed — paying for the download to arrive at a worse
    error, since "homr is not installed in this container" matches no entry in
    `_FAILURE_REASONS` and lands on the sentence that blames the photograph.
    """
    from app.services.ocr.pipeline import _default_chain

    try:
        chain = _default_chain()
    except Exception:  # noqa: BLE001 — an unresolvable chain is reported elsewhere
        return False

    if not chain:
        return True
    for provider in chain:
        available = getattr(provider, "available", None)
        # A provider that does not declare availability is one reached over the
        # network with a key, and whether *that* works is not knowable from
        # here. Only a provider that says outright it is absent counts.
        if not callable(available) or available():
            return False
    return True


def _read_pages(client, score_id: str, urls: list[str]) -> None:
    """Every page of one part, joined into one piece of music.

    **All-or-nothing, and the failure names the page.** A score assembled out
    of the pages that happened to read is a timeline with a silent hole in it,
    and `alignment.py` accumulates durations — so every bar after the gap is
    judged against music that is not there, and the musician is told they
    rushed a passage they played correctly. Naming the page is what makes the
    failure actionable: one page gets re-photographed, not the whole part.
    """
    if _nothing_here_can_read():
        log.error(
            "transcription %s: no provider in the chain is installed in this "
            "process; refusing before the page is fetched",
            score_id,
        )
        _fail(client, score_id, _NO_READER_HERE)
        return

    _update(
        client,
        score_id,
        {"transcription_status": "reading", "transcription_stage": STAGE_FETCHING},
    )

    readings = []
    for page_number, image_url in enumerate(urls, start=1):
        page_score = _read_one_page(client, score_id, image_url, page_number, len(urls))
        if page_score is None:
            return
        readings.append(page_score)

    try:
        score = join_pages(readings)
    except Exception:  # noqa: BLE001 — anything at all beats a row stuck reading
        log.exception("transcription %s: could not join %d pages", score_id, len(readings))
        _fail(client, score_id, "Something went wrong assembling the pages.")
        return

    from app.services.ocr.pipeline import configured_reader

    finished = {
        "score_json": score.model_dump(mode="json"),
        "ocr_confidence": score.ocr_confidence,
        "transcription_status": "done",
        "transcription_stage": None,
        "transcription_error": None,
    }
    # **Attempted with the reader's name, retried without it.** `_update`
    # swallows a failed write so a lost stage update cannot end a run — which is
    # right for a stage and catastrophic here, because this is the write that
    # stores the transcription and moves the row off `reading`. A database
    # without 013 rejects the whole statement over one unknown column, and the
    # scan would sit reading forever until the sweeper gave up on it.
    _update(
        client,
        score_id,
        {**finished, "transcription_reader": configured_reader()},
        fallback=finished,
    )
    log.info(
        "transcription %s: %d page(s), %d measures, confidence %.2f",
        score_id,
        len(urls),
        len(score.measures),
        score.ocr_confidence,
    )


def _read_one_page(
    client, score_id: str, image_url: str, page_number: int, total: int
):
    """One page, or None having already written the failure to the row."""
    single = total == 1

    def _failed(sentence: str) -> None:
        # The page is named only when there is a choice of page to name. On a
        # one-page scan "Page 1 of 1:" is noise in front of every error message
        # in the app.
        _fail(
            client,
            score_id,
            sentence if single else f"Page {page_number} of {total}: {sentence}",
        )

    def report(stage: str) -> None:
        # **A multi-page scan reports the page it is on and nothing finer, and
        # that is a limitation rather than a design.**
        #
        # The bar's positions are keyed on the worker's words and rise in the
        # order the worker reaches them (`fixtures/stages/parity.json`). Page 2
        # starting over at "Finding the staves" — 0.3, after page 1 left the bar
        # at 0.9 — walks it backwards, which reads as the scan having restarted
        # and is the exact failure `transcriptionProgress.ts` exists to prevent.
        #
        # The honest fix is a page counter in the words, the way a stave count
        # already works: `Reading page 2 of 3`. That is new copy on a screen, so
        # it waits for the owner's approval under the UI gate. Until then a
        # multi-page read reports "Reading the notation" for the whole of it —
        # coarse, true throughout, and monotone.
        if single:
            _update(client, score_id, {"transcription_stage": _human_stage(stage)})

    if not single:
        # The page counter, in place of the per-stave one. Suppressing the
        # stave reports is what keeps the two from fighting over the bar: page
        # 2 opening at "Reading stave 1 of 9" after page 1 finished at "9 of 9"
        # walks it backwards, which is exactly what `transcriptionProgress.ts`
        # exists to prevent.
        _update(
            client,
            score_id,
            {"transcription_stage": _reading_page(page_number, total)},
        )

    try:
        fetch_url = readable_url(image_url)
        # **The origin check `download_image` documents only runs if a caller
        # passes one**, and this — the only caller in the application — passed
        # nothing, so the redirect guard it grew after a review has never
        # executed in production. Both shapes `readable_url` can return are on
        # the storage host: a URL it freshly signed, or the stored
        # `_durable_image_url`, which `scores._durable_image_url` builds from a
        # validated key against `SUPABASE_URL`. So the approved origin is that
        # one, and a 302 away from it is the thing being refused.
        #
        # `storage_origin` answers None when the deployment has no
        # `SUPABASE_URL`, which disables the comparison — the behaviour this
        # line replaces, so a Modal container without it is no worse off.
        image_bytes = download_image(
            fetch_url, expected_origin=storage_origin(settings.SUPABASE_URL)
        )
        # **Nothing is rotated here, and that is a correction.**
        #
        # A previous version turned pages it judged sideways. It judged wrongly
        # on the page it was written for: EXIF orientation had *already* put
        # that photograph the right way up, and what looked sideways was the raw
        # pixels before the tag is applied — which `_inked` applies and I did
        # not. Measured against real homr on that exact page: as stored it finds
        # **5 staffs, 25 measures, 112 notes**; rotated either way it finds
        # **none**. The heuristic took a page homr reads and broke it.
        #
        # Orientation is homr's problem, and homr is better at it than a
        # band-count heuristic — it dewarps and finds its own staves. When it
        # cannot, it says so, and `HomrProvider` turns the page and asks again.
        # Normalise before anything reads it. A page arrives from a phone
        # rotated by an EXIF flag, several megabytes, and 3000-4000px on the
        # long edge — none of which any provider was ever tested against, and
        # every one of which fails in a way that says nothing about the page.
        # See `prepare_for_model`.
        # Before any provider sees it, and on the photograph as it arrived
        # rather than the prepared copy — resizing up to `MODEL_MAX_EDGE` adds
        # pixels and no detail, so the only question is what was photographed.
        #
        # A page whose staff lines cannot be resolved is not a hard page, it is
        # not a page. Every stage below this one would still succeed on it: the
        # systems are found by ink density and a row of notation is dense at any
        # size, so eight crops go out and something comes back. What comes back
        # is invented, and there is nothing further down that can tell.
        unreadable = too_small_to_read(image_bytes)
        if unreadable:
            # **The sentence already carries the number**, and the pixel size
            # with it — that is why they were put in it. Calling
            # `staff_space_px` here as well decoded the photograph and re-ran
            # the entire measurement a second time, on the one path where the
            # image is by definition a large one somebody just uploaded, to
            # print a figure this string already contains.
            log.info(
                "transcription %s: refusing page %d: %s",
                score_id,
                page_number,
                unreadable,
            )
            _failed(unreadable)
            return None
        page, media_type = prepare_for_model(image_bytes)
        # **The display copy, written from bytes that already exist.**
        #
        # This is the same JPEG the reader is about to be given: decoded once,
        # EXIF-rotated once, resized once to `MODEL_MAX_EDGE`. It used to be
        # dropped on the floor after the read, and the app went on downloading
        # the 5712x4284 photograph to show on a 390-point screen.
        #
        # Best effort by construction — `store_display_copy` never raises, and
        # a page without one still displays, because `signed_display_urls`
        # falls back to the photograph. Every page scanned before this existed
        # takes that path permanently.
        page_key = object_key_from(image_url)
        if page_key:
            store_display_copy(page_key, page, image_bytes)
        # The prepared page is what gets *read* whole and what the systems are
        # detected on; the crops are cut from the photograph itself, so each
        # system spends the whole size budget on its own long edge. See
        # `crop_systems`' `source` — without it a crop carries no more detail
        # than the page it came from, which is the entire point of the cut.
        score = parse_sheet_music(
            page, media_type=media_type, on_stage=report, source=image_bytes
        )
        # The words homr does not read — "poco rit.", "a tempo", "♩ = 88" —
        # asked of a vision model when the reading has none. Never raises: a
        # page whose words could not be read is kept as it was read.
        score = with_tempo_marks(
            score,
            page,
            media_type=media_type,
            source=image_bytes,
            first_page=page_number == 1,
        )
    except HTTPException as exc:
        # `page_image` speaks in HTTP status codes because its other caller is
        # a request handler. Here only the sentence matters.
        log.warning(
            "transcription %s: could not fetch page %d: %s",
            score_id, page_number, exc.detail,
        )
        _failed("The photograph could not be fetched from storage.")
        return None
    except OCRError as exc:
        log.warning("transcription %s: page %d: %s", score_id, page_number, exc)
        _failed(_why_it_failed(str(exc)))
        return None
    except Exception:  # noqa: BLE001 — anything at all beats a row stuck reading
        log.exception("transcription %s: internal error on page %d", score_id, page_number)
        _failed("Something went wrong reading this page.")
        return None

    return score


#: The row this worker needs, in the two shapes the database may have. A failed
#: fetch here leaves the row `reading` with nobody coming back for it, which is
#: why the narrower shape has to exist — see `score_pages.PAGE_COLUMNS`.
_SCORE_COLUMNS = tuple(f"id, user_id, {pages}" for pages in PAGE_COLUMNS)


def _fetch_score(client, score_id: str) -> dict | None:
    for index, columns in enumerate(_SCORE_COLUMNS):
        try:
            res = (
                client.table("scores")
                .select(columns)
                .eq("id", score_id)
                .limit(1)
                .execute()
            )
        except Exception:  # noqa: BLE001 — try the narrower shape before giving up
            if index == len(_SCORE_COLUMNS) - 1:
                raise
            log.warning(
                "transcription %s: `%s` was refused; falling back to the "
                "pre-011 columns and reading page one only",
                score_id,
                columns,
            )
            continue
        rows = res.data or []
        return rows[0] if rows else None
    return None


def _update(client, score_id: str, patch: dict, *, fallback: dict | None = None) -> None:
    """Write one patch, and never let a failed write end the run.

    A stage update is a courtesy to whoever is watching; losing one costs a
    line of text. Losing the transcription because storage hiccuped while
    reporting progress would be an absurd trade, so this swallows rather than
    raises — and the terminal writes are logged loudly enough to notice.

    `fallback` is a second, narrower patch to try when the first is refused. It
    exists for the deploy window in front of a migration: PostgREST rejects the
    whole statement over one column the database has not got, and swallowing
    that on the write which stores the transcription would leave the row
    `reading` forever. Same reasoning as `score_pages.PAGE_COLUMNS`, at the one
    other place a write names a new column.
    """
    for attempt in (patch, fallback):
        if attempt is None:
            continue
        try:
            client.table("scores").update({**attempt, "updated_at": _now_iso()}).eq(
                "id", score_id
            ).execute()
            return
        except Exception:  # noqa: BLE001
            if attempt is patch and fallback is not None:
                log.warning(
                    "transcription %s: retrying without %s",
                    score_id,
                    sorted(set(patch) - set(fallback)),
                )
                continue
            log.warning(
                "transcription %s: could not write %s",
                score_id, sorted(attempt), exc_info=True,
            )


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

#: How long to wait before failing a read that was handed to Modal.
#:
#: **Because "nothing has happened yet" is not the same fact on both sides.**
#: In-process, a row with no progress for ten minutes means the process that was
#: reading it is gone — the reader threads are in this process, so there is
#: nothing else it could be waiting for. On Modal the row sits `queued` for the whole of a cold
#: start, and a cold start is not a hang: Modal builds an image lazily, on first
#: invocation, and this one installs homr and 151 MB of ONNX weights. That is
#: minutes.
#:
#: At ten minutes the sweeper would fail the **first page ever read on Modal**,
#: while Modal was still building the container to read it, and tell the
#: musician the server had restarted — which is both wrong and the worst
#: possible first impression of a system that is working.
#:
#: Thirty is a real dead read lingering twenty minutes longer than it used to.
#: That is the right side to be wrong on: a dead row costs a musician a retry
#: they can see, and killing a live one costs them the photograph, the upload,
#: the wait, and their belief that the thing works.
STUCK_AFTER_REMOTE = timedelta(minutes=30)


def _stuck_after() -> timedelta:
    """The cutoff for however this deployment reads pages."""
    from app.workers.dispatch import TRANSCRIPTION_RUNTIME

    return STUCK_AFTER_REMOTE if TRANSCRIPTION_RUNTIME == "modal" else STUCK_AFTER


#: A read Modal says is still in flight. Not an error string, so it can never
#: be written into `transcription_error` by accident.
_STILL_RUNNING = object()

#: What the sweeper says when it has nothing better. Unchanged, and now only
#: reached when there is genuinely nothing to ask: a page read in-process, a row
#: from before `transcription_call_id` existed, or a Modal that will not answer.
_SWEPT_WITHOUT_A_REASON = (
    "Reading this page stopped before it finished. The photograph is still "
    "here; try reading it again."
)


def _modal_verdict(call_id: str | None):
    """What Modal says became of this read.

    Returns `_STILL_RUNNING`, or the sentence to put in `transcription_error`.

    **The whole point is the middle case.** A container that dies before its
    first write — a bad secret, an image that will not import, an OOM at
    start-up — leaves the row exactly as a slow read leaves it, and the sweeper
    has been reporting both as "stopped before it finished". Modal remembers the
    exception long after the container is gone, and asking costs one call.

    **Fails to the old guess, never to leaving a row stuck.** If Modal is
    unreachable, or the client is a version whose API differs, this returns the
    sentence it always returned. A musician waiting on a progress bar is not
    helped by our being unsure, and a row that is never swept is the bug the
    sweeper was written to fix.
    """
    if not call_id:
        return _SWEPT_WITHOUT_A_REASON
    try:
        import modal

        from app.workers.dispatch import clean_modal_credentials

        clean_modal_credentials()
        # `timeout=0` asks without waiting: a call still running raises rather
        # than blocking the sweep behind somebody else's page.
        modal.FunctionCall.from_id(call_id).get(timeout=0)
    except ImportError:
        return _SWEPT_WITHOUT_A_REASON
    except Exception as exc:  # noqa: BLE001 — every outcome arrives as one
        if _is_still_running(exc):
            return _STILL_RUNNING
        # The remote failure, named. `_why_it_failed` already knows how to turn
        # "not installed", "api key" and the rest into something a musician can
        # act on — and how to say "this is our fault, not your photograph"
        # rather than sending them to re-shoot a page that was never wrong.
        return _why_it_failed(f"{type(exc).__name__}: {exc}")
    # It finished, and did not write the row. Nothing here can produce the
    # notes, so the read is over — but the reason is emphatically not the
    # photograph, and saying so would send someone to re-shoot a good page.
    return (
        "This page was read but the result never arrived. That is a fault on "
        "our side, not with your photograph — try reading it again."
    )


def _is_still_running(exc: BaseException) -> bool:
    """Whether this exception means "not finished yet" rather than "failed".

    Matched on the **name**, not the class, because the class lives in a Modal
    module whose path has moved between versions and importing it to compare
    would make a version bump silently reclassify every in-flight read as a
    failure. A name that says timeout is Modal declining to wait, which is what
    `timeout=0` asked for.
    """
    name = type(exc).__name__.lower()
    return "timeout" in name or "notfinished" in name


def sweep_stuck_transcriptions(client=None, *, now: datetime | None = None) -> int:
    """Fail reads that stopped happening. Returns how many were swept.

    **The hole this fills, reported from a phone.** A musician photographed a
    page, left the screen, and came back to "Reading the notation" with the
    progress bar part-filled — permanently. Nothing was reading it. Nothing was
    ever going to.

    `run_transcription` runs on one of `dispatch`'s reader threads, which is to
    say *in the web process*, so anything that ends the process ends the read —
    and so does anything that ends it while the id is still queued. A deploy, the
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

    **A row that names a Modal call is asked about before it is failed.**
    Sweeping is a guess — "it stopped happening" — and that guess has now been
    shown to a musician for two entirely different faults without either being
    diagnosed. Modal keeps the outcome of a call long after the container is
    gone, so where there is a call id there is a real answer: still running,
    or a named exception. Only a row with no answer available gets the guess.
    """
    client = client or get_service_client()
    if client is None:
        return 0
    cutoff = ((now or datetime.now(tz=timezone.utc)) - _stuck_after()).isoformat()
    try:
        stuck = (
            client.table("scores")
            .select("id, transcription_call_id")
            .in_("transcription_status", sorted(TRANSCRIPTION_IN_PROGRESS))
            .lt("updated_at", cutoff)
            .execute()
        ).data or []
    except Exception:  # noqa: BLE001 — one sweep, not every sweep
        log.exception("stuck-transcription sweep failed")
        return 0

    swept = 0
    for row in stuck:
        verdict = _modal_verdict(row.get("transcription_call_id"))
        if verdict is _STILL_RUNNING:
            # Not stuck — working, and slower than the cutoff. Failing this
            # would throw away a read that is about to succeed, which is worse
            # than leaving the progress screen up a little longer.
            continue
        try:
            client.table("scores").update(
                {
                    "transcription_status": "failed",
                    "transcription_stage": None,
                    "transcription_error": verdict,
                    "updated_at": _now_iso(),
                }
            ).eq("id", row["id"]).in_(
                "transcription_status", sorted(TRANSCRIPTION_IN_PROGRESS)
            ).execute()
        except Exception:  # noqa: BLE001 — one row, not the whole sweep
            log.exception("score %s: could not be swept", row.get("id"))
            continue
        swept += 1

    if swept:
        log.info("swept %d stuck transcription(s) to failed", swept)
    return swept
