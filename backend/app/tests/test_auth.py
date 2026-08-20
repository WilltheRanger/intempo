"""Auth dependency unit tests.

Exercises the real `current_user_id` decoder path. The autouse
`_stub_jwks` fixture (in conftest) replaces the JWKS client with a
stub that returns the test ES256 public key, so signature verification
runs end-to-end against tokens minted by the `make_token` fixture.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Callable
from uuid import UUID, uuid4

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import auth as auth_module
from app.auth import current_user_id, current_user_id_provisioned


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


# ---------------------------------------------------------------------------
# Rejection paths
#
# These were the untested part of the security boundary — every one of them is
# a *refusal*, and an untested refusal is the dangerous kind: a refactor that
# accidentally turns one into an acceptance passes the whole suite without a
# word. Each test below asserts that a request which should be turned away is
# turned away, and with which status.
# ---------------------------------------------------------------------------


def test_token_with_empty_subject_returns_401(
    client: TestClient, make_token: Callable[..., str]
) -> None:
    """A signed token is not the same as an identified caller.

    Asserts the *property*, not a particular guard. Two independent checks in
    `current_user_id` deliver it — the explicit `if not sub`, and `UUID(sub)`
    raising on an empty string — so deleting either one leaves this passing.
    That was checked by mutation rather than assumed: the explicit guard is
    defence in depth here, and the assertion is deliberately not on the
    message, which would make the test pass for the wrong reason.
    """
    res = client.get(
        "/whoami",
        headers={"Authorization": f"Bearer {make_token(extra={'sub': ''})}"},
    )
    assert res.status_code == 401
    assert "user_id" not in res.json()


def test_token_with_no_subject_claim_returns_401(
    client: TestClient, make_token: Callable[..., str]
) -> None:
    """Absent, not merely empty — a different branch in `payload.get('sub')`."""
    import jwt as pyjwt

    from app.tests.conftest import _PRIVATE_PEM

    now = datetime.now(tz=timezone.utc)
    token = pyjwt.encode(
        {
            "aud": "authenticated",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=10)).timestamp()),
            "email": "nobody@example.com",
        },
        _PRIVATE_PEM,
        algorithm="ES256",
    )
    res = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_non_bearer_scheme_returns_401(
    client: TestClient, make_token: Callable[..., str]
) -> None:
    """`Basic <a valid jwt>` is not authentication, however valid the token is."""
    res = client.get("/whoami", headers={"Authorization": f"Basic {make_token()}"})
    assert res.status_code == 401


def test_jwks_fetch_failure_returns_401_not_500(
    client: TestClient, make_token: Callable[..., str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A key server that is down must refuse the request, never admit it.

    This is the branch that would be catastrophic to get wrong: if a JWKS
    failure ever returned a payload instead of raising, every token — including
    a forged one — would be accepted. 401 rather than 500 is also deliberate:
    the caller is not authenticated, whatever the cause.
    """

    class _Broken:
        def get_signing_key_from_jwt(self, _token: str):
            raise RuntimeError("jwks unreachable")

    monkeypatch.setattr(auth_module, "_jwks", _Broken())
    res = client.get(
        "/whoami", headers={"Authorization": f"Bearer {make_token()}"}
    )
    assert res.status_code == 401


def test_jwks_client_without_supabase_url_raises_500(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No project configured is a server fault, not a rejected caller."""
    auth_module._get_jwks_client.cache_clear()
    monkeypatch.setattr(auth_module.settings, "SUPABASE_URL", "")
    with pytest.raises(HTTPException) as excinfo:
        auth_module._get_jwks_client()
    assert excinfo.value.status_code == 500
    auth_module._get_jwks_client.cache_clear()


# --- current_user_id_provisioned -------------------------------------------
#
# The dependency that write endpoints use. It does everything `current_user_id`
# does *and* touches the database, so it has two refusal paths of its own.


@pytest.fixture()
def provisioned_client() -> TestClient:
    app = FastAPI()

    @app.get("/writes")
    async def writes(user_id: UUID = Depends(current_user_id_provisioned)):
        return {"user_id": str(user_id)}

    return TestClient(app, raise_server_exceptions=False)


def test_provisioned_rejects_non_uuid_subject(
    provisioned_client: TestClient, make_token: Callable[..., str]
) -> None:
    res = provisioned_client.get(
        "/writes",
        headers={"Authorization": f"Bearer {make_token(extra={'sub': 'not-a-uuid'})}"},
    )
    assert res.status_code == 401


def test_provisioned_without_service_client_is_500_not_a_silent_pass(
    provisioned_client: TestClient,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unconfigured server must not wave the caller through unprovisioned.

    The handler behind this dependency is about to insert a row referencing
    `users(id)`. Continuing without the row would trade a clear 500 for a
    foreign-key error somewhere further in.
    """
    monkeypatch.setattr(auth_module, "get_service_client", lambda: None)
    res = provisioned_client.get(
        "/writes", headers={"Authorization": f"Bearer {make_token()}"}
    )
    assert res.status_code == 500


def test_provisioned_returns_the_subject_when_everything_is_in_order(
    provisioned_client: TestClient, make_token: Callable[..., str]
) -> None:
    """The refusals above are only meaningful if the acceptance still works."""
    user_id = uuid4()
    res = provisioned_client.get(
        "/writes", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"}
    )
    assert res.status_code == 200
    assert res.json()["user_id"] == str(user_id)
