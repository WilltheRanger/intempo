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
    body = res.json()
    assert {k: body[k] for k in ("id", "email", "tier", "role", "studio_id")} == {
        "id": str(user_id),
        "email": row["email"],
        "tier": "pro",
        "role": "student",
        "studio_id": str(studio_id),
    }
    # Pro has no quota, so the limit is null rather than a large number.
    assert body["analyses"]["limit"] is None
    assert body["analyses"]["remaining"] is None
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
    body = res.json()
    assert {k: body[k] for k in ("id", "email", "tier", "role", "studio_id")} == {
        "id": str(user_id),
        "email": new_row["email"],
        "tier": "free",
        "role": "student",
        "studio_id": None,
    }
    # A brand-new free account has used none of its three.
    assert body["analyses"]["limit"] == 3
    assert body["analyses"]["used"] == 0
    table.insert.assert_called_once()
    inserted = table.insert.call_args.args[0]
    assert inserted["id"] == str(user_id)
    assert inserted["email"] == new_row["email"]
    assert inserted["tier"] == "free"
    assert inserted["role"] == "student"


def test_invalid_jwt_returns_401(client: TestClient) -> None:
    res = client.get("/v1/me", headers={"Authorization": "Bearer garbage"})
    assert res.status_code == 401


# ---- the profile a musician owns --------------------------------------------
#
# Signing up produced a row with an email and nothing else: no name to greet
# anyone by, no picture, and no idea which instrument was being played — the
# one field that changes what the app does.


def _profile_mock(*, row: dict[str, Any], updated: dict[str, Any] | None = None) -> MagicMock:
    """A client whose select finds `row` and whose update returns `updated`."""
    mock_client = _build_supabase_mock(existing_row=row)
    table = mock_client.table.return_value
    table.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[updated if updated is not None else row]
    )
    mock_client.storage.from_.return_value.create_signed_url.return_value = {
        "signedURL": "https://signed.test/avatar.jpg"
    }
    return mock_client


def _row(**over: Any) -> dict[str, Any]:
    base = {
        "id": str(uuid4()),
        "email": "user@example.com",
        "tier": "free",
        "role": "student",
        "studio_id": None,
        "instrument": None,
        "display_name": None,
        "avatar_key": None,
        "onboarded_at": None,
    }
    base.update(over)
    return base


def _patch(client: TestClient, token: str, body: dict[str, Any]):
    return client.patch("/v1/me", json=body, headers={"Authorization": f"Bearer {token}"})


def test_an_instrument_nobody_has_chosen_is_null_not_violin(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The rule `ScoreJson.clef` already follows, applied to the account.

    Defaulting an unknown to the commonest value produces an answer
    indistinguishable from a stated one. `violin` here has to mean a person
    chose violin — otherwise the app cannot tell "not asked yet" from "asked,
    and they play the violin", and the onboarding screen has nothing to key
    off.
    """
    user_id = uuid4()
    monkeypatch.setattr(
        me_module, "get_service_client", lambda: _profile_mock(row=_row(id=str(user_id)))
    )

    body = client.get(
        "/v1/me", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"}
    ).json()

    assert body["instrument"] is None
    assert body["display_name"] is None
    assert body["onboarded_at"] is None


def test_the_profile_comes_back_on_get(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    monkeypatch.setattr(
        me_module,
        "get_service_client",
        lambda: _profile_mock(
            row=_row(
                id=str(user_id),
                instrument="double_bass",
                display_name="Aryam",
                avatar_key=f"{user_id}/face.jpg",
            )
        ),
    )

    body = client.get(
        "/v1/me", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"}
    ).json()

    assert body["instrument"] == "double_bass"
    assert body["display_name"] == "Aryam"
    assert body["avatar_url"] == "https://signed.test/avatar.jpg"


def test_the_avatar_is_signed_fresh_and_never_stored_as_a_url(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The lesson `scores.source_image_url` taught: a signed URL expires, so a
    stored one is a value that stops working — and nothing notices until
    someone's picture quietly stops loading."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id), avatar_key=f"{user_id}/face.jpg"))
    monkeypatch.setattr(me_module, "get_service_client", lambda: sb)

    client.get("/v1/me", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"})

    assert sb.storage.from_.called, "the avatar URL was not signed at request time"
    assert sb.storage.from_.call_args.args[0] == "avatars"


def test_storage_being_down_does_not_fail_the_call_that_provisions_an_account(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`/v1/me` is also first-touch provisioning. Failing it over a decorative
    picture would lock someone out of the app on the first request they make."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id), avatar_key=f"{user_id}/face.jpg"))
    sb.storage.from_.return_value.create_signed_url.side_effect = RuntimeError("down")
    monkeypatch.setattr(me_module, "get_service_client", lambda: sb)

    res = client.get(
        "/v1/me", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"}
    )

    assert res.status_code == 200
    assert res.json()["avatar_url"] is None


def test_patching_one_field_leaves_the_others_alone(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id), display_name="Aryam"))
    monkeypatch.setattr(me_module, "get_service_client", lambda: sb)

    res = _patch(client, make_token(sub=user_id), {"instrument": "cello"})
    assert res.status_code == 200, res.text

    written = sb.table.return_value.update.call_args.args[0]
    assert written["instrument"] == "cello"
    assert "display_name" not in written, "an untouched field was overwritten"
    assert "avatar_key" not in written


def test_an_explicit_null_clears_and_an_omission_does_not(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The same contract `PATCH /v1/scores/:id` uses. Someone taking their
    photograph back off the account has to have a way to say so, and
    "omitted" cannot mean both "leave it" and "remove it"."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id), avatar_key=f"{user_id}/face.jpg"))
    monkeypatch.setattr(me_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"avatar_key": None})

    written = sb.table.return_value.update.call_args.args[0]
    assert "avatar_key" in written and written["avatar_key"] is None


def test_a_name_of_spaces_is_no_name(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Storing "   " shows as a blank greeting that nothing reads as absent."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(me_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"display_name": "   "})

    assert sb.table.return_value.update.call_args.args[0]["display_name"] is None


def test_finishing_onboarding_stamps_the_time(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(me_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"onboarded": True})

    assert sb.table.return_value.update.call_args.args[0].get("onboarded_at")


def test_skipping_counts_as_onboarded(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Being asked is what it records. Someone who skips was asked and
    declined — asking again every launch is how a skippable screen stops being
    skippable."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(me_module, "get_service_client", lambda: sb)

    res = _patch(client, make_token(sub=user_id), {"onboarded": True})

    assert res.status_code == 200
    written = sb.table.return_value.update.call_args.args[0]
    assert written.get("onboarded_at")
    # Nothing else was set — a skip answers no questions.
    assert "instrument" not in written and "display_name" not in written


def test_onboarding_cannot_be_un_done(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Only ever forward. A client that could send false would make the screen
    reappear over a musician who had already dealt with it."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id), onboarded_at="2026-08-24T00:00:00Z"))
    monkeypatch.setattr(me_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"onboarded": False, "instrument": "viola"})

    written = sb.table.return_value.update.call_args.args[0]
    assert "onboarded_at" not in written


def test_an_empty_patch_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    monkeypatch.setattr(
        me_module, "get_service_client", lambda: _profile_mock(row=_row(id=str(user_id)))
    )

    assert _patch(client, make_token(sub=user_id), {}).status_code == 400


def test_an_instrument_the_app_does_not_have_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The four are a closed set, matched by a CHECK on the column. A value
    that passes here and fails at the database is a 500 for a typo."""
    user_id = uuid4()
    monkeypatch.setattr(
        me_module, "get_service_client", lambda: _profile_mock(row=_row(id=str(user_id)))
    )

    assert _patch(client, make_token(sub=user_id), {"instrument": "trombone"}).status_code == 422


def test_an_unknown_field_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`extra="forbid"`. A client sending `tier` or `role` must not silently
    have it ignored — it must be told the field is not theirs to set."""
    user_id = uuid4()
    monkeypatch.setattr(
        me_module, "get_service_client", lambda: _profile_mock(row=_row(id=str(user_id)))
    )

    assert _patch(client, make_token(sub=user_id), {"tier": "pro"}).status_code == 422


def test_a_patch_only_ever_touches_the_callers_own_row(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The id comes from the verified token, never from the body — `extra
    forbid` means it cannot even be offered."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(me_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"instrument": "viola"})

    scoped = sb.table.return_value.update.return_value.eq
    assert scoped.call_args.args == ("id", str(user_id))
