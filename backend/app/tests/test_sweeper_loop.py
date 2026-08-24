"""The thing that rescues a take nobody is watching.

`BackgroundTasks` do not survive a crash, so a row that was `processing` when
the process died would sit there forever with a musician on a progress screen.
Two sweeps handle that: one at startup, for the crash you restart after, and a
periodic one for the crash you do not — a worker thread killed by the OOM
reaper on a server that keeps serving, a write to `done` that failed, a task
that never returned.

The periodic half had **no tests**, and it is the half that matters while the
app is running. Nothing about it fails loudly: if it stops, rows simply stay
`processing`, every request keeps working, and the only symptom is a verdict
that never arrives.

`asyncio.run` rather than `pytest-asyncio`. Seven tests is not a reason to add
a plugin to the suite, and the bodies read the same either way.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager, suppress

import pytest

from app import main


def _sweeper_tasks() -> list[asyncio.Task]:
    return [t for t in asyncio.all_tasks() if "_sweep_periodically" in repr(t.get_coro())]


@asynccontextmanager
async def _running_app():
    """The app's lifespan, entered and always left.

    `lifespan` ends with `suppress(CancelledError): await sweeper`, so if the
    cancel is ever missing, shutdown waits on a loop that never ends — and a
    plain `async with` in a test **hangs** rather than failing. A hang is a
    worse signal than a red test and it takes the whole suite down with it.

    So the exit runs as its own task with a deadline, and anything still
    sweeping is stopped here rather than leaking into the next test. Whether
    shutdown *should* have finished on its own is asserted in one place, below.
    """
    context = main.lifespan(main.app)
    await context.__aenter__()
    try:
        yield
    finally:
        closing = asyncio.create_task(context.__aexit__(None, None, None))
        await asyncio.wait({closing}, timeout=2)
        for task in [closing, *_sweeper_tasks()]:
            task.cancel()
            with suppress(asyncio.CancelledError, StopAsyncIteration):
                await task


async def _sweep_until(count: int, calls: list) -> None:
    """Run the loop until it has swept `count` times, then stop it."""
    task = asyncio.create_task(main._sweep_periodically())
    try:
        async with asyncio.timeout(5):
            while len(calls) < count:
                await asyncio.sleep(0.001)
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


def test_it_keeps_sweeping_for_as_long_as_the_server_is_up(monkeypatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(main, "SWEEP_INTERVAL_SECONDS", 0.001)
    monkeypatch.setattr(main, "sweep_once", lambda: calls.append(1))

    asyncio.run(_sweep_until(3, calls))

    assert len(calls) >= 3, "one sweep is the startup case; this is the other one"


def test_it_sweeps_off_the_event_loop(monkeypatch) -> None:
    """The sweep is a synchronous Supabase call.

    Run on the loop it would stall **every request** for its duration — and it
    runs every five minutes forever, so that is a periodic freeze of the whole
    API rather than one slow moment.
    """
    ran_on: list[int] = []
    monkeypatch.setattr(main, "SWEEP_INTERVAL_SECONDS", 0.001)
    monkeypatch.setattr(main, "sweep_once", lambda: ran_on.append(threading.get_ident()))

    async def body() -> None:
        loop_thread = threading.get_ident()
        await _sweep_until(1, ran_on)
        assert ran_on[0] != loop_thread

    asyncio.run(body())


def test_it_sweeps_through_the_contained_call(monkeypatch) -> None:
    """`sweep_once`, not `sweep_stuck_analyses`.

    `sweep_once` swallows its own failure, which is the whole reason it exists:
    a transient Supabase error must cost one sweep, not every sweep for the
    lifetime of the process. Calling the raw version here would let a single
    blip end recovery until the next deploy, with nothing reporting it — so the
    raw one is replaced with a landmine and the loop must not step on it.
    """
    swept: list[int] = []
    monkeypatch.setattr(main, "SWEEP_INTERVAL_SECONDS", 0.001)
    monkeypatch.setattr(main, "sweep_once", lambda: swept.append(1))

    def _landmine() -> int:
        raise AssertionError("the periodic loop called the uncontained sweep")

    monkeypatch.setattr(main, "sweep_stuck_analyses", _landmine)

    asyncio.run(_sweep_until(2, swept))

    assert len(swept) >= 2


def test_the_contained_sweep_really_does_contain(monkeypatch) -> None:
    """Through the real `sweep_once`, with the database broken.

    The containment above is only worth having if it holds, so this one does
    not stub it out: three failures in a row have to cost three sweeps rather
    than every sweep after the first.
    """
    from app.workers import analysis_runner

    attempts: list[int] = []

    def _broken(*_args, **_kwargs):
        attempts.append(1)
        raise RuntimeError("connection reset")

    monkeypatch.setattr(analysis_runner, "sweep_stuck_analyses", _broken)

    for _ in range(3):
        assert analysis_runner.sweep_once() == 0

    assert len(attempts) == 3, "it stopped trying after the first failure"


def test_startup_sweeps_once_and_starts_the_periodic_one(monkeypatch) -> None:
    startup: list[int] = []
    monkeypatch.setattr(main, "SWEEP_INTERVAL_SECONDS", 3600)
    monkeypatch.setattr(main, "sweep_stuck_analyses", lambda: startup.append(1))
    monkeypatch.setattr(main, "sweep_once", lambda: None)

    async def body() -> None:
        async with _running_app():
            assert startup == [1], "the crash you restart after is the startup sweep's job"
            assert _sweeper_tasks(), (
                "nothing watches for the crash you do not restart after"
            )

    asyncio.run(body())


def test_a_broken_startup_sweep_does_not_stop_the_server(monkeypatch) -> None:
    """An API that will not start because recovery failed is strictly worse
    than one that starts with some rows still stuck."""
    monkeypatch.setattr(main, "SWEEP_INTERVAL_SECONDS", 3600)
    monkeypatch.setattr(main, "sweep_once", lambda: None)

    def _raises() -> int:
        raise RuntimeError("no database")

    monkeypatch.setattr(main, "sweep_stuck_analyses", _raises)

    async def body() -> None:
        async with _running_app():
            pass  # reaching here at all is the assertion

    asyncio.run(body())


def test_the_sweeper_does_not_outlive_the_app(monkeypatch) -> None:
    """Under a reloader each restart would otherwise leave another one
    sweeping, and they accumulate for as long as you keep editing.

    **Driven as a separate task on purpose.** The obvious version — an
    `async with main.lifespan(...)` under `asyncio.timeout` — is wrong twice
    over, and I wrote it that way first. `lifespan` ends with
    `suppress(CancelledError): await sweeper`, so a timeout's cancellation is
    *swallowed by the code under test*: the test then passed while the leak was
    present, and in a full-file run it hung instead of failing. A hang is a
    worse signal than a red test and it takes CI down with it.

    Running `__aexit__` as its own task asks the question directly — did
    shutdown finish, and is the sweeper actually stopped — with nothing to
    swallow.
    """
    monkeypatch.setattr(main, "SWEEP_INTERVAL_SECONDS", 3600)
    monkeypatch.setattr(main, "sweep_stuck_analyses", lambda: None)
    monkeypatch.setattr(main, "sweep_once", lambda: None)

    async def body() -> None:
        context = main.lifespan(main.app)
        await context.__aenter__()
        sweeper = _sweeper_tasks()[0]

        closing = asyncio.create_task(context.__aexit__(None, None, None))
        _done, pending = await asyncio.wait({closing}, timeout=2)
        try:
            assert not pending, (
                "shutdown never finished — the sweeper is awaited without "
                "being cancelled, so the app cannot stop"
            )
            assert sweeper.done(), "the sweeper outlived the app that started it"
        finally:
            # Both are already finished when the app is healthy, so this is a
            # no-op then and a cleanup only when the assertions above failed.
            for task in (closing, sweeper):
                task.cancel()
                with suppress(asyncio.CancelledError, StopAsyncIteration):
                    await task

    asyncio.run(body())


# ---- saying at startup whether a page can be read at all ------------------


def test_a_stale_provider_chain_is_reported_at_startup(monkeypatch, caplog) -> None:
    """A misconfiguration here is invisible until someone scans, and then it
    does not look like a misconfiguration — the musician is simply told their
    page could not be read.

    Not hypothetical: the shipped default once read
    `claude-sonnet-4-6,claude-opus-4-7`, both names from the previous Claude
    generation, and the service's own logs still show those names in August.
    `OCR_PROVIDER_CHAIN` lives in the hosting dashboard, so nothing in this
    repository can tell whether it was ever updated — one line at startup puts
    the answer in the logs, readable without a scan and without shell access.
    """
    from app import config
    from app.main import _report_reader_configuration

    monkeypatch.setattr(
        config.settings, "OCR_PROVIDER_CHAIN", "claude-sonnet-4-6,claude-opus-4-7"
    )
    with caplog.at_level(logging.ERROR, logger="intempo"):
        _report_reader_configuration()

    messages = [r.getMessage() for r in caplog.records]
    assert any("SHEET MUSIC READING IS OFF" in m for m in messages), messages
    assert any("claude-sonnet-4-6" in m for m in messages), messages


def test_a_chain_that_works_says_so_once(monkeypatch, caplog) -> None:
    """Quiet when it is fine, so the loud line means something."""
    from app import config
    from app.main import _report_reader_configuration

    monkeypatch.setattr(
        config.settings, "OCR_PROVIDER_CHAIN", "gemini-2.5-flash,claude-sonnet-5"
    )
    with caplog.at_level(logging.INFO, logger="intempo"):
        _report_reader_configuration()

    messages = [r.getMessage() for r in caplog.records]
    assert any("reader chain" in m and "gemini-2.5-flash" in m for m in messages), messages
    assert not any("OFF" in m for m in messages), messages


def test_one_stale_name_among_working_ones_is_a_warning_not_a_failure(
    monkeypatch, caplog
) -> None:
    """A renamed model should cost that model, not the feature — which is what
    `_default_chain` already does. The startup line has to agree with it, or the
    log would say a page cannot be read when it can."""
    from app import config
    from app.main import _report_reader_configuration

    monkeypatch.setattr(
        config.settings, "OCR_PROVIDER_CHAIN", "claude-sonnet-5,claude-opus-4-7"
    )
    with caplog.at_level(logging.INFO, logger="intempo"):
        _report_reader_configuration()

    messages = [r.getMessage() for r in caplog.records]
    assert not any("OFF" in m for m in messages), messages
    assert any("claude-opus-4-7" in m for m in messages), messages


def test_reporting_the_configuration_never_stops_the_server(monkeypatch, caplog) -> None:
    """A server that cannot read a page can still serve every other route.
    Refusing to start would take the app down instead of one feature."""
    from app.main import _report_reader_configuration
    from app.services.ocr import pipeline

    def _explodes():
        raise RuntimeError("the registry is on fire")

    monkeypatch.setattr("app.main._default_chain", _explodes)
    with caplog.at_level(logging.ERROR, logger="intempo"):
        _report_reader_configuration()  # must not raise

    assert any("on fire" in r.getMessage() for r in caplog.records)
    assert pipeline is not None
