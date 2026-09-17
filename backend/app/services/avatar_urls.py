"""A signed URL for a profile picture, held still long enough to be cached.

**Measured on the live project, 2026-09-13: one avatar was downloaded 51 times in
24 hours — 9 MB of a 176 kB file.** It is the single most re-fetched object in
the project, ahead of every sheet-music page.

`routers/me.py::_avatar_url` signed a fresh URL on **every `/v1/me` response**,
and the app asks for `/v1/me` on every launch, every profile view and every
session refresh. A signed URL carries a token in its query string, and the
query string is part of the browser's cache key — so each answer handed the
browser a URL it had never seen, and it fetched the same bytes again.

**This is why `Cache-Control` alone did not fix the avatar.** The uploads now
say `max-age=31536000, immutable` (`cache_headers.py`), and it buys nothing
against a URL that changes on every request. The same trap is documented in
`display_urls.py`, which was written for score images and solved exactly this;
the avatar had no equivalent and nobody noticed, because the failure is
invisible on any screen — the picture loads correctly every time.

**The old docstring's reasoning was right and its conclusion was not.** It
said: *"Signing per response rather than storing a URL is the lesson
`scores.source_image_url` taught: a signed URL expires, so a stored one is a
value that stops working."* True. But the choice is not between a stale stored
URL and a fresh one every time — it is to remember the URL *with its expiry*
and re-sign once it is close to it, which is what this does and what
`display_urls.py` has always done.

Never raises. A profile picture is decoration, and storage being unreachable
must not fail the call that also provisions the account.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.buckets import AVATAR_BUCKET
from app.services.signed_urls import absolute, signed_url_in

log = logging.getLogger("intempo.me")

#: A week, matching the score images. The URL is the browser's cache key, so
#: its life is the ceiling on how long a cached picture can be reused.
AVATAR_URL_TTL_SECONDS = 7 * 24 * 60 * 60

#: Re-sign once less than this remains, so a response never hands out a URL
#: that expires while the screen holding it is still open.
REUSE_FLOOR_SECONDS = 24 * 60 * 60

#: Bounded: one entry per musician who has a picture, at roughly 200 bytes.
CACHE_MAX = 1024

_urls: dict[str, tuple[str, datetime]] = {}
_lock = threading.Lock()


def reset_cache() -> None:
    """For tests. The memo is process state, and tests must not share it."""
    with _lock:
        _urls.clear()


def _evict(now: datetime) -> None:
    """Drop what has expired, and only then the oldest, and only if still full.

    Evicting is not the same as emptying: clearing the memo on every overflow
    would re-sign every live URL, which is the cost this module exists to
    avoid.
    """
    for key in [k for k, (_, expires) in _urls.items() if expires <= now]:
        del _urls[key]
    while len(_urls) > CACHE_MAX:
        oldest = min(_urls, key=lambda k: _urls[k][1])
        del _urls[oldest]


def signed_avatar_url(client: Any, key: str | None) -> str | None:
    """The picture's URL, reused while it comfortably still works."""
    if not key:
        return None

    now = datetime.now(tz=timezone.utc)
    with _lock:
        held = _urls.get(key)
        if held is not None:
            url, expires = held
            if expires - now > timedelta(seconds=REUSE_FLOOR_SECONDS):
                return url

    try:
        signed = client.storage.from_(AVATAR_BUCKET).create_signed_url(
            key, AVATAR_URL_TTL_SECONDS
        )
    except Exception as exc:  # noqa: BLE001 — storage down, key gone, permissions
        log.warning("could not sign avatar %s: %s", key, exc)
        return None

    url = signed_url_in(signed)
    if url is None:
        return None
    url = absolute(url)

    with _lock:
        _urls[key] = (url, now + timedelta(seconds=AVATAR_URL_TTL_SECONDS))
        _evict(now)
    return url
