"""End-to-end tests for /v1/scores with mocked OCR + Supabase.

The autouse `_stub_jwks` fixture (in conftest) keeps the production
auth decoder happy with `make_token`. OCR is stubbed via monkeypatch
on `parse_sheet_music`. Supabase is mocked via the chained
`client.table(...).select(...).eq(...)...execute()` shape.
"""

from __future__ import annotations

import json
from typing import Any, Callable
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import scores as scores_module
from app.services.score_schema import ScoreJson


GOOD_PAYLOAD = {
    "time_signature": "4/4",
    "key_signature": "D major",
    "tempo_marking": None,
    "bpm_hint": None,
    "clef": "treble",
    "measures": [
        {
            "measure_number": 1,
            "notes": [
                {
                    "pitch": "D3",
                    "duration": "quarter",
                    "articulation": None,
                    "tied_to_next": False,
                    "dynamics": None,
                }
            ],
            "slurs": [],
        }
    ],
    "repeats": [],
    "ocr_confidence": 0.9,
    "notes_to_human": "",
}

PROJECT_HOST = "https://test.supabase.invalid"


def _signed_url(user_id: UUID, ext: str = "jpg") -> str:
    return (
        f"{PROJECT_HOST}/storage/v1/object/sign/score-images/{user_id}/abc.{ext}"
        f"?token=eyJfake"
    )


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _row_for(score_id: UUID, user_id: UUID, **overrides: Any) -> dict[str, Any]:
    base = {
        "id": str(score_id),
        "user_id": str(user_id),
        "title": "Etude #1",
        "composer": None,
        "source_image_url": _signed_url(user_id),
        "score_json": GOOD_PAYLOAD,
        "shared_with_studio": None,
        "ocr_confidence": GOOD_PAYLOAD["ocr_confidence"],
        "created_at": "2026-04-26T20:00:00+00:00",
        "updated_at": "2026-04-26T20:00:00+00:00",
    }
    base.update(overrides)
    return base


def _install_supabase(monkeypatch: pytest.MonkeyPatch, *, returning_row: dict | None = None,
                     returning_rows: list[dict] | None = None,
                     raise_on_delete: Exception | None = None) -> MagicMock:
    """Build a chain mock matching the supabase-py call shape used by scores.py."""
    client = MagicMock()
    table = client.table.return_value
    # select(...).eq(...).eq(...).limit(1).execute() — single
    select_chain = table.select.return_value
    select_eq = select_chain.eq.return_value
    select_eq2 = select_eq.eq.return_value
    select_eq2.limit.return_value.execute.return_value = MagicMock(
        data=[returning_row] if returning_row else []
    )
    # select(...).eq(...).order(...).range(...).execute() — list
    select_eq.order.return_value.range.return_value.execute.return_value = MagicMock(
        data=returning_rows or []
    )
    # insert(...).execute()
    table.insert.return_value.execute.return_value = MagicMock(
        data=[returning_row] if returning_row else []
    )
    # update(...).eq(...).eq(...).execute()
    table.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[returning_row] if returning_row else []
    )
    # delete(...).eq(...).eq(...).execute()
    delete_chain = table.delete.return_value.eq.return_value.eq.return_value
    if raise_on_delete is not None:
        delete_chain.execute.side_effect = raise_on_delete
    else:
        delete_chain.execute.return_value = MagicMock(
            data=[returning_row] if returning_row else []
        )
    monkeypatch.setattr(scores_module, "get_service_client", lambda: client)
    return client


def _stub_ocr(monkeypatch: pytest.MonkeyPatch, *, score: ScoreJson | None = None) -> None:
    if score is None:
        score = ScoreJson.model_validate(GOOD_PAYLOAD)
    monkeypatch.setattr(scores_module, "parse_sheet_music", lambda *a, **k: score)


def _stub_download(monkeypatch: pytest.MonkeyPatch, body: bytes = b"<jpeg>") -> None:
    monkeypatch.setattr(scores_module, "_download_image", lambda url: body)


# ---- POST /v1/scores ------------------------------------------------------


def test_post_unauthenticated_returns_401(client: TestClient) -> None:
    res = client.post("/v1/scores", json={"image_url": "x", "title": "t"})
    assert res.status_code == 401


def test_post_creates_score(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    _stub_download(monkeypatch)
    _stub_ocr(monkeypatch)
    sb = _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))

    res = client.post(
        "/v1/scores",
        json={
            "image_url": _signed_url(user_id),
            "title": "Etude #1",
        },
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["id"] == str(score_id)
    assert body["user_id"] == str(user_id)
    assert body["score_json"]["clef"] == "treble"
    assert body["ocr_confidence"] == GOOD_PAYLOAD["ocr_confidence"]
    # Insert was called with the user's id and the OCR result, not arbitrary data.
    sb.table.return_value.insert.assert_called_once()
    payload = sb.table.return_value.insert.call_args.args[0]
    assert payload["user_id"] == str(user_id)
    assert payload["score_json"]["ocr_confidence"] == GOOD_PAYLOAD["ocr_confidence"]


def test_post_rejects_url_outside_user_prefix(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    other_user = uuid4()
    _stub_download(monkeypatch)
    _stub_ocr(monkeypatch)
    _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))

    # Signed URL points at *another* user's prefix — should be 403 before download.
    bad_url = _signed_url(other_user)
    res = client.post(
        "/v1/scores",
        json={"image_url": bad_url, "title": "sneaky"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 403


def test_post_rejects_arbitrary_external_url(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    _stub_download(monkeypatch)
    _stub_ocr(monkeypatch)
    _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))

    res = client.post(
        "/v1/scores",
        json={
            "image_url": "https://evil.example.com/payload.jpg",
            "title": "etude",
        },
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 403


def test_post_ocr_failure_returns_422(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    from app.services.ocr import OCRError

    user_id = uuid4()
    _stub_download(monkeypatch)
    monkeypatch.setattr(
        scores_module,
        "parse_sheet_music",
        lambda *a, **k: (_ for _ in ()).throw(OCRError("nope")),
    )
    _install_supabase(monkeypatch)

    res = client.post(
        "/v1/scores",
        json={"image_url": _signed_url(user_id), "title": "etude"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 422
    assert "OCR failed" in res.json()["detail"]


# ---- GET /v1/scores -------------------------------------------------------


def test_list_returns_owner_scores(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    rows = [_row_for(uuid4(), user_id, title=f"row {i}") for i in range(3)]
    _install_supabase(monkeypatch, returning_rows=rows)

    res = client.get(
        "/v1/scores",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 3
    assert [r["title"] for r in body] == ["row 0", "row 1", "row 2"]


# ---- GET /v1/scores/:id ---------------------------------------------------


def test_get_own_score_returns_200(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))

    res = client.get(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200
    assert res.json()["id"] == str(score_id)


def test_get_unknown_score_returns_404(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=None)

    res = client.get(
        f"/v1/scores/{uuid4()}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 404


def test_get_other_users_score_returns_404(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """Service-role read filters by user_id, so another user's row is invisible
    even though the underlying table has it. RLS-on-the-API-layer parity."""
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=None)

    res = client.get(
        f"/v1/scores/{uuid4()}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 404


# ---- PATCH /v1/scores/:id -------------------------------------------------


def test_patch_replaces_score_json(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    new_payload = {**GOOD_PAYLOAD, "ocr_confidence": 0.95, "key_signature": "G major"}
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id, score_json=new_payload, ocr_confidence=0.95),
    )

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={"score_json": new_payload},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["score_json"]["key_signature"] == "G major"
    sb.table.return_value.update.assert_called_once()
    update_payload = sb.table.return_value.update.call_args.args[0]
    assert update_payload["ocr_confidence"] == 0.95


def test_patch_empty_body_returns_400(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))
    res = client.patch(
        f"/v1/scores/{uuid4()}",
        json={},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 400


def test_patch_unknown_id_returns_404(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=None)
    res = client.patch(
        f"/v1/scores/{uuid4()}",
        json={"title": "renamed"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 404


# ---- DELETE /v1/scores/:id ------------------------------------------------


def test_delete_owner_returns_204(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))
    res = client.delete(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 204


def test_delete_unknown_returns_404(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=None)
    res = client.delete(
        f"/v1/scores/{uuid4()}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 404


def test_delete_with_dependent_analyses_returns_409(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    fk_violation = RuntimeError(
        "update or delete on table scores violates foreign key constraint analyses_score_id_fkey"
    )
    _install_supabase(monkeypatch, raise_on_delete=fk_violation)
    res = client.delete(
        f"/v1/scores/{uuid4()}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 409
    assert "analyses" in res.json()["detail"]
