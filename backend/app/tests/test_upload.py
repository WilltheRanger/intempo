"""Tests for /v1/upload/{audio,score-image}."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import upload as upload_module

SECRET = "test-secret-do-not-use-in-prod"


def _token(sub: UUID) -> str:
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": str(sub),
        "aud": "authenticated",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=10)).timestamp()),
        "email": "user@example.com",
    }
    return jwt.encode(payload, SECRET, algorithm="HS256")


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


def test_audio_returns_signed_url(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    user_id = uuid4()
    mock_client = _mock_storage("https://signed.example.com/take.wav")
    monkeypatch.setattr(upload_module, "get_service_client", lambda: mock_client)

    res = client.post(
        "/v1/upload/audio",
        json={"filename": "take.wav"},
        headers={"Authorization": f"Bearer {_token(user_id)}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["upload_url"] == "https://signed.example.com/take.wav"
    assert body["object_key"].startswith(f"{user_id}/")
    assert body["object_key"].endswith(".wav")
    assert body["public_url"].startswith("audio-uploads/")
    # The bucket the handler signed against:
    mock_client.storage.from_.assert_called_with("audio-uploads")


def test_score_image_returns_signed_url(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    user_id = uuid4()
    mock_client = _mock_storage("https://signed.example.com/page.jpg")
    monkeypatch.setattr(upload_module, "get_service_client", lambda: mock_client)

    res = client.post(
        "/v1/upload/score-image",
        json={"filename": "page.JPG"},
        headers={"Authorization": f"Bearer {_token(user_id)}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["object_key"].startswith(f"{user_id}/")
    assert body["object_key"].endswith(".jpg")
    mock_client.storage.from_.assert_called_with("score-images")


def test_audio_rejects_disallowed_extension(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    user_id = uuid4()
    monkeypatch.setattr(upload_module, "get_service_client", lambda: _mock_storage())
    res = client.post(
        "/v1/upload/audio",
        json={"filename": "evil.exe"},
        headers={"Authorization": f"Bearer {_token(user_id)}"},
    )
    assert res.status_code == 400


def test_audio_rejects_no_extension(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    user_id = uuid4()
    monkeypatch.setattr(upload_module, "get_service_client", lambda: _mock_storage())
    res = client.post(
        "/v1/upload/audio",
        json={"filename": "noextension"},
        headers={"Authorization": f"Bearer {_token(user_id)}"},
    )
    assert res.status_code == 400


def test_expires_at_is_in_future(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    user_id = uuid4()
    monkeypatch.setattr(upload_module, "get_service_client", lambda: _mock_storage())
    before = datetime.now(tz=timezone.utc)
    res = client.post(
        "/v1/upload/audio",
        json={"filename": "take.wav"},
        headers={"Authorization": f"Bearer {_token(user_id)}"},
    )
    assert res.status_code == 200
    expires_at = datetime.fromisoformat(res.json()["expires_at"])
    assert expires_at > before
