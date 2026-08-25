"""GET /v1/me — return the authenticated user.

First-touch provisioning: Supabase Auth and our `users` table are
separate. A user can have a valid JWT (signed up via Supabase Auth)
but no row in `users` yet — that happens on first call to /v1/me.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import current_jwt_payload
from app.db import get_service_client
from app.models.user import (
    Instrument,
    MeResponse,
    UpdateMeRequest,
    UsageResponse,
    UserRole,
    UserTier,
)
from app.services.tier_limits import usage_for

router = APIRouter(tags=["me"])
log = logging.getLogger("intempo.me")

#: Where profile pictures live. Separate from `score-images`: a page
#: photograph is transient and deleted on acceptance, an avatar lives as
#: long as the account.
AVATAR_BUCKET = "avatars"
#: How long a signed avatar URL lasts. An hour, not the five minutes an
#: upload URL gets — this one is read by an <img> that may be rendered
#: long after the response was built.
AVATAR_URL_TTL_SECONDS = 3600


def _user_id_from(payload: dict[str, Any]) -> UUID:
    """The caller's id, or 401. Shared so PATCH cannot validate more loosely
    than GET."""
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing sub"
        )
    try:
        return UUID(sub)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token subject is not a UUID",
        ) from exc


def _provision_user(client: Any, user_id: UUID, email: str) -> dict[str, Any]:
    """Create the users row on first /v1/me. Uses service role to bypass RLS."""
    insert = (
        client.table("users")
        .insert(
            {
                "id": str(user_id),
                "email": email,
                "tier": UserTier.free.value,
                "role": UserRole.student.value,
            }
        )
        .execute()
    )
    rows = insert.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to provision user row",
        )
    return rows[0]


@router.get("/me", response_model=MeResponse)
async def get_me(payload: dict[str, Any] = Depends(current_jwt_payload)) -> MeResponse:
    sub = payload.get("sub")
    email = payload.get("email")
    if not sub or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing sub/email",
        )
    try:
        user_id = UUID(sub)
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

    existing = client.table("users").select("*").eq("id", str(user_id)).limit(1).execute()
    rows = existing.data or []
    row = rows[0] if rows else _provision_user(client, user_id, email)

    tier = UserTier(row.get("tier", UserTier.free.value))

    # Best-effort. This endpoint is also the first-touch provisioning call, and
    # failing it over a usage counter would lock someone out of the app on the
    # very first request they make.
    try:
        usage = usage_for(client, user_id, tier.value)
        analyses = UsageResponse(
            used=usage.used,
            limit=usage.limit,
            remaining=usage.remaining,
            resets_at=usage.period_end,
        )
    except Exception:  # noqa: BLE001
        analyses = None

    return _to_response(user_id, row, tier, analyses)


def _avatar_url(client: Any, key: str | None) -> str | None:
    """Sign a fresh URL for the profile picture.

    The stored value is an object key. Signing per response rather than storing
    a URL is the lesson `scores.source_image_url` taught: a signed URL expires,
    so a stored one is a value that stops working, and nothing notices until
    someone's picture quietly stops loading.

    Never raises. A profile picture is decoration; storage being unreachable
    must not fail the call that also provisions the account.
    """
    if not key:
        return None
    try:
        signed = client.storage.from_(AVATAR_BUCKET).create_signed_url(
            key, AVATAR_URL_TTL_SECONDS
        )
    except Exception as exc:  # noqa: BLE001 — storage down, key gone, permissions
        log.warning("could not sign avatar %s: %s", key, exc)
        return None
    if isinstance(signed, dict):
        return signed.get("signedURL") or signed.get("signedUrl")
    return None


def _to_response(
    user_id: UUID,
    row: dict[str, Any],
    tier: UserTier,
    analyses: UsageResponse | None,
) -> MeResponse:
    """One place both GET and PATCH build their answer.

    Two builders drift, and the field that drifts is the one nobody notices —
    a PATCH that returns the row without the freshly signed avatar looks fine
    until a client trusts the response instead of refetching.
    """
    client = get_service_client()
    return MeResponse(
        id=user_id,
        email=row["email"],
        tier=tier,
        role=UserRole(row.get("role", UserRole.student.value)),
        studio_id=UUID(row["studio_id"]) if row.get("studio_id") else None,
        analyses=analyses,
        instrument=(
            Instrument(row["instrument"]) if row.get("instrument") else None
        ),
        display_name=row.get("display_name"),
        avatar_url=_avatar_url(client, row.get("avatar_key")),
        onboarded_at=row.get("onboarded_at"),
    )


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: UpdateMeRequest,
    payload: dict[str, Any] = Depends(current_jwt_payload),
) -> MeResponse:
    """Set the profile fields a musician owns.

    Fields not sent are left alone; an explicit null clears — the same
    contract `PATCH /v1/scores/:id` uses. Someone taking their photograph or
    their name back off the account has to have a way to say so, and
    "omitted" cannot mean both "leave it" and "remove it".
    """
    user_id = _user_id_from(payload)
    client = get_service_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service-role client is not configured",
        )

    sent = body.model_fields_set
    update: dict[str, Any] = {}
    if "instrument" in sent:
        update["instrument"] = body.instrument.value if body.instrument else None
    if "display_name" in sent:
        # Whitespace is not a name. Someone who types spaces and saves has
        # cleared it, and storing "   " would show as a blank greeting that
        # nothing reads as absent.
        cleaned = (body.display_name or "").strip()
        update["display_name"] = cleaned or None
    if "avatar_key" in sent:
        update["avatar_key"] = body.avatar_key
    if body.onboarded:
        # Only ever forward. There is no route back to "never asked", and a
        # client that could send false would make the screen reappear.
        update["onboarded_at"] = datetime.now(timezone.utc).isoformat()

    if not update:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="patch body must include at least one field",
        )
    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    updated = (
        client.table("users")
        .update(update)
        .eq("id", str(user_id))
        .execute()
    ).data or []
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user not found"
        )

    row = updated[0]
    return _to_response(user_id, row, UserTier(row.get("tier", UserTier.free.value)), None)
