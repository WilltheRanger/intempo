import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.logging_config import configure_logging
from app.routers import analyses, calibration, corrections, health, me, scores, upload
from app.workers.analysis_runner import (
    SWEEP_INTERVAL_SECONDS,
    sweep_once,
    sweep_stuck_analyses,
)
from app.services.ocr.pipeline import _default_chain, unknown_provider_names
from app.services import pending_uploads
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

    # BackgroundTasks don't survive a crash/restart, so recover any job
    # orphaned mid-analysis before we start serving (spec Batch 4 §4).
    try:
        sweep_stuck_analyses()
    except Exception:  # noqa: BLE001 — never let recovery block startup
        log.exception("stuck-analysis sweep failed on startup")
    try:
        sweep_stuck_transcriptions()
    except Exception:  # noqa: BLE001 — never let recovery block startup
        log.exception("stuck-transcription sweep failed on startup")

    sweeper = asyncio.create_task(_sweep_periodically())
    try:
        yield
    finally:
        # Without this the task outlives the app under a reloader, and each
        # restart leaves another one sweeping.
        sweeper.cancel()
        with suppress(asyncio.CancelledError):
            await sweeper


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


@app.get("/")
def root():
    return {"app": "intempo", "status": "ok"}
