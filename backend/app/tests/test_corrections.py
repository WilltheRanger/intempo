"""Tests for /v1/analyses/:id/corrections — the §7.5 feedback loop.

Two things matter here beyond "does it write a row". The pairing: both the
app's verdict and the musician's have to survive, because the comparison is
the whole point of the dataset. And the scoping: a correction on someone
else's analysis must be impossible, and indistinguishable from one on an
analysis that doesn't exist.
"""

from __future__ import annotations

from typing import Any, Callable
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import corrections as corrections_module


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _correction_row(analysis_id: UUID, user_id: UUID, **overrides: Any) -> dict[str, Any]:
    row = {
        "id": str(uuid4()),
        "analysis_id": str(analysis_id),
        "user_id": str(user_id),
        "measure_number": 6,
        "app_verdict": "rushing",
        "user_verdict": "on_tempo",
        "comment": None,
        "created_at": "2026-08-16T21:00:00+00:00",
    }
    row.update(overrides)
    return row


def _install_supabase(
    monkeypatch: pytest.MonkeyPatch,
    *,
    owns_analysis: bool = True,
    inserted: list[dict] | None = None,
    listed: list[dict] | None = None,
) -> MagicMock:
    client = MagicMock()
    table = client.table.return_value

    # The ownership probe: select("id").eq().eq().limit(1).execute()
    ownership = table.select.return_value.eq.return_value.eq.return_value
    ownership.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": "x"}] if owns_analysis else []
    )
    # The list: select("*").eq().eq().order().range().execute()
    ownership.order.return_value.range.return_value.execute.return_value = MagicMock(
        data=listed or []
    )
    table.insert.return_value.execute.return_value = MagicMock(data=inserted or [])

    monkeypatch.setattr(corrections_module, "get_service_client", lambda: client)
    return client


def _auth(make_token: Callable[..., str], user_id: UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub=str(user_id))}"}


# ---- POST -----------------------------------------------------------------


def test_post_unauthenticated_returns_401(client: TestClient) -> None:
    res = client.post(
        f"/v1/analyses/{uuid4()}/corrections",
        json={"corrections": [{"measure_number": 1, "app_verdict": "rushing", "user_verdict": "on_tempo"}]},
    )
    assert res.status_code == 401


def test_records_both_verdicts(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Storing only the correction would lose what it was correcting."""
    user_id, analysis_id = uuid4(), uuid4()
    supabase = _install_supabase(
        monkeypatch, inserted=[_correction_row(analysis_id, user_id)]
    )

    res = client.post(
        f"/v1/analyses/{analysis_id}/corrections",
        json={
            "corrections": [
                {"measure_number": 6, "app_verdict": "rushing", "user_verdict": "on_tempo"}
            ]
        },
        headers=_auth(make_token, user_id),
    )

    assert res.status_code == 201
    body = res.json()[0]
    assert body["app_verdict"] == "rushing"
    assert body["user_verdict"] == "on_tempo"

    written = supabase.table.return_value.insert.call_args[0][0]
    assert written == [
        {
            "analysis_id": str(analysis_id),
            "user_id": str(user_id),
            "measure_number": 6,
            "app_verdict": "rushing",
            "user_verdict": "on_tempo",
            "comment": None,
        }
    ]


def test_a_whole_take_is_one_request(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Twenty-four measures must not be twenty-four round trips."""
    user_id, analysis_id = uuid4(), uuid4()
    rows = [_correction_row(analysis_id, user_id, measure_number=n) for n in range(1, 25)]
    supabase = _install_supabase(monkeypatch, inserted=rows)

    res = client.post(
        f"/v1/analyses/{analysis_id}/corrections",
        json={
            "corrections": [
                {"measure_number": n, "app_verdict": "on_tempo", "user_verdict": "dragging"}
                for n in range(1, 25)
            ]
        },
        headers=_auth(make_token, user_id),
    )

    assert res.status_code == 201
    assert len(res.json()) == 24
    assert supabase.table.return_value.insert.call_count == 1


def test_unsure_is_accepted(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A musician who can't remember is more useful in the data than one who guessed."""
    user_id, analysis_id = uuid4(), uuid4()
    _install_supabase(
        monkeypatch,
        inserted=[_correction_row(analysis_id, user_id, user_verdict="unsure")],
    )

    res = client.post(
        f"/v1/analyses/{analysis_id}/corrections",
        json={
            "corrections": [
                {"measure_number": 1, "app_verdict": "dragging", "user_verdict": "unsure"}
            ]
        },
        headers=_auth(make_token, user_id),
    )
    assert res.status_code == 201


def test_an_unknown_verdict_is_rejected(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id, analysis_id = uuid4(), uuid4()
    _install_supabase(monkeypatch)

    res = client.post(
        f"/v1/analyses/{analysis_id}/corrections",
        json={
            "corrections": [
                {"measure_number": 1, "app_verdict": "rushing", "user_verdict": "too fast"}
            ]
        },
        headers=_auth(make_token, user_id),
    )
    assert res.status_code == 422


def test_someone_elses_analysis_is_a_404(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Not a 403 — an id that isn't yours is an id that doesn't exist."""
    user_id, analysis_id = uuid4(), uuid4()
    supabase = _install_supabase(monkeypatch, owns_analysis=False)

    res = client.post(
        f"/v1/analyses/{analysis_id}/corrections",
        json={
            "corrections": [
                {"measure_number": 1, "app_verdict": "rushing", "user_verdict": "on_tempo"}
            ]
        },
        headers=_auth(make_token, user_id),
    )

    assert res.status_code == 404
    supabase.table.return_value.insert.assert_not_called()


def test_an_empty_list_is_rejected(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    _install_supabase(monkeypatch)
    res = client.post(
        f"/v1/analyses/{uuid4()}/corrections",
        json={"corrections": []},
        headers=_auth(make_token, uuid4()),
    )
    assert res.status_code == 422


def test_measure_zero_is_rejected(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The column has the same CHECK; failing at the edge beats a 500 from Postgres."""
    _install_supabase(monkeypatch)
    res = client.post(
        f"/v1/analyses/{uuid4()}/corrections",
        json={
            "corrections": [
                {"measure_number": 0, "app_verdict": "rushing", "user_verdict": "on_tempo"}
            ]
        },
        headers=_auth(make_token, uuid4()),
    )
    assert res.status_code == 422


# ---- GET ------------------------------------------------------------------


def test_lists_this_users_corrections(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id, analysis_id = uuid4(), uuid4()
    _install_supabase(
        monkeypatch, listed=[_correction_row(analysis_id, user_id, comment="bar 6 felt fine")]
    )

    res = client.get(
        f"/v1/analyses/{analysis_id}/corrections", headers=_auth(make_token, user_id)
    )

    assert res.status_code == 200
    assert res.json()[0]["comment"] == "bar 6 felt fine"


def test_list_on_someone_elses_analysis_is_a_404(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    _install_supabase(monkeypatch, owns_analysis=False)
    res = client.get(
        f"/v1/analyses/{uuid4()}/corrections", headers=_auth(make_token, uuid4())
    )
    assert res.status_code == 404


def test_corrections_route_does_not_shadow_get_analysis(client: TestClient) -> None:
    """Both live under /analyses; the sub-path must not swallow the parent."""
    paths = {r.path for r in app.routes if hasattr(r, "methods")}
    assert "/v1/analyses/{analysis_id}" in paths
    assert "/v1/analyses/{analysis_id}/corrections" in paths
