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

import io
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


# =============================================================
# Getting a phone photograph into a shape a vision model accepts
# =============================================================
#
# **This step did not exist, and its absence is the likeliest reason real
# scans kept failing.** Everything upstream was built and tuned against
# `fixtures/scores/`, which is five cropped excerpts of 30-50 KB. The app
# receives something else entirely: a full page, shot handheld, 3000-4000 px
# on the long edge and several megabytes, carrying an EXIF orientation flag.
# The pipeline had never once been exercised on that input.
#
# Three ways it fails, none of which says anything useful about the page:
#
#   * **Too large.** Anthropic caps an image at 5 MB, and the limit applies to
#     the *base64* payload, which is 4/3 the size of the file. A 4 MB
#     photograph is a 5.3 MB request and comes back 400.
#   * **Sideways.** A phone writes orientation into EXIF rather than rotating
#     the pixels. Viewers honour it; an API reading raw bytes need not. A
#     staff rotated 90 degrees is not sheet music to a reader that expects
#     horizontal lines.
#   * **Too many pixels to be worth sending.** Anthropic resizes anything over
#     1568 px before it reaches the model, so the extra pixels buy no accuracy
#     — they are paid for in upload time and in the size limit above.

#: Anthropic's own recommended maximum edge. Larger images are downsampled
#: server-side before the model sees them, so sending more is spending more to
#: deliver the same picture.
MODEL_MAX_EDGE = 1568

#: The hard API ceiling on one image, applied to the base64 payload.
MODEL_MAX_BYTES = 5 * 1024 * 1024

#: Base64 inflates by 4/3. Budget against the encoded size, not the file size —
#: budgeting against the file is how a 4 MB photograph becomes a 5.3 MB
#: request that is refused.
_B64_RATIO = 4 / 3

#: Re-encode quality, then the fallbacks if the first pass is still too big.
#: 88 is visually indistinguishable on engraved notation; below about 60 the
#: thin lines of a staff start to break up, which is the one thing that must
#: survive.
_QUALITY_STEPS = (88, 75, 60)


def prepare_for_model(image_bytes: bytes) -> tuple[bytes, str]:
    """Normalise a photograph into something a vision model will accept.

    Returns `(bytes, media_type)`. Always JPEG on success.

    **Never raises.** A page that cannot be decoded is returned untouched with
    its sniffed media type, so this can only ever improve matters: the worst
    case is the behaviour that existed before this function did. An
    unrecognised format is the provider's to refuse, with the provider's own
    message, rather than something for this to guess about.
    """
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover — Pillow is a declared dependency
        log.warning("Pillow is not installed; sending the page as it arrived")
        return image_bytes, media_type_of(image_bytes, "")

    _register_heif()

    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            # Orientation first, and before anything reads the dimensions:
            # rotating afterwards would fit the long edge to the wrong axis.
            image = ImageOps.exif_transpose(image)
            # A page can arrive as CMYK from a scanner, palette from a PNG
            # export, or RGBA from a canvas capture. JPEG encodes none of
            # those, and an alpha channel over white sheet music is a
            # transparent page.
            if image.mode != "RGB":
                image = image.convert("RGB")

            longest = max(image.size)
            if longest > MODEL_MAX_EDGE:
                scale = MODEL_MAX_EDGE / longest
                image = image.resize(
                    (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                    # LANCZOS, not the default. Staff lines are one or two
                    # pixels wide and a cheaper filter drops them in patches —
                    # which produces exactly the "unreadable page" this whole
                    # step exists to prevent.
                    Image.Resampling.LANCZOS,
                )

            for quality in _QUALITY_STEPS:
                buffer = io.BytesIO()
                image.save(buffer, format="JPEG", quality=quality, optimize=True)
                encoded = buffer.getvalue()
                if len(encoded) * _B64_RATIO <= MODEL_MAX_BYTES:
                    log.info(
                        "page normalised: %d bytes -> %d (%dx%d, q%d)",
                        len(image_bytes), len(encoded), image.width, image.height, quality,
                    )
                    return encoded, "image/jpeg"

            # Every quality step still too big. Vanishingly unlikely at
            # 1568 px, and if it happens the smallest attempt is still a far
            # better bet than the original.
            log.warning("page still over the size limit after re-encoding; sending the smallest")
            return encoded, "image/jpeg"
    except Exception as exc:  # noqa: BLE001 — decode failures of every kind
        log.warning("could not normalise the page, sending it as it arrived: %s", exc)
        return image_bytes, media_type_of(image_bytes, "")


_heif_registered = False


def _register_heif() -> None:
    """Teach Pillow to open HEIC, which is what an iPhone shoots by default.

    Optional: without it a HEIC page falls through to the untouched path and
    the provider refuses it by name, which is the behaviour that existed
    before. With it, the same page becomes an ordinary JPEG.
    """
    global _heif_registered
    if _heif_registered:
        return
    _heif_registered = True
    try:
        import pillow_heif

        pillow_heif.register_heif_opener()
    except ImportError:  # pragma: no cover
        log.info("pillow-heif is not installed; HEIC pages will not be normalised")


# =============================================================
# The same page, prepared for a rule-based engine instead
# =============================================================
#
# A vision model and an OMR engine want opposite things, and the difference is
# not a preference — it is the difference between a reading and a refusal.
#
# Measured on a 3024x4032 page with Audiveris 5.4:
#
#     long edge   time    peak RSS   result
#          1568    1.4s      159 MB  FAILED — "interline value of 10 pixels …
#                                     picture resolution is too low"
#          2048    9.3s      517 MB  transcribed
#          2400   10.5s      543 MB  transcribed
#          3024   15.4s      723 MB  transcribed
#
# Audiveris measures staff spacing in pixels and needs roughly fifteen between
# lines. At the 1568 px a vision model is served, a full page leaves ten, and
# the engine stops before it reads a note. So `prepare_for_model` — which is
# exactly right for the model — is fatal to the engine, and the two cannot
# share one prepared image.
#
# 2048 is chosen over the original: it reads the same page, in 40% of the time
# and 70% of the memory, and memory is the binding constraint on any host small
# enough to be worth using.

#: Enough pixels for the engine to resolve staff spacing, and no more.
ENGINE_TARGET_EDGE = 2048

#: Audiveris refuses a page over 20 megapixels outright. A phone shoots 12-48,
#: so this is the first thing a real photograph hits.
ENGINE_MAX_PIXELS = 20_000_000


def prepare_for_engine(image_bytes: bytes) -> tuple[bytes, str]:
    """Normalise a photograph for a rule-based OMR engine.

    Same contract as `prepare_for_model` — returns `(bytes, media_type)` and
    never raises — but a different target, for the reasons measured above.

    Only ever scales *down*. Enlarging a page that is already small cannot add
    the staff detail the engine is looking for; it only invents pixels between
    the ones that were photographed, and costs memory to do it.
    """
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover — Pillow is a declared dependency
        return image_bytes, media_type_of(image_bytes, "")

    _register_heif()

    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image = ImageOps.exif_transpose(image)
            if image.mode != "RGB":
                image = image.convert("RGB")

            longest = max(image.size)
            target = min(longest, ENGINE_TARGET_EDGE)
            scale = target / longest
            # The megapixel ceiling, applied after the edge target rather than
            # instead of it: a very wide, short page can be under 2048 on its
            # long edge and still over 20 MP.
            if image.width * image.height * scale * scale > ENGINE_MAX_PIXELS:
                scale = (ENGINE_MAX_PIXELS / (image.width * image.height)) ** 0.5

            if scale < 1:
                image = image.resize(
                    (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                    Image.Resampling.LANCZOS,
                )

            buffer = io.BytesIO()
            # Higher quality than the model gets, and no subsampling. The
            # engine is thresholding thin black lines out of a photograph;
            # chroma subsampling smears exactly those edges, and unlike a model
            # it has no way to read around the damage.
            image.save(buffer, format="JPEG", quality=95, subsampling=0)
            encoded = buffer.getvalue()
            log.info(
                "page prepared for the engine: %d bytes -> %d (%dx%d)",
                len(image_bytes), len(encoded), image.width, image.height,
            )
            return encoded, "image/jpeg"
    except Exception as exc:  # noqa: BLE001
        log.warning("could not prepare the page for the engine: %s", exc)
        return image_bytes, media_type_of(image_bytes, "")


# =============================================================
# Cutting a page into systems, so the engine reads one at a time
# =============================================================
#
# Measured on the same 3024x4032 page, Audiveris 5.4, peak RSS sampled from
# /proc rather than `ru_maxrss` (which is a monotonic maximum over all children
# and reports 0 for every run after the largest):
#
#     whole page at 2048 px        9.5 s    512 MB    10 measures
#     all 5 strips, one JVM       19.1 s    570 MB    10 measures
#     one strip on its own         6.2 s    322 MB     2 measures
#
# **Sequential strips halve peak memory and find the same measures.** That is
# the whole point: memory is the binding constraint on any host worth using,
# and 322 MB alongside a ~150 MB Python service fits inside 512 MB, where
# 512 MB alongside it does not.
#
# Batching every strip into one invocation is the obvious optimisation and it
# does not work — Audiveris holds them all and peaks *higher* than the whole
# page. The saving comes from the process exiting between systems, so the JVM
# start is paid per strip and is what the extra wall-clock buys.
#
# Cut at **full resolution**. A strip keeps the interline spacing of the
# original, which is the measurement Audiveris refuses a page for lacking — so
# slicing sidesteps the resolution floor instead of fighting it.

#: Rows quieter than this fraction of the busiest row are page, not staff.
_INK_FLOOR = 0.04

#: A band thinner than this is a stray mark, a page number or a caption, not a
#: system worth starting a JVM for.
_MIN_BAND_PX = 40

#: White space kept around each strip. Audiveris looks above and below a staff
#: for ledger lines, stems, slurs and dynamics; a tight crop amputates them.
_BAND_PADDING_PX = 90


def split_systems(image_bytes: bytes, *, max_systems: int = 24) -> list[bytes]:
    """Cut a page into one image per staff system, at full resolution.

    Returns `[]` when the page cannot be split usefully — unreadable, or a
    single system, or more bands than a page plausibly has. The caller then
    reads the page whole, which is the behaviour that existed before.

    Found by horizontal projection: sum the ink in each row, and a staff system
    is a contiguous run of inked rows between two quiet ones. Deliberately not
    the staff-line tracker in `tools/staffgrid.js` — that fits five lines to a
    staff and needs to be right about each; this needs only to know where the
    page is empty, which is a far weaker question and correspondingly harder to
    get wrong.
    """
    try:
        import numpy as np
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover
        return []

    _register_heif()

    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image = ImageOps.exif_transpose(image)
            grey = image.convert("L")
            rows = (np.asarray(grey, dtype=np.uint8) < 160).sum(axis=1)
            if rows.max() == 0:
                return []

            inked = rows > max(3, rows.max() * _INK_FLOOR)
            bands: list[tuple[int, int]] = []
            start: int | None = None
            for y, on in enumerate(inked):
                if on and start is None:
                    start = y
                elif not on and start is not None:
                    if y - start >= _MIN_BAND_PX:
                        bands.append((start, y))
                    start = None
            if start is not None and len(inked) - start >= _MIN_BAND_PX:
                bands.append((start, len(inked)))

            # One band is the page itself — nothing gained, and a JVM start
            # spent to prove it. More than a couple of dozen means the
            # projection found texture rather than systems, and the page is
            # safer read whole.
            if len(bands) < 2 or len(bands) > max_systems:
                log.info("page not split: %d band(s) found", len(bands))
                return []

            page = image.convert("RGB")
            slices: list[bytes] = []
            for top, bottom in bands:
                crop = page.crop(
                    (
                        0,
                        max(0, top - _BAND_PADDING_PX),
                        page.width,
                        min(page.height, bottom + _BAND_PADDING_PX),
                    )
                )
                buffer = io.BytesIO()
                crop.save(buffer, format="JPEG", quality=95, subsampling=0)
                slices.append(buffer.getvalue())
            log.info("page split into %d systems", len(slices))
            return slices
    except Exception as exc:  # noqa: BLE001
        log.warning("could not split the page into systems: %s", exc)
        return []
