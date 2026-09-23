"""Free-tier quota: how many analyses this month, and whether there's room.

Batch 8's first half. Deliberately separate from billing, which needs a
decision this project hasn't made — Stripe Checkout is what the spec's Batch 8
describes, and Apple requires in-app purchase for digital subscriptions, so an
iOS-first app can't simply take the spec's route. Counting and enforcing needs
none of that resolved, and shipping it now means the limit is real before there
is anything to sell.

The window is the **calendar month**, per the spec, not a rolling 30 days. It
resets on the 1st for everyone, which is the version a musician can predict
without being told.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.models.user import UserTier

#: Analyses a free account may run per calendar month (spec §8 tier table).
FREE_MONTHLY_ANALYSES = 3

#: Tiers with no quota. `student_via_teacher` is here because the student's
#: teacher is paying — billing them a second time through a limit would be the
#: same mistake as billing them twice.
UNLIMITED_TIERS = frozenset(
    {UserTier.pro.value, UserTier.teacher.value, UserTier.student_via_teacher.value}
)


@dataclass(frozen=True)
class Usage:
    """This account's position against its quota, right now."""

    tier: str
    used: int
    #: None for tiers with no quota, so "unlimited" is a distinct value rather
    #: than a very large number a client has to recognise.
    limit: int | None
    period_start: datetime
    period_end: datetime

    @property
    def unlimited(self) -> bool:
        return self.limit is None

    @property
    def remaining(self) -> int | None:
        if self.limit is None:
            return None
        return max(0, self.limit - self.used)

    @property
    def exhausted(self) -> bool:
        return self.limit is not None and self.used >= self.limit


def month_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    """First instant of this UTC month, and the first instant of the next one.

    UTC rather than the musician's timezone: the server doesn't know their
    timezone, and a quota that resets at a different moment per request — as it
    would if inferred from a device clock — is a quota that can be gamed by
    changing the clock.
    """
    now = now or datetime.now(tz=timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = (
        start.replace(year=start.year + 1, month=1)
        if start.month == 12
        else start.replace(month=start.month + 1)
    )
    return start, end


def count_analyses_this_month(client: Any, user_id: UUID, now: datetime | None = None) -> int:
    """How many of this month's analyses count against the free allowance.

    **A take counts if it produced a verdict, or might still.** So: every
    analysis still queued or running — without those, a musician could start
    four at once and have all of them admitted — and every finished one whose
    result is `ok`.

    **What does not count, decided by the owner on 2026-09-23:** a take the
    pipeline refused (`not_played`, `alignment_failed`, `no_onsets` — finished,
    with no verdict), a file refused at intake, and a run that failed on our
    side. This counted every analysis until then, "the less generous" choice,
    with a note that it should be revisited if failures made it feel punitive.
    The pitch check made that concrete: a take refused because nobody played
    had cost one of three monthly analyses for a recording of a metronome.

    Two counts rather than one query, because PostgREST's filters cannot
    express the union of "in flight" and "finished with a verdict" without an
    `or=` that the test fake would have to parse. `result_json->>status` is the
    `status` inside the stored result, text or null.
    """
    start, end = month_bounds(now)

    def rows():
        return (
            client.table("analyses")
            .select("id", count="exact")
            .eq("user_id", str(user_id))
            .gte("created_at", start.isoformat())
            .lt("created_at", end.isoformat())
        )

    in_flight = _count(rows().in_("status", ["queued", "processing"]).execute())
    with_verdict = _count(
        rows().eq("status", "done").eq("result_json->>status", "ok").execute()
    )
    return in_flight + with_verdict


def _count(response: Any) -> int:
    count = getattr(response, "count", None)
    # `isinstance` rather than a None check, and rather than `int(count)`:
    # anything that isn't already an integer is a client that didn't answer the
    # question, and coercing it invents a number. `int()` on a MagicMock
    # returns 1 — which is how a test first showed a brand-new account with one
    # analysis already used.
    if isinstance(count, int):
        return count
    # Older supabase-py, or a stand-in that doesn't implement `count`: fall
    # back to the rows themselves rather than reporting zero, which would
    # silently disable the limit.
    return len(response.data or [])


def usage_for(client: Any, user_id: UUID, tier: str, now: datetime | None = None) -> Usage:
    start, end = month_bounds(now)
    if tier in UNLIMITED_TIERS:
        # No query: an unlimited account's count changes nothing, and this is
        # on the path of every analysis a paying user runs.
        return Usage(tier=tier, used=0, limit=None, period_start=start, period_end=end)

    return Usage(
        tier=tier,
        used=count_analyses_this_month(client, user_id, now),
        limit=FREE_MONTHLY_ANALYSES,
        period_start=start,
        period_end=end,
    )


def tier_of(client: Any, user_id: UUID) -> str:
    """The account's tier, defaulting to free.

    A missing row means `/v1/me` hasn't run yet, which shouldn't happen on an
    authenticated path — but defaulting to free is the safe direction. The
    alternative failure mode is handing someone unlimited analyses because a
    row was late.
    """
    response = (
        client.table("users").select("tier").eq("id", str(user_id)).limit(1).execute()
    )
    rows = response.data or []
    if not rows:
        return UserTier.free.value
    return rows[0].get("tier") or UserTier.free.value
