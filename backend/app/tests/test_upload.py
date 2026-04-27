"""Tests for /v1/upload/{audio,score-image}.

Auth runs through the production decoder via the autouse `_stub_jwks`
fixture in conftest. Supabase storage calls are mocked.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import upload as upload_module


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _mock_storage(signed_url: str = "https://signed.example.com/upload") -> MagicMock:
    mock_client = MagicMock()
    bucket = mock_client.storage.from_.return_value
    bucket.create_signed_upload_url.return_value = {
        "signedUrl": signed_url,
        "path": "ignored-by-handler",
    }
    return mock_client


def test_audio_unauthenticated_returns_401(client: TestClient) -> None:
    res = client.post("/v1/upload/audio", json={"filename": "take.wav"})
    assert res.status_code == 401


def test_score_image_unauthenticated_returns_401(client: TestClient) -> None:
    res = client.post("/v1/upload/score-image", json={"filename": "page.jpg"})
    assert res.status_code == 401


def test_audio_returns_signed_url(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    mock_client = _mock_storage("https://signed.example.com/take.wav")
    monkeypatch.setattr(upload_module, "get_service_client", lambda: mock_client)

    res = client.post(
        "/v1/upload/audio",
        json={"filename": "take.wav"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["upload_url"] == "https://signed.example.com/take.wav"
    assert body["object_key"].startswith(f"{user_id}/")
    assert body["object_key"].endswith(".wav")
    assert body["public_url"].startswith("audio-uploads/")
    mock_client.storage.from_.assert_called_with("audio-uploads")


def test_score_image_returns_signed_url(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    mock_client = _mock_storage("https://signed.example.com/page.jpg")
    monkeypatch.setattr(upload_module, "get_service_client", lambda: mock_client)

    res = client.post(
        "/v1/upload/score-image",
        json={"filename": "page.JPG"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["object_key"].startswith(f"{user_id}/")
    assert body["object_key"].endswith(".jpg")
    mock_client.storage.from_.assert_called_with("score-images")


def test_audio_rejects_disallowed_extension(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    monkeypatch.setattr(upload_module, "get_service_client", lambda: _mock_storage())
    res = client.post(
        "/v1/upload/audio",
        json={"filename": "evil.exe"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 400


def test_audio_rejects_no_extension(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    monkeypatch.setattr(upload_module, "get_service_client", lambda: _mock_storage())
    res = client.post(
        "/v1/upload/audio",
        json={"filename": "noextension"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 400


def test_expires_at_is_in_future(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    monkeypatch.setattr(upload_module, "get_service_client", lambda: _mock_storage())
    before = datetime.now(tz=timezone.utc)
    res = client.post(
        "/v1/upload/audio",
        json={"filename": "take.wav"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200
    expires_at = datetime.fromisoformat(res.json()["expires_at"])
    assert expires_at > before
