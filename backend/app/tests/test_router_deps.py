"""The one service-role check the HTTP layer shares.

`require_service_client` replaced three byte-identical private copies — in
`analyses.py`, `corrections.py` and `scores.py` — and **none of the three had
a test**. Deduplicating them is only worth doing if the one that survives is
checked, so this file is the check: the deployment fault it exists for, and
the route-level proof that it is actually wired in front of a handler rather
than sitting in a module nothing calls.
"""

from __future__ import annotations

from typing import Callable
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import db as db_module
from app.main import app
from app.routers.deps import require_service_client


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def test_a_missing_service_client_is_a_500_naming_the_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`None` means the key is unset, which is ours to fix, not the caller's."""
    monkeypatch.setattr(db_module, "get_service_client", lambda: None)

    with pytest.raises(HTTPException) as raised:
        require_service_client()

    assert raised.value.status_code == 500
    # The detail has to name the thing to go and set, or the log says only
    # "Internal Server Error" and the deploy that caused it is a guess.
    assert "service-role" in raised.value.detail


def test_a_configured_client_is_returned_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured = MagicMock()
    monkeypatch.setattr(db_module, "get_service_client", lambda: configured)

    assert require_service_client() is configured


def test_a_route_that_needs_it_answers_500_rather_than_crashing(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """Without the check this is `AttributeError` on `None.table` — a 500 too,
    but one whose body says nothing and whose traceback names Supabase's
    client rather than the missing environment variable."""
    monkeypatch.setattr(db_module, "get_service_client", lambda: None)
    user_id = uuid4()

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

    assert res.status_code == 500
    assert "service-role" in res.json()["detail"]
