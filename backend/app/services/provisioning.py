"""Guaranteeing the `public.users` row exists before anything references it.

Supabase Auth and `public.users` are separate tables. A musician can hold a
perfectly valid JWT — they signed up, they are signed in — and have no row here
at all, because that row is created on first touch of `/v1/me`.

Every write then depends on an ordering nobody enforced. `scores.user_id` and
`analyses.user_id` are foreign keys onto `users(id)`, so a create that lands
before `/v1/me` fails on `scores_user_id_fkey` with a 500 that says nothing
useful. `useMe`'s own docstring in the client asks callers to make `/v1/me` the
first authenticated request, and `TodayScreen` fires five queries in parallel —
so the client was politely asked to win a race it had no way to control, and
EDIT_LOG records the 500 that resulted.

The invariant belongs where the constraint is. This makes provisioning a
precondition of the writes that need it rather than a request order the client
has to get right.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.models.user import UserRole, UserTier


def ensure_user_row(client: Any, user_id: UUID, email: str | None) -> None:
    """Create the row if it isn't there. Safe to call on every write.

    An upsert rather than select-then-insert: two requests arriving together —
    which is exactly what a client firing several queries at once produces —
    would both see no row and both insert, and the second would fail on the
    primary key. `ON CONFLICT DO NOTHING` is one round trip and has no such
    window.

    Deliberately does not update the email of an existing row. This runs on
    every write; making it a write to `users` each time would be a needless
    contention point, and `/v1/me` is where the profile is actually reconciled.
    """
    client.table("users").upsert(
        {
            "id": str(user_id),
            # The column is NOT NULL. A token without an email claim is
            # unusual but not impossible, and a placeholder that is obviously
            # a placeholder beats a 500 here — `/v1/me` corrects it on the
            # next read.
            "email": email or f"{user_id}@unknown.invalid",
            "tier": UserTier.free.value,
            "role": UserRole.student.value,
        },
        on_conflict="id",
        ignore_duplicates=True,
    ).execute()
