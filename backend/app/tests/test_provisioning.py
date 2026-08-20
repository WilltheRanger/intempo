"""The `users` row is created before anything references it.

`scores.user_id` and `analyses.user_id` are foreign keys onto `users(id)`, and
that row is created on first touch of `/v1/me`. A create landing first failed on
`scores_user_id_fkey` with a 500 — an ordering the client was asked to get right
and had no way to control, since `TodayScreen` fires five queries at once.
"""

from __future__ import annotations

from typing import Callable
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import auth as auth_module
from app.main import app
from app.services.provisioning import ensure_user_row
from app.tests.test_scores_router import (
    _install_supabase,
    _row_for,
    _stub_download,
    _stub_ocr,
)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def test_ensure_user_row_upserts_rather_than_inserting() -> None:
    """`ON CONFLICT DO NOTHING`, not select-then-insert.

    Two requests arriving together — which is exactly what a client firing
    several queries at once produces — would both see no row and both insert,
    and the second would fail on the primary key.
    """
    client = MagicMock()
    user_id = uuid4()

    ensure_user_row(client, user_id, "player@example.com")

    client.table.assert_called_once_with("users")
    upsert = client.table.return_value.upsert
    upsert.assert_called_once()
    row, kwargs = upsert.call_args.args[0], upsert.call_args.kwargs
    assert row["id"] == str(user_id)
    assert row["email"] == "player@example.com"
    assert kwargs["on_conflict"] == "id"
    assert kwargs["ignore_duplicates"] is True


def test_ensure_user_row_survives_a_token_with_no_email() -> None:
    """`users.email` is NOT NULL, so a missing claim must not 500 the write."""
    client = MagicMock()
    user_id = uuid4()

    ensure_user_row(client, user_id, None)

    row = client.table.return_value.upsert.call_args.args[0]
    assert row["email"].endswith("@unknown.invalid")
    assert str(user_id) in row["email"]


def test_creating_a_score_provisions_the_user_first(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """The end-to-end guarantee: POST /v1/scores upserts `users` before it runs."""
    user_id = uuid4()
    provisioning = MagicMock()
    # Overrides the autouse stub in conftest so the call can be observed.
    monkeypatch.setattr(auth_module, "get_service_client", lambda: provisioning)

    _stub_download(monkeypatch)
    _stub_ocr(monkeypatch)
    _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))

    res = client.post(
        "/v1/scores",
        json={
            "image_url": (
                "https://test.supabase.invalid/storage/v1/object/sign/"
                f"score-images/{user_id}/abc.jpg?token=x"
            ),
            "title": "Etude #1",
        },
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text
    provisioning.table.assert_called_once_with("users")
    assert provisioning.table.return_value.upsert.call_count == 1


def test_reads_do_not_provision(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """Reads tolerate a missing row and must not pay for a write every request."""
    user_id = uuid4()
    provisioning = MagicMock()
    monkeypatch.setattr(auth_module, "get_service_client", lambda: provisioning)
    _install_supabase(monkeypatch, returning_rows=[])

    res = client.get(
        "/v1/scores",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200
    provisioning.table.assert_not_called()
