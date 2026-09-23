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

import jwt
import pytest
from fastapi import Depends, FastAPI, HTTPException
from jwt.exceptions import PyJWKClientConnectionError
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


def test_wrong_issuer_returns_401(
    client: TestClient, make_token: Callable[..., str]
) -> None:
    """A token from another Supabase project must not authenticate here."""
    token = make_token(extra={"iss": "https://other.supabase.invalid/auth/v1"})
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
            "iss": "https://test.supabase.invalid/auth/v1",
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


def test_a_key_server_that_is_down_never_admits_the_request(
    client: TestClient, make_token: Callable[..., str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The property that would be catastrophic to lose.

    If a JWKS failure ever returned a payload instead of raising, every token —
    including a forged one — would be accepted. This asserts the refusal
    itself, separately from *which* refusal, because the two are different
    claims and only one of them changed.
    """

    class _Broken:
        def get_signing_key_from_jwt(self, _token: str):
            raise RuntimeError("jwks unreachable")

    monkeypatch.setattr(auth_module, "_jwks", _Broken())
    res = client.get("/whoami", headers={"Authorization": f"Bearer {make_token()}"})

    assert res.status_code >= 400
    assert "user_id" not in res.text


def test_an_unreachable_key_server_is_503_and_not_401(
    client: TestClient, make_token: Callable[..., str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Reversed on 2026-09-09**, and the reversal is the whole point.

    This used to assert 401, under the reasoning that "the caller is not
    authenticated, whatever the cause". True as a statement about
    authentication, and it ignored what the *client* does with a 401:
    `apiFetch` calls `signOut()` on every one, deliberately, because a rejected
    token is unusable. So a network blip between this service and Supabase
    ended every active session in the app and returned every musician to the
    sign-in screen.

    Measured rather than reasoned about: `PyJWKClientConnectionError` is a
    subclass of `PyJWTError`, so a failed fetch landed in the same branch as a
    forged signature.

    The sibling test below already draws this line for a *missing* project —
    "no project configured is a server fault, not a rejected caller" — and an
    unreachable one is the same category with the opposite answer.
    """

    class _Unreachable:
        def get_signing_key_from_jwt(self, _token: str):
            raise PyJWKClientConnectionError('Fail to fetch data from the url, err: "timed out"')

    monkeypatch.setattr(auth_module, "_jwks", _Unreachable())
    res = client.get("/whoami", headers={"Authorization": f"Bearer {make_token()}"})

    assert res.status_code == 503
    # Still refused, and told to come back rather than to sign in again.
    assert "user_id" not in res.text
    assert "sign-in" in res.json()["detail"]


def test_a_forged_signature_is_still_401(
    client: TestClient, make_token: Callable[..., str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The 503 above must not swallow the case it sits in front of.

    A bad token is still a rejected caller, and the app still has to sign that
    musician out — which is what the 401 is for.
    """

    class _Rejecting:
        def get_signing_key_from_jwt(self, _token: str):
            raise jwt.InvalidSignatureError("Signature verification failed")

    monkeypatch.setattr(auth_module, "_jwks", _Rejecting())
    res = client.get("/whoami", headers={"Authorization": f"Bearer {make_token()}"})

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


# ---------------------------------------------------------------------------
# The two classic JWT bypasses, and **which line actually stops them**.
#
# I wrote these expecting `_ALLOWED_ALGORITHMS` to be the defence, then
# measured it: adding `"HS256"` or `"none"` to that list changes nothing, and
# both tests below still pass. What refuses them is **PyJWT's own key-type
# check** — `HMACAlgorithm.prepare_key` rejects anything PEM- or SSH-shaped as
# an HMAC secret, which is hardening the library added for precisely this
# attack. Measured both ways a key can arrive: as the key *object* PyJWK
# returns (`TypeError`) and as raw PEM bytes a refactor might pass
# (`InvalidKeyError`).
#
# So these two are **evidence, not a gate**: they prove the forged tokens are
# refused end to end, and they will catch `options={"verify_signature": False}`
# alongside `test_signature_from_wrong_key_returns_401`. They do *not* catch a
# widened allowlist, and saying otherwise would be worse than not having them.
# `test_the_algorithm_allowlist_admits_no_symmetric_algorithm` is the gate for
# that, and its reason is a library change rather than this attack.
#
# Both reach `jwt.decode` exactly as they would in production: the JWKS stub
# hands back the public key for any token, so nothing is short-circuited by a
# `kid` lookup failing first.
# ---------------------------------------------------------------------------


def _public_pem() -> bytes:
    """The verifying key, in the form an attacker has it — it is published."""
    from cryptography.hazmat.primitives import serialization

    key = auth_module._jwks.get_signing_key_from_jwt("irrelevant").key
    return key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def _claims(sub: UUID) -> dict:
    now = datetime.now(tz=timezone.utc)
    return {
        "sub": str(sub),
        "aud": "authenticated",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=10)).timestamp()),
        "email": "attacker@example.com",
    }


def test_an_unsigned_token_is_refused(client: TestClient) -> None:
    """`alg: none` — a token with a valid-looking payload and no signature.

    The oldest JWT attack there is. A library that honours the header's own
    claim about how to verify it accepts anything anyone types.
    """
    import base64
    import json

    def segment(data: dict) -> str:
        raw = json.dumps(data, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    forged = f"{segment({'alg': 'none', 'typ': 'JWT'})}.{segment(_claims(uuid4()))}."

    res = client.get("/whoami", headers={"Authorization": f"Bearer {forged}"})
    assert res.status_code == 401


def test_a_token_signed_with_the_public_key_as_an_hmac_secret_is_refused(
    client: TestClient,
) -> None:
    """Algorithm confusion, and the reason the allowlist names its two.

    The verifying key is *public* — it is served from the JWKS endpoint. An
    asymmetric verifier that will also accept `HS256` can be handed a token
    the attacker signed with that public key as the shared secret, and it
    verifies, because the same bytes are now both the secret and the key.
    """
    import base64
    import hashlib
    import hmac
    import json

    def segment(data: dict) -> bytes:
        raw = json.dumps(data, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=")

    # Signed by hand rather than with PyJWT, which refuses to *encode* this —
    # it rejects an asymmetric key as an HMAC secret, which is a good defence
    # and not the one under test. An attacker is not using PyJWT.
    signing_input = segment({"alg": "HS256", "typ": "JWT"}) + b"." + segment(
        _claims(uuid4())
    )
    mac = hmac.new(_public_pem(), signing_input, hashlib.sha256).digest()
    forged = (
        signing_input + b"." + base64.urlsafe_b64encode(mac).rstrip(b"=")
    ).decode()

    res = client.get("/whoami", headers={"Authorization": f"Bearer {forged}"})
    assert res.status_code == 401


def test_the_algorithm_allowlist_admits_no_symmetric_algorithm() -> None:
    """Defence in depth, and the depth is a library change — not this attack.

    PyJWT refuses an asymmetric key as an HMAC secret, so today algorithm
    confusion cannot happen here whatever this list says (measured — see the
    comment above). That protection lives in a dependency, and this list is
    the part of it that lives here: it is what still refuses the attack if
    PyJWT drops that check, or if this file ever moves to another JWT library
    that never had it.

    `none` is in scope for the same reason. It is not an algorithm; it is the
    header asking to be trusted.
    """
    admitted = [str(a) for a in auth_module._ALLOWED_ALGORITHMS]

    assert admitted, "an empty allowlist makes PyJWT accept whatever the header says"
    for algorithm in admitted:
        assert not algorithm.upper().startswith("HS"), (
            f"{algorithm} is symmetric: the verifying key is published in the "
            "JWKS, so a token signed with it as a shared secret would verify"
        )
        assert algorithm.lower() != "none", "a token may not choose to be unsigned"
        assert algorithm.upper().startswith(("ES", "RS", "PS", "ED")), (
            f"{algorithm} is not an asymmetric algorithm this API expects"
        )
