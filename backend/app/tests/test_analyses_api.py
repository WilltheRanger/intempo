"""Tests for /v1/analyses — enqueue, poll, the worker, and the sweeper."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import analyses as analyses_module
from app.tests.audio_helpers import evenly_spaced, synth_click_track
from app.tests.fake_supabase import FakeSupabase
from app.workers import analysis_runner
from app.workers.analysis_runner import sweep_stuck_analyses

PROJECT_HOST = "https://test.supabase.invalid"

GOOD_SCORE_JSON = {
    "clef": "treble",
    "time_signature": "4/4",
    "key_signature": None,
    "tempo_marking": None,
    "bpm_hint": None,
    "measures": [
        {"measure_number": 1, "notes": [{"pitch": "A4", "duration": "quarter"}] * 4, "slurs": []},
        {"measure_number": 2, "notes": [{"pitch": "A4", "duration": "quarter"}] * 4, "slurs": []},
    ],
    "repeats": [],
    "ocr_confidence": 0.9,
    "notes_to_human": "",
}


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _audio_url(user_id: UUID) -> str:
    return f"{PROJECT_HOST}/storage/v1/object/sign/audio-uploads/{user_id}/take.wav?token=x"


def _wav_bytes(bpm: float = 120.0, n: int = 8) -> bytes:
    import io

    import soundfile as sf

    y = synth_click_track(evenly_spaced(n, bpm), sr=22050)
    buf = io.BytesIO()
    sf.write(buf, y, 22050, format="WAV")
    return buf.getvalue()


def _install(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabase) -> None:
    # Router and worker must share the SAME fake so the enqueue→run→poll
    # flow is consistent.
    monkeypatch.setattr(analyses_module, "get_service_client", lambda: fake)
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)


# ---- auth / validation ----------------------------------------------------


def test_post_unauthenticated_returns_401(client: TestClient) -> None:
    res = client.post("/v1/analyses", json={
        "score_id": str(uuid4()), "audio_url": "x", "target_bpm": 120, "bpm_source": "manual",
    })
    assert res.status_code == 401


def test_post_rejects_foreign_audio_url(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    fake = FakeSupabase()
    _install(monkeypatch, fake)
    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(uuid4()),
            "audio_url": "https://evil.example.com/steal.wav",
            "target_bpm": 120,
            "bpm_source": "manual",
        },
    )
    assert res.status_code == 403


def test_post_unknown_score_returns_404(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    fake = FakeSupabase()  # no score seeded
    _install(monkeypatch, fake)
    monkeypatch.setattr(analysis_runner, "run_analysis", lambda _id: None)
    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(uuid4()),
            "audio_url": _audio_url(user_id),
            "target_bpm": 120,
            "bpm_source": "manual",
        },
    )
    assert res.status_code == 404


# ---- enqueue + poll -------------------------------------------------------


def test_post_enqueues_and_returns_202(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}])
    _install(monkeypatch, fake)

    # Spy on the background worker instead of running it here.
    called: list[str] = []
    monkeypatch.setattr(
        analyses_module, "start_analysis", lambda aid, _tasks: called.append(aid)
    )

    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 120,
            "bpm_source": "manual",
        },
    )
    assert res.status_code == 202
    body = res.json()
    assert body["status"] == "queued"
    assert called == [body["analysis_id"]]  # background task got the new id


def test_audio_key_is_stored_durably_and_retry_is_idempotent(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A lost POST response must not upload, charge or enqueue the take twice."""
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}],
    )
    _install(monkeypatch, fake)
    called: list[str] = []
    monkeypatch.setattr(
        analyses_module, "start_analysis", lambda aid, _tasks: called.append(aid)
    )
    headers = {"Authorization": f"Bearer {make_token(sub=user_id)}"}
    body = {
        "score_id": str(score_id),
        "audio_key": f"{user_id}/take.wav",
        "target_bpm": 120,
        "bpm_source": "manual",
    }

    first = client.post("/v1/analyses", headers=headers, json=body)
    second = client.post("/v1/analyses", headers=headers, json=body)

    assert first.status_code == second.status_code == 202
    assert first.json()["analysis_id"] == second.json()["analysis_id"]
    assert len(fake.table("analyses").rows) == 1
    stored = fake.table("analyses").rows[0]["audio_url"]
    assert f"/object/authenticated/audio-uploads/{user_id}/take.wav" in stored
    assert "token=" not in stored
    assert called == [first.json()["analysis_id"]]


def test_post_rejects_another_accounts_audio_key(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    fake = FakeSupabase()
    _install(monkeypatch, fake)

    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(uuid4()),
            "audio_key": f"{uuid4()}/take.wav",
            "target_bpm": 120,
            "bpm_source": "manual",
        },
    )

    assert res.status_code == 403


def test_full_flow_queued_to_done(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}])
    _install(monkeypatch, fake)
    # Real worker runs (TestClient executes BackgroundTasks after response);
    # only stub the storage fetch so the real pipeline analyzes real audio.
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: _wav_bytes())

    token = make_token(sub=user_id)
    post = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 120,
            "bpm_source": "manual",
        },
    )
    assert post.status_code == 202
    analysis_id = post.json()["analysis_id"]

    got = client.get(f"/v1/analyses/{analysis_id}", headers={"Authorization": f"Bearer {token}"})
    assert got.status_code == 200
    body = got.json()
    assert body["status"] == "done"
    assert body["result_json"]["status"] == "ok"
    assert body["alignment_quality"] is not None
    assert body["finished_at"] is not None


def test_worker_marks_failed_when_audio_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id, score_id = uuid4(), uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}])
    analysis_id = str(uuid4())
    fake.seed("analyses", [{
        "id": analysis_id, "user_id": str(user_id), "score_id": str(score_id),
        "audio_url": _audio_url(user_id), "target_bpm": 120, "bpm_source": "manual",
        "status": "queued",
    }])
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)

    def _boom(_url):
        raise analysis_runner.AudioFetchError("gone")

    monkeypatch.setattr(analysis_runner, "download_audio", _boom)

    analysis_runner.run_analysis(analysis_id)

    row = fake.table("analyses").rows[0]
    assert row["status"] == "failed"
    assert row["failure_reason"] == "audio_unavailable"


def test_get_unknown_analysis_returns_404(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    fake = FakeSupabase()
    _install(monkeypatch, fake)
    res = client.get(
        f"/v1/analyses/{uuid4()}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 404


# ---- list ------------------------------------------------------------------


def _analysis_row(user_id: UUID, score_id: UUID, **over: Any) -> dict:
    now = datetime.now(tz=timezone.utc).isoformat()
    row = {
        "id": str(uuid4()),
        "user_id": str(user_id),
        "score_id": str(score_id),
        "audio_url": _audio_url(user_id),
        "status": "done",
        "target_bpm": 96.0,
        "bpm_source": "manual",
        "metronome_mode": "off",
        "result_json": {"verdict": {"text": "Steady"}},
        "alignment_quality": 0.9,
        "created_at": now,
        "updated_at": now,
        "finished_at": now,
    }
    row.update(over)
    return row


def test_list_returns_only_the_callers_analyses(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The owner filter is the whole point — Insights reads this endpoint."""
    mine, theirs = uuid4(), uuid4()
    score = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "analyses",
        [
            _analysis_row(mine, score),
            _analysis_row(mine, score),
            _analysis_row(theirs, uuid4()),
        ],
    )
    _install(monkeypatch, fake)

    res = client.get(
        "/v1/analyses", headers={"Authorization": f"Bearer {make_token(sub=mine)}"}
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 2
    assert {row["user_id"] for row in body} == {str(mine)}


def test_list_filters_by_score_and_status(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    wanted, other = uuid4(), uuid4()
    fake = FakeSupabase()
    fake.seed(
        "analyses",
        [
            _analysis_row(user_id, wanted, status="done"),
            _analysis_row(user_id, wanted, status="queued"),
            _analysis_row(user_id, other, status="done"),
        ],
    )
    _install(monkeypatch, fake)
    headers = {"Authorization": f"Bearer {make_token(sub=user_id)}"}

    by_score = client.get(f"/v1/analyses?score_id={wanted}", headers=headers)
    assert by_score.status_code == 200
    assert len(by_score.json()) == 2

    done_only = client.get(f"/v1/analyses?score_id={wanted}&status=done", headers=headers)
    assert done_only.status_code == 200
    assert [row["status"] for row in done_only.json()] == ["done"]


def test_list_unauthenticated_returns_401(client: TestClient) -> None:
    assert client.get("/v1/analyses").status_code == 401


# ---- crash-recovery sweeper ----------------------------------------------


def test_sweeper_recovers_stuck_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeSupabase()
    old = (datetime.now(tz=timezone.utc) - timedelta(minutes=15)).isoformat()
    fresh = datetime.now(tz=timezone.utc).isoformat()
    fake.seed("analyses", [
        {"id": "1", "status": "processing", "updated_at": old},
        {"id": "2", "status": "queued", "updated_at": old},
        {"id": "3", "status": "processing", "updated_at": fresh},  # too recent — leave it
        {"id": "4", "status": "done", "updated_at": old},  # already terminal
    ])

    swept = sweep_stuck_analyses(fake)

    assert swept == 2
    by_id = {r["id"]: r for r in fake.table("analyses").rows}
    assert by_id["1"]["status"] == "failed_recoverable"
    assert by_id["2"]["status"] == "failed_recoverable"
    assert by_id["3"]["status"] == "processing"
    assert by_id["4"]["status"] == "done"


def _submit(
    client: TestClient,
    token: str,
    user_id: UUID,
    score_id: UUID,
    **extra: object,
) -> str:
    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 120,
            "bpm_source": "manual",
            **extra,
        },
    )
    assert res.status_code == 202, res.text
    return res.json()["analysis_id"]


@pytest.mark.parametrize(
    ("instrument", "expected_flag"),
    [
        ("double_bass", True),
        ("cello", False),
        ("violin", False),
        (None, False),
    ],
)
def test_the_instrument_decides_the_double_bass_setting(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
    instrument: str | None,
    expected_flag: bool,
) -> None:
    """`analyze()`'s `double_bass` flag had no caller that ever set it.

    It turns on a high-pass filter and a lower onset threshold for the register
    where attacks are softest — and every bass player was analysed without it,
    in an app whose spec names double bass as its initial instrument focus.
    This is the test that the flag is reachable at all.

    Cello is here deliberately: it reads bass clef and it is *not* a double
    bass. Its low C is around 65 Hz, under the 80 Hz high-pass, so treating the
    two alike would filter away the fundamental of the notes a cellist most
    needs heard.
    """
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}],
    )
    _install(monkeypatch, fake)
    monkeypatch.setattr(analysis_runner, "download_audio", lambda _url: _wav_bytes())

    seen: list[bool] = []
    real = analysis_runner.analyze

    def spy(audio, score, target_bpm, **kwargs):
        seen.append(bool(kwargs.get("double_bass")))
        return real(audio, score, target_bpm, **kwargs)

    monkeypatch.setattr(analysis_runner, "analyze", spy)

    token = make_token(sub=user_id)
    extra = {} if instrument is None else {"instrument": instrument}
    _submit(client, token, user_id, score_id, **extra)

    assert seen == [expected_flag]


def test_the_instrument_is_stored_and_read_back(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Stored as the instrument, not as a derived flag — how each instrument
    should be treated is still being tuned, and a column holding today's
    conclusion could never answer "how did the cellists do"."""
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}],
    )
    _install(monkeypatch, fake)
    monkeypatch.setattr(analyses_module, "start_analysis", lambda _id, _tasks: None)

    token = make_token(sub=user_id)
    analysis_id = _submit(client, token, user_id, score_id, instrument="double_bass")

    got = client.get(
        f"/v1/analyses/{analysis_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert got.status_code == 200
    assert got.json()["instrument"] == "double_bass"


def test_an_unknown_instrument_is_refused_rather_than_ignored(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A closed enum, so a typo cannot quietly become "not stated"."""
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}],
    )
    _install(monkeypatch, fake)

    res = client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 120,
            "bpm_source": "manual",
            "instrument": "theremin",
        },
    )
    assert res.status_code == 422


# --------------------------------------------------------------------------
# Skipping the long rests
#
# The flag has to reach the worker: skipping a rest the timeline still contains
# takes an otherwise perfect take from quality 1.000 to 0.000. See
# `test_long_rest_parity.py` for that measurement and migration 012 for why the
# key is written only when it is true.
# --------------------------------------------------------------------------


def _post_take(client, token: str, user_id: UUID, score_id, **extra) -> Any:
    return client.post(
        "/v1/analyses",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 96,
            "bpm_source": "manual",
            **extra,
        },
    )


def test_a_take_that_skipped_the_rests_says_so_on_the_row(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}])
    _install(monkeypatch, fake)
    monkeypatch.setattr(analysis_runner, "run_analysis", lambda _id: None)

    res = _post_take(
        client, make_token(sub=user_id), user_id, score_id, skip_long_rests=True
    )

    assert res.status_code == 202, res.text
    assert fake.table("analyses").rows[0]["skip_long_rests"] is True


def test_a_take_that_did_not_skip_writes_no_key_at_all(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """**So a deployment without migration 012 is untouched until it matters.**

    Writing `false` on every take would break every insert on a table that
    predates the column — for a fact that is only ever interesting when true.
    """
    user_id = uuid4()
    score_id = uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [{"id": str(score_id), "user_id": str(user_id), "score_json": GOOD_SCORE_JSON}])
    _install(monkeypatch, fake)
    monkeypatch.setattr(analysis_runner, "run_analysis", lambda _id: None)

    assert (
        _post_take(client, make_token(sub=user_id), user_id, score_id).status_code == 202
    )
    assert "skip_long_rests" not in fake.table("analyses").rows[0]

    assert (
        _post_take(
            client, make_token(sub=user_id), user_id, score_id, skip_long_rests=False
        ).status_code
        == 202
    )
    assert "skip_long_rests" not in fake.table("analyses").rows[1]
