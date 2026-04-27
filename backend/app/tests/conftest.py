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
