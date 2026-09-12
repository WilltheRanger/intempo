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

from app import db as db_module
from app.main import app


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


def _install(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """The mocked storage client, wired into the handler."""
    sb = _mock_storage()
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)
    return sb


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
    monkeypatch.setattr(db_module, "get_service_client", lambda: mock_client)

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
    monkeypatch.setattr(db_module, "get_service_client", lambda: mock_client)

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
    monkeypatch.setattr(db_module, "get_service_client", lambda: _mock_storage())
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
    monkeypatch.setattr(db_module, "get_service_client", lambda: _mock_storage())
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
    monkeypatch.setattr(db_module, "get_service_client", lambda: _mock_storage())
    before = datetime.now(tz=timezone.utc)
    res = client.post(
        "/v1/upload/audio",
        json={"filename": "take.wav"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200
    expires_at = datetime.fromisoformat(res.json()["expires_at"])
    assert expires_at > before


# ---- profile pictures --------------------------------------------------------


def test_an_avatar_gets_a_signed_url_in_its_own_bucket(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token
) -> None:
    """Its own bucket rather than a folder in `score-images`: a page photograph
    is transient and deleted when the reading is accepted, an avatar lives as
    long as the account. Sharing one would mean one retention rule for both."""
    user_id = uuid4()
    sb = _install(monkeypatch)

    res = client.post(
        "/v1/upload/avatar",
        json={"filename": "me.jpg"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    assert res.status_code == 200, res.text
    assert sb.storage.from_.call_args.args[0] == "avatars"
    assert res.json()["object_key"].startswith(f"{user_id}/")


def test_heic_is_refused_for_an_avatar_though_a_page_may_be_one(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token
) -> None:
    """Not an oversight, and the asymmetry is the point.

    A photographed page is downloaded by the worker and decoded by Pillow,
    which reads HEIC through `pillow-heif`. An avatar is never decoded by
    anything — it goes straight to an `<img>` from a signed URL, and Chrome and
    Firefox cannot display HEIC. Accepting one stores a picture most browsers
    render as broken, with nothing reporting a problem.
    """
    _install(monkeypatch)
    token = make_token(sub=uuid4())

    avatar = client.post(
        "/v1/upload/avatar",
        json={"filename": "IMG_0001.heic"},
        headers={"Authorization": f"Bearer {token}"},
    )
    page = client.post(
        "/v1/upload/score-image",
        json={"filename": "IMG_0001.heic"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert avatar.status_code == 400
    assert page.status_code == 200, "a photographed page may still be a HEIC"


def test_the_key_is_prefixed_with_the_caller_so_ownership_is_checkable(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token
) -> None:
    """`PATCH /v1/me` validates the key by this prefix, because the server
    reads storage with the service role and bypasses RLS. If the key stopped
    starting with the owner's id, that check would have nothing to stand on."""
    user_id = uuid4()
    _install(monkeypatch)

    key = client.post(
        "/v1/upload/avatar",
        json={"filename": "me.png"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    ).json()["object_key"]

    assert key.startswith(f"{user_id}/")
    assert "/" not in key[len(f"{user_id}/"):], "a nested key would defeat the prefix check"
