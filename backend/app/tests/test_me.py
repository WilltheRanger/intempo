"""Tests for GET /v1/me with mocked Supabase service-role client.

The autouse `_stub_jwks` fixture (in conftest) makes the production
auth decoder accept tokens minted by `make_token`. We additionally
mock `get_service_client` so the handler's DB calls run against an
in-memory mock instead of touching Supabase.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import db as db_module
from app.main import app
from app.tests.fake_supabase import FakeSupabase


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
        db_module, "get_service_client", lambda: _profile_mock(row=_row(id=str(user_id)))
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
        db_module,
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
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    client.get("/v1/me", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"})

    assert sb.storage.from_.called, "the avatar URL was not signed at request time"
    assert sb.storage.from_.call_args.args[0] == "avatars"


def test_an_avatar_is_checked_for_size_after_the_response(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Profile waited on a 5.2 MB picture drawn in a 76pt circle (measured
    2026-09-23). `/v1/me` hands every avatar it names to the shrink, which
    decides; the response itself is not held up by it."""
    from app.routers import me as me_module

    calls: list[tuple[Any, str]] = []
    monkeypatch.setattr(
        me_module, "shrink_if_oversized", lambda _c, uid, key: calls.append((uid, key))
    )
    user_id = uuid4()
    key = f"{user_id}/face.jpg"
    sb = _profile_mock(row=_row(id=str(user_id), avatar_key=key))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = client.get("/v1/me", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"})

    assert res.status_code == 200
    assert calls == [(user_id, key)]


def test_no_avatar_means_nothing_to_check(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    from app.routers import me as me_module

    calls: list[Any] = []
    monkeypatch.setattr(me_module, "shrink_if_oversized", lambda *args: calls.append(args))
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id), avatar_key=None))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    client.get("/v1/me", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"})

    assert calls == []


def test_storage_being_down_does_not_fail_the_call_that_provisions_an_account(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`/v1/me` is also first-touch provisioning. Failing it over a decorative
    picture would lock someone out of the app on the first request they make."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id), avatar_key=f"{user_id}/face.jpg"))
    sb.storage.from_.return_value.create_signed_url.side_effect = RuntimeError("down")
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

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
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

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
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"avatar_key": None})

    written = sb.table.return_value.update.call_args.args[0]
    assert "avatar_key" in written and written["avatar_key"] is None


def test_a_name_of_spaces_is_no_name(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Storing "   " shows as a blank greeting that nothing reads as absent."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"display_name": "   "})

    assert sb.table.return_value.update.call_args.args[0]["display_name"] is None


def _finished(user_id: Any) -> dict[str, Any]:
    """A body that answers everything onboarding asks, photo included."""
    return {
        "onboarded": True,
        "display_name": "Aryam",
        "instrument": "double_bass",
        "avatar_key": f"{user_id}/face.jpg",
    }


def test_finishing_onboarding_stamps_the_time(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _patch(client, make_token(sub=user_id), _finished(user_id))

    assert res.status_code == 200
    assert sb.table.return_value.update.call_args.args[0].get("onboarded_at")


def test_onboarding_is_refused_until_name_and_instrument_are_answered(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A name and an instrument; the photo is optional since 2026-09-23.

    The owner's call on 2026-08-25 made all three required; the redesign's
    photo step ("Do this later") reversed the photo half, confirmed by the
    owner. Enforced here and not only in the app, because a requirement only
    the client checks is a convention — this endpoint is reachable without the
    screen.
    """
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _patch(client, make_token(sub=user_id), {"onboarded": True})

    assert res.status_code == 400
    detail = res.json()["detail"]
    assert "display_name" in detail and "instrument" in detail
    assert "avatar_key" not in detail
    # And nothing was written. A refused finish must not half-onboard anyone.
    sb.table.return_value.update.assert_not_called()


def test_finishing_without_a_photo_is_allowed(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """"Do this later" on the photo step finishes onboarding all the same."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    body = _finished(user_id)
    body.pop("avatar_key")
    res = _patch(client, make_token(sub=user_id), body)

    assert res.status_code == 200
    assert sb.table.return_value.update.call_args.args[0].get("onboarded_at")


@pytest.mark.parametrize("withheld", ["display_name", "instrument"])
def test_any_one_missing_answer_refuses_the_finish(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
    withheld: str,
) -> None:
    """Each field on its own, because "both" is two rules and a check that
    only looked at one would pass a half test."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    body = _finished(user_id)
    body.pop(withheld)

    res = _patch(client, make_token(sub=user_id), body)

    assert res.status_code == 400
    assert withheld in res.json()["detail"]


def test_an_answer_already_on_the_row_counts(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The check reads the **resulting** row, not the request body.

    Someone whose name was set on another device and who answers the rest here
    is finishing onboarding. A check that looked only at the body would refuse
    them and there would be no way through the screen at all.
    """
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id), display_name="Aryam"))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _patch(
        client,
        make_token(sub=user_id),
        {
            "onboarded": True,
            "instrument": "double_bass",
            "avatar_key": f"{user_id}/face.jpg",
        },
    )

    assert res.status_code == 200
    assert sb.table.return_value.update.call_args.args[0].get("onboarded_at")


def test_an_empty_name_on_the_row_does_not_count(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Null and "" are both missing. A row written before the column had a
    length check can carry an empty string, and an account whose greeting is
    blank has not answered the question."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id), display_name=""))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _patch(
        client,
        make_token(sub=user_id),
        {
            "onboarded": True,
            "instrument": "double_bass",
            "avatar_key": f"{user_id}/face.jpg",
        },
    )

    assert res.status_code == 400


def test_finishing_twice_is_a_no_op_rather_than_an_error(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A retried request, a second tap, an app that lost the response.

    It must not 400 — the caller did nothing wrong — must not re-stamp the
    time, which would make "when were they asked" a lie, and must not run the
    completeness check against an account that is already through.
    """
    user_id = uuid4()
    sb = _profile_mock(
        row=_row(id=str(user_id), onboarded_at="2026-08-24T00:00:00Z")
    )
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _patch(client, make_token(sub=user_id), {"onboarded": True})

    assert res.status_code == 200
    sb.table.return_value.update.assert_not_called()


def test_onboarding_cannot_be_un_done(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Only ever forward. A client that could send false would make the screen
    reappear over a musician who had already dealt with it."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id), onboarded_at="2026-08-24T00:00:00Z"))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"onboarded": False, "instrument": "viola"})

    written = sb.table.return_value.update.call_args.args[0]
    assert "onboarded_at" not in written


def test_an_empty_patch_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    monkeypatch.setattr(
        db_module, "get_service_client", lambda: _profile_mock(row=_row(id=str(user_id)))
    )

    assert _patch(client, make_token(sub=user_id), {}).status_code == 400


def test_an_instrument_the_app_does_not_have_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The four are a closed set, matched by a CHECK on the column. A value
    that passes here and fails at the database is a 500 for a typo."""
    user_id = uuid4()
    monkeypatch.setattr(
        db_module, "get_service_client", lambda: _profile_mock(row=_row(id=str(user_id)))
    )

    assert _patch(client, make_token(sub=user_id), {"instrument": "trombone"}).status_code == 422


def test_an_unknown_field_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`extra="forbid"`. A client sending `tier` or `role` must not silently
    have it ignored — it must be told the field is not theirs to set."""
    user_id = uuid4()
    monkeypatch.setattr(
        db_module, "get_service_client", lambda: _profile_mock(row=_row(id=str(user_id)))
    )

    assert _patch(client, make_token(sub=user_id), {"tier": "pro"}).status_code == 422


def test_a_patch_only_ever_touches_the_callers_own_row(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The id comes from the verified token, never from the body — `extra
    forbid` means it cannot even be offered."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"instrument": "viola"})

    scoped = sb.table.return_value.update.return_value.eq
    assert scoped.call_args.args == ("id", str(user_id))


# ---- the avatar key comes from the client -----------------------------------
#
# The storage policies in 009 protect the bucket from a client acting
# *directly*. They do nothing about a client handing the server someone else's
# key: the server reads storage with the service role, which bypasses RLS.


def test_a_key_belonging_to_someone_else_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Without this, `PATCH /v1/me {"avatar_key": "<stranger>/face.jpg"}` makes
    the next `/v1/me` hand back a working signed URL for their photograph.

    An audit of this codebase already found the same class of hole in the score
    `image_url` check, which looked at the path and not the host.
    """
    user_id, stranger = uuid4(), uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _patch(client, make_token(sub=user_id), {"avatar_key": f"{stranger}/face.jpg"})

    assert res.status_code == 400
    assert not sb.table.return_value.update.called, "the stranger's key was written"


def test_a_key_that_escapes_the_prefix_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`<me>/../<stranger>/face.jpg` starts with the right prefix and is not
    this account's object. The check is the whole key, not just its start."""
    user_id, stranger = uuid4(), uuid4()
    sb = _profile_mock(row=_row(id=str(user_id)))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _patch(
        client, make_token(sub=user_id), {"avatar_key": f"{user_id}/../{stranger}/face.jpg"}
    )

    assert res.status_code == 400


def test_the_accounts_own_key_is_accepted(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """It has to be able to pass, or nobody can set a picture at all."""
    user_id = uuid4()
    key = f"{user_id}/abc.jpg"
    sb = _profile_mock(row=_row(id=str(user_id)), updated=_row(id=str(user_id), avatar_key=key))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _patch(client, make_token(sub=user_id), {"avatar_key": key})

    assert res.status_code == 200, res.text
    assert sb.table.return_value.update.call_args.args[0]["avatar_key"] == key


def test_replacing_a_picture_removes_the_one_it_replaced(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Otherwise every change of picture leaks the previous one forever — the
    bug `delete_score` had until this morning, in a new place."""
    user_id = uuid4()
    old_key, new_key = f"{user_id}/old.jpg", f"{user_id}/new.jpg"
    sb = _profile_mock(
        row=_row(id=str(user_id), avatar_key=old_key),
        updated=_row(id=str(user_id), avatar_key=new_key),
    )
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"avatar_key": new_key})

    removed = [
        c.args[0][0]
        for c in sb.storage.from_.return_value.remove.call_args_list
        if c.args and c.args[0]
    ]
    assert removed == [old_key]


def test_clearing_a_picture_removes_it_too(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Taking your photograph off the account has to actually take it off."""
    user_id = uuid4()
    old_key = f"{user_id}/old.jpg"
    sb = _profile_mock(
        row=_row(id=str(user_id), avatar_key=old_key),
        updated=_row(id=str(user_id), avatar_key=None),
    )
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"avatar_key": None})

    removed = [
        c.args[0][0]
        for c in sb.storage.from_.return_value.remove.call_args_list
        if c.args and c.args[0]
    ]
    assert removed == [old_key]


def test_a_patch_that_does_not_touch_the_picture_removes_nothing(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Changing your name must not cost you your photograph."""
    user_id = uuid4()
    sb = _profile_mock(row=_row(id=str(user_id), avatar_key=f"{user_id}/face.jpg"))
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    _patch(client, make_token(sub=user_id), {"display_name": "Aryam"})

    assert not sb.storage.from_.return_value.remove.called


def test_storage_being_down_does_not_fail_a_picture_change(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    sb = _profile_mock(
        row=_row(id=str(user_id), avatar_key=f"{user_id}/old.jpg"),
        updated=_row(id=str(user_id), avatar_key=f"{user_id}/new.jpg"),
    )
    sb.storage.from_.return_value.remove.side_effect = RuntimeError("storage unreachable")
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _patch(client, make_token(sub=user_id), {"avatar_key": f"{user_id}/new.jpg"})

    assert res.status_code == 200


def test_setting_the_same_picture_again_does_not_delete_it(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A real bug, found by mutating the guard away rather than by me.

    A client that re-sends the key it already has — a retry, a form that
    submits every field, a save with nothing changed — would otherwise have the
    picture read as "superseded" and removed, while the row went on pointing at
    it. The next `/v1/me` would sign a URL for an object that no longer exists.

    So the test is not "was something removed" but "was it still the current
    one", which is why the guard compares against the row *after* the write.
    """
    user_id = uuid4()
    key = f"{user_id}/face.jpg"
    sb = _profile_mock(
        row=_row(id=str(user_id), avatar_key=key),
        updated=_row(id=str(user_id), avatar_key=key),
    )
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _patch(client, make_token(sub=user_id), {"avatar_key": key})

    assert res.status_code == 200
    assert not sb.storage.from_.return_value.remove.called, (
        "the picture the row still points at was deleted"
    )


# ---- permanent account deletion --------------------------------------------


def _delete_account_mock(
    user_id: Any,
    *,
    owns_studio: bool = False,
    with_assets: bool = True,
) -> MagicMock:
    """A service client with separately addressable account tables."""
    mock_client = MagicMock()
    uid = str(user_id)

    rows = {
        "studios": [{"id": str(uuid4())}] if owns_studio else [],
        "users": (
            [{"avatar_key": f"{uid}/avatar.jpg"}] if with_assets else []
        ),
        "scores": (
            [
                {
                    "source_image_url": (
                        "https://project.supabase.co/storage/v1/object/sign/"
                        f"score-images/{uid}/page-1.jpg?token=old"
                    ),
                    # The first page appears in both columns during migration
                    # 011; deletion must de-duplicate it.
                    "source_image_urls": [
                        (
                            "https://project.supabase.co/storage/v1/object/sign/"
                            f"score-images/{uid}/page-1.jpg?token=new"
                        ),
                        (
                            "https://project.supabase.co/storage/v1/object/"
                            f"authenticated/score-images/{uid}/page-2.jpg"
                        ),
                    ],
                }
            ]
            if with_assets
            else []
        ),
        "analyses": (
            [
                {
                    "audio_url": (
                        "https://project.supabase.co/storage/v1/object/sign/"
                        f"audio-uploads/{uid}/take.wav?token=audio"
                    )
                }
            ]
            if with_assets
            else []
        ),
    }

    # An upload that was signed for and never became anything — the fourth
    # place an object can live. Migration 014's `user_id` exists so account
    # deletion can take these with it; for a long time nothing read them.
    rows["pending_uploads"] = (
        [
            {"bucket": "score-images", "object_key": f"{uid}/abandoned.jpg"},
            # Also in `scores` above: deletion must not ask twice.
            {"bucket": "score-images", "object_key": f"{uid}/page-1.jpg"},
            {"bucket": "audio-uploads", "object_key": f"{uid}/unsent.wav"},
        ]
        if with_assets
        else []
    )

    tables: dict[str, MagicMock] = {}
    for name, data in rows.items():
        table = MagicMock()
        query = table.select.return_value
        query.eq.return_value = query
        query.limit.return_value = query
        query.execute.return_value = MagicMock(data=data)
        tables[name] = table

    def _table(name: str) -> MagicMock:
        if name not in tables:
            # What a deployment that predates the migration does.
            raise RuntimeError(f'relation "{name}" does not exist')
        return tables[name]

    mock_client.table.side_effect = _table
    return mock_client


def _delete_me(client: TestClient, token: str):
    return client.delete(
        "/v1/me",
        headers={"Authorization": f"Bearer {token}"},
    )


def test_account_deletion_requires_authentication(client: TestClient) -> None:
    assert client.delete("/v1/me").status_code == 401


def test_account_deletion_removes_identity_then_owned_storage(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    sb = _delete_account_mock(user_id)
    events: list[str] = []
    sb.auth.admin.delete_user.side_effect = lambda _uid: events.append("identity")
    sb.storage.from_.return_value.remove.side_effect = (
        lambda _keys: events.append("storage")
    )
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _delete_me(client, make_token(sub=user_id))

    assert res.status_code == 204, res.text
    sb.auth.admin.delete_user.assert_called_once_with(str(user_id))
    assert events[0] == "identity"
    assert events[1:] == ["storage", "storage", "storage"]

    sb.storage.from_.assert_any_call("avatars")
    sb.storage.from_.assert_any_call("score-images")
    sb.storage.from_.assert_any_call("audio-uploads")
    removed = [call.args[0] for call in sb.storage.from_.return_value.remove.call_args_list]
    assert [f"{user_id}/avatar.jpg"] in removed
    # The unclaimed page joins the claimed ones, and `page-1.jpg` — which is in
    # both `scores` and `pending_uploads` — is still asked for once.
    #
    # **Each claimed page brings its display copy**, because a page that has
    # been read is two objects and deleting an account must not leave the
    # smaller one behind. `abandoned.jpg` does not: it was signed for and never
    # claimed, so nothing ever read it and no derivative was ever written.
    assert [
        f"{user_id}/page-1.jpg",
        f"{user_id}/page-1.display.jpg",
        f"{user_id}/page-2.jpg",
        f"{user_id}/page-2.display.jpg",
        f"{user_id}/abandoned.jpg",
    ] in removed
    assert [f"{user_id}/take.wav", f"{user_id}/unsent.wav"] in removed


def test_deleting_an_account_takes_its_abandoned_uploads_with_it(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """The fourth place an object can be, and the one with no way back.

    A page photographed and then backed out of leaves an object and a
    `pending_uploads` row. That row cascades from `auth.users`, so deleting the
    identity removes the only index of the object — no `scores` row, no owner,
    no sweeper entry. It is then unreachable by every screen and every request
    forever, produced by the one action a musician takes to make their data go
    away. Migration 014 put `user_id` on that table for exactly this, and
    nothing read it.
    """
    user_id = uuid4()
    sb = _delete_account_mock(user_id)
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    assert _delete_me(client, make_token(sub=user_id)).status_code == 204

    removed = [
        key
        for call in sb.storage.from_.return_value.remove.call_args_list
        for key in call.args[0]
    ]
    assert f"{user_id}/abandoned.jpg" in removed
    assert f"{user_id}/unsent.wav" in removed


def test_the_inventory_reads_pending_uploads_before_the_identity_goes(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """Ordering, which is the whole of the fix.

    `user_id` cascades, so a snapshot taken after `delete_user` finds nothing
    and reports success over stranded objects.
    """
    user_id = uuid4()
    sb = _delete_account_mock(user_id)
    order: list[str] = []
    inner = sb.table("pending_uploads").select.return_value
    inner.execute.side_effect = lambda: (
        order.append("inventory"),
        MagicMock(data=[{"bucket": "score-images", "object_key": f"{user_id}/x.jpg"}]),
    )[1]
    sb.auth.admin.delete_user.side_effect = lambda _uid: order.append("identity")
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    assert _delete_me(client, make_token(sub=user_id)).status_code == 204
    assert order == ["inventory", "identity"]


def test_an_account_can_still_be_deleted_where_migration_014_never_ran(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """A missing table must not make deletion impossible.

    Migration 014 is applied on the live project and not everywhere (CLAUDE.md),
    and a failed inventory aborts the deletion with a 503 — correctly, for a
    database that is down. "This deployment has no `pending_uploads`" is not
    that, and refusing to delete an account over it would be a worse bug than
    the one being fixed. Everything the deployment *does* know about is still
    removed.
    """
    user_id = uuid4()
    sb = _delete_account_mock(user_id)
    tables = {
        name: sb.table(name) for name in ("users", "scores", "analyses", "studios")
    }
    sb.table.side_effect = lambda name: (
        tables[name]
        if name in tables
        else (_ for _ in ()).throw(RuntimeError('relation "pending_uploads" does not exist'))
    )
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    assert _delete_me(client, make_token(sub=user_id)).status_code == 204
    sb.auth.admin.delete_user.assert_called_once_with(str(user_id))
    removed = [
        key
        for call in sb.storage.from_.return_value.remove.call_args_list
        for key in call.args[0]
    ]
    assert f"{user_id}/avatar.jpg" in removed
    assert f"{user_id}/page-2.jpg" in removed


def test_an_empty_page_array_does_not_hide_the_legacy_page(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """The shape `pages_of` exists to get right, and two copies got wrong.

    `source_image_urls` empty with a page still in the deprecated
    `source_image_url`. Both hand-rolled readers in this module took
    `isinstance([], list)` as "the array is the answer" and stopped — the
    export counted zero pages, and deletion left the photograph in the bucket.
    Migration 011 writes NULL rather than `'{}'`, so such a row is hand-built
    rather than common, which is the argument for using the shared reader
    rather than for keeping a copy that is nearly right.
    """
    user_id = uuid4()
    sb = _delete_account_mock(user_id)
    legacy = (
        "https://project.supabase.co/storage/v1/object/sign/"
        f"score-images/{user_id}/legacy.jpg?token=old"
    )
    sb.table("scores").select.return_value.execute.return_value = MagicMock(
        data=[{"source_image_url": legacy, "source_image_urls": []}]
    )
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    assert _delete_me(client, make_token(sub=user_id)).status_code == 204

    removed = [
        key
        for call in sb.storage.from_.return_value.remove.call_args_list
        for key in call.args[0]
    ]
    assert f"{user_id}/legacy.jpg" in removed


def test_account_deletion_refuses_to_orphan_a_owned_studio(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    sb = _delete_account_mock(user_id, owns_studio=True)
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _delete_me(client, make_token(sub=user_id))

    assert res.status_code == 409
    assert "studio" in res.json()["detail"].lower()
    sb.auth.admin.delete_user.assert_not_called()


def test_identity_failure_leaves_storage_in_place_for_retry(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    sb = _delete_account_mock(user_id)
    sb.auth.admin.delete_user.side_effect = RuntimeError("provider unavailable")
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _delete_me(client, make_token(sub=user_id))

    assert res.status_code == 502
    sb.storage.from_.return_value.remove.assert_not_called()


def test_storage_failure_does_not_resurrect_a_deleted_account(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    sb = _delete_account_mock(user_id)
    sb.storage.from_.return_value.remove.side_effect = RuntimeError("storage down")
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = _delete_me(client, make_token(sub=user_id))

    assert res.status_code == 204
    sb.auth.admin.delete_user.assert_called_once_with(str(user_id))


# ---- portable account export ------------------------------------------------


#: The app's typed claim about what `/v1/me/export` returns.
_ACCOUNT_EXPORT_TS = (
    Path(__file__).resolve().parents[3]
    / "mobile"
    / "src"
    / "data"
    / "accountExport.ts"
)


def _app_export_fields(interface: str) -> set[str]:
    """Field names on one interface in `accountExport.ts`.

    The same technique as `test_client_enums.py`: a TypeScript interface cannot
    be imported from Python, and the app is compiled against this one — so
    every screen believes it, and nothing on either side notices when the
    server stops sending a field it names.
    """
    source = _ACCOUNT_EXPORT_TS.read_text()
    body = re.search(
        rf"export interface {interface} \{{(.*?)\n\}}", source, re.DOTALL
    )
    assert body, f"no `export interface {interface}` in accountExport.ts"
    # Field lines only: `name: type;`, at one level of indent, skipping the
    # nested object's members and every comment line.
    return set(re.findall(r"^  (\w+)[?]?:", body.group(1), re.MULTILINE))


def _stored_media_fields() -> set[str]:
    """The nested `stored_media` object's members."""
    source = _ACCOUNT_EXPORT_TS.read_text()
    body = re.search(r"stored_media: \{(.*?)\n  \};", source, re.DOTALL)
    assert body, "no `stored_media` object in AccountExport"
    return set(re.findall(r"^    (\w+)[?]?:", body.group(1), re.MULTILINE))


def test_account_export_requires_authentication(client: TestClient) -> None:
    assert client.get("/v1/me/export").status_code == 401


def test_account_export_contains_owned_records_without_storage_tokens(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    other_id = uuid4()
    assignment_id = uuid4()
    sb = FakeSupabase()
    sb.seed(
        "users",
        [
            {
                "id": str(user_id),
                "email": "player@example.com",
                "tier": "free",
                "role": "student",
                "studio_id": None,
                "avatar_key": f"{user_id}/face.jpg",
                "baseline_profile": {"piece": "personal"},
            }
        ],
    )
    sb.seed(
        "scores",
        [
            {
                "id": "score-mine",
                "user_id": str(user_id),
                "title": "Suite",
                "score_json": {"measures": []},
                "source_image_url": "https://storage.test/old-token",
                "source_image_urls": ["https://storage.test/new-token-1", "x2"],
            },
            {
                "id": "score-other",
                "user_id": str(other_id),
                "title": "Not mine",
                "score_json": {"measures": []},
            },
        ],
    )
    sb.seed(
        "analyses",
        [
            {
                "id": "analysis-mine",
                "user_id": str(user_id),
                "score_id": "score-mine",
                "audio_url": "https://storage.test/audio-token",
                "result_json": {"verdict": "on_tempo"},
            },
            {
                "id": "analysis-other",
                "user_id": str(other_id),
                "score_id": "score-other",
                "audio_url": "secret",
            },
        ],
    )
    sb.seed(
        "verdict_corrections",
        [{"id": "correction", "user_id": str(user_id), "comment": "late"}],
    )
    sb.seed(
        "assignments",
        [
            {
                "id": str(assignment_id),
                "student_user_id": str(user_id),
                "teacher_user_id": str(user_id),
                "teacher_instructions": "slowly",
            }
        ],
    )
    sb.seed(
        "studios",
        [
            {
                "id": "studio",
                "owner_user_id": str(user_id),
                "name": "My studio",
                "invite_code": "SECRET",
            }
        ],
    )
    sb.seed(
        "sync_events",
        [{"id": "sync", "user_id": str(user_id), "payload": {"take": 1}}],
    )
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = client.get(
        "/v1/me/export",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["export_version"] == 1
    assert body["generated_at"]
    assert body["account"]["email"] == "player@example.com"
    assert "avatar_key" not in body["account"]
    assert [row["id"] for row in body["library"]] == ["score-mine"]
    assert "source_image_url" not in body["library"][0]
    assert "source_image_urls" not in body["library"][0]
    assert [row["id"] for row in body["practice_analyses"]] == ["analysis-mine"]
    assert "audio_url" not in body["practice_analyses"][0]
    assert len(body["assignments"]) == 1, "student + teacher queries must de-duplicate"
    assert "invite_code" not in body["owned_studios"][0]
    assert body["stored_media"] == {
        "profile_photo": True,
        "score_pages": 2,
        "practice_recordings": 1,
        "included_in_json": False,
    }

    # Both directions, against the interface every screen is compiled against.
    # A field renamed here becomes `undefined` in the app with nothing failing
    # anywhere; a field the app names and the server never sends is a promise
    # on a screen. `verdict_corrections` and `sync_events` are in this set and
    # were asserted nowhere above — the export is the one response whose
    # *completeness* is the product.
    app_fields = _app_export_fields("AccountExport")
    assert app_fields, "the interface reader found nothing"
    assert set(body) == app_fields

    media_fields = _stored_media_fields()
    assert media_fields, "the stored_media reader found nothing"
    assert set(body["stored_media"]) == media_fields
