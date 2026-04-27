"""Auth dependency unit tests.

Exercises the real `current_user_id` decoder path. The autouse
`_stub_jwks` fixture (in conftest) replaces the JWKS client with a
stub that returns the test ES256 public key, so signature verification
runs end-to-end against tokens minted by the `make_token` fixture.
"""

from __future__ import annotations

from typing import Callable
from uuid import UUID, uuid4

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth import current_user_id


@pytest.fixture()
def client() -> TestClient:
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


def test_expired_token_returns_401(
    client: TestClient, make_token: Callable[..., str]
) -> None:
    token = make_token(expired=True)
    res = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_wrong_audience_returns_401(
    client: TestClient, make_token: Callable[..., str]
) -> None:
    token = make_token(aud="wrong-audience")
    res = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_non_uuid_sub_returns_401(
    client: TestClient, make_token: Callable[..., str]
) -> None:
    token = make_token(sub="not-a-uuid")
    res = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_signature_from_wrong_key_returns_401(
    client: TestClient, bad_token: str
) -> None:
    """A token signed by a different ES256 key must be rejected."""
    res = client.get("/whoami", headers={"Authorization": f"Bearer {bad_token}"})
    assert res.status_code == 401


def test_valid_token_returns_user_id(
    client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    token = make_token(sub=user_id)
    res = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json() == {"user_id": str(user_id)}
