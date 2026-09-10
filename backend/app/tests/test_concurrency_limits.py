"""What happens when several people use this at the same time.

**The question this answers is "would it work if multiple people run it", and
before these limits the answer was no.** Sync work handed to `BackgroundTasks`
runs in Starlette's threadpool, which holds **40** threads and counts nothing.
Forty simultaneous jobs is therefore a reachable state, not a hypothetical one,
and it costs:

    ~81 MB   per in-flight scan on the vision path (Pillow decode buffers —
             a 12 MP photograph is ~36 MB as RGB before anything copies it)
    ~460 MB  per in-flight analysis (`workers/dispatch`, top of file)

The instance has 512 MB, and an OOM kill takes the **whole process** down —
every other musician's work with it, and their sign-in — not just the job that
asked for too much. So forty scans is 3.2 GB, and **two analyses do not fit
either**.

**Both halves, because for a long time only one was bounded.** Reading a page
got a semaphore and its own threads in 2026-08. Analysing a take — five times
heavier, on the same pool — was still going to `BackgroundTasks` unbounded when
this file was extended on 2026-09-10, with the arithmetic that condemns it
written at the top of `dispatch.py` the whole time. A rule stated once and
applied to one of two paths is the shape of defect this repository keeps
finding; the last one was a pair of fetch functions where only one checked a
redirect.

The tests below are about the bounds holding under actual threads rather than
in principle.
"""

from __future__ import annotations

import threading
import time

import pytest

from app.config import settings
from app.workers import dispatch
from app.workers import transcription_runner as runner


class _Recorder:
    """Counts how many callers are inside at once."""

    def __init__(self) -> None:
        self.live = 0
        self.peak = 0
        self._lock = threading.Lock()

    def enter(self) -> None:
        with self._lock:
            self.live += 1
            self.peak = max(self.peak, self.live)

    def leave(self) -> None:
        with self._lock:
            self.live -= 1


# ---- reading pages ---------------------------------------------------------


def test_only_so_many_pages_are_read_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """Forty threads, and never more than the configured number inside.

    Without the semaphore this peaks at the number of threads offered, which
    on a real server is forty and about 3.2 GB.
    """
    seen = _Recorder()

    def fake_read(_client, _score_id, _urls):
        seen.enter()
        time.sleep(0.05)
        seen.leave()

    monkeypatch.setattr(runner, "_read_pages", fake_read)
    monkeypatch.setattr(runner, "get_service_client", lambda: _Client())
    monkeypatch.setattr(runner, "_fetch_score", lambda *_: {"source_image_url": "u"})

    threads = [threading.Thread(target=runner.run_transcription, args=("id",)) for _ in range(40)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert seen.peak <= settings.TRANSCRIPTION_MAX_CONCURRENT
    assert seen.peak > 0, "nothing ran at all"


def test_every_page_still_gets_read(monkeypatch: pytest.MonkeyPatch) -> None:
    """A limit that dropped work would be worse than no limit — the point is
    to make them wait, not to lose them."""
    done = []
    lock = threading.Lock()

    def fake_read(_client, _score_id, _urls):
        with lock:
            done.append(1)

    monkeypatch.setattr(runner, "_read_pages", fake_read)
    monkeypatch.setattr(runner, "get_service_client", lambda: _Client())
    monkeypatch.setattr(runner, "_fetch_score", lambda *_: {"source_image_url": "u"})

    threads = [threading.Thread(target=runner.run_transcription, args=("id",)) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(done) == 12


def test_a_slot_is_returned_even_when_the_page_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """A leaked permit is a server that stops reading pages and never says why.

    Worth its own test because the failure is silent, permanent, and looks
    exactly like the queue being busy.
    """

    def explodes(_client, _score_id, _urls):
        raise RuntimeError("boom")

    monkeypatch.setattr(runner, "_read_pages", explodes)
    monkeypatch.setattr(runner, "get_service_client", lambda: _Client())
    monkeypatch.setattr(runner, "_fetch_score", lambda *_: {"source_image_url": "u"})

    for _ in range(settings.TRANSCRIPTION_MAX_CONCURRENT + 2):
        with pytest.raises(RuntimeError):
            runner.run_transcription("id")

    # Still acquirable: the permits came back.
    assert runner._scan_slots.acquire(timeout=1)
    runner._scan_slots.release()


class _Client:
    def table(self, _name):
        return self

    def select(self, *_a):
        return self

    def eq(self, *_a):
        return self

    def limit(self, *_a):
        return self

    def update(self, *_a):
        return self

    def execute(self):
        return type("R", (), {"data": [{"source_image_url": "u"}]})()


# ---- analysing takes -------------------------------------------------------


def _drain() -> None:
    dispatch._analysing._pending.join()


def test_only_so_many_takes_are_analysed_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """The bound that did not exist.

    Submitted the way the endpoint submits them — `start_analysis`, forty times
    — and counted inside the work itself. Before the pool this peaked at the
    number of threads Starlette offered; at ~460 MB a take, the second one is
    already over the instance.
    """
    seen = _Recorder()

    def fake_run(_analysis_id: str) -> None:
        seen.enter()
        time.sleep(0.02)
        seen.leave()

    monkeypatch.setattr(dispatch, "ANALYSIS_RUNTIME", "inprocess")
    monkeypatch.setattr(dispatch, "_run_analysis_here", fake_run)

    for index in range(40):
        dispatch.start_analysis(f"take-{index}")
    _drain()

    assert seen.peak <= max(1, settings.ANALYSIS_MAX_CONCURRENT)
    assert seen.peak > 0, "nothing ran at all"


def test_every_take_still_gets_analysed(monkeypatch: pytest.MonkeyPatch) -> None:
    """A limit that dropped takes would be worse than no limit.

    A musician who has finished playing is watching a row that says `queued`.
    Waiting is a slower answer; losing it is no answer, and the screen polls
    forever.
    """
    done: list[str] = []
    lock = threading.Lock()

    def fake_run(analysis_id: str) -> None:
        with lock:
            done.append(analysis_id)

    monkeypatch.setattr(dispatch, "ANALYSIS_RUNTIME", "inprocess")
    monkeypatch.setattr(dispatch, "_run_analysis_here", fake_run)

    for index in range(12):
        dispatch.start_analysis(f"take-{index}")
    _drain()

    assert sorted(done) == sorted(f"take-{index}" for index in range(12))


def test_a_take_that_throws_does_not_stop_the_ones_behind_it(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A worker that dies takes the whole queue with it, silently.

    Worse than the semaphore leak this file already tests for: there is no
    handle on the work, so nothing logs it, and every take submitted afterwards
    sits in a queue no thread is reading. With `ANALYSIS_MAX_CONCURRENT` at 1
    that is the analysis half of the app gone until a restart.
    """
    done: list[str] = []

    def sometimes_explodes(analysis_id: str) -> None:
        if analysis_id == "bad":
            raise RuntimeError("boom")
        done.append(analysis_id)

    monkeypatch.setattr(dispatch, "ANALYSIS_RUNTIME", "inprocess")
    monkeypatch.setattr(dispatch, "_run_analysis_here", sometimes_explodes)

    with caplog.at_level("ERROR"):
        dispatch.start_analysis("bad")
        _drain()
        dispatch.start_analysis("after")
        _drain()

    assert done == ["after"], "one failed take stopped every take after it"
    assert "bad" in caplog.text


def test_waiting_to_be_analysed_holds_no_request_thread(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reason this is a queue and not a semaphore around the work.

    `POST /v1/analyses` answers 202 and nothing about that reply depends on the
    analysis. If submitting blocked until a slot came free, a burst of takes
    would park request threads — the same starvation the handlers were taken
    off the event loop to avoid, one layer down. Submitting must return while
    the work is still queued.
    """
    monkeypatch.setattr(dispatch, "ANALYSIS_RUNTIME", "inprocess")
    release = threading.Event()

    def blocks(_analysis_id: str) -> None:
        release.wait(5)

    monkeypatch.setattr(dispatch, "_run_analysis_here", blocks)

    try:
        dispatch.start_analysis("slow")
        started = time.monotonic()
        for index in range(10):
            dispatch.start_analysis(f"behind-{index}")
        # Ten submissions behind a job that is still running, in well under the
        # time that job takes. The number is generous on purpose: what is being
        # asserted is "did not wait for the work", not a latency budget.
        assert time.monotonic() - started < 1.0
    finally:
        release.set()
        _drain()
