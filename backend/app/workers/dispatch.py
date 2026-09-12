"""Where an analysis actually runs, decided in one place.

`create_analysis` should not know. It writes a row and asks for the work to
happen; whether that happens in this process or on another machine is a
deployment fact, and deployment facts that leak into request handlers are how
you end up unable to change them.

**Why there is a choice at all.** The instance this deploys to has 512 MB for
the *whole* application, and one analysis peaks near 460 — so two musicians
finishing takes within a few seconds of each other is an out-of-memory kill,
and this work runs in the web process, so it takes sign-in down with it rather
than just the analysis. An OMR model alongside that does not fit at any size.

That paragraph stood here from the beginning and **nothing enforced it** until
2026-09-10: analyses went to `BackgroundTasks`, which is Starlette's
forty-thread pool with no count kept, so "two at once" was not the reachable
state — forty was. `_WorkerPool` below is the enforcement, and it is the same
one reading a page has had since it learned the same thing first.

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
import queue
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from app.config import settings

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


@dataclass
class _Dispatches:
    """How pages have actually been read since this process started.

    **The fact that was invisible.** `TRANSCRIPTION_RUNTIME=modal` was set on
    the deployment, and every page was read in this process instead, without
    homr, for the entire life of it. Nothing was broken enough to notice: the
    spawn failure is caught so it cannot 500 the request, the fallback is
    deliberately quiet so a musician does not lose a page to a deployment
    setting, and `/v1/ready` reported the *configuration* — which was correct.
    What nobody could see was the **behaviour**, and a single counter would
    have shown it on the first scan.

    Process-local and reset by a restart. That is the right scope: it answers
    "is this instance doing what it was configured to do", not "has this ever
    worked", and a fresh process genuinely does not know yet.
    """

    #: Pages handed to Modal successfully.
    to_modal: int = 0
    #: Pages read here because Modal could not be reached.
    fell_back: int = 0
    #: The **type** of the last spawn failure. Never the message.
    #:
    #: The message is where the credential was: `grpclib` raises
    #: `ValueError: Invalid metadata value: 'ak-...'`, which put a token into
    #: the Render logs inside a traceback. `/v1/ready` is served over HTTP and
    #: read in a browser, and a readiness detail is the last place a secret
    #: should be able to reach.
    last_failure_type: str | None = None


#: Recorded by `start_transcription`, read by `/v1/ready`.
transcription_dispatches = _Dispatches()


def _spawn_transcription_on_modal(score_id: str) -> str | None:
    """Hand the page to Modal. Returns the call id, or None if it was refused.

    **Empty string and None are different answers, deliberately.** `None` means
    the spawn did not happen and the page still needs reading somewhere. `""`
    means it happened and gave no handle back — the page is on its way, and
    only the diagnostic is missing. Collapsing the two would send a page that
    Modal already has to be read again in-process, without homr, by the vision
    models the owner removed: a scan that quietly invents notes because a
    handle was absent.

    Still fire and forget — nothing waits for the read — but **not anonymous
    any more.** `spawn` returns a handle Modal will answer questions about
    later, and that handle is the only way to find out what happened to a run
    that died before it could write to the row. Without it, a bad secret and a
    genuinely slow page are the same observation: a row that has not changed.
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
        return None

    try:
        fn = modal.Function.from_name(MODAL_APP_NAME, MODAL_TRANSCRIBE_FUNCTION_NAME)
        call = fn.spawn(score_id)
    except Exception as exc:  # noqa: BLE001 — must not 500 the request
        transcription_dispatches.last_failure_type = type(exc).__name__
        log.exception("score %s: could not be started on Modal", score_id)
        return None
    # `""`, not None: see the docstring. The call id improves how a failure is
    # *reported*; it is never a precondition for the work.
    return getattr(call, "object_id", None) or ""


class _WorkerPool:
    """Work waiting to run here, and the fixed set of threads that run it.

    **Its own threads, not Starlette's.** Both kinds of work here take tens of
    seconds, and one that arrives while the workers are busy has to wait
    somewhere. Starlette's threadpool is where every request handler in this
    API now runs, so borrowing threads from it to hold a queue would trade the
    event loop the handlers were just taken off for a pool they can be starved
    out of — the same outage with more steps. Waiting happens in the queue,
    which holds no thread at all.

    **Daemon threads, and that is the load-bearing word.** The obvious shape
    here is a `ThreadPoolExecutor`, and it is wrong for this: it registers an
    `atexit` hook that **joins its workers**, so a process asked to exit while
    a job is running blocks until it finishes. Measured: a task sleeping eight
    seconds delays `sys.exit(0)` by eight seconds. That is a deploy or a
    restart hanging for the length of a transcription — tens of seconds now,
    and up to the vision SDK's ten-minute default if that chain is ever turned
    back on. Introducing a stuck shutdown while removing stuck requests is not
    a trade.

    A process that goes down mid-job leaves the row `reading` or `processing`,
    which the sweepers already understand and recover. That is the same ending
    a crash has always had, and the same recovery. **Queued work is lost the
    same way and recovered the same way** — `sweep_stuck_analyses` matches
    `queued` as well as `processing`, and `sweep_stuck_transcriptions` matches
    `queued` as well as `reading`, so a job that never reached a thread is a
    row that stops being `queued` on the same timer as one that did.

    **One class, two pools, because this shape was written twice and applied
    once.** Reading a page has been bounded since 2026-08; analysing a take —
    heavier by a factor of five and on the same 40-thread pool — was still
    going to `BackgroundTasks` unbounded. Two copies of a rule is how the
    second one stops being updated, and this repository has already paid that
    bill in a pair of fetch functions where only one of them checked a
    redirect.

    Threads start lazily, not at import. `transcription_runner` imports this
    module and the Modal container imports that, so threads created at import
    would be created in a container that does its one job on the main thread
    and exits.
    """

    def __init__(
        self,
        name: str,
        run: Callable[[str], None],
        size: Callable[[], int],
    ) -> None:
        self._name = name
        self._run = run
        # A callable rather than an int, so a test that changes the setting
        # gets the setting it changed. Read once, at the moment the threads are
        # created, which is the only moment it can matter.
        self._size = size
        self._pending: queue.Queue[str] = queue.Queue()
        self._lock = threading.Lock()
        self._started = False

    def submit(self, job_id: str) -> None:
        self._ensure_started()
        self._pending.put(job_id)

    def _loop(self) -> None:
        while True:
            job_id = self._pending.get()
            try:
                self._run(job_id)
            except Exception:  # noqa: BLE001 — queued work must not die unrecorded
                # Nothing holds a handle on this work, so an exception that
                # escaped here would vanish in silence: the row would stay
                # `queued` and the screen would go on polling a question
                # already answered badly.
                log.exception("%s %s: could not be started", self._name, job_id)
            finally:
                self._pending.task_done()

    def _ensure_started(self) -> None:
        with self._lock:
            if self._started:
                return
            for index in range(max(1, self._size())):
                threading.Thread(
                    target=self._loop, name=f"{self._name}-{index}", daemon=True
                ).start()
            self._started = True


#: Pages waiting to be read here. Sized by the memory ceiling `_scan_slots`
#: enforces in the runner: a read peaks around 81 MB on the vision path.
_reading = _WorkerPool(
    "transcribe",
    lambda score_id: _decide_and_read(score_id),
    lambda: settings.TRANSCRIPTION_MAX_CONCURRENT,
)

#: Takes waiting to be analysed here. **One at a time by default**, because
#: `analyze()` peaks near 460 MB against this instance's 512 — see
#: `ANALYSIS_MAX_CONCURRENT`, and the paragraph at the top of this file that
#: has named the consequence since before anything enforced it.
_analysing = _WorkerPool(
    "analyse",
    lambda analysis_id: _run_analysis_here(analysis_id),
    lambda: settings.ANALYSIS_MAX_CONCURRENT,
)


def _run_analysis_here(analysis_id: str) -> None:
    """Import at call time, for the reason `_ensure_started` is lazy."""
    from app.workers.analysis_runner import run_analysis

    run_analysis(analysis_id)


def _decide_and_read(score_id: str) -> None:
    """Send the page to Modal, or read it here. Runs off the request.

    **The decision is a network call, which is why it is no longer in the
    handler.** `fn.spawn()` is a gRPC round trip to Modal, and it used to sit
    between the musician pressing the shutter and the app admitting the piece
    existed — a third party's latency in front of a response that does not
    depend on its answer, since the row is written and returned either way.
    When Modal was unreachable it was worse than latency: the scan waited for
    somebody else's timeout to decide something the musician was not waiting to
    hear.
    """
    from app.workers.transcription_runner import run_transcription

    if TRANSCRIPTION_RUNTIME == "modal":
        call_id = _spawn_transcription_on_modal(score_id)
        if call_id is not None:
            transcription_dispatches.to_modal += 1
            log.info("score %s: being read on Modal as %s", score_id, call_id)
            if call_id:
                _record_call_id(score_id, call_id)
            return

    if TRANSCRIPTION_RUNTIME == "modal":
        # Counted as well as logged. The warning was already here and was true
        # every single time; a line in a log nobody is watching is how this
        # went unnoticed for the life of the deployment.
        transcription_dispatches.fell_back += 1
        log.warning(
            "score %s: falling back to reading in-process, without homr", score_id
        )

    run_transcription(score_id)


def _record_call_id(score_id: str, call_id: str) -> None:
    """Remember which Modal call is reading this page.

    **After the spawn, never before.** A call id written first would name a run
    that may not exist, and the sweeper would then ask Modal about a call
    nobody made and believe the answer.

    Never raises. This is a diagnostic thread back to a container, and losing it
    costs a better error message; failing the read over it would cost the page.
    A row without one is swept exactly as it was before this existed.
    """
    from app.db import get_service_client

    client = get_service_client()
    if client is None:
        return
    try:
        client.table("scores").update({"transcription_call_id": call_id}).eq(
            "id", score_id
        ).execute()
    except Exception:  # noqa: BLE001 — a lost handle is not a lost read
        log.warning("score %s: could not record the Modal call id", score_id)


def start_transcription(score_id: str) -> None:
    """Get the page read, wherever it runs, without holding up the response.

    Returns the moment the work is queued. Nothing about the reply to the
    musician depends on where the page goes or whether it got there: the row
    exists, it says `queued`, and the app polls it.

    **Falls back to in-process, which is a real reading and not a stub.** The
    API host has no homr — 150 MB of weights and 1350 MB of peak for a job it
    cannot hold — so the fallback reads with the vision chain instead. That is
    worse at reading and it is not nothing, and a musician who has just
    photographed a page should not lose it to a deployment setting.
    """
    _reading.submit(score_id)


def start_analysis(analysis_id: str) -> None:
    """Start the work, wherever it runs.

    **Falls back to in-process if the remote runtime refuses.** A musician who
    has just finished playing should not lose the take because a deployment
    setting is wrong — a slow analysis on a tight box is a far better outcome
    than none, and the failure is in the log where it belongs.

    Unlike a page, the Modal decision stays in the request here, and the
    difference is what the caller is waiting for: `POST /v1/analyses` answers
    202 with an id and nothing else, so it is already the cheapest request in
    the app, while `POST /v1/scores` answers with a row the musician is looking
    at.

    **It used to take a `BackgroundTasks` and hand the work to it, and that was
    the unbounded half of a rule this file already stated.** Starlette runs a
    background task on the same forty-thread pool every request handler uses,
    with no ceiling on how many of them run at once, so forty simultaneous
    takes was a reachable state rather than a hypothetical one — at ~460 MB
    each against 512 MB total, so was two. The queue is what makes the
    ceiling real, and it is the same queue reading has used since it learned
    the same lesson.
    """
    if ANALYSIS_RUNTIME == "modal" and _spawn_on_modal(analysis_id):
        log.info("analysis %s: started on Modal", analysis_id)
        return

    if ANALYSIS_RUNTIME == "modal":
        log.warning("analysis %s: falling back to in-process", analysis_id)

    _analysing.submit(analysis_id)
