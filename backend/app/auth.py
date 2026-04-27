"""Supabase JWT verification.

Verifies user access tokens using the project's JWKS endpoint
(`/auth/v1/.well-known/jwks.json`). Modern Supabase projects sign
user tokens with an asymmetric ES256 key — there is no shared secret
to load from env. The JWKS client fetches the public key once and
caches it in-process.

The single most common silent-failure mode is omitting
`audience="authenticated"` — Supabase tokens carry that audience, and
without it `jwt.decode` raises `InvalidAudienceError` for every valid
token. Spec §11 / Batch 1 calls this out explicitly.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.config import settings
from app.db import get_service_client

bearer = HTTPBearer(auto_error=False)

# Algorithms allowed for user-token verification. Supabase uses ES256
# on the new asymmetric system; RS256 is included so a project that
# upgrades to RS-class keys keeps working without a code change.
_ALLOWED_ALGORITHMS = ["ES256", "RS256"]


@lru_cache
def _get_jwks_client() -> PyJWKClient:
    """Module-level JWKS client. PyJWKClient caches keys internally."""
    if not settings.SUPABASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_URL is not configured",
        )
    jwks_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
    return PyJWKClient(jwks_url, cache_keys=True)


# Test-suite hook: tests monkeypatch `_jwks` to a stub that returns
# their generated public key without making a network call. Production
# code paths read it lazily via `_get_active_jwks()`.
_jwks: PyJWKClient | None = None


def _get_active_jwks() -> PyJWKClient:
    return _jwks if _jwks is not None else _get_jwks_client()


def _decode_token(token: str) -> dict[str, Any]:
    try:
        signing_key = _get_active_jwks().get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            signing_key,
            algorithms=_ALLOWED_ALGORITHMS,
            audience="authenticated",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — JWKS fetch failures, etc.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token validation failed: {exc}",
        ) from exc


async def current_user_id(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> UUID:
    """FastAPI dependency: returns the JWT subject as a UUID."""
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    payload = _decode_token(creds.credentials)
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject",
        )
    try:
        return UUID(sub)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token subject is not a UUID",
        ) from exc


async def current_jwt_payload(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict[str, Any]:
    """FastAPI dependency: returns the full decoded JWT payload.

    Used by handlers that need the email out of the token (e.g. /v1/me
    first-touch provisioning) without re-loading from the DB.
    """
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    return _decode_token(creds.credentials)


async def current_user(
    payload: dict[str, Any] = Depends(current_jwt_payload),
) -> dict[str, Any]:
    """FastAPI dependency: loads the full users row from Supabase.

    Returns a raw dict (not a Pydantic model) so each caller can decide
    whether to parse it as `User`, `MeResponse`, etc.
    Raises 404 if the user has a valid JWT but no row in `users` —
    callers that want first-touch provisioning should depend on
    `current_user_id` + `current_jwt_payload` instead and handle the
    missing-row case directly.
    """
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject",
        )
    client = get_service_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service-role client is not configured",
        )
    response = client.table("users").select("*").eq("id", sub).limit(1).execute()
    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return rows[0]
