"""Auth dependency unit tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth import current_user_id

SECRET = "test-secret-do-not-use-in-prod"


def _make_token(
    *,
    sub: str | None = None,
    aud: str = "authenticated",
    expired: bool = False,
    extra: dict | None = None,
) -> str:
    now = datetime.now(tz=timezone.utc)
    exp = now - timedelta(minutes=5) if expired else now + timedelta(minutes=10)
    payload: dict = {
        "sub": sub or str(uuid4()),
        "aud": aud,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "email": "user@example.com",
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, SECRET, algorithm="HS256")


@pytest.fixture()
def client() -> TestClient:
    """Mini app that exposes only the auth dep, so we can probe it directly."""
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(user_id: UUID = Depends(current_user_id)):
        return {"user_id": str(user_id)}

    return TestClient(app, raise_server_exceptions=True)


def test_missing_bearer_returns_401(client: TestClient) -> None:
    res = client.get("/whoami")
    assert res.status_code == 401


def test_invalid_token_returns_401(client: TestClient) -> None:
    res = client.get("/whoami", headers={"Authorization": "Bearer not-a-real-jwt"})
    assert res.status_code == 401


def test_expired_token_returns_401(client: TestClient) -> None:
    token = _make_token(expired=True)
    res = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_wrong_audience_returns_401(client: TestClient) -> None:
    token = _make_token(aud="wrong-audience")
    res = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_non_uuid_sub_returns_401(client: TestClient) -> None:
    token = _make_token(sub="not-a-uuid")
    res = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_valid_token_returns_user_id(client: TestClient) -> None:
    user_id = uuid4()
    token = _make_token(sub=str(user_id))
    res = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json() == {"user_id": str(user_id)}
