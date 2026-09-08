"""The signed-display-URL memo, tested directly rather than through a route.

Every property here was previously reachable only by building a score row,
issuing an HTTP request and counting calls on a `MagicMock` storage double —
which is why the two that need no request at all, **the cache bound** and the
degrade-to-cached paths, had never been tested. A memo with a lock and a cap
is not request handling, and this is what moving it out of `routers/scores.py`
was for.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app import db as db_module
from app.services import display_urls
from app.services.buckets import SCORE_BUCKET
from app.services.page_image import SIGNED_DOWNLOAD_TTL_SECONDS


class _Storage:
    """`client.storage.from_(bucket).create_signed_urls(keys, ttl)`."""

    def __init__(self, *, raises: Exception | None = None, prefix_bucket: bool = False):
        self.calls: list[list[str]] = []
        self.raises = raises
        self.prefix_bucket = prefix_bucket

    def from_(self, bucket: str):
        assert bucket == SCORE_BUCKET
        return self

    def create_signed_urls(self, keys, ttl):
        assert ttl == SIGNED_DOWNLOAD_TTL_SECONDS
        self.calls.append(list(keys))
        if self.raises is not None:
            raise self.raises
        return [
            {
                "path": f"{SCORE_BUCKET}/{key}" if self.prefix_bucket else key,
                "signedUrl": f"https://signed.example/{key}?token=t{len(self.calls)}",
            }
            for key in keys
        ]


class _Client:
    def __init__(self, storage: _Storage):
        self.storage = storage


def _age(key: str, *, seconds: int) -> None:
    """Rewrite one memo entry's expiry to `seconds` from now (negative = past)."""
    with display_urls._lock:
        url, _ = display_urls._urls[key]
        display_urls._urls[key] = (
            url,
            datetime.now(tz=timezone.utc) + timedelta(seconds=seconds),
        )


@pytest.fixture(autouse=True)
def _fresh_cache():
    display_urls.reset_cache()
    yield
    display_urls.reset_cache()


def _install(monkeypatch: pytest.MonkeyPatch, storage: _Storage | None) -> None:
    client = _Client(storage) if storage is not None else None
    monkeypatch.setattr(db_module, "get_service_client", lambda: client)


# ---- the batch ------------------------------------------------------------


def test_no_keys_asks_storage_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    storage = _Storage()
    _install(monkeypatch, storage)

    assert display_urls.signed_display_urls([]) == {}
    assert storage.calls == []


def test_a_library_is_one_signing_call_not_forty(monkeypatch: pytest.MonkeyPatch) -> None:
    storage = _Storage()
    _install(monkeypatch, storage)
    keys = [f"u/{i}.jpg" for i in range(40)]

    signed = display_urls.signed_display_urls(keys)

    assert len(signed) == 40
    assert storage.calls == [keys]


def test_the_bucket_is_stripped_when_supabase_echoes_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Supabase returns `path` with or without the bucket depending on the call;
    the memo is keyed on the bare object key either way."""
    _install(monkeypatch, _Storage(prefix_bucket=True))

    signed = display_urls.signed_display_urls(["u/a.jpg"])

    assert list(signed) == ["u/a.jpg"]


# ---- reuse ----------------------------------------------------------------


def test_a_fresh_url_is_reused_rather_than_signed_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The whole point: a fresh signature is a fresh URL, and a fresh URL is a
    cache miss in every image cache downstream."""
    storage = _Storage()
    _install(monkeypatch, storage)

    first = display_urls.signed_display_urls(["u/a.jpg"])
    second = display_urls.signed_display_urls(["u/a.jpg"])

    assert first == second
    assert storage.calls == [["u/a.jpg"]]


@pytest.mark.parametrize(
    "remaining, resigns",
    [
        # Five minutes left. The URL still works, so nothing *fails* if it is
        # handed out — which is exactly why the floor has to be a deliberate
        # number and not "has it expired yet".
        (5 * 60, True),
        (50 * 60, False),
    ],
)
def test_reuse_stops_while_the_url_still_comfortably_works(
    monkeypatch: pytest.MonkeyPatch, remaining: int, resigns: bool
) -> None:
    """A list fetched and then stared at is still holding URLs that have to
    survive the stare.

    The remaining lifetimes are written as literal minutes rather than derived
    from `REUSE_FLOOR_SECONDS`: a test that computes its input from the
    constant it is checking passes for every value of that constant, including
    zero. (It did, until a mutation run said so.)
    """
    storage = _Storage()
    _install(monkeypatch, storage)
    display_urls.signed_display_urls(["u/a.jpg"])
    _age("u/a.jpg", seconds=remaining)

    display_urls.signed_display_urls(["u/a.jpg"])

    assert len(storage.calls) == (2 if resigns else 1)


def test_only_the_missing_keys_are_signed(monkeypatch: pytest.MonkeyPatch) -> None:
    """A new piece added to a library of forty signs one key, not forty-one."""
    storage = _Storage()
    _install(monkeypatch, storage)
    display_urls.signed_display_urls([f"u/{i}.jpg" for i in range(40)])

    signed = display_urls.signed_display_urls([f"u/{i}.jpg" for i in range(41)])

    assert len(signed) == 41
    assert storage.calls[1] == ["u/40.jpg"]


# ---- degrading ------------------------------------------------------------


def test_no_service_client_returns_what_is_cached_rather_than_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A list of scores with no thumbnails is a usable screen; a 500 is not."""
    storage = _Storage()
    _install(monkeypatch, storage)
    display_urls.signed_display_urls(["u/a.jpg"])

    _install(monkeypatch, None)
    signed = display_urls.signed_display_urls(["u/a.jpg", "u/b.jpg"])

    assert list(signed) == ["u/a.jpg"]


def test_a_signing_failure_degrades_to_the_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, _Storage())
    display_urls.signed_display_urls(["u/a.jpg"])

    _install(monkeypatch, _Storage(raises=RuntimeError("storage down")))
    signed = display_urls.signed_display_urls(["u/a.jpg", "u/b.jpg"])

    assert list(signed) == ["u/a.jpg"]


# ---- the bound ------------------------------------------------------------


def test_the_memo_drops_the_stale_entries_and_keeps_the_live_ones(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unbounded memo is a slow leak on a host that stays up for weeks — but
    evicting is not the same as emptying, and the difference is a signing call
    for every URL still on someone's screen.

    So the cap is reached with a *mixture*: two entries past their usefulness
    and one with most of its hour left. Dropping the eviction loop entirely
    passes a test where everything is stale, because the clear below it
    produces the same three keys."""
    monkeypatch.setattr(display_urls, "CACHE_MAX", 4)
    storage = _Storage()
    _install(monkeypatch, storage)
    display_urls.signed_display_urls(["u/stale-0.jpg", "u/stale-1.jpg", "u/live.jpg"])
    _age("u/stale-0.jpg", seconds=-1)
    _age("u/stale-1.jpg", seconds=-1)
    _age("u/live.jpg", seconds=50 * 60)

    # 3 + 2 is past the cap; 1 + 2 is not, once the stale pair is gone.
    display_urls.signed_display_urls(["u/new-0.jpg", "u/new-1.jpg"])

    with display_urls._lock:
        assert sorted(display_urls._urls) == [
            "u/live.jpg",
            "u/new-0.jpg",
            "u/new-1.jpg",
        ]


def test_a_memo_of_live_entries_is_cleared_rather_than_left_to_grow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Nothing is stale and the cap is reached, so the memo starts again. The
    cost is one extra signing call per key, which is where this started."""
    monkeypatch.setattr(display_urls, "CACHE_MAX", 4)
    storage = _Storage()
    _install(monkeypatch, storage)
    display_urls.signed_display_urls(["u/0.jpg", "u/1.jpg", "u/2.jpg"])
    for key in ("u/0.jpg", "u/1.jpg", "u/2.jpg"):
        _age(key, seconds=50 * 60)

    signed = display_urls.signed_display_urls(["u/3.jpg", "u/4.jpg"])

    assert list(signed) == ["u/3.jpg", "u/4.jpg"]
    with display_urls._lock:
        assert sorted(display_urls._urls) == ["u/3.jpg", "u/4.jpg"]
