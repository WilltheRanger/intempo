"""Shared test configuration.

Sets minimal env vars before `app.config.Settings` is constructed (it
reads them in module scope) and stands up a fake JWKS for `app.auth`
so tests can mint real ES256 tokens that the production decoder
verifies end-to-end.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Callable
from unittest.mock import MagicMock
from uuid import UUID, uuid4

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.invalid")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
# Entering the app's lifespan would otherwise analyse a synthetic take on a
# thread behind whatever the test is doing. `test_warmup.py` turns it on.
os.environ.setdefault("ANALYSIS_WARMUP", "0")

import jwt  # noqa: E402  (env vars must land before app imports)
import pytest  # noqa: E402
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

from app import auth as auth_module  # noqa: E402

# Generate a single ES256 keypair for the entire test session. The
# private key signs tokens; `auth_module._jwks` is monkeypatched to
# return the matching public key so the production decoder verifies.
_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
_PUBLIC_KEY = _PRIVATE_KEY.public_key()
_PRIVATE_PEM = _PRIVATE_KEY.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)


@pytest.fixture(autouse=True)
def _stub_jwks(monkeypatch: pytest.MonkeyPatch):
    """Replace the JWKS client with a stub that always returns the test public key.

    Autouse so every test gets a valid verifier without per-test
    setup. Tests that want to exercise the failure path can pass an
    intentionally-bad token; PyJWT will reject it during signature
    verification just like production.
    """

    class _StubKey:
        def __init__(self, key):
            self.key = key

    class _StubJWKS:
        def get_signing_key_from_jwt(self, _token: str) -> _StubKey:
            return _StubKey(_PUBLIC_KEY)

    monkeypatch.setattr(auth_module, "_jwks", _StubJWKS())


@pytest.fixture()
def make_token() -> Callable[..., str]:
    """Mint an ES256-signed JWT using the test private key.

    Default payload looks like a real Supabase access token: random
    UUID `sub`, `aud=authenticated`, valid 10-minute window. Override
    any field via kwargs.
    """

    def _make(
        *,
        sub: UUID | str | None = None,
        aud: str = "authenticated",
        email: str = "user@example.com",
        expired: bool = False,
        extra: dict | None = None,
    ) -> str:
        now = datetime.now(tz=timezone.utc)
        exp = now - timedelta(minutes=5) if expired else now + timedelta(minutes=10)
        payload: dict = {
            "sub": str(sub) if sub is not None else str(uuid4()),
            "aud": aud,
            "iss": "https://test.supabase.invalid/auth/v1",
            "iat": int(now.timestamp()),
            "exp": int(exp.timestamp()),
            "email": email,
        }
        if extra:
            payload.update(extra)
        return jwt.encode(payload, _PRIVATE_PEM, algorithm="ES256")

    return _make


@pytest.fixture()
def bad_token() -> str:
    """A token signed by a *different* ES256 key — should fail signature verification."""
    other_priv = ec.generate_private_key(ec.SECP256R1())
    pem = other_priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    payload = {
        "sub": str(uuid4()),
        "aud": "authenticated",
        "iat": int(datetime.now(tz=timezone.utc).timestamp()),
        "exp": int((datetime.now(tz=timezone.utc) + timedelta(minutes=10)).timestamp()),
        "email": "attacker@example.com",
    }
    return jwt.encode(payload, pem, algorithm="ES256")


@pytest.fixture(autouse=True)
def _stub_provisioning(monkeypatch: pytest.MonkeyPatch):
    """Neutralise the first-touch provisioning that write endpoints now run.

    `current_user_id_provisioned` upserts the `users` row before any handler
    that inserts a row referencing it — see `services/provisioning.py`. That
    needs a Supabase client, and tests patch `get_service_client` on the
    *router* module they are exercising, so without this the dependency reaches
    for a real one and every write test tries to open a network connection.

    Autouse and a plain mock: the provisioning behaviour itself is covered
    directly in `test_provisioning.py`, and every other test is about the
    handler, not about the row already existing.
    """
    monkeypatch.setattr(auth_module, "get_service_client", lambda: MagicMock())


@pytest.fixture(autouse=True)
def _fresh_reading_rate(monkeypatch: pytest.MonkeyPatch):
    """Give every test its own reading-rate limiter.

    `services.reading_rate.readings` is process-wide by design — one dictionary
    for the life of the server. Under pytest that makes it shared state between
    tests, and the suite currently only survives it by accident: nearly every
    test invents a fresh `uuid4()` account, so no single key gets near the
    allowance. A test that reused an id, or a suite run in a different order,
    would start failing somewhere unrelated to what it was testing.

    Reset rather than disabled, so the guard is still in the path everything
    exercises and a handler that stopped calling it would still be caught by
    the tests that assert the refusal.
    """
    from app.services import reading_rate

    monkeypatch.setattr(reading_rate, "readings", reading_rate.ReadingRate())
