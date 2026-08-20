import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from app.routers import analyses, calibration, corrections, health, me, scores, upload
from app.workers.analysis_runner import (
    SWEEP_INTERVAL_SECONDS,
    sweep_once,
    sweep_stuck_analyses,
)

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


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # BackgroundTasks don't survive a crash/restart, so recover any job
    # orphaned mid-analysis before we start serving (spec Batch 4 §4).
    try:
        sweep_stuck_analyses()
    except Exception:  # noqa: BLE001 — never let recovery block startup
        log.exception("stuck-analysis sweep failed on startup")

    sweeper = asyncio.create_task(_sweep_periodically())
    try:
        yield
    finally:
        # Without this the task outlives the app under a reloader, and each
        # restart leaves another one sweeping.
        sweeper.cancel()
        with suppress(asyncio.CancelledError):
            await sweeper


app = FastAPI(title="InTempo API", lifespan=lifespan)
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
