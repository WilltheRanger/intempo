import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.routers import analyses, calibration, health, me, scores, upload
from app.workers.analysis_runner import sweep_stuck_analyses

log = logging.getLogger("intempo")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # BackgroundTasks don't survive a crash/restart, so recover any job
    # orphaned mid-analysis before we start serving (spec Batch 4 §4).
    try:
        sweep_stuck_analyses()
    except Exception:  # noqa: BLE001 — never let recovery block startup
        log.exception("stuck-analysis sweep failed on startup")
    yield


app = FastAPI(title="InTempo API", lifespan=lifespan)
app.include_router(health.router, prefix="/v1")
app.include_router(me.router, prefix="/v1")
app.include_router(upload.router, prefix="/v1")
app.include_router(scores.router, prefix="/v1")
app.include_router(analyses.router, prefix="/v1")
app.include_router(calibration.router, prefix="/v1")


@app.get("/")
def root():
    return {"app": "intempo", "status": "ok"}
