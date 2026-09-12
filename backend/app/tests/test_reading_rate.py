"""The cost guard on starting a reading — see `services/reading_rate`.

Every test drives the clock explicitly. Nothing here sleeps, and nothing here
depends on how long it takes to run.
"""

from __future__ import annotations

from app.services.reading_rate import (
    LIMITS,
    LONGEST_WINDOW,
    Limit,
    ReadingRate,
)


def test_a_reading_is_allowed_and_recorded_in_one_call() -> None:
    """Two calls would be two chances to check and forget to record, and the
    one that forgets fails open — which is the direction that costs money."""
    rate = ReadingRate((Limit(2, 60.0),))

    assert rate.check("u", now=0.0).allowed is True
    assert rate.check("u", now=1.0).allowed is True
    assert rate.check("u", now=2.0).allowed is False


def test_the_burst_limit_stops_a_loop_within_the_minute() -> None:
    rate = ReadingRate()
    # Ten in a second is not a capture flow; it is a client retrying.
    for n in range(10):
        assert rate.check("u", now=n * 0.1).allowed is True
    assert rate.check("u", now=1.1).allowed is False


def test_the_hourly_limit_catches_what_the_burst_limit_cannot_see() -> None:
    """A script pacing itself just under ten a minute would never trip the
    burst window. Sixty an hour is the limit that sees it."""
    rate = ReadingRate()
    # Nine every minute — comfortably inside the burst allowance every time.
    allowed = 0
    for minute in range(20):
        for n in range(9):
            if rate.check("u", now=minute * 60.0 + n).allowed:
                allowed += 1
    assert allowed == 60, "the hourly allowance is what stopped it"


def test_room_reappears_as_the_window_slides() -> None:
    rate = ReadingRate((Limit(2, 60.0),))
    rate.check("u", now=0.0)
    rate.check("u", now=10.0)
    assert rate.check("u", now=59.0).allowed is False
    # The first event leaves the window at t=60.
    assert rate.check("u", now=60.5).allowed is True


def test_one_account_hitting_the_limit_does_not_touch_another() -> None:
    """The key is the account. A busy musician must not stop anyone else."""
    rate = ReadingRate((Limit(1, 60.0),))
    assert rate.check("a", now=0.0).allowed is True
    assert rate.check("a", now=1.0).allowed is False
    assert rate.check("b", now=1.0).allowed is True


def test_the_wait_is_long_enough_to_actually_work() -> None:
    """Rounded up, not down. A client that waits exactly `retry_after` must be
    past the boundary — landing on it and being refused again is the bug that
    turns a wait into a loop."""
    rate = ReadingRate((Limit(1, 60.0),))
    rate.check("u", now=0.0)

    refused = rate.check("u", now=0.5)
    assert refused.allowed is False
    assert rate.check("u", now=0.5 + refused.retry_after).allowed is True


def test_a_refusal_is_never_told_to_come_back_immediately() -> None:
    """`retry_after` of 0 alongside `allowed=False` reads as "try now", which
    is how a refusal becomes a tight retry loop."""
    rate = ReadingRate((Limit(1, 3600.0),))
    rate.check("u", now=0.0)
    # A refusal a hair before the boundary still rounds to a whole second.
    assert rate.check("u", now=3599.999).retry_after >= 1


def test_the_wait_reported_is_the_longest_one_that_applies() -> None:
    """Both windows can be full at once. Reporting the shorter wait sends the
    client back to be refused again."""
    rate = ReadingRate((Limit(2, 10.0), Limit(2, 100.0)))
    rate.check("u", now=0.0)
    rate.check("u", now=1.0)

    refused = rate.check("u", now=2.0)
    assert refused.allowed is False
    # The ten-second window clears at t=10; the hundred-second one at t=100.
    assert refused.retry_after == 98


def test_a_refusal_does_not_count_against_the_next_attempt() -> None:
    """Recording refused attempts would make a client that retries lock itself
    out for longer every time it tried."""
    rate = ReadingRate((Limit(1, 60.0),))
    rate.check("u", now=0.0)
    for moment in (10.0, 20.0, 30.0, 40.0, 50.0):
        assert rate.check("u", now=moment).allowed is False
    # Only the reading at t=0 was ever recorded, so room appears at t=60.
    assert rate.check("u", now=60.5).allowed is True


def test_accounts_that_have_gone_quiet_are_forgotten() -> None:
    """One entry per account that has ever photographed a page, for the life of
    the process, is a leak — the kind only found in production."""
    rate = ReadingRate()
    for n in range(50):
        rate.check(f"user-{n}", now=0.0)
    assert rate.tracked == 50

    assert rate.forget_expired(now=LONGEST_WINDOW + 1) == 50
    assert rate.tracked == 0


def test_a_still_active_account_is_not_forgotten() -> None:
    rate = ReadingRate()
    rate.check("busy", now=0.0)
    rate.check("gone", now=0.0)
    rate.check("busy", now=LONGEST_WINDOW - 1)

    rate.forget_expired(now=LONGEST_WINDOW + 0.5)
    assert rate.tracked == 1
    # And forgetting the other one did not give it back its allowance.
    assert rate.check("busy", now=LONGEST_WINDOW + 0.5).allowed is True


def test_a_refused_account_with_no_history_is_not_left_behind() -> None:
    """A zero allowance refuses without recording anything. The key must not
    stay in the dictionary for an account that has never been let through."""
    rate = ReadingRate((Limit(0, 60.0),))
    assert rate.check("u", now=0.0).allowed is False
    assert rate.tracked == 0


def test_the_shipped_allowances_are_out_of_a_musician_s_reach() -> None:
    """These are a cost guard, not a product limit — `tier_limits` and spec §8
    are what a free account is *entitled* to. If a number here ever drops far
    enough to be felt by someone photographing a book of études, it has stopped
    being a guard and become pricing, which is the owner's call and not this
    module's.
    """
    per_minute, per_hour = LIMITS
    assert per_minute.allowance >= 6, "fewer than one a ten seconds is human territory"
    assert per_hour.allowance >= 40, "a long capture session must not be stopped"
    # And the burst limit has to be the tighter of the two, or it does nothing.
    assert per_minute.allowance / per_minute.window_seconds > (
        per_hour.allowance / per_hour.window_seconds
    )
