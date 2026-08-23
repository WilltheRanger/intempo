"""The analysis worker — Phase 1: called via FastAPI `BackgroundTasks`.

`run_analysis` is a plain SYNC function on purpose:

- FastAPI runs a sync background task in a worker thread (Starlette's
  threadpool), so the CPU-bound `analyze()` never blocks the event loop
  — which is the #1 Batch 4 pitfall. No `run_in_executor` gymnastics
  needed.
- The Supabase client is sync anyway.
- The body is structured so the Celery migration is mechanical: add a
  `@celery_app.task` decorator and swap `add_task` → `.delay` at the
  call site. The DB writes, result shape, and exception handling don't
  change (see the "Migration to Celery" subsection in the spec).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.db import get_service_client
from app.models.analysis import Instrument
from app.services import audio as audio_svc
from app.services.analysis import analyze
from app.services.score_schema import ScoreJson

log = logging.getLogger("intempo.analysis")

# Audio for a 4-min take is ~2 MB AAC / ~10 MB WAV; cap with headroom.
MAX_AUDIO_BYTES = 25 * 1024 * 1024
AUDIO_DOWNLOAD_TIMEOUT = 20.0


class AudioFetchError(Exception):
    """Raised when the recording can't be pulled from storage."""


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def download_audio(url: str) -> bytes:
    """Fetch a recording from its (already ownership-validated) storage URL."""
    try:
        with httpx.Client(timeout=AUDIO_DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
            response = client.get(url)
    except httpx.RequestError as exc:
        raise AudioFetchError(f"download failed: {exc}") from exc
    if response.status_code != 200:
        raise AudioFetchError(f"download returned status {response.status_code}")
    body = response.content
    if len(body) > MAX_AUDIO_BYTES:
        raise AudioFetchError(f"audio larger than {MAX_AUDIO_BYTES} bytes")
    return body


def run_analysis(analysis_id: str) -> None:
    """Load audio + score, run `analyze()`, write the result back to the row.

    Phase 2 (Celery): this same function gets `@celery_app.task` on top and
    the enqueue site becomes `run_analysis.delay(analysis_id)`. Body unchanged.
    """
    client = get_service_client()
    if client is None:
        log.error("analysis %s: no service-role client configured", analysis_id)
        return

    row = _fetch_analysis(client, analysis_id)
    if row is None:
        log.error("analysis %s: row missing", analysis_id)
        return

    _update(client, analysis_id, {"status": "processing", "updated_at": _now_iso()})

    try:
        audio_bytes = download_audio(row["audio_url"])
        score = _load_score(client, row["score_id"], row["user_id"])
        y, sr = audio_svc.load_audio_bytes(audio_bytes)
        # The one caller that has ever set this. `analyze()` has taken a
        # `double_bass` flag since Batch 3 — a high-pass filter and a lower
        # onset threshold for the register where attacks are softest and the
        # detector is weakest — and nothing had ever turned it on, so every
        # bass player was analysed with settings tuned for treble strings.
        #
        # Read from the row rather than passed in: the work happens after the
        # response is sent, so the row is the only thing that survives.
        result = analyze(
            (y, sr),
            score,
            float(row["target_bpm"]),
            double_bass=row.get("instrument") == Instrument.double_bass.value,
        )
    except AudioFetchError as exc:
        log.warning("analysis %s: %s", analysis_id, exc)
        _finish_failed(client, analysis_id, "audio_unavailable")
        return
    except Exception:  # noqa: BLE001 — any pipeline error → failed, never a silent hang
        log.exception("analysis %s: internal error", analysis_id)
        _finish_failed(client, analysis_id, "internal_error")
        return

    _update(
        client,
        analysis_id,
        {
            "status": "done",
            "result_json": result.model_dump(mode="json"),
            "alignment_quality": result.quality,
            "failure_reason": None,
            "finished_at": _now_iso(),
            "updated_at": _now_iso(),
        },
    )


def _fetch_analysis(client, analysis_id: str) -> dict | None:
    res = client.table("analyses").select("*").eq("id", analysis_id).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None


def _load_score(client, score_id: str, user_id: str) -> ScoreJson:
    res = (
        client.table("scores")
        .select("score_json")
        .eq("id", score_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise ValueError(f"score {score_id} not found for user {user_id}")
    return ScoreJson.model_validate(rows[0]["score_json"])


def _update(client, analysis_id: str, patch: dict) -> None:
    client.table("analyses").update(patch).eq("id", analysis_id).execute()


def _finish_failed(client, analysis_id: str, reason: str) -> None:
    _update(
        client,
        analysis_id,
        {"status": "failed", "failure_reason": reason, "updated_at": _now_iso()},
    )


# In-process BackgroundTasks don't survive a crash/restart: a job that was
# 'processing' when the server died would spin forever in the UI. Any
# 'queued'/'processing' row older than this window is marked
# 'failed_recoverable' so the client can offer a retry (spec Batch 4 §4).
STUCK_AFTER = timedelta(minutes=10)

#: How often to look, once the server is up.
#:
#: The sweep used to run **only** at startup, which recovers exactly one class
#: of failure: the crash you restart after. It does nothing for a server that
#: stays up — a worker thread killed by the OOM reaper, a `_update` to 'done'
#: that fails, a task that never returns — and those rows then spin in the UI
#: until the next deploy, which could be weeks. A musician waiting on a verdict
#: gets no answer and no error.
#:
#: Half of `STUCK_AFTER`, so nothing waits longer than about fifteen minutes
#: for an answer it is never going to get.
SWEEP_INTERVAL_SECONDS = 5 * 60


def sweep_stuck_analyses(client=None, *, now: datetime | None = None) -> int:
    """Recover crashed-mid-analysis rows. Returns how many were swept."""
    client = client or get_service_client()
    if client is None:
        return 0
    cutoff = ((now or datetime.now(tz=timezone.utc)) - STUCK_AFTER).isoformat()
    res = (
        client.table("analyses")
        .update(
            {
                "status": "failed_recoverable",
                "failure_reason": "server restarted while analyzing — please retry",
                "updated_at": _now_iso(),
            }
        )
        .in_("status", ["queued", "processing"])
        .lt("updated_at", cutoff)
        .execute()
    )
    swept = len(res.data or [])
    if swept:
        log.info("swept %d stuck analysis row(s) to failed_recoverable", swept)
    return swept


def sweep_once() -> int:
    """One sweep, with its failure contained.

    Split out so the periodic loop cannot die: a transient Supabase error must
    cost one sweep, not every sweep for the lifetime of the process. Returns 0
    when it failed, which is indistinguishable from "nothing to sweep" — and
    that is fine, because the caller's only job either way is to try again.
    """
    try:
        return sweep_stuck_analyses()
    except Exception:  # noqa: BLE001 — the loop outlives any one failure
        log.exception("stuck-analysis sweep failed")
        return 0
