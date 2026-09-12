"""Signed download URLs for score images, memoised for most of their life.

**Why this is a module and not part of `routers/scores.py`.** It was ~85 lines
of the router: a process-global dict, a lock, a reuse floor, a cache bound and
a batching call, none of which needs a request to exist and none of which the
router's other 1,600 lines touch. Its only test was through HTTP — five cases
in `test_scores_router.py` that had to build a whole score row and read a
response body to assert something about a dictionary.

Nothing here imports FastAPI, and the client is reached through `app.db` so a
test fakes storage the same way it fakes it for every other part of the HTTP
layer.
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

from app import db
from app.services.buckets import SCORE_BUCKET
from app.services.page_image import SIGNED_DOWNLOAD_TTL_SECONDS
from app.services.signed_urls import absolute, signed_url_in

#: A URL is only reused while at least this much of its life remains — a
#: screen that fetched a list and then sat is still holding URLs that work.
REUSE_FLOOR_SECONDS = 10 * 60

#: Bounded, because an unbounded memo is a slow leak on a host that stays up
#: for weeks. At roughly 200 bytes a URL this is well under a megabyte.
CACHE_MAX = 4096

#: Display URLs already signed, by object key, with their real expiry.
_urls: dict[str, tuple[str, datetime]] = {}
_lock = threading.Lock()


def reset_cache() -> None:
    """For tests. The memo is process state, and tests must not share it."""
    with _lock:
        _urls.clear()


def signed_display_urls(keys: list[str]) -> dict[str, tuple[str, datetime]]:
    """Object key → (signed download URL, expiry), for as many as storage gives.

    Batched: a library of forty scores is one storage call, not forty. Missing
    keys are simply absent from the result, and a signing failure degrades the
    whole batch to whatever was already cached rather than failing the request
    — a list of scores with no thumbnails is a usable screen; a 500 is not.

    **Signed once, reused for most of the hour — because a fresh signature is
    a fresh URL, and a fresh URL is a cache miss.** Every response used to mint
    a new token per image, so the URL string differed on every fetch and every
    image cache — expo-image's, keyed on the URL, and the browser's HTTP cache
    alike — missed on every one. The screen showing the photograph *while a
    scan is read* polls every three seconds, so watching one sixty-second read
    re-downloaded the photograph twenty times: measured against this library's
    pages, 50–100 MB of egress per scan watched, on a bucket holding 53 MB in
    total.

    Reused only while comfortably inside its life (`REUSE_FLOOR_SECONDS`), so
    nothing on screen holds a URL that dies mid-scroll, and the expiry reported
    to the client is the *reused* URL's real one rather than a promise the
    token does not keep.
    """
    if not keys:
        return {}

    now = datetime.now(tz=timezone.utc)
    with _lock:
        floor = now + timedelta(seconds=REUSE_FLOOR_SECONDS)
        cached = {
            key: _urls[key]
            for key in keys
            if key in _urls and _urls[key][1] > floor
        }
    missing = [key for key in keys if key not in cached]
    if not missing:
        return cached

    client = db.get_service_client()
    if client is None:
        return cached

    bucket = client.storage.from_(SCORE_BUCKET)
    try:
        signed = bucket.create_signed_urls(missing, SIGNED_DOWNLOAD_TTL_SECONDS)
    except Exception:  # noqa: BLE001 — no thumbnails beats no screen
        return cached

    expires_at = now + timedelta(seconds=SIGNED_DOWNLOAD_TTL_SECONDS)
    fresh: dict[str, tuple[str, datetime]] = {}
    for entry in signed or []:
        if not isinstance(entry, dict) or entry.get("error"):
            continue
        url = signed_url_in(entry)
        path = entry.get("path")
        if url and path:
            # Supabase echoes the key back; it may or may not carry the bucket.
            fresh[str(path).removeprefix(f"{SCORE_BUCKET}/")] = (
                absolute(url),
                expires_at,
            )

    with _lock:
        # Past the cap the stale entries are dropped; if every entry is live
        # the memo is simply cleared — the cost is one extra signing call per
        # key, which is where this started.
        if len(_urls) + len(fresh) > CACHE_MAX:
            for key in [k for k, (_, exp) in _urls.items() if exp <= floor]:
                del _urls[key]
        if len(_urls) + len(fresh) > CACHE_MAX:
            _urls.clear()
        _urls.update(fresh)

    return {**cached, **fresh}
