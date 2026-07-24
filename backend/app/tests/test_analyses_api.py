"""Tests for /v1/analyses — enqueue, poll, the worker, and the sweeper."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Callable
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
    monkeypatch.setattr(analyses_module, "run_analysis", lambda aid: called.append(aid))

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
