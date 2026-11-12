"""Writing an object to Storage so it keeps the `Cache-Control` it was sent.

**Every object this service wrote was stored with a header no browser can
use.** `storage3`'s `upload` sends a multipart form, and for a form Storage
does not keep the `cache-control` it is given. It writes `max-age=` in front of
the form's `cacheControl` field, which its API documents as a number of
seconds. Handed `cache_headers.CACHE_FOREVER`, that produced
`max-age=private, max-age=31536000, immutable`. Read off the live project on
2026-10-24: every display copy of a page, every compressed take and every
shrunk avatar this service had written carried it, 27 objects in all. Every
object a phone uploaded directly carried the header as sent. In Chromium the
malformed one was fetched again after a reload, where the right one was not.
So the photographs on a piece's screen and the takes on its verdict screen
were downloaded again on every visit, which is what `CACHE_FOREVER` exists to
stop.

**A raw body keeps the header verbatim.** For a request whose body is the
object itself, Storage stores the request's own `cache-control` as it stands.
That is how the app's direct uploads (`mobile/src/data/api/upload.ts`) get it
right, and this sends the same request: the bytes as the body, through the
same storage client, its signed-in session and its error handling.
"""

from __future__ import annotations

from typing import Any

from app.services.cache_headers import CACHE_FOREVER


def write_object(
    bucket: Any, key: str, data: bytes, *, content_type: str, upsert: bool = False
) -> None:
    """Store `data` at `key` in `bucket` (a `client.storage.from_(...)`), cached
    for good (`CACHE_FOREVER`).

    `upsert` replaces an object already at `key`; without it, a key that
    exists is refused, as `upload` refuses it. Raises what `upload` raises,
    `storage3.exceptions.StorageApiError` for a refusal.

    **`_request` is `storage3`'s own, and private.** No public call sends a raw
    body. It is the one every public call goes through, so it carries the
    client's address, keys and error handling, and
    `test_storage_writes.py` holds it to the request this needs against the
    real library, so an upgrade that changes it fails there.
    """
    bucket._request(  # noqa: SLF001 — see the docstring
        "POST",
        ["object", bucket.id, *key.split("/")],
        headers={
            "content-type": content_type,
            "cache-control": CACHE_FOREVER,
            "x-upsert": "true" if upsert else "false",
        },
        content=data,
    )
