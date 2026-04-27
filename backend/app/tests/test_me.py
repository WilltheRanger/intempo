"""Tests for GET /v1/me with mocked Supabase service-role client.

The autouse `_stub_jwks` fixture (in conftest) makes the production
auth decoder accept tokens minted by `make_token`. We additionally
mock `get_service_client` so the handler's DB calls run against an
in-memory mock instead of touching Supabase.
"""

from __future__ import annotations

from typing import Any, Callable
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import db as db_module
from app.main import app
from app.routers import me as me_module


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _build_supabase_mock(*, existing_row: dict[str, Any] | None) -> MagicMock:
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


def test_existing_user_returns_row(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
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

    res = client.get(
        "/v1/me",
        headers={"Authorization": f"Bearer {make_token(sub=user_id, email=row['email'])}"},
    )
    assert res.status_code == 200, res.text
    assert res.json() == {
        "id": str(user_id),
        "email": row["email"],
        "tier": "pro",
        "role": "student",
        "studio_id": str(studio_id),
    }
    mock_client.table.return_value.insert.assert_not_called()


def test_first_touch_provisioning(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
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
        headers={
            "Authorization": f"Bearer {make_token(sub=user_id, email=new_row['email'])}"
        },
    )
    assert res.status_code == 200, res.text
    assert res.json() == {
        "id": str(user_id),
        "email": new_row["email"],
        "tier": "free",
        "role": "student",
        "studio_id": None,
    }
    table.insert.assert_called_once()
    inserted = table.insert.call_args.args[0]
    assert inserted["id"] == str(user_id)
    assert inserted["email"] == new_row["email"]
    assert inserted["tier"] == "free"
    assert inserted["role"] == "student"


def test_invalid_jwt_returns_401(client: TestClient) -> None:
    res = client.get("/v1/me", headers={"Authorization": "Bearer garbage"})
    assert res.status_code == 401
