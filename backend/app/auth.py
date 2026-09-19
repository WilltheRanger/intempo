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

import logging
from functools import lru_cache
from typing import Any
from uuid import UUID

import jwt
from jwt.exceptions import PyJWKClientConnectionError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.config import settings
from app.db import get_service_client
from app.services.provisioning import ensure_user_row

log = logging.getLogger("intempo")

bearer = HTTPBearer(auto_error=False)

# Algorithms allowed for user-token verification. Supabase uses ES256
# on the new asymmetric system; RS256 is included so a project that
# upgrades to RS-class keys keeps working without a code change.
_ALLOWED_ALGORITHMS = ["ES256", "RS256"]


#: How long to wait for Supabase's public keys before giving up.
#:
#: **PyJWT's default is 30 seconds, and this call is in front of every
#: authenticated request.** `get_signing_key_from_jwt` fetches the JWKS
#: whenever the token's key id is not already cached — a cold process, a key
#: rotation, or simply the first request after a deploy — and it fetches it
#: with a blocking `urlopen`. At the default, one unreachable auth endpoint
#: turns every request in the app into a half-minute wait that ends in a 401,
#: which reaches the musician as "your session has ended" and sends them to
#: sign in again against the same unreachable endpoint.
#:
#: Five seconds. This is a small JSON document from the same provider the app
#: just authenticated against; if it has not arrived by then, waiting longer
#: does not change the outcome, it only decides how long the app looks frozen
#: first.
_JWKS_TIMEOUT_SECONDS = 5

#: How long a fetched key set stays good before it is fetched again.
#:
#: Ten minutes rather than PyJWT's five. The keys rotate on the order of
#: months, and each expiry is a blocking network call standing in front of
#: whichever request happens to arrive next.
_JWKS_LIFESPAN_SECONDS = 600


@lru_cache
def _get_jwks_client() -> PyJWKClient:
    """Module-level JWKS client. PyJWKClient caches keys internally."""
    if not settings.SUPABASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_URL is not configured",
        )
    jwks_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
    return PyJWKClient(
        jwks_url,
        cache_keys=True,
        cache_jwk_set=True,
        lifespan=_JWKS_LIFESPAN_SECONDS,
        timeout=_JWKS_TIMEOUT_SECONDS,
    )


# Test-suite hook: tests monkeypatch `_jwks` to a stub that returns
# their generated public key without making a network call. Production
# code paths read it lazily via `_get_active_jwks()`.
_jwks: PyJWKClient | None = None


def _get_active_jwks() -> PyJWKClient:
    return _jwks if _jwks is not None else _get_jwks_client()


def _decode_token(token: str) -> dict[str, Any]:
    try:
        signing_key = _get_active_jwks().get_signing_key_from_jwt(token).key
        issuer = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1"
        return jwt.decode(
            token,
            signing_key,
            algorithms=_ALLOWED_ALGORITHMS,
            audience="authenticated",
            issuer=issuer,
        )
    except PyJWKClientConnectionError as exc:
        # **Could not check is not the same as not valid**, and answering 401
        # for it signs musicians out. Measured chain: `PyJWKClientConnectionError`
        # is a `PyJWTError`, so a network blip between this service and the key
        # server used to land in the branch below as a 401 — and the app's
        # `apiFetch` calls `signOut()` on every 401, deliberately and with a
        # written argument, because a rejected token is unusable. So a Supabase
        # hiccup lasting seconds ended every active session in the app.
        #
        # **Nothing is admitted.** The request is still refused, which is the
        # property the branch below exists to guarantee: a key server that is
        # down must never return a payload, or a forged token would be accepted.
        # 503 refuses exactly as hard as 401 and asks for a retry instead of a
        # sign-in. See `DECISIONS.md`, 2026-09-09.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="could not check your sign-in just now — try again in a moment",
        ) from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — a key server that answered with something unreadable
        # Also **not** a statement about the token. Nothing that decides a token
        # is invalid raises outside `PyJWTError`; reaching here means the check
        # itself could not be made — an unreadable JWKS body, a TLS failure, a
        # missing configuration. Same refusal, same reason as above.
        log.warning("could not validate a token: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="could not check your sign-in just now — try again in a moment",
        ) from exc


def current_user_id(
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


def current_jwt_payload(
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


def current_user_id_provisioned(
    payload: dict[str, Any] = Depends(current_jwt_payload),
) -> UUID:
    """The JWT subject, with its `public.users` row guaranteed to exist.

    For endpoints that *write* a row referencing `users(id)`. `current_user_id`
    remains the right dependency for reads, which tolerate a missing row and
    should not pay for a write on every request.

    See `services/provisioning.py` for why this exists rather than the client
    being asked to call `/v1/me` first.
    """
    sub = payload.get("sub")
    try:
        user_id = UUID(str(sub))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token subject is not a UUID",
        ) from exc

    client = get_service_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service-role client is not configured",
        )
    ensure_user_row(client, user_id, payload.get("email"))
    return user_id
