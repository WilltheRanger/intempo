"""The worker that reads the page after the response has gone out.

The one thing this must never do is leave a row saying `reading` forever. A
musician watching that has no way to tell a slow page from a dead worker, and
no button that helps — so every test here is about a terminal state being
written, including for the failures nobody planned for.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.ocr import OCRError
from app.services.ocr.pipeline import STAGE_CONFIRMING
from app.services.score_schema import Measure, Note, ScoreJson
from app.workers import transcription_runner as runner

SCORE_ID = "11111111-1111-1111-1111-111111111111"
IMAGE_URL = "https://p.supabase.co/storage/v1/object/upload/sign/score-images/u/p.jpg"


@pytest.fixture(autouse=True)
def _a_reader_is_installed(monkeypatch):
    """These tests stub the reading pipeline, so give the pre-flight a reader.

    `_read_page` now refuses **before downloading the page** when not one
    provider in the chain exists in this process — the chain is homr alone and
    homr lives only in the Modal container, so on a developer's machine, and on
    the API host, there genuinely is nothing here that can read. Without this
    every test below would stop at that refusal instead of reaching the stub it
    installed.

    Faking availability rather than deleting the check: what these tests are
    about is what happens *given* a reader. The refusal has its own file,
    `test_homr_only_chain.py`, including the test that nothing is downloaded
    before it fires.
    """

    class _Installed:
        name = "homr"

        def available(self) -> bool:
            return True

    monkeypatch.setattr(
        "app.services.ocr.pipeline._default_chain", lambda: [_Installed()]
    )


def _score() -> ScoreJson:
    return ScoreJson(
        clef="bass",
        time_signature="4/4",
        ocr_confidence=0.88,
        measures=[
            Measure(
                measure_number=1,
                notes=[Note(pitch="C3", duration="quarter") for _ in range(4)],
            )
        ],
    )


class _Table:
    """The two calls the worker makes, recorded rather than performed."""

    def __init__(self, row: dict | None) -> None:
        self._row = row
        self.patches: list[dict] = []

    # select(...).eq(...).limit(...).execute()
    def select(self, *_args):
        return self

    def eq(self, *_args):
        return self

    def limit(self, *_args):
        return self

    def execute(self):
        return type("Res", (), {"data": [self._row] if self._row else []})()

    # update(...).eq(...).execute()
    def update(self, patch: dict):
        self.patches.append(patch)
        return self


class _Client:
    def __init__(self, table: _Table) -> None:
        self._table = table

    def table(self, _name: str) -> _Table:
        return self._table


@pytest.fixture()
def table(monkeypatch: pytest.MonkeyPatch) -> _Table:
    t = _Table({"id": SCORE_ID, "user_id": "u", "source_image_url": IMAGE_URL})
    monkeypatch.setattr(runner, "get_service_client", lambda: _Client(t))
    monkeypatch.setattr(runner, "readable_url", lambda url: url)
    monkeypatch.setattr(runner, "download_image", lambda url: b"\x89PNG\r\n\x1a\n")
    return t


def _final(table: _Table) -> dict:
    return table.patches[-1]


def _statuses(table: _Table) -> list[str]:
    return [p["transcription_status"] for p in table.patches if "transcription_status" in p]


# ---- the happy path --------------------------------------------------------


def test_a_read_page_lands_in_the_row(table, monkeypatch) -> None:
    score = _score()
    monkeypatch.setattr(runner, "parse_sheet_music", lambda *a, **k: score)

    runner.run_transcription(SCORE_ID)

    final = _final(table)
    assert final["transcription_status"] == "done"
    assert final["score_json"]["measures"][0]["notes"][0]["pitch"] == "C3"
    assert final["ocr_confidence"] == pytest.approx(0.88)
    # Cleared, not left behind: a stale stage or error under a finished score
    # reads as a warning about the notes above it.
    assert final["transcription_stage"] is None
    assert final["transcription_error"] is None
    assert _statuses(table) == ["reading", "done"]


def test_the_media_type_is_sniffed_from_the_downloaded_bytes(table, monkeypatch) -> None:
    """The bug the first phone scan found, now on the worker's side of the move.

    The page is named `.jpg` and the bytes are PNG, and it is the bytes that
    have to reach the provider's `media_type` — Anthropic rejects the pair
    otherwise.
    """
    seen: dict = {}

    def fake_parse(image_bytes, *, media_type, on_stage=None, **_engine):
        seen["media_type"] = media_type
        return _score()

    monkeypatch.setattr(runner, "parse_sheet_music", fake_parse)
    runner.run_transcription(SCORE_ID)
    assert seen["media_type"] == "image/png"


def test_each_stage_is_written_as_it_happens(table, monkeypatch) -> None:
    """The whole reason the worker exists is that this takes a visible amount
    of time, so what it reports has to be what it actually did."""

    def fake_parse(image_bytes, *, media_type, on_stage=None, **_engine):
        on_stage("reading:claude-sonnet-5")
        on_stage(STAGE_CONFIRMING)
        return _score()

    monkeypatch.setattr(runner, "parse_sheet_music", fake_parse)
    runner.run_transcription(SCORE_ID)

    stages = [p["transcription_stage"] for p in table.patches if "transcription_stage" in p]
    assert stages == [
        "Fetching the page",
        # Not the provider's name. "claude-sonnet-5" tells a musician nothing
        # they can act on and rather more than they asked about.
        "Reading the notation",
        "Checking the bar counts",
        None,
    ]


# ---- every way it can end badly -------------------------------------------


def test_an_unreadable_page_fails_with_advice(table, monkeypatch) -> None:
    monkeypatch.setattr(
        runner,
        "parse_sheet_music",
        lambda *a, **k: (_ for _ in ()).throw(OCRError("every provider failed")),
    )
    runner.run_transcription(SCORE_ID)

    final = _final(table)
    assert final["transcription_status"] == "failed"
    # Something the musician can act on, not the pipeline's own words.
    assert "flatter" in final["transcription_error"]
    assert final["transcription_stage"] is None


def test_a_failed_download_says_so_rather_than_blaming_the_notation(table, monkeypatch) -> None:
    """`page_image` raises HTTPException because its other caller is a request
    handler. Here only the sentence matters, and it has to be the right one —
    telling someone to retake a photograph that was never fetched wastes their
    time."""
    monkeypatch.setattr(
        runner,
        "download_image",
        lambda url: (_ for _ in ()).throw(HTTPException(status_code=502, detail="nope")),
    )
    runner.run_transcription(SCORE_ID)

    final = _final(table)
    assert final["transcription_status"] == "failed"
    assert "storage" in final["transcription_error"]


def test_an_unplanned_error_still_ends_the_row(table, monkeypatch) -> None:
    """The important one. Anything at all beats a row stuck on `reading`."""
    monkeypatch.setattr(
        runner,
        "parse_sheet_music",
        lambda *a, **k: (_ for _ in ()).throw(ZeroDivisionError("surprise")),
    )
    runner.run_transcription(SCORE_ID)
    assert _final(table)["transcription_status"] == "failed"


def test_a_row_with_no_photograph_fails_immediately(monkeypatch) -> None:
    t = _Table({"id": SCORE_ID, "user_id": "u", "source_image_url": None})
    monkeypatch.setattr(runner, "get_service_client", lambda: _Client(t))
    runner.run_transcription(SCORE_ID)
    assert _final(t)["transcription_status"] == "failed"


def test_a_missing_row_is_logged_and_dropped(monkeypatch) -> None:
    """Not an error to write anywhere — the row it would be written to is the
    one that isn't there. Deleting a piece while its scan is in flight is the
    ordinary way to reach this."""
    t = _Table(None)
    monkeypatch.setattr(runner, "get_service_client", lambda: _Client(t))
    runner.run_transcription(SCORE_ID)
    assert t.patches == []


def test_no_service_client_does_not_raise(monkeypatch) -> None:
    monkeypatch.setattr(runner, "get_service_client", lambda: None)
    runner.run_transcription(SCORE_ID)  # must simply return


def test_a_stage_write_that_fails_does_not_lose_the_transcription(table, monkeypatch) -> None:
    """Reporting progress is a courtesy. Trading a finished transcription for a
    failed courtesy would be an absurd bargain, so the writes swallow."""
    calls = {"n": 0}
    real_update = table.update

    def flaky(patch: dict):
        calls["n"] += 1
        if patch.get("transcription_stage") == "Reading the notation":
            raise RuntimeError("storage blipped")
        return real_update(patch)

    table.update = flaky

    def fake_parse(image_bytes, *, media_type, on_stage=None, **_engine):
        on_stage("reading:claude-sonnet-4-6")
        return _score()

    monkeypatch.setattr(runner, "parse_sheet_music", fake_parse)
    runner.run_transcription(SCORE_ID)
    assert _final(table)["transcription_status"] == "done"


# ---- what the musician is told ---------------------------------------------


@pytest.mark.parametrize(
    "detail,expected",
    [
        (
            "all providers failed: claude-sonnet-4-6: the transcription was cut "
            "off at 16000 tokens — this page has more notes than one response can hold",
            "fewer bars",
        ),
        ("all providers failed: claude-sonnet-4-6: RateLimitError: rate limit", "busy"),
        ("all providers failed: gemini-flash: GEMINI_API_KEY is not configured", "our"),
        (
            "all providers failed: claude: BadRequestError: image media type mismatch",
            "format",
        ),
    ],
)
def test_the_reason_matches_what_actually_happened(
    table, monkeypatch, detail: str, expected: str
) -> None:
    """The default used to be the only answer, and it was a guess.

    Every failed read said "a flatter, better-lit shot usually fixes it",
    including for a sharp photograph that had simply run past the output cap.
    Sending someone to re-photograph a page that was never the problem is worse
    than saying nothing: it is confident, actionable and wrong, and they will
    do it, and it will fail again in the same place.
    """
    monkeypatch.setattr(
        runner,
        "parse_sheet_music",
        lambda *a, **k: (_ for _ in ()).throw(OCRError(detail)),
    )
    runner.run_transcription(SCORE_ID)

    final = _final(table)
    assert final["transcription_status"] == "failed"
    assert expected in final["transcription_error"]
    # And specifically NOT the photograph, which was never at fault here.
    assert "better-lit" not in final["transcription_error"]


def test_an_unrecognised_failure_still_says_something_useful(table, monkeypatch) -> None:
    """The photograph is blamed only when nothing more specific is known —
    which is the one case where it is a fair guess rather than a wrong one."""
    monkeypatch.setattr(
        runner,
        "parse_sheet_music",
        lambda *a, **k: (_ for _ in ()).throw(OCRError("all providers failed: ???")),
    )
    runner.run_transcription(SCORE_ID)
    assert "better-lit" in _final(table)["transcription_error"]


# ---------------------------------------------------------------------------
# Asking Modal what became of a read, instead of guessing
#
# A page dispatched to Modal leaves no trace except the `scores` row, and Modal
# is what writes that row. So a container that dies *before its first write* —
# a bad secret, an image that will not import, an OOM at start-up — leaves the
# row exactly as a slow read leaves it. The sweeper reported both as "stopped
# before it finished", and that sentence was shown to a musician twice for two
# entirely different faults without either being diagnosed.
#
# `fn.spawn()` returns a call id. Modal answers questions about it long after
# the container is gone.
# ---------------------------------------------------------------------------


class _SweepClient:
    """A Supabase stand-in that hands back stuck rows and records the updates."""

    def __init__(self, rows):
        self._rows = rows
        self.updates: list[tuple[dict, str]] = []
        self._pending: dict | None = None
        self._id: str | None = None

    def table(self, _name):
        return self

    def select(self, *_a, **_k):
        return self

    def in_(self, *_a, **_k):
        return self

    def lt(self, *_a, **_k):
        return self

    def eq(self, _col, value):
        self._id = value
        return self

    def update(self, payload):
        self._pending = payload
        return self

    def execute(self):
        if self._pending is not None:
            self.updates.append((self._pending, self._id))
            self._pending = None
            return type("R", (), {"data": [{"id": self._id}]})()
        return type("R", (), {"data": self._rows})()


def _sweep(monkeypatch, rows, verdict):
    from app.workers import transcription_runner as runner

    monkeypatch.setattr(runner, "_modal_verdict", lambda call_id: verdict)
    client = _SweepClient(rows)
    swept = runner.sweep_stuck_transcriptions(client)
    return swept, client.updates


def test_a_read_modal_says_is_still_running_is_not_failed(monkeypatch) -> None:
    """The cutoff is a guess about elapsed time; Modal knows.

    Failing a read that is about to succeed costs the photograph, the upload
    and the wait — for the sake of a progress bar that would have finished.
    """
    from app.workers.transcription_runner import _STILL_RUNNING

    swept, updates = _sweep(
        monkeypatch, [{"id": "s1", "transcription_call_id": "fc-1"}], _STILL_RUNNING
    )

    assert swept == 0
    assert updates == [], "a running read must not be touched at all"


def test_modals_reason_is_reported_rather_than_ours(monkeypatch) -> None:
    """The whole point. "Stopped before it finished" is what we say when we do
    not know; when Modal knows, it says."""
    swept, updates = _sweep(
        monkeypatch,
        [{"id": "s1", "transcription_call_id": "fc-1"}],
        "The transcription service is not configured.",
    )

    assert swept == 1
    payload, row_id = updates[0]
    assert row_id == "s1"
    assert payload["transcription_status"] == "failed"
    assert payload["transcription_error"] == "The transcription service is not configured."
    assert "stopped before it finished" not in payload["transcription_error"]


def test_a_row_with_no_call_id_is_swept_exactly_as_before(monkeypatch) -> None:
    """Read in-process, or written before the column existed. There is nothing
    to ask, so the old sentence is still the honest one."""
    from app.workers.transcription_runner import _SWEPT_WITHOUT_A_REASON

    swept, updates = _sweep(
        monkeypatch, [{"id": "s1", "transcription_call_id": None}],
        _SWEPT_WITHOUT_A_REASON,
    )

    assert swept == 1
    assert updates[0][0]["transcription_error"] == _SWEPT_WITHOUT_A_REASON


def test_one_running_read_does_not_hold_up_the_others(monkeypatch) -> None:
    """The sweep is per row now. A single call Modal will not answer about must
    not leave every other stuck scan un-swept."""
    from app.workers import transcription_runner as runner

    monkeypatch.setattr(
        runner,
        "_modal_verdict",
        lambda call_id: runner._STILL_RUNNING if call_id == "fc-1" else "gone",
    )
    client = _SweepClient(
        [
            {"id": "s1", "transcription_call_id": "fc-1"},
            {"id": "s2", "transcription_call_id": "fc-2"},
            {"id": "s3", "transcription_call_id": None},
        ]
    )

    assert runner.sweep_stuck_transcriptions(client) == 2
    assert {row_id for _, row_id in client.updates} == {"s2", "s3"}


def test_the_verdict_falls_back_to_the_old_sentence_when_modal_cannot_answer() -> None:
    """**Never leaves a row stuck.** A musician waiting on a progress bar is
    not helped by our being unsure, and a row that is never swept is the exact
    bug the sweeper was written to fix."""
    from app.workers.transcription_runner import (
        _SWEPT_WITHOUT_A_REASON,
        _modal_verdict,
    )

    # No id to ask about at all.
    assert _modal_verdict(None) == _SWEPT_WITHOUT_A_REASON
    assert _modal_verdict("") == _SWEPT_WITHOUT_A_REASON


def test_a_finished_call_that_wrote_nothing_does_not_blame_the_photograph(
    monkeypatch,
) -> None:
    """Modal says it succeeded and the row never changed. Whatever went wrong,
    it was not the page — and the default sentence would send someone out to
    re-shoot a photograph that was fine."""
    import sys
    import types

    from app.workers.transcription_runner import _modal_verdict

    fake = types.ModuleType("modal")

    class _Call:
        @staticmethod
        def from_id(_id):
            return type("C", (), {"get": staticmethod(lambda **_k: None)})()

    fake.FunctionCall = _Call
    monkeypatch.setitem(sys.modules, "modal", fake)

    reason = _modal_verdict("fc-1")

    assert "our side" in reason
    assert "flatter" not in reason, "that is the re-photograph advice"


def test_a_call_that_raised_is_reported_with_that_reason(monkeypatch) -> None:
    """And routed through `_why_it_failed`, which already knows how to turn
    "not installed" into a sentence that says this is our fault."""
    import sys
    import types

    from app.workers.transcription_runner import _modal_verdict

    fake = types.ModuleType("modal")

    class _Call:
        @staticmethod
        def from_id(_id):
            def _get(**_k):
                raise RuntimeError("homr is not installed in this container")

            return type("C", (), {"get": staticmethod(_get)})()

    fake.FunctionCall = _Call
    monkeypatch.setitem(sys.modules, "modal", fake)

    reason = _modal_verdict("fc-1")

    assert "not with your photograph" in reason


def test_a_still_running_call_is_recognised_by_name_not_by_class() -> None:
    """Matched on the exception's *name* because Modal's exception module path
    has moved between versions, and importing it to compare would make a
    version bump silently reclassify every in-flight read as a failure."""
    from app.workers.transcription_runner import _is_still_running

    class FunctionTimeoutError(Exception):
        pass

    class OutputNotFinished(Exception):
        pass

    assert _is_still_running(TimeoutError())
    assert _is_still_running(FunctionTimeoutError())
    assert _is_still_running(OutputNotFinished())
    assert not _is_still_running(RuntimeError("homr is not installed"))
    assert not _is_still_running(ValueError("Invalid metadata value"))
