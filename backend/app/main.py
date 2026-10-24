import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.config import settings
from app.heavy_reads import HeavyReadGate
from app.logging_config import configure_logging
from app.routers import (
    analyses,
    assignments,
    calibration,
    corrections,
    health,
    me,
    scores,
    studios,
    upload,
)
from app.workers.analysis_runner import (
    SWEEP_INTERVAL_SECONDS,
    sweep_once,
    sweep_stuck_analyses,
)
from app.services.ocr.pipeline import _default_chain, unknown_provider_names
from app.services import pending_uploads
from app.services import reading_rate
from app.services import score_archive
from app.services import take_archive
from app.workers import dispatch, warmup
from app.workers.transcription_runner import sweep_stuck_transcriptions

log = logging.getLogger("intempo")


async def _sweep_periodically() -> None:
    """Recover orphaned analyses for as long as the server is up.

    The startup sweep below handles the crash you restart after. This handles
    the one you don't: a worker thread killed mid-run on a server that keeps
    serving, whose row would otherwise sit in 'processing' until the next
    deploy while a musician waits for a verdict that is never coming.

    `to_thread` because the sweep is a synchronous Supabase call, and running it
    on the event loop would stall every request for its duration.
    """
    while True:
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
        await asyncio.to_thread(sweep_once)
        # Scores as well as analyses, and for the same reason twice over. A
        # read runs in this process too, so anything that ends the process ends
        # it — including a free-tier instance spinning down, which is what
        # leaving the scan screen brings about, since the polling keeping it
        # awake stops with you. `sweep_stuck_transcriptions` contains its own
        # failure, so one bad sweep costs one sweep.
        await asyncio.to_thread(sweep_stuck_transcriptions)
        # And the objects nothing ever claimed. Cheap — an indexed query on a
        # table that is empty in the steady state — and the only path by which
        # an abandoned photograph is ever removed. See
        # `services/pending_uploads` for the invariant it maintains.
        await asyncio.to_thread(pending_uploads.sweep_unclaimed)
        # And the recordings of takes that ended without a verdict, which that
        # sweep cannot see: `POST /v1/analyses` claims the object as it writes
        # the row, so a take that then fails is claimed by a row finished with
        # it and swept by nothing. The one path that deletes a WAV runs only
        # after a verdict is written. See `services/take_archive`.
        await asyncio.to_thread(take_archive.sweep_unjudged_takes)
        # And the originals of takes that *were* judged, an hour after the
        # verdict rather than at it: a link to the WAV handed out just before
        # the Opus was recorded has to keep playing until it expires.
        await asyncio.to_thread(take_archive.sweep_judged_originals)
        # And the scans the reader could not read, which that sweep cannot see
        # either: `POST /v1/scores` claims the photograph as it writes the row,
        # so a reading that fails leaves a titled piece with no notation and a
        # page nothing will ever remove. The shelf offers *try again* and
        # *discard* on the tile; this is for the ones nobody goes back to. See
        # `services/score_archive`.
        await asyncio.to_thread(score_archive.sweep_unreadable_scans)
        # And the rate-limiter's memory of accounts that have stopped scanning.
        #
        # **This is the only caller, and for eleven days there was none.**
        # `ReadingRate.forget_expired` was written with a docstring explaining
        # that without it the dictionary only grows, and then nothing called
        # it — the exact defect this repository keeps finding, in the one shape
        # `check-dead-exports` cannot see, because a method is not a module
        # export. Measured at **849 bytes an account**: 100,000 accounts is
        # 85 MB held forever, on an instance with 512 MB.
        #
        # Purely in-memory, and `to_thread` all the same: it walks every
        # tracked account under a lock, and the doctrine in this loop is that
        # synchronous work does not run on the event loop.
        forgotten = await asyncio.to_thread(reading_rate.readings.forget_expired)
        if forgotten:
            log.info("reading-rate: forgot %d idle account(s)", forgotten)


async def _recover_after_restart() -> None:
    """Recover what the last process left in flight, once the server answers.

    BackgroundTasks don't survive a crash/restart (spec Batch 4 §4), so the jobs
    a dead process was holding have to be found again. **This used to run
    before the server would answer anything**, and on a free instance that is
    in front of every wake: uvicorn accepts no connection until the lifespan
    yields, and the three database round trips here, the first of them opening
    the TLS connection to Supabase at a tenth of a CPU, took 2.2 s on the live
    instance (02:07:34.5 to 02:07:36.8 on 2026-10-24, "Waiting for application
    startup" to "complete"). The app wakes the host on `/v1/health` and holds
    every screen on the answer, so those seconds were added to every cold open.

    Nothing in it has to come first. Each step touches only rows that have
    stood still for minutes — `STUCK_AFTER`, the transcription sweeper's own
    limits, `UNSTARTED_GRACE` — so a request arriving meanwhile is about a row
    it will not touch, and a musician polling a stuck one sees it released a
    second later than before rather than not at all.

    In the order it always ran, each step in a thread and each contained: a
    failed sweep costs that sweep, and an API that will not start because
    recovery failed is strictly worse than one with some rows still stuck.
    """
    steps = (
        ("stuck-analysis sweep", sweep_stuck_analyses),
        ("stuck-transcription sweep", sweep_stuck_transcriptions),
        ("resuming unstarted reads", dispatch.resume_unstarted_reads),
    )
    for name, step in steps:
        try:
            await asyncio.to_thread(step)
        except Exception:  # noqa: BLE001 — never let recovery stop the server
            log.exception("%s failed on startup", name)


def _report_reader_configuration() -> None:
    """Say, at startup, whether this build can read a page at all.

    **A misconfiguration here is invisible until someone scans**, and then it
    does not look like a misconfiguration. `_default_chain` skips a provider
    name this build has never heard of — which is right, a renamed model should
    cost that model and not the feature — but it only says so when a scan runs,
    and if *every* name is stale the musician is simply told their page could
    not be read.

    That is not hypothetical. The shipped default once read
    `claude-sonnet-4-6,claude-opus-4-7`, both names from the previous Claude
    generation, and the service's own logs still show those names being used in
    August. `OCR_PROVIDER_CHAIN` lives in the hosting dashboard, so nothing in
    this repository can tell whether it was ever updated — but one line at
    startup puts the answer in the logs, where it can be read without a scan and
    without shell access.

    Never raises. A server that cannot read a page can still serve every other
    route, and refusing to start would take the app down instead of one feature.
    """
    try:
        chain = [provider.name for provider in _default_chain()]
    except Exception as exc:  # noqa: BLE001 — reporting must not block startup
        log.error(
            "SHEET MUSIC READING IS OFF: %s. Set OCR_PROVIDER_CHAIN to names "
            "this build knows; every scan will otherwise fail.", exc,
        )
        return
    if unknown_provider_names:
        log.warning(
            "reader chain %s; ignoring unknown name(s) %s in "
            "OCR_PROVIDER_CHAIN", chain, unknown_provider_names,
        )
    else:
        log.info("reader chain %s", chain)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    _report_reader_configuration()

    # Jobs the last process died holding, recovered beside the first requests
    # rather than in front of them. See `_recover_after_restart`.
    recovery = asyncio.create_task(_recover_after_restart())

    # The first take in a fresh process used to wait two minutes on numba
    # compiling librosa. The image carries that compiled code now (see the
    # Dockerfile); this reads it back while the musician is still opening the
    # app rather than after they press stop. Only where takes actually run.
    if settings.ANALYSIS_WARMUP and dispatch.ANALYSIS_RUNTIME == "inprocess":
        warmup.warm_in_background()
    # The same idea for a deployment that sends its work elsewhere: the Modal
    # client is ten seconds of import on this instance, and the first page
    # after a restart used to wait for it. See `preload_modal_client`.
    if "modal" in (dispatch.ANALYSIS_RUNTIME, dispatch.TRANSCRIPTION_RUNTIME):
        dispatch.preload_modal_client()

    sweeper = asyncio.create_task(_sweep_periodically())
    try:
        yield
    finally:
        # Without this the task outlives the app under a reloader, and each
        # restart leaves another one sweeping.
        for task in (sweeper, recovery):
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


# ---------------------------------------------------------------------------
# Every request handler in this API is a plain `def`, never `async def`, and
# that is load-bearing.
#
# **What it cost when they were `async def`.** Starlette runs an `async def`
# endpoint *on the event loop* and a plain `def` one in a worker thread. Every
# handler here talks to Supabase through its synchronous client, which blocks
# the calling thread on a socket — so while they were coroutines, the whole API
# served exactly **one request at a time**. Not slowly: serially. A library
# listing held the loop for its round trip to Supabase, and everything else the
# app had asked for — the profile, the analyses, the next poll of a page being
# read — waited behind it rather than running alongside it.
#
# Three things made that far worse than a queue usually is:
#
#   * `/v1/health` queued too. The app wakes this host on `/v1/health` before
#     its first authenticated request and blocks every screen on the answer, so
#     one slow database call did not delay one screen, it delayed all of them.
#   * `POST /v1/calibration` downloads a take and runs librosa over it. That is
#     seconds of CPU with no `await` in it anywhere, during which nothing else
#     was served at all — including the health check Render uses to decide
#     whether this instance is alive.
#   * Creating a score handed the page to Modal over gRPC *in the handler*.
#     A blocking network call, on the loop, in front of the response.
#
# None of it needed the event loop: there is not one `await` in any router.
# They were coroutines by habit, and the cost was the entire server's
# concurrency.
#
# The rule is enforced by `tests/test_no_blocking_handlers.py` rather than left
# as a convention, because the failure it prevents is invisible in development
# — one person clicking around never notices a server that serves one request
# at a time — and shows up only as "the app is stuck" under real use.
# ---------------------------------------------------------------------------
app = FastAPI(title="InTempo API", lifespan=lifespan)

# **A burst of musicians queues instead of killing the instance.** Innermost,
# so compression and CORS wrap whatever it lets through as they wrap everything
# else. See `app/heavy_reads.py` for the measurement and the waiting rules.
app.add_middleware(HeavyReadGate, at_once=settings.HEAVY_READS_AT_ONCE)

# **Compressed, because every byte of these responses crosses a phone's
# connection.** Nothing compressed them: a library listing carries every
# piece's notation and a list of takes carries their bars, both JSON, both
# repetitive, and both went over the air raw. Measured 2026-10-23 on the
# shapes this API returns: a take list shrinks about 19x at level 5, in 15 ms
# per 1.8 MB. Level 5 rather than 9 because the instance has a tenth of a CPU
# and level 9 bought another 20% for six times the work. Small bodies are left
# alone; the header and the round trip are the cost there, not the bytes.
#
# **Level 3, not 5, for the same reason one step further** (measured the same
# day, on the real responses). zlib's levels 1 to 3 share its fast strategy,
# and the cost jumps above them: a 2.5 MB Library listing took 17.6 ms at level
# 5 and 5.3 ms at level 3, for 46 KB against 56; a take list 0.73 ms against
# 0.34, for 4.1 KB against 4.9. On a tenth of a CPU that is 176 ms against 53
# per listing, spent in front of every other request on the instance, to save
# ten kilobytes a phone receives in a few milliseconds. Profiled under load,
# compression was a quarter of the API's own CPU.
#
# Added before CORS so CORS stays outermost and every response — compressed or
# not, error or not — carries its headers.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=3)

# The app and this API are never same-origin — 8081 against 8000 in
# development, a Pages site against wherever this is hosted in production — so
# without this the browser refuses every request before sending it and the app
# shows "Failed to fetch", which names nothing.
#
# `allow_credentials=False` because auth is a bearer token, not a cookie:
# nothing here needs the browser to attach ambient credentials, and asking for
# them would rule out ever using a wildcard origin for no gain.
#
# `Authorization` has to be named explicitly. It is not a CORS-safelisted
# header, so a preflight that omits it fails every authenticated request while
# leaving `/v1/health` working — which looks like an auth bug rather than a
# CORS one.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Covers the hostname Cloudflare gives each deployment, which is not the
    # production alias and is the one its dashboard shows you after a build.
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)

if not settings.CORS_ALLOWED_ORIGINS:
    log.info(
        "CORS_ALLOWED_ORIGINS is not set — allowing localhost development "
        "origins only. A deployed frontend must name its own origin."
    )

app.include_router(health.router, prefix="/v1")
app.include_router(me.router, prefix="/v1")
app.include_router(upload.router, prefix="/v1")
app.include_router(scores.router, prefix="/v1")
app.include_router(analyses.router, prefix="/v1")
# Shares the /analyses prefix; registered after so the more specific
# /analyses/{id}/corrections routes don't shadow /analyses/{id}.
app.include_router(corrections.router, prefix="/v1")
app.include_router(calibration.router, prefix="/v1")
# No prefix collision with anything above: `/assignments` is its own root. The
# teacher tier's way in — see the module docstring for what already existed.
app.include_router(assignments.router, prefix="/v1")
# How a teacher comes to have a studio at all. Registered after assignments
# because it is the thing that makes those endpoints reachable — see its
# docstring.
app.include_router(studios.router, prefix="/v1")


@app.get("/")
def root():
    return {"app": "intempo", "status": "ok"}
