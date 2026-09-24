"""The stuck-analysis sweep keeps running for as long as the server does.

It used to run only at startup, which recovers exactly one class of failure:
the crash you restart after. A worker thread killed on a server that keeps
serving left its row in 'processing' until the next deploy, while a musician
waited on a verdict that was never coming.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from app import main as main_module
from app.workers import analysis_runner
from app.workers.analysis_runner import STUCK_AFTER, sweep_once, sweep_stuck_analyses


def _client_returning(rows: list[dict]) -> MagicMock:
    client = MagicMock()
    (
        client.table.return_value.update.return_value.in_.return_value.lt.return_value
        .execute.return_value
    ) = MagicMock(data=rows)
    return client


def test_sweep_marks_only_rows_older_than_the_window() -> None:
    client = _client_returning([{"id": "a"}, {"id": "b"}])
    now = datetime(2026, 8, 18, 12, 0, tzinfo=timezone.utc)

    assert sweep_stuck_analyses(client, now=now) == 2

    update = client.table.return_value.update
    patch = update.call_args.args[0]
    assert patch["status"] == "failed_recoverable"
    # The client treats failed_recoverable as finished, so this is what
    # unblocks a poll that would otherwise never end.
    assert "retry" in patch["failure_reason"]

    in_call = update.return_value.in_
    assert in_call.call_args.args[1] == ["queued", "processing"]
    cutoff = in_call.return_value.lt.call_args.args[1]
    assert cutoff == (now - STUCK_AFTER).isoformat()


def test_sweep_once_swallows_a_failure_so_the_loop_survives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One transient Supabase error must cost one sweep, not every future one."""
    def boom(*_a, **_k):
        raise RuntimeError("supabase is having a moment")

    monkeypatch.setattr(analysis_runner, "sweep_stuck_analyses", boom)
    assert sweep_once() == 0


def test_sweep_once_returns_the_count_on_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(analysis_runner, "sweep_stuck_analyses", lambda: 3)
    assert sweep_once() == 3


def test_the_loop_keeps_sweeping_and_stops_when_cancelled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Runs more than once — the whole point — and shuts down cleanly.

    Driven with `asyncio.run` rather than `pytest.mark.asyncio`: the project has
    no async test plugin, and one loop-shaped test is not worth a dependency.
    """
    calls = 0

    def counted() -> int:
        nonlocal calls
        calls += 1
        return 0

    monkeypatch.setattr(main_module, "SWEEP_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(main_module, "sweep_once", counted)
    # **Everything else the loop calls has to be stubbed too.** Left unstubbed
    # each one reaches for a real Supabase client and a real network call, and
    # this test then fails on a proxy 403 rather than on anything about
    # sweeping. That has now happened twice — once when the transcription
    # sweeper joined the loop, once when the unclaimed-upload sweeper did, and
    # once when the unjudged-take reclaim did, once when the unreadable-scan
    # sweep did, and once when the judged-take release did — so if you are reading this
    # because the test is failing that way again, the answer is a line below
    # rather than anything wrong with the loop.
    monkeypatch.setattr(main_module, "sweep_stuck_transcriptions", lambda: 0)
    monkeypatch.setattr(
        main_module.pending_uploads, "sweep_unclaimed", lambda: 0
    )
    monkeypatch.setattr(
        main_module.take_archive, "sweep_unjudged_takes", lambda: 0
    )
    monkeypatch.setattr(
        main_module.take_archive, "sweep_judged_originals", lambda: 0
    )
    monkeypatch.setattr(
        main_module.score_archive, "sweep_unreadable_scans", lambda: 0
    )

    async def drive() -> bool:
        task = asyncio.create_task(main_module._sweep_periodically())
        await asyncio.sleep(0.08)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return task.cancelled()

    cancelled = asyncio.run(drive())

    assert calls >= 2, f"swept {calls} time(s); a periodic sweep must repeat"
    assert cancelled, "the loop must stop when the app shuts down"
