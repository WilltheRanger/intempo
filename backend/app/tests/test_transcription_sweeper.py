"""Reads that stopped happening.

**Reported from a phone.** A musician photographed a page, left the screen, and
came back to "Reading the notation" with the progress bar part-filled —
permanently. Nothing was reading it and nothing was ever going to.

`run_transcription` runs in `BackgroundTasks`, which is to say *in the web
process*, so anything that ends the process ends the read: a deploy, the OOM
reaper, or a free-tier instance spinning down after fifteen minutes idle —
which is exactly what leaving the screen brings about, because the polling that
was keeping it awake stops with you.

Analyses have had a sweeper for this since Batch 4. Scores never got one, and
the failure is worse here: an analysis can be recorded again in a minute, while
a scan that dies has already spent the photograph, the upload and the model
call.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.tests.fake_supabase import FakeSupabase
from app.workers import transcription_runner
from app.workers.transcription_runner import STUCK_AFTER, sweep_stuck_transcriptions

NOW = datetime(2026, 5, 17, 12, 0, tzinfo=timezone.utc)


def _scores(*rows: dict) -> FakeSupabase:
    fake = FakeSupabase()
    fake.seed("scores", list(rows))
    return fake


def _row(score_id: str, status: str, *, age: timedelta) -> dict:
    return {
        "id": score_id,
        "transcription_status": status,
        "transcription_stage": "reading",
        "transcription_error": None,
        "updated_at": (NOW - age).isoformat(),
    }


def test_a_read_that_stopped_is_failed_rather_than_left_running() -> None:
    fake = _scores(_row("s1", "reading", age=STUCK_AFTER + timedelta(minutes=1)))

    assert sweep_stuck_transcriptions(fake, now=NOW) == 1

    row = fake.table("scores").rows[0]
    assert row["transcription_status"] == "failed"
    assert row["transcription_stage"] is None, "a failed read is not at a stage"


def test_the_musician_is_told_the_photograph_survived() -> None:
    """The one thing they need to know. A scan that dies has already spent the
    photograph, the upload and the model call; "try again" is only actionable
    if it does not mean photographing the page again."""
    fake = _scores(_row("s1", "reading", age=STUCK_AFTER * 2))

    sweep_stuck_transcriptions(fake, now=NOW)

    reason = fake.table("scores").rows[0]["transcription_error"]
    assert "photograph is still here" in reason.lower()
    assert "again" in reason.lower()


def test_a_scan_still_waiting_its_turn_is_left_alone() -> None:
    """`queued` is not a euphemism — a scan waits behind
    `TRANSCRIPTION_MAX_CONCURRENT`, legitimately, for as long as the queue
    ahead of it takes. Failing one that was about to be read would be the
    sweeper causing the problem it exists to fix."""
    fake = _scores(_row("s1", "queued", age=timedelta(minutes=2)))

    assert sweep_stuck_transcriptions(fake, now=NOW) == 0
    assert fake.table("scores").rows[0]["transcription_status"] == "queued"


def test_a_read_in_progress_is_left_alone() -> None:
    fake = _scores(_row("s1", "reading", age=timedelta(seconds=30)))

    assert sweep_stuck_transcriptions(fake, now=NOW) == 0


def test_a_queued_scan_that_never_started_is_swept_too() -> None:
    """The process can die between writing the row and starting the read, and
    then nothing ever will — the only thing that starts one is the request that
    created the score."""
    fake = _scores(_row("s1", "queued", age=STUCK_AFTER + timedelta(minutes=5)))

    assert sweep_stuck_transcriptions(fake, now=NOW) == 1


def test_a_finished_page_is_never_touched() -> None:
    """Sweeping a `done` row would delete a reading that worked, and an old
    `updated_at` is exactly what a finished page has."""
    fake = _scores(
        _row("done", "done", age=timedelta(days=30)),
        _row("failed", "failed", age=timedelta(days=30)),
    )

    assert sweep_stuck_transcriptions(fake, now=NOW) == 0
    assert {r["transcription_status"] for r in fake.table("scores").rows} == {
        "done",
        "failed",
    }


def test_it_is_a_no_op_without_a_database(monkeypatch, caplog) -> None:
    """It runs every five minutes for the life of the process. On a deployment
    with no service-role key it has to be **quiet**.

    Returning 0 is not enough to check, and a mutation proved it: delete the
    `client is None` guard and `None.table(...)` raises, the catch-all swallows
    it, and 0 comes back anyway — while a traceback is logged every five
    minutes about a thing that was never going to work. So the assertion is
    about the log, not the return value.
    """
    monkeypatch.setattr(transcription_runner, "get_service_client", lambda: None)

    with caplog.at_level("WARNING"):
        assert sweep_stuck_transcriptions() == 0

    assert not caplog.records, (
        f"an unconfigured deployment was logged at: {[r.message for r in caplog.records]}"
    )


def test_one_bad_sweep_costs_one_sweep(monkeypatch) -> None:
    """Contained like the analysis one. A transient Supabase error must not end
    recovery for the lifetime of the process — the periodic loop calls this
    directly, so there is no outer `sweep_once` to catch for it."""

    class _Broken:
        def table(self, _name):
            raise RuntimeError("connection reset")

    for _ in range(3):
        assert sweep_stuck_transcriptions(_Broken(), now=NOW) == 0


def test_it_is_wired_into_the_periodic_sweep() -> None:
    """A sweeper nobody calls recovers nothing. The analysis one is called from
    two places — startup and the loop — and this has to be called from both or
    it only fixes the crash you restart after.
    """
    from pathlib import Path

    import re

    source = (Path(__file__).resolve().parents[1] / "main.py").read_text()
    # Comments stripped first. The periodic loop carries a comment naming this
    # function, so a mutation that replaced the *call* with `pass` left the
    # name in the file and this test went on passing — checking that the word
    # appears, not that anything runs.
    code = re.sub(r"#[^\n]*", "", source)

    periodic = code.split("async def _sweep_periodically")[1].split("@asynccontextmanager")[0]
    assert "to_thread(sweep_stuck_transcriptions)" in periodic, (
        "it only runs at startup, so a read that dies on a server which keeps "
        "serving stays stuck until the next deploy"
    )

    startup = code.split("async def lifespan")[1]
    assert "sweep_stuck_transcriptions()" in startup, (
        "nothing recovers the reads that were in flight when the process died"
    )


# ---- a page being read on another machine ---------------------------------


def test_a_read_on_modal_is_given_longer_before_it_is_declared_dead(monkeypatch) -> None:
    """"Nothing has happened yet" is not the same fact on both sides.

    In-process, ten minutes of no progress means the process reading the page is
    gone — `BackgroundTasks` runs here, so there is nothing else it could be
    waiting for. On Modal the row sits `queued` for the whole of a cold start,
    and Modal builds images **lazily, on first invocation**: this one installs
    homr and 151 MB of ONNX weights. At ten minutes the sweeper would fail the
    first page ever read on Modal while Modal was still building the container
    to read it.
    """
    from app.workers import dispatch, transcription_runner

    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", "modal")
    assert transcription_runner._stuck_after() == transcription_runner.STUCK_AFTER_REMOTE

    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", "inprocess")
    assert transcription_runner._stuck_after() == transcription_runner.STUCK_AFTER

    assert (
        transcription_runner.STUCK_AFTER_REMOTE > transcription_runner.STUCK_AFTER
    ), "the remote cutoff is not actually longer"


def test_a_page_mid_cold_start_is_left_alone(monkeypatch) -> None:
    """The failure this prevents, end to end: a row twelve minutes old, on a
    deployment that reads on Modal, is a container still being built — not a
    dead read."""
    from app.workers import dispatch

    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", "modal")
    fake = _scores(_row("s1", "queued", age=STUCK_AFTER + timedelta(minutes=2)))

    assert sweep_stuck_transcriptions(fake, now=NOW) == 0, (
        "a container still being built was failed as a dead read"
    )
    assert fake.table("scores").rows[0]["transcription_status"] == "queued"


def test_a_page_that_really_is_dead_is_still_swept_on_modal(monkeypatch) -> None:
    """Longer is not forever. Past the remote cutoff nothing is coming."""
    from app.workers import dispatch
    from app.workers.transcription_runner import STUCK_AFTER_REMOTE

    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", "modal")
    fake = _scores(_row("s1", "reading", age=STUCK_AFTER_REMOTE + timedelta(minutes=1)))

    assert sweep_stuck_transcriptions(fake, now=NOW) == 1


def test_the_message_no_longer_names_a_cause_it_cannot_know() -> None:
    """It said "the server restarted while it was working". On a read handed to
    Modal that is not even the right kind of explanation, and a confident wrong
    reason is worse than none — this project has been here before with "a
    flatter, better-lit shot of the page usually fixes it"."""
    fake = _scores(_row("s1", "reading", age=STUCK_AFTER * 4))

    sweep_stuck_transcriptions(fake, now=NOW)

    said = fake.table("scores").rows[0]["transcription_error"]
    assert "server restarted" not in said
    assert "try reading it again" in said
