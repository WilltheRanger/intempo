"""The profile picture's URL is held still, because the URL is the cache key.

Measured on `intempo-dev` on 2026-09-13: **51 downloads of one 176 kB avatar
in 24 hours**, the most re-fetched object in the project. `/v1/me` signed a
fresh URL on every response and the app calls it on every launch, profile view
and session refresh — so the browser was handed a URL it had never seen each
time and fetched the same bytes again.

This is invisible on every screen: the picture loads correctly every time. Only
the bill shows it. So the rule lives here.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.services import avatar_urls
from app.services.buckets import AVATAR_BUCKET


class _Storage:
    """`client.storage.from_(bucket).create_signed_url(key, ttl)`."""

    def __init__(self, *, raises: Exception | None = None, relative: bool = False):
        self.calls: list[tuple[str, int]] = []
        self.raises = raises
        self.relative = relative

    def from_(self, bucket: str):
        assert bucket == AVATAR_BUCKET
        return self

    def create_signed_url(self, key: str, ttl: int):
        self.calls.append((key, ttl))
        if self.raises is not None:
            raise self.raises
        token = len(self.calls)
        if self.relative:
            return {"signedURL": f"/object/sign/{AVATAR_BUCKET}/{key}?token=t{token}"}
        return {"signedURL": f"https://signed.example/{key}?token=t{token}"}


class _Client:
    def __init__(self, storage: _Storage):
        self.storage = storage


def _age(key: str, *, seconds: int) -> None:
    """Move a memo entry's expiry to `seconds` from now (negative = past)."""
    with avatar_urls._lock:
        url, _ = avatar_urls._urls[key]
        avatar_urls._urls[key] = (
            url,
            datetime.now(tz=timezone.utc) + timedelta(seconds=seconds),
        )


@pytest.fixture(autouse=True)
def _fresh_cache():
    avatar_urls.reset_cache()
    yield
    avatar_urls.reset_cache()


def test_the_same_picture_is_signed_once_and_the_url_is_stable() -> None:
    """The whole point. A second signature is a second URL, and a second URL is
    a download of bytes the browser already had."""
    storage = _Storage()

    first = avatar_urls.signed_avatar_url(_Client(storage), "u/a.jpg")
    second = avatar_urls.signed_avatar_url(_Client(storage), "u/a.jpg")

    assert first == second
    assert len(storage.calls) == 1


def test_it_asks_for_a_life_long_enough_to_be_worth_caching() -> None:
    """An hour was the old value, and an hour is shorter than the gap between
    two uses of the same app."""
    storage = _Storage()

    avatar_urls.signed_avatar_url(_Client(storage), "u/a.jpg")

    _, ttl = storage.calls[0]
    assert ttl == 7 * 24 * 60 * 60


@pytest.mark.parametrize(
    "remaining, resigns",
    [
        # Six hours left: the URL still works, which is exactly why the floor
        # has to be a deliberate number rather than "has it expired yet" — a
        # screen open when it expires is a picture that vanishes.
        (6 * 60 * 60, True),
        (5 * 24 * 60 * 60, False),
    ],
)
def test_it_re_signs_before_the_url_stops_working(remaining: int, resigns: bool) -> None:
    storage = _Storage()
    avatar_urls.signed_avatar_url(_Client(storage), "u/a.jpg")
    _age("u/a.jpg", seconds=remaining)

    avatar_urls.signed_avatar_url(_Client(storage), "u/a.jpg")

    assert len(storage.calls) == (2 if resigns else 1)


def test_no_key_asks_storage_nothing() -> None:
    storage = _Storage()

    assert avatar_urls.signed_avatar_url(_Client(storage), None) is None
    assert avatar_urls.signed_avatar_url(_Client(storage), "") is None
    assert storage.calls == []


def test_storage_being_unreachable_costs_the_picture_and_nothing_else() -> None:
    """`/v1/me` also provisions the account. A picture that cannot be signed is
    decoration missing, not a failed sign-in."""
    storage = _Storage(raises=RuntimeError("storage down"))

    assert avatar_urls.signed_avatar_url(_Client(storage), "u/a.jpg") is None


def test_a_path_is_returned_as_a_url_the_app_can_load() -> None:
    """Supabase answers with a path on some SDK versions and an absolute URL on
    others — the same fact `signed_urls.absolute` exists for."""
    storage = _Storage(relative=True)

    url = avatar_urls.signed_avatar_url(_Client(storage), "u/a.jpg")

    assert url == (
        f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1"
        f"/object/sign/{AVATAR_BUCKET}/u/a.jpg?token=t1"
    )


def test_the_memo_drops_the_expired_and_keeps_the_live() -> None:
    """Evicting is not emptying: clearing on overflow would re-sign every URL
    still on someone's screen, which is the cost this module removes."""
    avatar_urls.CACHE_MAX = 2
    try:
        storage = _Storage()
        client = _Client(storage)
        avatar_urls.signed_avatar_url(client, "u/stale.jpg")
        avatar_urls.signed_avatar_url(client, "u/live.jpg")
        _age("u/stale.jpg", seconds=-1)
        _age("u/live.jpg", seconds=5 * 24 * 60 * 60)

        avatar_urls.signed_avatar_url(client, "u/new.jpg")

        with avatar_urls._lock:
            assert sorted(avatar_urls._urls) == ["u/live.jpg", "u/new.jpg"]
    finally:
        avatar_urls.CACHE_MAX = 1024
