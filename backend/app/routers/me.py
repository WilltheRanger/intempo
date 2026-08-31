"""GET /v1/me — return the authenticated user.

First-touch provisioning: Supabase Auth and our `users` table are
separate. A user can have a valid JWT (signed up via Supabase Auth)
but no row in `users` yet — that happens on first call to /v1/me.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote, urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

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
from app.routers.scores import SCORE_BUCKET
from app.routers.upload import AUDIO_BUCKET

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
def get_me(payload: dict[str, Any] = Depends(current_jwt_payload)) -> MeResponse:
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
def update_me(
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

    # One read of the row as it stands, for the two things that need it: the
    # picture being replaced, and whether onboarding is already done. Read
    # **before** the update for the reason `delete_score` learned: the row is
    # the only thing that knows the old key, and after the write it knows a
    # different one.
    current: dict[str, Any] = {}
    if "avatar_key" in sent or body.onboarded:
        rows = (
            client.table("users")
            .select("*")
            .eq("id", str(user_id))
            .limit(1)
            .execute()
        ).data or []
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="user not found"
            )
        current = rows[0]

    superseded = current.get("avatar_key") if "avatar_key" in sent else None

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
        update["avatar_key"] = _own_avatar_key(user_id, body.avatar_key)
    if body.onboarded and not current.get("onboarded_at"):
        # Only ever forward, and only once. There is no route back to "never
        # asked", and re-stamping the timestamp on an account that is already
        # through would make "when were they asked" a lie.
        missing = _missing_for_onboarding(current, update)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "onboarding needs a name, an instrument and a photo; "
                    f"missing: {', '.join(missing)}"
                ),
            )
        update["onboarded_at"] = datetime.now(timezone.utc).isoformat()

    if not update:
        if body.onboarded:
            # Already onboarded, and nothing else was sent. A second tap, a
            # retried request — not an error, and not a reason to write.
            return _to_response(
                user_id,
                current,
                UserTier(current.get("tier", UserTier.free.value)),
                None,
            )
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

    # Strictly after the write succeeded, and only when the row has actually
    # stopped pointing at it. Otherwise a failed update would cost a picture
    # that is still the current one.
    if superseded and superseded != row.get("avatar_key"):
        _remove_avatar(client, superseded)

    return _to_response(user_id, row, UserTier(row.get("tier", UserTier.free.value)), None)


def _storage_key(url: str | None, bucket: str) -> str | None:
    """Recover an object key from any Supabase storage URL shape we issue."""
    if not url:
        return None
    path = unquote(urlparse(url).path)
    prefixes = (
        f"/storage/v1/object/sign/{bucket}/",
        f"/storage/v1/object/authenticated/{bucket}/",
        f"/storage/v1/object/public/{bucket}/",
    )
    for prefix in prefixes:
        if path.startswith(prefix):
            key = path[len(prefix):]
            return key or None
    return None


def _account_storage(client: Any, user_id: UUID) -> dict[str, list[str]]:
    """Snapshot every object key before auth deletion cascades its rows.

    The rows are the only durable index of uploads. Once the auth identity is
    removed, `users`, scores and analyses cascade away, so cleanup must collect
    their keys first even though it removes the objects afterwards.
    """
    user_rows = (
        client.table("users")
        .select("avatar_key")
        .eq("id", str(user_id))
        .limit(1)
        .execute()
    ).data or []

    # `source_image_urls` arrived in migration 011. Keep deletion usable
    # during a rolling deploy where the API is newer than the database.
    try:
        score_rows = (
            client.table("scores")
            .select("source_image_url,source_image_urls")
            .eq("user_id", str(user_id))
            .execute()
        ).data or []
    except Exception:  # noqa: BLE001 - compatibility fallback is deliberate
        score_rows = (
            client.table("scores")
            .select("source_image_url")
            .eq("user_id", str(user_id))
            .execute()
        ).data or []

    analysis_rows = (
        client.table("analyses")
        .select("audio_url")
        .eq("user_id", str(user_id))
        .execute()
    ).data or []

    avatars = [
        row["avatar_key"]
        for row in user_rows
        if isinstance(row.get("avatar_key"), str) and row["avatar_key"]
    ]
    pages: list[str] = []
    for row in score_rows:
        urls = row.get("source_image_urls")
        if not isinstance(urls, list):
            urls = [row.get("source_image_url")]
        for url in urls:
            key = _storage_key(url if isinstance(url, str) else None, SCORE_BUCKET)
            if key:
                pages.append(key)

    audio = []
    for row in analysis_rows:
        key = _storage_key(row.get("audio_url"), AUDIO_BUCKET)
        if key:
            audio.append(key)

    # Stable order makes logs/tests deterministic; de-duplication avoids asking
    # Storage to remove migration 011's first page twice.
    return {
        AVATAR_BUCKET: list(dict.fromkeys(avatars)),
        SCORE_BUCKET: list(dict.fromkeys(pages)),
        AUDIO_BUCKET: list(dict.fromkeys(audio)),
    }


def _remove_account_storage(
    client: Any,
    objects: dict[str, list[str]],
    user_id: UUID,
) -> None:
    """Best-effort cleanup after the identity and database rows are gone."""
    for bucket, keys in objects.items():
        if not keys:
            continue
        try:
            client.storage.from_(bucket).remove(keys)
        except Exception as exc:  # noqa: BLE001 - deletion already committed
            log.error(
                "account %s was deleted but %d object(s) remain in %s: %s",
                user_id,
                len(keys),
                bucket,
                exc,
            )


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    payload: dict[str, Any] = Depends(current_jwt_payload),
) -> Response:
    """Permanently delete the signed-in identity and everything it owns.

    `public.users.id` references `auth.users.id` with ON DELETE CASCADE, and
    every personal row cascades from `users`. Deleting the auth identity is
    therefore the single database operation; doing piecemeal table deletes
    would create partially deleted accounts when a later call failed.
    """
    user_id = _user_id_from(payload)
    client = get_service_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service-role client is not configured",
        )

    owned_studios = (
        client.table("studios")
        .select("id")
        .eq("owner_user_id", str(user_id))
        .limit(1)
        .execute()
    ).data or []
    if owned_studios:
        # The schema intentionally RESTRICTs deleting a studio owner. Silently
        # deleting a teacher's studio would also delete student assignments.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This account owns a studio. Transfer or close the studio "
                "before deleting the account."
            ),
        )

    try:
        objects = _account_storage(client, user_id)
    except Exception as exc:  # noqa: BLE001 - no destructive action has happened
        log.exception("could not inventory account %s for deletion", user_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not prepare the account for deletion. Try again.",
        ) from exc

    try:
        client.auth.admin.delete_user(str(user_id))
    except Exception as exc:  # noqa: BLE001 - provider errors vary by version
        message = str(exc).lower()
        if "foreign key" in message or "constraint" in message:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This account still owns shared data. Remove or transfer "
                    "it before deleting the account."
                ),
            ) from exc
        log.exception("auth identity deletion failed for account %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Account deletion could not be completed. Try again.",
        ) from exc

    _remove_account_storage(client, objects, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


#: What onboarding must have answered before it counts as done.
#:
#: The owner's call, 2026-08-25: *"dont make name profile and instrument
#: optional"*. It reversed the skippable screen shipped the same day, so the
#: rule is written here as well as in the app — a requirement only the client
#: enforces is a convention, and this endpoint is reachable without it.
ONBOARDING_REQUIRED_FIELDS = ("display_name", "instrument", "avatar_key")


def _missing_for_onboarding(
    current: dict[str, Any], update: dict[str, Any]
) -> list[str]:
    """Which required answers the row would still be missing after this patch.

    Reads the **resulting** row, not the request: someone who set their name
    last week and their instrument and photo now is finishing onboarding, and
    a check that only looked at the body would refuse them.

    Empty string and null are both missing. `display_name` is already stripped
    to None above, but the row may predate that.
    """
    return [
        field
        for field in ONBOARDING_REQUIRED_FIELDS
        if not (update[field] if field in update else current.get(field))
    ]


def _own_avatar_key(user_id: UUID, key: str | None) -> str | None:
    """Refuse a key that is not this account's.

    **The client chooses this value, and the server reads it with the service
    role, which bypasses RLS.** The storage policies in migration 009 protect
    the bucket from a client acting directly; they do nothing about a client
    handing us someone else's key and having us sign a URL for it. Without this
    check, `PATCH /v1/me {"avatar_key": "<other-user-id>/face.jpg"}` makes
    `/v1/me` hand back a working signed URL for a stranger's photograph.

    `_build_object_key` puts the owner's id first for exactly this reason, so
    the check is the prefix. An audit of this codebase already found the same
    class of hole in the score `image_url` check, which looked at the path and
    not the host.
    """
    if key is None:
        return None
    prefix = f"{user_id}/"
    if not key.startswith(prefix) or "/" in key[len(prefix):]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="avatar_key does not belong to this account",
        )
    return key


def _remove_avatar(client: Any, key: str) -> None:
    """Delete a picture the account no longer points at.

    Never raises. Replacing a photograph must not fail because a bucket is
    unreachable — the row is what the app reads, and the orphan is logged.
    """
    try:
        client.storage.from_(AVATAR_BUCKET).remove([key])
    except Exception as exc:  # noqa: BLE001 — storage down, key gone, permissions
        log.warning("could not remove the replaced avatar %s: %s", key, exc)
