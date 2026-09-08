"""Reading a download URL out of a Supabase signing response.

**Supabase spells the key three ways** — `signedURL`, `signedUrl` and
`signed_url` — depending on the SDK version and on whether the call was the
single or the batch form, and it returns **either a path or an absolute URL**
for the same reason. Three call sites each carried their own `or` chain for
the first fact and two of the three carried the second, which is three chances
to learn about a fourth spelling and two places to fix the path case.

The cost of that was already visible: the three chains did not even agree on
the order they tried the keys in, and the batch reader absolutised nothing —
so a Supabase version that answered the batch call with paths would have put
unloadable URLs on the library screen, silently, while the two single-URL
readers beside it handled exactly that.
"""

from __future__ import annotations

from typing import Any

from app.config import settings


def signed_url_in(payload: Any) -> str | None:
    """The URL out of one signing response, whichever way it was spelt.

    `None` for anything that is not a mapping carrying one — an error entry in
    a batch response, or an SDK returning something new. Callers treat that as
    "no URL for this key", which is the same thing they do for a key storage
    did not sign.
    """
    if not isinstance(payload, dict):
        return None
    url = (
        payload.get("signedURL")
        or payload.get("signedUrl")
        or payload.get("signed_url")
    )
    return str(url) if url else None


def absolute(url: str) -> str:
    """A signed URL made loadable, whether it arrived as a path or a URL."""
    if url.startswith("http"):
        return url
    return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1{url}"
