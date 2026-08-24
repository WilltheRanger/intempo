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
