"""Uploads that have been signed for but not yet claimed by a row.

**The invariant.** Every object in `score-images`, `audio-uploads` and
`avatars` has a row somewhere: a `scores` row because it became a piece, an
`analyses` row because it became a take, a `users.avatar_url` because it became
a face, or a row in `pending_uploads` because it has not become anything yet.
An object with no row at all is a bug — it is unreachable by every screen and
every request, including the musician's own.

Before this, three ordinary things produced one: backing out of the naming
screen after the upload finished, a save that failed after the bytes landed,
and a transcribe retried against a fresh key. None is an error, and all three
left a photograph of somebody's sheet music in storage forever.

**Nothing here may raise, with one deliberate exception.** Recording a pending
upload is bookkeeping; failing to record one costs a swept object later.
Failing the *upload* because the bookkeeping failed costs the musician their
page, which is the thing the bookkeeping exists to protect. `record`, `claim`
and `sweep_unclaimed` therefore each contain their own failure and say so in
the log.

`keys_for_user` is the exception and inverts the trade: it is the inventory
account deletion takes before removing an identity, and swallowing an error
there strands objects with no row, no owner and no sweeper entry — permanently,
during the one operation that cannot be retried. It raises, and its caller
decides. See its docstring.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from app.db import get_service_client

log = logging.getLogger("intempo")

TABLE = "pending_uploads"

#: How long an unclaimed object is left alone before it is swept.
#:
#: Generously long on purpose. The gap between minting a key and creating the
#: row is seconds — the upload, then one request — so anything unclaimed after
#: an hour is not coming. A day is chosen anyway, because the cost of sweeping
#: too early is deleting a photograph somebody is still using and the cost of
#: sweeping too late is a few megabytes for a few hours.
UNCLAIMED_TTL_HOURS = 24


def record(user_id: UUID, bucket: str, object_key: str) -> None:
    """Note that a key was handed out and nothing has claimed it yet."""
    client = get_service_client()
    if client is None:
        return
    try:
        client.table(TABLE).insert(
            {"user_id": str(user_id), "bucket": bucket, "object_key": object_key}
        ).execute()
    except Exception:  # noqa: BLE001 — bookkeeping must not fail an upload
        log.warning("could not record pending upload in %s", bucket, exc_info=True)


def claim(bucket: str, object_keys: list[str]) -> None:
    """A row now points at these objects, so they are no longer pending.

    Called with whatever keys a request consumed, including ones that were
    never pending — a client that uploaded before this table existed, or a key
    that arrived by some other route. Deleting nothing is the correct outcome
    there and costs one query.
    """
    if not object_keys:
        return
    client = get_service_client()
    if client is None:
        return
    try:
        (
            client.table(TABLE)
            .delete()
            .eq("bucket", bucket)
            .in_("object_key", object_keys)
            .execute()
        )
    except Exception:  # noqa: BLE001
        log.warning("could not clear pending uploads in %s", bucket, exc_info=True)


def sweep_unclaimed(*, now: datetime | None = None) -> int:
    """Delete objects nothing ever claimed, and their rows. Returns how many.

    **The object first, then the row**, and the ordering is the whole of the
    error handling. A row deleted before its object leaks the object
    permanently and silently — which is precisely the bug this module exists to
    fix, reintroduced one level down. A row that outlives a failed object
    deletion is swept again on the next pass, which costs one wasted request.

    Storage being unreachable is not an error worth raising: the sweep runs on
    a timer and the next one will do the work.
    """
    client = get_service_client()
    if client is None:
        return 0

    cutoff = (now or datetime.now(tz=timezone.utc)) - timedelta(hours=UNCLAIMED_TTL_HOURS)
    try:
        rows = (
            client.table(TABLE)
            .select("id,bucket,object_key")
            .lt("created_at", cutoff.isoformat())
            .limit(500)
            .execute()
        ).data or []
    except Exception:  # noqa: BLE001
        log.warning("could not list unclaimed uploads", exc_info=True)
        return 0

    swept = 0
    for row in rows:
        bucket = row.get("bucket")
        key = row.get("object_key")
        if not bucket or not key:
            continue
        try:
            client.storage.from_(bucket).remove([key])
        except Exception:  # noqa: BLE001
            # Left in the table on purpose: the next sweep tries again. An
            # object that no longer exists removes cleanly, so a repeated
            # failure here means storage is unreachable, not that the key is
            # bad.
            log.warning("could not remove unclaimed %s/%s", bucket, key, exc_info=True)
            continue
        try:
            client.table(TABLE).delete().eq("id", row["id"]).execute()
        except Exception:  # noqa: BLE001
            log.warning("removed %s/%s but could not clear its row", bucket, key)
        swept += 1

    if swept:
        log.info("swept %d unclaimed upload(s)", swept)
    return swept


def keys_for_user(client: Any, user_id: UUID) -> dict[str, list[str]]:
    """Every object this account has uploaded that nothing has claimed yet.

    For account deletion, and **this is the one function here that raises**.

    The rest of this module is bookkeeping whose failure costs a swept object
    later; failing an upload over it would cost a musician their page. This is
    the opposite trade. Its caller inventories storage *before* removing the
    identity precisely so a failed inventory can abort the deletion — and
    `user_id` cascades from `auth.users`, so once the identity goes these rows
    go with it. Returning an empty dict on an error would strand the objects
    with no row, no user and no sweeper entry: unreachable forever, created by
    the one action a musician takes to make their data go away.

    Grouped by whatever bucket each row names rather than by a fixed list, so a
    fourth bucket needs no change here.

    Takes the caller's `client` rather than reaching for its own, which is the
    other difference from everything above. The inventory and the deletion that
    follows it have to be the same view of the same database — an account
    inventoried through one client and deleted through another can strand
    exactly what this is here to catch.
    """
    rows = (
        client.table(TABLE)
        .select("bucket,object_key")
        .eq("user_id", str(user_id))
        .execute()
    ).data or []

    grouped: dict[str, list[str]] = {}
    for row in rows:
        bucket = row.get("bucket")
        key = row.get("object_key")
        if isinstance(bucket, str) and isinstance(key, str) and bucket and key:
            grouped.setdefault(bucket, []).append(key)
    return grouped
