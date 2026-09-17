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

from app.services import pending_uploads
from app.auth import current_jwt_payload
from app.routers.deps import require_service_client
from app.models.user import (
    Instrument,
    MeResponse,
    UpdateMeRequest,
    UsageResponse,
    UserRole,
    UserTier,
)
from app.services.page_image import display_key_for
from app.services.score_pages import pages_of
from app.services.tier_limits import usage_for
from app.services.training import may_keep_corrections
from app.routers.upload import AUDIO_BUCKET, SCORE_BUCKET
from app.services.avatar_urls import signed_avatar_url

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

    client = require_service_client()

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

    return _to_response(client, user_id, row, tier, analyses)


def _rows_owned_by(
    client: Any,
    table: str,
    column: str,
    user_id: UUID,
) -> list[dict[str, Any]]:
    return (
        client.table(table)
        .select("*")
        .eq(column, str(user_id))
        .execute()
    ).data or []


def _without(row: dict[str, Any], *keys: str) -> dict[str, Any]:
    """Copy a database row without ephemeral storage credentials."""
    blocked = set(keys)
    return {key: value for key, value in row.items() if key not in blocked}


@router.get("/me/export")
def export_me(
    payload: dict[str, Any] = Depends(current_jwt_payload),
) -> dict[str, Any]:
    """A portable JSON snapshot of the signed-in musician's account.

    Stored upload URLs are deliberately omitted: they contain short-lived
    tokens and are not durable data. The export carries the score itself and
    every analysis result, while naming how many media objects exist so the
    omission is explicit rather than silent.
    """
    user_id = _user_id_from(payload)
    client = require_service_client()

    account_rows = (
        client.table("users")
        .select("*")
        .eq("id", str(user_id))
        .limit(1)
        .execute()
    ).data or []
    if not account_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="user not found",
        )

    scores = _rows_owned_by(client, "scores", "user_id", user_id)
    analyses = _rows_owned_by(client, "analyses", "user_id", user_id)
    corrections = _rows_owned_by(
        client, "verdict_corrections", "user_id", user_id
    )
    sync_events = _rows_owned_by(client, "sync_events", "user_id", user_id)
    student_assignments = _rows_owned_by(
        client, "assignments", "student_user_id", user_id
    )
    teacher_assignments = _rows_owned_by(
        client, "assignments", "teacher_user_id", user_id
    )
    owned_studios = _rows_owned_by(
        client, "studios", "owner_user_id", user_id
    )

    assignments_by_id: dict[str, dict[str, Any]] = {}
    for assignment in [*student_assignments, *teacher_assignments]:
        key = str(assignment.get("id") or len(assignments_by_id))
        assignments_by_id[key] = assignment

    account = account_rows[0]
    score_export = [
        _without(row, "source_image_url", "source_image_urls")
        for row in scores
    ]
    analysis_export = [_without(row, "audio_url") for row in analyses]

    # `pages_of` rather than reading the two columns here. It is the one place
    # that knows the three shapes a scan comes in, including the one this used
    # to get wrong: an **empty** array with a page still in the legacy column
    # counted as zero pages, because `isinstance([], list)` is true and the
    # `elif` never ran. Migration 011 writes NULL rather than `'{}'`, so that
    # row is hand-built rather than common — which is exactly why a hand-rolled
    # copy of the rule is the wrong thing to keep.
    page_count = sum(len(pages_of(row)) for row in scores)

    return {
        "export_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "account": _without(account, "avatar_key"),
        "library": score_export,
        "practice_analyses": analysis_export,
        "verdict_corrections": corrections,
        "assignments": list(assignments_by_id.values()),
        "owned_studios": [
            _without(studio, "invite_code") for studio in owned_studios
        ],
        "sync_events": sync_events,
        "stored_media": {
            "profile_photo": bool(account.get("avatar_key")),
            "score_pages": page_count,
            "practice_recordings": len(
                [row for row in analyses if row.get("audio_url")]
            ),
            "included_in_json": False,
        },
    }


def _avatar_url(client: Any, key: str | None) -> str | None:
    """The profile picture's URL, reused rather than re-signed every response.

    **This signed a fresh URL on every `/v1/me`**, and the app asks for
    `/v1/me` on every launch, profile view and session refresh. A signed URL's
    token is part of the browser's cache key, so every answer was a URL the
    browser had never seen and re-downloaded: measured on the live project,
    **51 downloads of one 176 kB picture in 24 hours**, the most re-fetched
    object in the project.

    Its old reasoning was right and its conclusion was not — see
    `services/avatar_urls.py`, which keeps the URL *with its expiry* instead of
    choosing between a stale stored one and a fresh one every time.
    """
    return signed_avatar_url(client, key)


def _to_response(
    client: Any,
    user_id: UUID,
    row: dict[str, Any],
    tier: UserTier,
    analyses: UsageResponse | None,
) -> MeResponse:
    """One place both GET and PATCH build their answer.

    Two builders drift, and the field that drifts is the one nobody notices —
    a PATCH that returns the row without the freshly signed avatar looks fine
    until a client trusts the response instead of refetching.

    The client is passed in rather than fetched here. It used to call
    `get_service_client()` a second time, which every caller had already done
    and checked — so the `None` it could return was a branch no request could
    reach, and the only honest thing to write for it was nothing at all.
    """
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
        # The rule, not `bool(row.get(...))` — consent fails closed and there is
        # one place that decides what that means. A row from a database without
        # 013 has no key here and comes back false, which is correct: a
        # deployment that cannot store consent has not got any.
        training_consent=may_keep_corrections(row),
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
    client = require_service_client()

    sent = body.model_fields_set

    # One read of the row as it stands, for the two things that need it: the
    # picture being replaced, and whether onboarding is already done. Read
    # **before** the update for the reason `delete_score` learned: the row is
    # the only thing that knows the old key, and after the write it knows a
    # different one.
    current: dict[str, Any] = {}
    if "avatar_key" in sent or body.onboarded or "training_consent" in sent:
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
    withdrawing = False
    if "training_consent" in sent:
        # **Granting is idempotent; withdrawing is an instruction.**
        #
        # Re-granting keeps the original timestamp: a consent record answers
        # "when did they agree to this", and re-stamping it every time a screen
        # saves would make the answer the date of the last save. Withdrawing
        # clears it and, below, deletes what was kept — a switch that turns off
        # while the data it authorised stays is not a withdrawal, it is a
        # cosmetic control over somebody's photographs.
        if body.training_consent:
            if not may_keep_corrections(current):
                update["training_consent_at"] = datetime.now(timezone.utc).isoformat()
        else:
            withdrawing = bool(may_keep_corrections(current))
            update["training_consent_at"] = None
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
        if body.onboarded or "training_consent" in sent:
            # Already onboarded, or already consenting and consenting again. A
            # second tap, a retried request, a screen saving its own state back
            # — not an error, and not a reason to write.
            return _to_response(
                client,
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

    # The row points at this one now, so the sweeper must leave it alone. After
    # the write, like every other claim: a failed update would otherwise strand
    # the picture it did not save.
    if row.get("avatar_key"):
        pending_uploads.claim(AVATAR_BUCKET, [str(row["avatar_key"])])

    # Same ordering rule, and here it matters more: the consent has to be gone
    # from the row before anything is deleted on the strength of it being gone.
    if withdrawing:
        _forget_training_data(client, user_id)

    return _to_response(
        client, user_id, row, UserTier(row.get("tier", UserTier.free.value)), None
    )


def _forget_training_data(client: Any, user_id: UUID) -> None:
    """Delete what consent was keeping: the corrections, and the photographs.

    **Withdrawal is the only part of this feature that has to actually work.**
    Failing to *record* a correction costs a training row nobody was promised;
    failing to delete one after being asked keeps a person's photographs
    against their word. So this is the one path here that reports its failures
    rather than swallowing them — not by failing the request, which would leave
    the switch stuck on, but by leaving the row's `page_image_retained_at` set
    so a later sweep can still find what was missed.

    The corrections go first and by user id, so a row whose score has since been
    deleted goes with them. The photographs follow per score, because each one
    needs its own storage call and one refusal must not strand the rest.
    """
    # Imported here rather than at module scope: `routers.scores` imports the
    # transcription worker, and a top-level import of it from here is a cycle.
    from app.routers.scores import discard_pages_of

    try:
        client.table("training_corrections").delete().eq(
            "user_id", str(user_id)
        ).execute()
    except Exception:  # noqa: BLE001 — pre-013 database, or the table is gone
        log.warning("could not delete corrections for %s", user_id, exc_info=True)

    try:
        rows = (
            client.table("scores")
            .select("id, source_image_url, source_image_urls, page_image_retained_at")
            .eq("user_id", str(user_id))
            .not_.is_("page_image_retained_at", "null")
            .execute()
        ).data or []
    except Exception:  # noqa: BLE001 — pre-013 column
        log.warning("could not list retained pages for %s", user_id, exc_info=True)
        return

    for score in rows:
        discard_pages_of(client, score)
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
    removed, `users`, `scores`, `analyses` **and `pending_uploads`** all cascade
    away, so cleanup must collect their keys first even though it removes the
    objects afterwards.

    Four sources, because there are four places a key can be — the three that
    mean the object became something, and `pending_uploads`, which means it has
    not become anything yet. That fourth one was missing, and it is the only one
    whose objects nothing else could ever reach afterwards.
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
        .select("audio_url, playback_key")
        .eq("user_id", str(user_id))
        .execute()
    ).data or []

    avatars = [
        row["avatar_key"]
        for row in user_rows
        if isinstance(row.get("avatar_key"), str) and row["avatar_key"]
    ]
    # Also `pages_of`, and here the empty-array case cost more than a count: a
    # page still in the legacy column was never collected, so deleting the
    # account left it in the bucket. `scores._page_keys` is the same two lines
    # over the same function, with a comment saying one place — this was the
    # third copy, and the only one that disagreed.
    pages: list[str] = []
    for row in score_rows:
        for url in pages_of(row):
            key = _storage_key(url, SCORE_BUCKET)
            if key:
                pages.append(key)
                # **And its display copy**, for the same reason the take above
                # collects both of its references: a page has two objects once
                # it has been read, and collecting one of them would delete the
                # account and leave the other in the bucket. Most pages have no
                # display copy — every one scanned before `store_display_copy`
                # existed — and by the note below, removing a key that is
                # already gone is not an error.
                pages.append(display_key_for(key))

    # **Both references, because a judged take has two.** The WAV is replaced
    # by an Opus once the analysis finishes and `playback_key` names it; only
    # one of the two normally still exists, and asking storage to remove a key
    # that is already gone is not an error. Collecting one of them would delete
    # the account and leave its recordings behind.
    audio = []
    for row in analysis_rows:
        for field in ("audio_url", "playback_key"):
            key = _storage_key(row.get(field), AUDIO_BUCKET)
            if key:
                audio.append(key)

    # The three claimed sources, in a stable order so logs and tests are
    # deterministic.
    collected: dict[str, list[str]] = {
        AVATAR_BUCKET: avatars,
        SCORE_BUCKET: pages,
        AUDIO_BUCKET: audio,
    }

    # **The fourth place an object can be, and it was missing.**
    #
    # `pending_uploads` is the row an object gets when it has been uploaded and
    # has not become anything yet — a page photographed and then backed out of,
    # a save that failed after the bytes landed. Migration 014's own comment
    # says `user_id` is there "so that deleting an account can take its
    # unclaimed uploads with it", and nothing read it. The row cascades from
    # `auth.users`, so deleting the identity removed the only index of those
    # objects and left them with no row, no owner and no sweeper entry —
    # unreachable forever, produced by the one action a musician takes to make
    # their data go away.
    #
    # Read **last**, so the compatibility fallback below can be narrow. Any
    # failure that is not "this deployment has no `pending_uploads`" would have
    # already failed the three queries above, which raise and abort the
    # deletion. Migration 014 is not applied everywhere (see CLAUDE.md), and a
    # deployment that predates it must still be able to delete an account.
    try:
        for bucket, keys in pending_uploads.keys_for_user(client, user_id).items():
            collected.setdefault(bucket, []).extend(keys)
    except Exception:  # noqa: BLE001 - see above; pre-014 deployments have no table
        log.warning(
            "could not inventory unclaimed uploads for account %s; "
            "deleting the rest of its storage",
            user_id,
            exc_info=True,
        )

    # De-duplicated per bucket: migration 011 leaves the first page in both
    # `source_image_url` and `source_image_urls`, and a save that succeeded
    # after its pending row was written puts that key in two of the four
    # sources. Storage should be asked once.
    return {bucket: list(dict.fromkeys(keys)) for bucket, keys in collected.items()}


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
    client = require_service_client()

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
