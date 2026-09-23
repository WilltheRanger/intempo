"""`GET /v1/scores/current`: the piece Today offers, in one request.

The app worked this out in two requests in a row — the newest take, then its
score — after `/v1/me` had answered, and the owner watched Today's title and
Practice button "take like 2 seconds to load and just appear all of a sudden"
(2026-09-23). The rule is unchanged; only where it runs moved.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import db as db_module
from app.main import app
from app.tests.fake_supabase import FakeSupabase


@pytest.fixture()
def api() -> TestClient:
    return TestClient(app)


def _score(user_id: str, title: str, created_at: str) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "user_id": user_id,
        "title": title,
        "composer": None,
        "movement": None,
        "source_image_url": None,
        "score_json": None,
        "shared_with_studio": None,
        "ocr_confidence": None,
        "created_at": created_at,
        "updated_at": created_at,
    }


def _take(user_id: str, score_id: str, created_at: str) -> dict[str, Any]:
    return {"id": str(uuid4()), "user_id": user_id, "score_id": score_id, "created_at": created_at}


def _get(api: TestClient, make_token, user_id: str, monkeypatch, sb: FakeSupabase):
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)
    return api.get(
        "/v1/scores/current", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"}
    )


def test_the_piece_played_most_recently_not_the_one_added_most_recently(
    api: TestClient, make_token, monkeypatch
) -> None:
    user_id = str(uuid4())
    played = _score(user_id, "Played yesterday", "2026-09-01T00:00:00+00:00")
    added = _score(user_id, "Added today", "2026-09-22T00:00:00+00:00")
    sb = FakeSupabase()
    sb.seed("scores", [played, added])
    sb.seed(
        "analyses",
        [
            _take(user_id, played["id"], "2026-09-21T00:00:00+00:00"),
            _take(user_id, added["id"], "2026-09-02T00:00:00+00:00"),
        ],
    )

    response = _get(api, make_token, user_id, monkeypatch, sb)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["score"]["title"] == "Played yesterday"
    assert body["last_practiced_at"].startswith("2026-09-21")


def test_never_recorded_offers_the_newest_score(api: TestClient, make_token, monkeypatch) -> None:
    user_id = str(uuid4())
    sb = FakeSupabase()
    sb.seed(
        "scores",
        [
            _score(user_id, "Older", "2026-09-01T00:00:00+00:00"),
            _score(user_id, "Newer", "2026-09-02T00:00:00+00:00"),
        ],
    )

    body = _get(api, make_token, user_id, monkeypatch, sb).json()

    assert body["score"]["title"] == "Newer"
    assert body["last_practiced_at"] is None


def test_a_take_of_a_deleted_piece_falls_back_to_the_newest(
    api: TestClient, make_token, monkeypatch
) -> None:
    user_id = str(uuid4())
    sb = FakeSupabase()
    sb.seed("scores", [_score(user_id, "Still here", "2026-09-01T00:00:00+00:00")])
    sb.seed("analyses", [_take(user_id, str(uuid4()), "2026-09-21T00:00:00+00:00")])

    body = _get(api, make_token, user_id, monkeypatch, sb).json()

    assert body["score"]["title"] == "Still here"


def test_an_empty_library_is_null_not_an_error(api: TestClient, make_token, monkeypatch) -> None:
    user_id = str(uuid4())

    response = _get(api, make_token, user_id, monkeypatch, FakeSupabase())

    assert response.status_code == 200
    assert response.json() == {"score": None, "last_practiced_at": None}


def test_only_the_callers_own_pieces(api: TestClient, make_token, monkeypatch) -> None:
    me, someone = str(uuid4()), str(uuid4())
    theirs = _score(someone, "Not mine", "2026-09-22T00:00:00+00:00")
    sb = FakeSupabase()
    sb.seed("scores", [theirs])
    sb.seed("analyses", [_take(someone, theirs["id"], "2026-09-22T00:00:00+00:00")])

    body = _get(api, make_token, me, monkeypatch, sb).json()

    assert body["score"] is None
