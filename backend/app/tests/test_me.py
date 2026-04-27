"""Tests for GET /v1/me with mocked Supabase service-role client."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from app import db as db_module
from app.main import app
from app.routers import me as me_module

SECRET = "test-secret-do-not-use-in-prod"


def _token(sub: UUID, email: str = "user@example.com") -> str:
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": str(sub),
        "aud": "authenticated",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=10)).timestamp()),
        "email": email,
    }
    return jwt.encode(payload, SECRET, algorithm="HS256")


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _build_supabase_mock(*, existing_row: dict[str, Any] | None) -> MagicMock:
    """Mock the chained `client.table('users').select(...)` calls."""
    mock_client = MagicMock()
    table = mock_client.table.return_value
    select = table.select.return_value
    eq = select.eq.return_value
    limit = eq.limit.return_value
    limit.execute.return_value = MagicMock(data=[existing_row] if existing_row else [])
    insert = table.insert.return_value
    insert.execute.return_value = MagicMock(
        data=[
            existing_row
            or {
                "id": "00000000-0000-0000-0000-000000000000",
                "email": "user@example.com",
                "tier": "free",
                "role": "student",
                "studio_id": None,
            }
        ]
    )
    return mock_client


def test_unauthenticated_returns_401(client: TestClient) -> None:
    res = client.get("/v1/me")
    assert res.status_code == 401


def test_existing_user_returns_row(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    user_id = uuid4()
    studio_id = uuid4()
    row = {
        "id": str(user_id),
        "email": "musician@example.com",
        "tier": "pro",
        "role": "student",
        "studio_id": str(studio_id),
    }
    mock_client = _build_supabase_mock(existing_row=row)
    monkeypatch.setattr(me_module, "get_service_client", lambda: mock_client)
    monkeypatch.setattr(db_module, "get_service_client", lambda: mock_client)

    res = client.get("/v1/me", headers={"Authorization": f"Bearer {_token(user_id, row['email'])}"})
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "id": str(user_id),
        "email": row["email"],
        "tier": "pro",
        "role": "student",
        "studio_id": str(studio_id),
    }
    # The select happened — provisioning insert did not.
    mock_client.table.return_value.insert.assert_not_called()


def test_first_touch_provisioning(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    user_id = uuid4()
    new_row = {
        "id": str(user_id),
        "email": "fresh@example.com",
        "tier": "free",
        "role": "student",
        "studio_id": None,
    }
    mock_client = MagicMock()
    table = mock_client.table.return_value
    table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    table.insert.return_value.execute.return_value = MagicMock(data=[new_row])
    monkeypatch.setattr(me_module, "get_service_client", lambda: mock_client)
    monkeypatch.setattr(db_module, "get_service_client", lambda: mock_client)

    res = client.get(
        "/v1/me",
        headers={"Authorization": f"Bearer {_token(user_id, new_row['email'])}"},
    )
    assert res.status_code == 200
    assert res.json() == {
        "id": str(user_id),
        "email": new_row["email"],
        "tier": "free",
        "role": "student",
        "studio_id": None,
    }
    # The provisioning insert happened.
    table.insert.assert_called_once()
    inserted = table.insert.call_args.args[0]
    assert inserted["id"] == str(user_id)
    assert inserted["email"] == new_row["email"]
    assert inserted["tier"] == "free"
    assert inserted["role"] == "student"


def test_invalid_jwt_returns_401(client: TestClient) -> None:
    res = client.get("/v1/me", headers={"Authorization": "Bearer garbage"})
    assert res.status_code == 401
