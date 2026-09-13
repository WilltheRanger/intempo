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
from app.config import settings
from app.services import display_urls
from app.services.buckets import SCORE_BUCKET
from app.services.page_image import (
    SIGNED_DOWNLOAD_TTL_SECONDS,
    display_key_for,
)


class _Storage:
    """`client.storage.from_(bucket).create_signed_urls(keys, ttl)`."""

    def __init__(
        self,
        *,
        raises: Exception | None = None,
        prefix_bucket: bool = False,
        relative: bool = False,
        missing: set[str] | None = None,
    ):
        self.calls: list[list[str]] = []
        self.raises = raises
        self.prefix_bucket = prefix_bucket
        self.relative = relative
        #: Keys storage does not hold. Supabase answers a batch per entry, so a
        #: key that is not there comes back as an error beside the ones that
        #: are — which is exactly how a page with no display copy is detected.
        self.missing = missing or set()

    def from_(self, bucket: str):
        assert bucket == SCORE_BUCKET
        return self

    def create_signed_urls(self, keys, ttl):
        assert ttl == SIGNED_DOWNLOAD_TTL_SECONDS
        self.calls.append(list(keys))
        if self.raises is not None:
            raise self.raises
        return [
            {"path": key, "error": "Object not found"}
            if key in self.missing
            else {
                "path": f"{SCORE_BUCKET}/{key}" if self.prefix_bucket else key,
                "signedUrl": (
                    f"/object/sign/{SCORE_BUCKET}/{key}?token=t"
                    if self.relative
                    else f"https://signed.example/{key}?token=t{len(self.calls)}"
                ),
            }
            for key in keys
        ]


class _Client:
    def __init__(self, storage: _Storage):
        self.storage = storage


def _age(key: str, *, seconds: int) -> None:
    """Age a page's memo entries to `seconds` from now (negative = past).

    **Both of them**, because a page is two objects since display copies
    existed: the derivative and the photograph behind it are signed in the same
    batch and expire together. Ageing only the one named here would leave its
    twin live and make every cap assertion below measure something other than
    what it says.
    """
    with display_urls._lock:
        for entry in {key, display_key_for(key)}:
            if entry not in display_urls._urls:
                continue
            url, _ = display_urls._urls[entry]
            display_urls._urls[entry] = (
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
    # Still **one** call, which is what this test is named for. It carries two
    # keys per page now — the display copy and the photograph behind it — so a
    # page with no derivative needs no second round trip. See
    # `signed_display_urls`.
    assert storage.calls == [sorted([*keys, *(f"u/{i}.display.jpg" for i in range(40))])]


def test_a_path_is_stored_as_a_url_the_app_can_load(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The batch call returns a path on some SDK versions and an absolute URL
    on others — the same fact the two single-URL readers in `audio_storage` and
    `page_image` have always handled and this one did not.

    Unverified against a live project, and safe regardless: `absolute` is a
    no-op on a URL that already starts with `http`, so it either changes
    nothing or replaces a value the app could not have loaded."""
    _install(monkeypatch, _Storage(relative=True))

    signed = display_urls.signed_display_urls(["u/a.jpg"])

    url, _ = signed["u/a.jpg"]
    # Keyed by the photograph, pointing at the display copy — which is the
    # whole trade, and the reason callers needed no change.
    assert url == (
        f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1"
        f"/object/sign/{SCORE_BUCKET}/u/a.display.jpg?token=t"
    )


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
    assert storage.calls == [["u/a.display.jpg", "u/a.jpg"]]


@pytest.mark.parametrize(
    "remaining, resigns",
    [
        # Six hours left. The URL still works, so nothing *fails* if it is
        # handed out — which is exactly why the floor has to be a deliberate
        # number and not "has it expired yet".
        #
        # These bracketed a ten-minute floor until 2026-09-13, when the floor
        # became a day and the TTL a week: the signed URL is the browser's
        # cache key, so rotating it hourly threw away a cached image that was
        # still good. Both literals moved with it, and both still straddle the
        # floor rather than being derived from it.
        (6 * 60 * 60, True),
        (5 * 24 * 60 * 60, False),
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
    assert storage.calls[1] == ["u/40.display.jpg", "u/40.jpg"]


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
    and one with most of its week left. Dropping the eviction loop entirely
    passes a test where everything is stale, because the clear below it
    produces the same three keys."""
    # Eight, not four: every page memoises its display copy beside its
    # photograph, so the same three-pages-then-two shape needs twice the room.
    monkeypatch.setattr(display_urls, "CACHE_MAX", 8)
    storage = _Storage()
    _install(monkeypatch, storage)
    display_urls.signed_display_urls(["u/stale-0.jpg", "u/stale-1.jpg", "u/live.jpg"])
    _age("u/stale-0.jpg", seconds=-1)
    _age("u/stale-1.jpg", seconds=-1)
    _age("u/live.jpg", seconds=5 * 24 * 60 * 60)

    # 6 + 4 is past the cap; 2 + 4 is not, once the stale pair is gone.
    display_urls.signed_display_urls(["u/new-0.jpg", "u/new-1.jpg"])

    with display_urls._lock:
        assert sorted(display_urls._urls) == [
            "u/live.display.jpg",
            "u/live.jpg",
            "u/new-0.display.jpg",
            "u/new-0.jpg",
            "u/new-1.display.jpg",
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
        # Keyed by the object actually signed, so both members of each pair are
        # memoised — the result above is keyed by the photograph either way.
        assert sorted(display_urls._urls) == [
            "u/3.display.jpg",
            "u/3.jpg",
            "u/4.display.jpg",
            "u/4.jpg",
        ]


def test_a_page_with_no_display_copy_still_shows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Every page scanned before `store_display_copy` existed has no derivative,
    and nothing backfills them — so the fallback is not an edge case, it is the
    steady state for most of the library."""
    storage = _Storage(missing={"u/old.display.jpg"})
    _install(monkeypatch, storage)

    signed = display_urls.signed_display_urls(["u/old.jpg"])

    url, _ = signed["u/old.jpg"]
    assert url.endswith("u/old.jpg?token=t1")


def test_the_display_copy_is_preferred_when_both_exist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The point of the whole change: a phone photograph is 5712x4284 and the
    derivative is 1568 on its long edge, and the app was downloading the former
    to show on a 390-point screen."""
    storage = _Storage()
    _install(monkeypatch, storage)

    signed = display_urls.signed_display_urls(["u/p.jpg"])

    url, _ = signed["u/p.jpg"]
    assert "u/p.display.jpg" in url


def test_both_keys_go_out_in_one_call(monkeypatch: pytest.MonkeyPatch) -> None:
    """Probing the derivative and falling back would be two round trips on every
    page that has none, which is most of them. One batch of 2N keys is one."""
    storage = _Storage(missing={"u/a.display.jpg", "u/b.display.jpg"})
    _install(monkeypatch, storage)

    signed = display_urls.signed_display_urls(["u/a.jpg", "u/b.jpg"])

    assert sorted(signed) == ["u/a.jpg", "u/b.jpg"]
    assert len(storage.calls) == 1


def test_a_page_with_no_display_copy_is_asked_about_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The property this module exists for, extended to the pages that have no
    derivative — which is every one scanned before `store_display_copy`, and
    nothing backfills them. Without the absence memo each of those costs one
    extra signing call on every request, forever."""
    storage = _Storage(missing={"u/old.display.jpg"})
    _install(monkeypatch, storage)

    display_urls.signed_display_urls(["u/old.jpg"])
    display_urls.signed_display_urls(["u/old.jpg"])

    assert storage.calls == [["u/old.display.jpg", "u/old.jpg"]]


def test_the_absence_is_forgotten_so_a_re_scan_is_picked_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A re-transcription writes the derivative. The negative answer must not
    outlive the fact it describes."""
    storage = _Storage(missing={"u/old.display.jpg"})
    _install(monkeypatch, storage)
    display_urls.signed_display_urls(["u/old.jpg"])

    with display_urls._lock:
        display_urls._absent["u/old.display.jpg"] = datetime.now(
            tz=timezone.utc
        ) - timedelta(seconds=1)
    storage.missing = set()

    signed = display_urls.signed_display_urls(["u/old.jpg"])

    assert "u/old.display.jpg" in signed["u/old.jpg"][0]
