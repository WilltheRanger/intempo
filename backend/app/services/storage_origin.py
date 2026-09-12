"""Where a storage URL is allowed to point, and where the bytes may come from.

**The hole this closes.** `POST /v1/calibration` took an `audio_url` from the
request body, checked that its *path* began with
`/storage/v1/object/sign/audio-uploads/<caller's id>/`, and then fetched it.
Nothing checked the **host**. Measured, not argued — every one of these was
accepted for a caller whose id appears in the path:

    https://evil.example.com/storage/v1/object/sign/audio-uploads/<id>/x.wav
    http://169.254.169.254/storage/v1/object/sign/audio-uploads/<id>/x.wav
    http://127.0.0.1:8000/storage/v1/object/sign/audio-uploads/<id>/x.wav

So any signed-in account could make the API issue a GET to any host and port
reachable from the server — cloud metadata, an internal admin port, anything on
the private network — and the upstream status code came back in the 502 body,
which turns it into an oracle for what is listening where.

**A path is not an identity.** The prefix check was never a host check and was
being read as one; anybody can serve that path. The fix is an allow-list of one:
the storage origin this deployment is configured with.

Its own module because it is a security rule shared by two call sites that had
drifted apart — the image path grew redirect protection after a review and the
audio path never did — and `CLAUDE.md` is explicit that a rule worth keeping is
a rule with a test.
"""

from __future__ import annotations

from urllib.parse import urlparse
from uuid import UUID

#: The URL shapes Supabase serves an object under. An upload URL is included
#: because older clients send one; `readable_url` re-signs it before any GET.
STORAGE_PREFIXES = (
    "/storage/v1/object/sign/",
    "/storage/v1/object/upload/sign/",
    "/storage/v1/object/authenticated/",
    "/storage/v1/object/public/",
)


def origin_of(url: str) -> str | None:
    """`host:port` for a URL, or None when it has no host.

    Port included, because a redirect to another port on the same host reaches
    a different service — which is most of what an SSRF is for. `urlparse`
    lowercases the host but not the scheme's default port, so an explicit
    `:443` and an implicit one are normalised to the same string here.
    """
    parsed = urlparse(url)
    if not parsed.hostname:
        return None
    default = {"https": 443, "http": 80}.get(parsed.scheme)
    port = parsed.port or default
    return f"{parsed.hostname}:{port}" if port else parsed.hostname


def storage_origin(supabase_url: str) -> str | None:
    """The one origin object bytes are allowed to come from."""
    return origin_of(supabase_url) if supabase_url else None


def is_owned_storage_url(
    url: str,
    *,
    bucket: str,
    user_id: UUID,
    expected_origin: str | None,
) -> bool:
    """Whether `url` names an object in `bucket` under `user_id`, on our storage.

    **All three, and the host is the one that was missing.** Scheme so a
    `file://` or `gopher://` cannot be handed to a client that would honour it;
    origin so the path cannot be impersonated; path so one caller cannot read
    another's object.

    `expected_origin` of None means the deployment has no `SUPABASE_URL`, and
    this returns **False** — closed rather than open. A build that cannot say
    where its storage is has no business fetching a URL a stranger chose.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"https", "http"}:
        return False
    if expected_origin is None or origin_of(url) != expected_origin:
        return False
    return any(
        parsed.path.startswith(f"{prefix}{bucket}/{user_id}/")
        for prefix in STORAGE_PREFIXES
    )
