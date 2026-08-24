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

**What this host needs to use the remote runtime.** The `modal` client
library, which is a dependency of the API for this reason alone — nothing
imports it at module level, so it reads as unused — and a Modal API token in
`MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`. Without either, every take falls back to
running here, quietly and correctly, which is exactly the failure that is hard
to notice. `/v1/ready` reports both.

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

#: The env vars Modal turns into gRPC metadata on every call.
_MODAL_CREDENTIAL_VARS = ("MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET")


def clean_modal_credentials() -> list[str]:
    """Strip whitespace off the Modal token. Returns the names it had to fix.

    gRPC metadata values may not contain a newline, and `grpclib` raises
    ``ValueError: Invalid metadata value`` from six frames inside `spawn()`
    when one does. A token pasted into a hosting dashboard carries a trailing
    newline more often than not.

    **What that cost, on 2026-08-24.** Every `spawn` raised, so no page ever
    reached Modal — and Modal is the only place homr is installed. Reading
    fell back to this process, where the chain's first provider is a homr that
    is not there, so an orchestral bass part was read by vision models alone.
    They returned a transcription at confidence 0.40 whose own
    `notes_to_human` called it "approximate reconstructions", and the app
    showed it to a musician as their score.

    None of the three layers that should have caught it did. `/v1/ready`
    tested the tokens for *presence*, and a value ending in a newline is
    present. The spawn failure was logged and swallowed, by design, so the
    request would not 500. And the fallback is deliberately quiet, because a
    musician who has just photographed a page should not lose it to a
    deployment setting.

    So the value is repaired here rather than merely reported. A trailing
    newline is not a configuration decision anyone made, and there is no
    reading of it under which the untrimmed value is the one that was meant.
    """
    import os

    fixed = []
    for name in _MODAL_CREDENTIAL_VARS:
        value = os.environ.get(name)
        if value is not None and value != value.strip():
            os.environ[name] = value.strip()
            fixed.append(name)
    if fixed:
        # Never the value. This one reached the logs already, inside a
        # traceback, which is its own problem.
        log.warning(
            "%s had surrounding whitespace and would have been rejected by "
            "gRPC; using the trimmed value",
            " and ".join(fixed),
        )
    return fixed


#: The deployed Modal app and function names. Must match `modal_app.py`.
MODAL_APP_NAME = os.getenv("MODAL_APP_NAME", "intempo")
MODAL_FUNCTION_NAME = "run_analysis"
MODAL_TRANSCRIBE_FUNCTION_NAME = "transcribe_score"

#: Where a *page* is read. Separate from `ANALYSIS_RUNTIME` on purpose.
#:
#: The two jobs have different reasons to move. An analysis peaks near 460 MB
#: and merely wants headroom; reading a page with homr peaks at **1350 MB**,
#: measured, which does not fit on the API host at all. So a deployment can
#: sensibly run analyses in-process and pages on Modal, and saying so with one
#: switch would force a choice nobody needs to make.
#:
#: `inprocess` still works and still reads pages — with the vision chain, since
#: homr is not installed on the API host. That is the fallback, not a failure.
TRANSCRIPTION_RUNTIME: Runtime = (
    "modal"
    if os.getenv("TRANSCRIPTION_RUNTIME", "").strip().lower() == "modal"
    else "inprocess"
)


def _spawn_on_modal(analysis_id: str) -> bool:
    """Hand the job to Modal. True if it was accepted.

    Fire and forget: the `analyses` row is the state, exactly as it is for the
    in-process path, so there is no call handle worth keeping. A crash on the
    far side leaves the row `processing`, which the stuck-row sweeper already
    understands — the same failure the in-process path has always had, and the
    same recovery.
    """
    clean_modal_credentials()
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
        # Most often one of three, in falling order of how easy it is to miss:
        # `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` not set on *this* host (the
        # container's own secret is a different thing on a different
        # dashboard), the app never deployed, or Modal unreachable.
        # `/v1/ready` separates them; this only has to not take the request
        # down with it.
        log.exception("analysis %s: could not be started on Modal", analysis_id)
        return False
    return True


def _spawn_transcription_on_modal(score_id: str) -> bool:
    """Hand the page to Modal. True if it was accepted.

    Fire and forget, exactly as for an analysis: the `scores` row is the state
    on both sides, and `sweep_stuck_transcriptions` already understands a read
    that never finished.
    """
    clean_modal_credentials()
    try:
        import modal
    except ImportError:
        log.error(
            "TRANSCRIPTION_RUNTIME=modal but the modal package is not "
            "installed; score %s was not started",
            score_id,
        )
        return False

    try:
        fn = modal.Function.from_name(MODAL_APP_NAME, MODAL_TRANSCRIBE_FUNCTION_NAME)
        fn.spawn(score_id)
    except Exception:  # noqa: BLE001 — any failure here must not 500 the request
        log.exception("score %s: could not be started on Modal", score_id)
        return False
    return True


def start_transcription(score_id: str, background_tasks) -> None:
    """Read the page, wherever it runs.

    **Falls back to in-process, which is a real reading and not a stub.** The
    API host has no homr — 150 MB of weights and 1350 MB of peak for a job it
    cannot hold — so the fallback reads with the vision chain instead. That is
    worse at reading and it is not nothing, and a musician who has just
    photographed a page should not lose it to a deployment setting.
    """
    from app.workers.transcription_runner import run_transcription

    if TRANSCRIPTION_RUNTIME == "modal" and _spawn_transcription_on_modal(score_id):
        log.info("score %s: being read on Modal", score_id)
        return

    if TRANSCRIPTION_RUNTIME == "modal":
        log.warning(
            "score %s: falling back to reading in-process, without homr", score_id
        )

    background_tasks.add_task(run_transcription, score_id)


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
