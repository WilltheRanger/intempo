"""Where an analysis actually runs, decided in one place.

`create_analysis` should not know. It writes a row and asks for the work to
happen; whether that happens in this process or on another machine is a
deployment fact, and deployment facts that leak into request handlers are how
you end up unable to change them.

**Why there is a choice at all.** The instance this deploys to has 512 MB for
the *whole* application, and one analysis peaks near 460 — so two musicians
finishing takes within a few seconds of each other is an out-of-memory kill,
and `BackgroundTasks` runs in the web process, so it takes sign-in down with
it rather than just the analysis. An OMR model alongside that does not fit at
any size.

**Why in-process stays the default.** 692 tests, the six-clip corpus
regression and `python -m tuning_dashboard.cli` all run `analyze()` locally
with no network. If the remote runtime were the only path, tuning thresholds
against real recordings would need a deploy — exactly backwards for the thing
that most needs a fast loop.
"""

from __future__ import annotations

import logging
import os
from typing import Literal

log = logging.getLogger("intempo.analysis")

Runtime = Literal["inprocess", "modal"]

#: Which runtime to use. `inprocess` unless a deployment says otherwise.
ANALYSIS_RUNTIME: Runtime = (
    "modal" if os.getenv("ANALYSIS_RUNTIME", "").strip().lower() == "modal" else "inprocess"
)

#: The deployed Modal app and function names. Must match `modal_app.py`.
MODAL_APP_NAME = os.getenv("MODAL_APP_NAME", "intempo")
MODAL_FUNCTION_NAME = "run_analysis"


def _spawn_on_modal(analysis_id: str) -> bool:
    """Hand the job to Modal. True if it was accepted.

    Fire and forget: the `analyses` row is the state, exactly as it is for the
    in-process path, so there is no call handle worth keeping. A crash on the
    far side leaves the row `processing`, which the stuck-row sweeper already
    understands — the same failure the in-process path has always had, and the
    same recovery.
    """
    try:
        import modal
    except ImportError:
        log.error(
            "ANALYSIS_RUNTIME=modal but the modal package is not installed; "
            "analysis %s was not started",
            analysis_id,
        )
        return False

    try:
        fn = modal.Function.from_name(MODAL_APP_NAME, MODAL_FUNCTION_NAME)
        fn.spawn(analysis_id)
    except Exception:  # noqa: BLE001 — any failure here must not 500 the request
        log.exception("analysis %s: could not be started on Modal", analysis_id)
        return False
    return True


def start_analysis(analysis_id: str, background_tasks) -> None:
    """Start the work, wherever it runs.

    **Falls back to in-process if the remote runtime refuses.** A musician who
    has just finished playing should not lose the take because a deployment
    setting is wrong — a slow analysis on a tight box is a far better outcome
    than none, and the failure is in the log where it belongs.
    """
    from app.workers.analysis_runner import run_analysis

    if ANALYSIS_RUNTIME == "modal" and _spawn_on_modal(analysis_id):
        log.info("analysis %s: started on Modal", analysis_id)
        return

    if ANALYSIS_RUNTIME == "modal":
        log.warning("analysis %s: falling back to in-process", analysis_id)

    # Runs after the response is sent. `run_analysis` is sync, so FastAPI
    # executes it in a worker thread and the CPU-bound `analyze()` never
    # blocks the event loop.
    background_tasks.add_task(run_analysis, analysis_id)
