"""Getting the photographed page out of storage and into memory.

Lifted out of `routers/scores.py` when transcription moved to a background
worker. The worker cannot import the router — the router imports the worker to
enqueue it — so the half of that module concerned with *fetching bytes* lives
here, where both can reach it. Nothing in the move changed behaviour; the
functions are the ones the router had, renamed from `_private` to public
because they now have a caller outside their own module.

One wart, kept deliberately: these raise `fastapi.HTTPException`. That is the
right type for the request path and a strange one for a worker, but the status
codes and messages are the tested contract — `test_image_download.py` holds
them to it — and inventing a parallel exception to translate at both call sites
would be more moving parts than the wart costs. The worker catches it and reads
`.detail` for the failure it records.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException, status

from app.config import settings
from app.db import get_service_client
from app.routers.upload import SCORE_BUCKET

log = logging.getLogger("intempo.scores")

#: Cap on what we will pull from a signed URL before bailing. Matches the
#: score-images bucket's 10 MB limit, with headroom.
MAX_IMAGE_BYTES = 12 * 1024 * 1024

#: Download timeout in seconds. Kept tight: OCR is the slow part of a scan and
#: the fetch should not eat its budget.
IMAGE_DOWNLOAD_TIMEOUT = 6.0


def media_type_for(url: str) -> str:
    """Best-effort image media type from the URL's path extension.

    The last resort only. A filename is a claim about the bytes, and on the
    web build there is no filename at all — a captured page arrives as a
    `blob:` URI with no extension, so this answers `image/jpeg` for everything.
    Prefer `_media_type_of`, which reads the bytes.
    """
    path = urlparse(url).path.lower()
    if path.endswith(".png"):
        return "image/png"
    if path.endswith(".webp"):
        return "image/webp"
    if path.endswith(".heic"):
        return "image/heic"
    return "image/jpeg"


#: What each image format puts at the front of the file. Enough of each
#: signature to be unambiguous, and no more — the point is identification, not
#: validation, and a truncated or corrupt file is the provider's error to give.
MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)

#: ISO base-media brands that mean HEIF. The container is shared with MP4, so
#: the brand at offset 8 is what distinguishes a photograph from a video.
HEIF_BRANDS = frozenset(
    {b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevm", b"hevs", b"mif1", b"msf1"}
)


def media_type_of(image_bytes: bytes, url: str) -> str:
    """What the bytes actually are, falling back to what the URL called them.

    Vision APIs check this. Anthropic answers a mismatch with
    `The image was specified using the image/jpeg media type, but the image
    appears to be a image/png image` and a 400 — which is what the first real
    scan from a phone got, because the web build captures to a canvas (PNG)
    and hands over a `blob:` URI with no extension for `_media_type_for` to
    guess `image/jpeg` from.

    The client is fixed too, but this is the fix that holds: the bytes are in
    hand here, so there is no reason to ask a filename what they are.
    """
    for signature, media_type in MAGIC:
        if image_bytes.startswith(signature):
            return media_type
    if (
        len(image_bytes) >= 12
        and image_bytes[4:8] == b"ftyp"
        and image_bytes[8:12] in HEIF_BRANDS
    ):
        return "image/heic"
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    # Unrecognised: pass on the name's guess rather than inventing one, so an
    # exotic-but-valid format still reaches the provider to be judged there.
    return media_type_for(url)



STORAGE_PREFIXES = (
    "/storage/v1/object/sign/",
    "/storage/v1/object/upload/sign/",
    "/storage/v1/object/authenticated/",
    "/storage/v1/object/public/",
)


def object_key_from(image_url: str, bucket: str = SCORE_BUCKET) -> str | None:
    """`<user_id>/<uuid>.<ext>` out of a stored storage URL, or None.

    `scores.source_image_url` holds the signed *upload* URL, which stops
    working minutes after the upload — so displaying an image means signing a
    fresh download, and signing needs the object key rather than the URL. The
    key is in the URL's path; this pulls it back out.

    Storing the key on the row would be tidier than re-deriving it, and is the
    right follow-up. It needs a migration and a backfill, and the derivation is
    safe today because `_assert_image_url_owned_by` has already refused any URL
    that isn't one of these shapes.
    """
    path = urlparse(image_url).path
    for prefix in STORAGE_PREFIXES:
        marker = f"{prefix}{bucket}/"
        if path.startswith(marker):
            key = path[len(marker) :]
            return key or None
    return None



#: Redirects to follow. Supabase serves signed object URLs from the same host,
#: so one or two is generous; the cap exists so a redirect chain cannot become
#: a way to spend the request budget.
MAX_IMAGE_REDIRECTS = 3


def download_image(image_url: str, *, expected_origin: str | None = None) -> bytes:
    """Fetch a score image, refusing anything too large, too far, or not there.

    **The size limit is enforced while reading, not after.** This used to be
    `client.get()` followed by `len(body) > MAX_IMAGE_BYTES`, which reads the
    whole response into memory first — so a 2 GB object in the caller's own
    storage prefix was fully buffered before being rejected. A limit that only
    refuses after allocating protects the OCR provider downstream and nothing
    else. Streaming stops at the first chunk that crosses the line, so the most
    this ever holds is one chunk past the limit.

    **Redirects may not leave the endpoint the caller was authorised for.**
    `_assert_image_url_owned_by` checks the URL is a Supabase score-images URL
    under this user's prefix, and its docstring says "we never download
    arbitrary internet URLs" — which was true of the URL given and not of where
    following redirects could end up. A 302 to a link-local address would have
    been followed.

    The comparison is host *and* port, not host alone: a redirect to another
    port on the same host reaches a different service, which is most of what
    an SSRF is for.
    """
    try:
        with httpx.Client(
            timeout=IMAGE_DOWNLOAD_TIMEOUT,
            follow_redirects=True,
            max_redirects=MAX_IMAGE_REDIRECTS,
        ) as client:
            with client.stream("GET", image_url) as response:
                if response.status_code != 200:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=f"image download returned status {response.status_code}",
                    )
                final = response.url
                final_origin = f"{final.host}:{final.port}"
                if expected_origin and final_origin != expected_origin:
                    # Names both ends. Supabase serves signed object URLs from
                    # the project host and is not expected to redirect off it —
                    # but that could not be verified against a live project
                    # from where this was written, so if this ever fires in
                    # production the message has to say where it went rather
                    # than leaving someone to guess at a bare 403.
                    log.warning(
                        "image download redirected off the approved origin: %s -> %s",
                        expected_origin,
                        final_origin,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=(
                            f"image_url redirected off the storage host "
                            f"({expected_origin} -> {final_origin})"
                        ),
                    )
                # Trust the declared length only to refuse early — never to
                # decide the read is safe, since it is a claim, not a fact.
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > MAX_IMAGE_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        detail=f"image is larger than {MAX_IMAGE_BYTES} bytes",
                    )
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > MAX_IMAGE_BYTES:
                        raise HTTPException(
                            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                            detail=f"image is larger than {MAX_IMAGE_BYTES} bytes",
                        )
                    chunks.append(chunk)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"failed to download image: {exc}",
        ) from exc
    return b"".join(chunks)



#: How long a display URL lives. Long enough that a library screen scrolled
#: for a while doesn't start showing broken images, short enough that a leaked
#: URL stops working the same session. `image_url_expires_at` is returned so a
#: client can re-fetch rather than guess.
SIGNED_DOWNLOAD_TTL_SECONDS = 60 * 60



def readable_url(image_url: str) -> str:
    """The URL to actually fetch the bytes from.

    A Supabase signed **upload** URL only answers `PUT`. `GET` on one returns
    400, which is exactly what the app hit on its first real scan: the upload
    succeeded, the score screen appeared, and then "image download returned
    status 400" — because `upload.ts` passes the upload URL on to
    `POST /v1/scores` as `image_url`, and this fetched it as given.

    Signing a fresh download URL from the object key fixes it and is better
    regardless: `_assert_image_url_owned_by` has already established which
    object the caller is allowed to read, so the key is the trustworthy part of
    what was sent, and the URL around it is not.

    Falls back to the URL as given when a key cannot be extracted or nothing
    can sign one — a `/object/sign/` or `/object/public/` URL is already
    readable, and this must not break the paths that were working.
    """
    key = object_key_from(image_url)
    if key is None:
        return image_url
    client = get_service_client()
    if client is None:
        return image_url
    try:
        signed = client.storage.from_(SCORE_BUCKET).create_signed_url(
            key, SIGNED_DOWNLOAD_TTL_SECONDS
        )
    except Exception as exc:  # storage unreachable, key gone, permissions
        log.info("could not sign a download URL for %s, using it as given: %s", key, exc)
        return image_url
    if isinstance(signed, dict):
        fresh = (
            signed.get("signedURL")
            or signed.get("signedUrl")
            or signed.get("signed_url")
        )
        if fresh:
            # Supabase returns a path on some SDK versions and an absolute URL
            # on others.
            if fresh.startswith("http"):
                return fresh
            return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1{fresh}"
    return image_url
