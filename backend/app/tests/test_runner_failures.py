"""What the worker does when something goes wrong after the response was sent.

By the time any of this runs, the musician has finished playing and is watching
a progress screen. There is no request to fail — the only way to tell them
anything is the `analyses` row, so every path here has to end in a row that
says something rather than a row that stays `processing` forever.

Every branch below was uncovered. `pytest --cov` had this module at **79%**,
and the missing lines were, without exception, the failure paths.
"""

from __future__ import annotations

from uuid import uuid4

import httpx
import pytest

from app.tests.fake_supabase import FakeSupabase
from app.tests.test_analyses_api import GOOD_SCORE_JSON, _audio_url
from app.workers import analysis_runner
from app.workers.analysis_runner import (
    MAX_AUDIO_BYTES,
    AudioFetchError,
    download_audio,
)


class _Response:
    def __init__(self, status_code: int, content: bytes = b"") -> None:
        self.status_code = status_code
        self.content = content


class _Client:
    """Stands in for `httpx.Client`, recording how it was built."""

    built_with: dict = {}

    def __init__(self, **kwargs) -> None:
        _Client.built_with = kwargs

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> None:
        return None

    def get(self, _url):
        return self.response


def _client_returning(response, monkeypatch) -> None:
    _Client.response = response
    monkeypatch.setattr(analysis_runner.httpx, "Client", _Client)


def _client_raising(exc, monkeypatch) -> None:
    class _Raises(_Client):
        def get(self, _url):
            raise exc

    monkeypatch.setattr(analysis_runner.httpx, "Client", _Raises)


# ---------------------------------------------------------------------------
# Fetching the recording
# ---------------------------------------------------------------------------


def test_a_network_failure_is_named_as_one(monkeypatch) -> None:
    _client_raising(httpx.ConnectError("name resolution failed"), monkeypatch)

    with pytest.raises(AudioFetchError, match="download failed"):
        download_audio("https://storage.example/take.wav")


def test_a_refused_download_names_the_status(monkeypatch) -> None:
    """403 here means the signed URL expired, and the status is the only thing
    that distinguishes it from storage being down."""
    _client_returning(_Response(403), monkeypatch)

    with pytest.raises(AudioFetchError, match="403"):
        download_audio("https://storage.example/take.wav")


def test_a_take_exactly_at_the_cap_is_fetched(monkeypatch) -> None:
    """The boundary is inclusive, and it has been wrong before.

    This cap was 25 MB while the bucket accepted 50, so a six-minute take
    uploaded successfully, sat in storage, and was refused *here* — reported to
    the musician as `audio_unavailable`, which was not true. Anything storage
    accepted, this has to be able to fetch.
    """
    _client_returning(_Response(200, b"x" * MAX_AUDIO_BYTES), monkeypatch)

    assert len(download_audio("https://storage.example/take.wav")) == MAX_AUDIO_BYTES


def test_one_byte_over_the_cap_is_refused(monkeypatch) -> None:
    _client_returning(_Response(200, b"x" * (MAX_AUDIO_BYTES + 1)), monkeypatch)

    with pytest.raises(AudioFetchError, match="larger than"):
        download_audio("https://storage.example/take.wav")


def test_it_follows_the_redirect_storage_answers_with(monkeypatch) -> None:
    """A signed storage URL redirects. Without this the worker would fetch the
    redirect *page* and hand a few hundred bytes of HTML to the decoder."""
    _client_returning(_Response(200, b"wav"), monkeypatch)

    download_audio("https://storage.example/take.wav")

    assert _Client.built_with["follow_redirects"] is True
    assert _Client.built_with["timeout"] == analysis_runner.AUDIO_DOWNLOAD_TIMEOUT


# ---------------------------------------------------------------------------
# The run itself
# ---------------------------------------------------------------------------


def _seeded() -> tuple[FakeSupabase, str]:
    user_id, score_id = uuid4(), uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}],
    )
    analysis_id = str(uuid4())
    fake.seed(
        "analyses",
        [
            {
                "id": analysis_id,
                "user_id": str(user_id),
                "score_id": str(score_id),
                "audio_url": _audio_url(user_id),
                "target_bpm": 120,
                "bpm_source": "manual",
                "status": "queued",
            }
        ],
    )
    return fake, analysis_id


def test_a_pipeline_error_ends_the_row_rather_than_leaving_it_running(monkeypatch) -> None:
    """The catch-all, and the branch a missing `config.toml` came through.

    Anything the analysis raises has to become a finished row. A row left
    `processing` is a progress screen that never resolves, and the stuck-row
    sweeper does not touch it for ten minutes.
    """
    fake, analysis_id = _seeded()
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: b"not audio")

    analysis_runner.run_analysis(analysis_id)

    row = fake.table("analyses").rows[0]
    assert row["status"] == "failed"
    assert row["failure_reason"] == "internal_error"


def test_a_missing_score_fails_the_take_instead_of_hanging(monkeypatch) -> None:
    """A score deleted between recording and analysis, or a worker reading a
    different project. Either way the take cannot be judged, and saying so is
    the only useful thing left."""
    fake, analysis_id = _seeded()
    fake.table("scores").rows.clear()
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: b"wav")

    analysis_runner.run_analysis(analysis_id)

    row = fake.table("analyses").rows[0]
    assert row["status"] == "failed"


def test_the_row_is_marked_running_before_the_work_starts(monkeypatch) -> None:
    """So a crash mid-analysis is distinguishable from one that never began —
    which is what the stuck-row sweeper keys off."""
    fake, analysis_id = _seeded()
    seen: list[str] = []
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)

    def _record(_url):
        seen.append(fake.table("analyses").rows[0]["status"])
        raise analysis_runner.AudioFetchError("gone")

    monkeypatch.setattr(analysis_runner, "download_audio", _record)

    analysis_runner.run_analysis(analysis_id)

    assert seen == ["processing"]


# ---------------------------------------------------------------------------
# The sweeper with nothing to sweep with
# ---------------------------------------------------------------------------


def test_the_sweep_is_a_no_op_without_a_database(monkeypatch) -> None:
    """It runs every five minutes for the life of the process. On a deployment
    with no service-role key it must be quiet, not a log line every five
    minutes about a thing that was never going to work."""
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: None)

    assert analysis_runner.sweep_stuck_analyses() == 0
    assert analysis_runner.sweep_once() == 0
