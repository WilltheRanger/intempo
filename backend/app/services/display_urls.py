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
from app.services.page_image import (
    SIGNED_DOWNLOAD_TTL_SECONDS,
    display_key_for,
    is_display_key,
)
from app.services.signed_urls import absolute, signed_url_in

#: A URL is only reused while at least this much of its life remains — a
#: screen that fetched a list and then sat is still holding URLs that work.
#:
#: A day against a week's TTL, so a given image keeps one URL for about six
#: days. That stability is the point: the URL is the browser's cache key, and
#: rotating it throws away a cached copy that was still perfectly good.
REUSE_FLOOR_SECONDS = 24 * 60 * 60

#: Bounded, because an unbounded memo is a slow leak on a host that stays up
#: for weeks. At roughly 200 bytes a URL this is well under a megabyte.
CACHE_MAX = 4096

#: Display URLs already signed, by object key, with their real expiry.
_urls: dict[str, tuple[str, datetime]] = {}

#: Keys storage did not return, and when to ask about them again.
#:
#: **Absence has to be remembered or it is asked about forever.** Every page
#: scanned before `store_display_copy` existed has no display copy and nothing
#: backfills them, so without this a library of old pages re-probes every
#: derivative on every request — one extra signing call per page, permanently,
#: which is the exact cost `signed_display_urls` was written to remove. Caught
#: by `test_the_same_image_is_signed_once_and_the_url_is_stable`, which counted
#: two signing calls where it demanded one.
_absent: dict[str, datetime] = {}

#: Short, because the absence is temporary for any page that gets re-read: a
#: re-transcription writes the derivative and this is how long the old answer
#: survives it. Ten minutes of one extra signing call per page is a cost worth
#: paying to keep the negative answer from outliving the fact.
ABSENT_TTL_SECONDS = 10 * 60

_lock = threading.Lock()


def reset_cache() -> None:
    """For tests. The memo is process state, and tests must not share it."""
    with _lock:
        _urls.clear()
        _absent.clear()


def _signed_for_keys(keys: list[str]) -> dict[str, tuple[str, datetime]]:
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


def signed_display_urls(keys: list[str]) -> dict[str, tuple[str, datetime]]:
    """Page object key -> (signed URL, expiry), preferring the display copy.

    Callers pass the key of the photograph and get back whatever is cheapest to
    look at: the display-size copy written during transcription when there is
    one, the photograph itself when there is not. The result is keyed by the
    photograph either way, so nothing upstream has to know this happened.

    **Both keys go in one storage call, not the derivative first and the
    photograph after it.** A batch of 2N keys is one round trip; probing and
    falling back is two whenever a derivative is missing, which is every page
    scanned before `store_display_copy` existed — permanently, since nothing
    backfills them. Signing is a JWT operation on a key that need not exist, so
    the waste is a few tokens; the round trip is the part that costs. Missing
    objects come back as error entries, which `_signed_for_keys` already skips.

    That also leaves the photograph's URL signed and memoised beside the
    derivative's, so a page whose display copy is removed keeps working without
    a second call.
    """
    if not keys:
        return {}

    display_of = {key: display_key_for(key) for key in keys}

    now = datetime.now(tz=timezone.utc)
    with _lock:
        known_absent = {
            key for key, until in _absent.items() if until > now
        }
    ask = sorted(
        {*display_of.keys(), *(set(display_of.values()) - known_absent)}
    )
    signed = _signed_for_keys(ask)

    # Anything asked for and not returned is not there. Remembered so the next
    # request does not ask again; see `_absent`.
    missing = [key for key in ask if key not in signed and is_display_key(key)]
    if missing:
        until = now + timedelta(seconds=ABSENT_TTL_SECONDS)
        with _lock:
            if len(_absent) + len(missing) > CACHE_MAX:
                for key in [k for k, u in _absent.items() if u <= now]:
                    del _absent[key]
            if len(_absent) + len(missing) > CACHE_MAX:
                _absent.clear()
            _absent.update({key: until for key in missing})
    out: dict[str, tuple[str, datetime]] = {}
    for original, display in display_of.items():
        found = signed.get(display) or signed.get(original)
        if found is not None:
            out[original] = found
    return out
