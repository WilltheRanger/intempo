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
from typing import NamedTuple
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException, status

from app.config import settings
from app.db import get_service_client
from app.services.buckets import SCORE_BUCKET

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


#: Vertical overlap between neighbouring crops, as a multiple of the page's
#: typical band height.
#:
#: Generous on purpose, and asymmetric would be better still: what sits above a
#: staff is rehearsal marks, dynamics, bowings and the tempo text that says
#: `Meno mosso`, and what sits below is more dynamics and the occasional
#: fingering. Cropping tight to the staff throws all of it away, and the
#: pipeline reads a page for its markings as well as its notes.
_SYSTEM_PADDING = 0.55

#: Below this, splitting is not worth doing: the page is already a single
#: system — which is what every fixture in this repository is — and one crop
#: of the whole thing is the same picture with an extra decode.
_MIN_SYSTEMS_TO_SPLIT = 2

#: Radius of the blur that estimates the page's own brightness, as a fraction
#: of the shorter edge.
#:
#: Ink is decided against the paper immediately around it, not against the
#: photograph's average. A phone photograph of paper is unevenly lit — the real
#: page measured here runs from 193 down to 146 across its own height — and a
#: global threshold therefore finds the ink in the shadow and misses the ink in
#: the light. Wide enough to be the *page* rather than the notes: at 2.5% of the
#: shorter edge it spans several staff lines, so a staff cannot mistake itself
#: for its own background.
_INK_BLUR_FRACTION = 0.025

#: How much darker than the paper around it a pixel has to be to count as ink.
_INK_RATIO = 0.90

#: Width of the moving average over the row-ink profile, as a fraction of the
#: page **width**.
#:
#: **This is what replaced "rows that are mostly dark are staff lines."** That
#: was true of every fixture in this repository and false of the first real page
#: it saw: on a photograph held in the hand, each system slopes by *more than
#: its own height* across the width of the page, so no row is mostly anything
#: and the detector found two systems where there were ten. Ink density survives
#: the slope — a band of rows holding a system carries several times the ink of
#: the gap above it however tilted it is — and smoothing over roughly a system's
#: height turns five sharp lines into one hill.
#:
#: **Of the width, not the height, and that is the whole reason this constant is
#: written down.** A fraction of the height was the obvious choice and it is
#: wrong: page height depends on how many systems are on the page, so a
#: single-staff strip — which is what every fixture here is — got a window of
#: three rows and returned each of its five staff lines as its own band. Staff
#: size scales with the *width*, because a system spans the page and holds a
#: broadly fixed number of bars.
#:
#: Measured across eleven pages (five fixtures as bare strips, the same five
#: stacked into multi-system pages, and the real part) the values that get every
#: one of them right run from 0.032 to 0.042. This sits in the middle. There is
#: a second pocket at 0.046–0.050 where the real page's two desk bands merge
#: away and it returns exactly its ten systems — tempting, and not taken: three
#: samples wide, chosen because it gives a tidy number on the only real page in
#: hand, is how a constant gets fitted to one photograph.
_BAND_SMOOTH_FRACTION = 0.036

#: How quiet a cut has to be, against the quietest band, to be a gap.
#:
#: The one way tiling crops can still damage a page: a cut placed *inside* a
#: system splits a bar across two crops and both halves come back short.
#: Measured — on the real page the loudest cut carries 0.044 of a row's width
#: in ink against 0.20 for the quietest band, a factor of 4.5, and on every
#: fixture the cuts are at exactly zero. Half is far outside both.
_CUT_QUIET_RATIO = 0.5


def _inked(image_bytes: bytes):
    """A boolean page: True where a pixel is darker than the paper around it.

    Split out from `_ink_profile` so the same page can be measured along both
    axes without decoding and blurring it twice — see `staff_space_px`.
    """
    try:
        import numpy as np
        from PIL import Image, ImageFilter, ImageOps
    except ImportError:  # pragma: no cover — both are declared dependencies
        return None

    _register_heif()
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            grey = ImageOps.exif_transpose(image).convert("L")
            radius = max(4, int(min(grey.size) * _INK_BLUR_FRACTION))
            background = np.asarray(
                grey.filter(ImageFilter.BoxBlur(radius)), dtype=np.float32
            )
            pixels = np.asarray(grey, dtype=np.float32)
    except Exception:  # noqa: BLE001 — an unreadable page is the caller's problem
        return None

    if pixels.size == 0 or pixels.shape[0] < 8:
        return None

    return pixels < np.maximum(background, 1.0) * _INK_RATIO


def _profile_of(ink):
    """How much ink each row holds, and the smoothed version.

    `ink` is the boolean page from `_inked`, or its transpose — the arithmetic
    is the same either way, which is the point of taking an array rather than
    bytes. "Row" means a row *of what it was handed*.
    """
    import numpy as np

    if ink.shape[0] < 8:
        return None

    profile = ink.mean(axis=1)

    # Scaled by the extent *across* the profile — the page's width when reading
    # rows, its height when reading columns. See `_BAND_SMOOTH_FRACTION`: using
    # the extent *along* the profile would make the window depend on how many
    # systems are on the page.
    window = max(3, int(ink.shape[1] * _BAND_SMOOTH_FRACTION) | 1)
    pad = window // 2
    kernel = np.ones(window, dtype=np.float32) / window
    padded = np.pad(profile, pad, mode="edge")
    smoothed = np.convolve(padded, kernel, mode="same")[pad:pad + len(profile)]
    return profile, smoothed


def _ink_profile(image_bytes: bytes):
    """How much ink each row of the page holds, and the smoothed version.

    Returns `(profile, smoothed)` or `None` if the page cannot be read. Rows
    only — the callers that crop a page all assume systems run across it, and
    a sideways page is a *reading* problem rather than a cropping one.
    """
    ink = _inked(image_bytes)
    if ink is None:
        return None
    return _profile_of(ink)


class _Legibility(NamedTuple):
    """What could be measured about a page, before anything tried to read it.

    Three states, and the difference between the last two is the whole reason
    this is a named thing rather than an optional float:

    - `decoded=False` — the bytes are not an image this can open. Not a
      judgement about the notation.
    - `bands=False` — it opened, and carries no band of ink along either axis.
      Blank paper, or a photograph of something that is not sheet music.
    - `bands=True, spacing=None` — there are systems, and no staff period
      inside any of them. *This* is the page too small to read.
    """

    decoded: bool
    bands: bool
    spacing: float | None
    #: The shorter side of the photograph, in pixels. 0 when it did not decode.
    short_edge: int = 0
    #: `(width, height)` as read, after any EXIF rotation. `(0, 0)` if it did
    #: not decode.
    size: tuple[int, int] = (0, 0)


def _legibility(image_bytes: bytes) -> _Legibility:
    """Measure the staff spacing, trying both orientations.

    **One implementation, two callers.** `staff_space_px` and
    `too_small_to_read` each used to walk the bands themselves, which meant the
    rule lived twice — and when the row-wise measurement was taught to fall back
    to columns, only one of them learned. The gate went on refusing a page the
    measurement could now read. `validate.py`'s "one home and two ports" note
    is about exactly this shape of mistake; this is the same fix.

    **Both axes.** Staff lines are parallel, so exactly one orientation shows
    their periodicity — see `staff_space_px` for the photograph that proved it.
    The transpose is of an array already in memory and is only reached when the
    first orientation found nothing.
    """
    ink = _inked(image_bytes)
    if ink is None:
        return _Legibility(decoded=False, bands=False, spacing=None)
    short_edge = int(min(ink.shape))
    size = (int(ink.shape[1]), int(ink.shape[0]))

    # **Both orientations answer, and only one of them is reading staff lines.**
    # Measured on `01_simple_printed` at phone resolution: upright, rows give
    # seven bands all at 26 px while columns give a single band at 72; turned
    # ninety degrees, those two readings swap sides exactly. So "whichever
    # answered first" returns 72 for a sideways page — a number that clears the
    # floor for entirely the wrong reason, which is worse than the refusal it
    # replaced, since this gate exists to keep unread pages out of a library.
    #
    # Taking the *smaller* was the next idea and is also wrong: on the real
    # pages the cross-axis sometimes reads finer than the staff, and it dragged
    # `page-upright.jpg` from 34 px to 19 and failed two corpus tests. A gate
    # that refuses good pages is the bug this whole fallback exists to fix.
    #
    # **How many bands agreed is the signal.** A page of music has systems, and
    # every one of them carries the same staff period; the cross-axis has no
    # systems in it, so it produces one blob and one number. Seven against one
    # is not a close call, and it is the same shape of evidence whichever way up
    # the phone was.
    any_bands = False
    best: tuple[int, float] | None = None
    for index, oriented in enumerate((ink, ink.T)):
        read = _profile_of(oriented)
        if read is None:
            continue
        profile, smoothed = read
        bands = _bands(smoothed)
        any_bands = any_bands or bool(bands)
        spacings = [
            space
            for top, bottom in bands
            if (space := _band_staff_space(profile[top:bottom])) is not None
        ]
        if not spacings:
            continue
        # `>` and not `>=`: on a tie the rows keep it, so a page that was
        # already being measured correctly is measured identically to before.
        # Every reading in this file's corpus tables was taken that way.
        if best is None or len(spacings) > best[0]:
            best = (len(spacings), _representative_spacing(spacings))

    if best is None:
        return _Legibility(True, any_bands, None, short_edge, size)
    return _Legibility(True, True, best[1], short_edge, size)


#: The smallest staff-line spacing, in source pixels, a page can be read from.
#:
#: **Measured, on 2026-08-24, against every page in the repository plus the one
#: that provoked this.** A staff is five lines and four spaces; telling a
#: notehead sitting *on* a line from one sitting *in* a space needs the space
#: resolved, and below this it simply is not there.
#:
#:     the Gershwin contrabass part, downscaled   4284px wide -> 35 px  ✓
#:                                                1568        -> 13 px  ✓
#:                                                1200        -> 10 px  ✓
#:                                                 900        ->  7.5px ✗
#:                                                 640        ->  5.5px ✗
#:                                                 480        -> nothing measurable
#:     01/02/03_printed.jpg   (read correctly)                -> 11 px  ✓
#:     04_handwritten_clean.jpg (read correctly)              -> 15 px  ✓
#:     05_handwritten_messy.jpg (**yields zero measures**)    ->  5 px  ✗
#:
#: So 8 sits in the gap between every page in the corpus that reads and the one
#: that does not, and the corpus agrees with the downscale series about where
#: the gap is. It is not fitted to a single photograph.
_MIN_STAFF_SPACE_PX = 8

#: A staff period must be at least this many rows, or it is pixel noise.
_MIN_STAFF_PERIOD = 3

#: How strong the autocorrelation peak must be to be believed as a staff.
#:
#: **Measured, and it started at 0.15 and was wrong there.** At 0.15 a
#: handwritten fixture that the pipeline reads correctly was refused: its true
#: period is found, at the right lag, with a correlation of 0.136. Handwriting
#: puts a far larger share of a system's ink outside the five lines than
#: engraving does, so the ruling is a quieter part of the signal without being
#: any less present.
#:
#: The strongest peak each band reports, across everything available:
#:
#:     01/02/03_printed, phone resolution   0.75  0.64  0.38   read
#:     05_handwritten_messy, phone res      0.36                read
#:     04_handwritten_clean, phone res      0.136               read  <- weakest true signal
#:     the real page's staff bands          0.37 - 0.68         read
#:     the real page's title and desk bands 0.074 - 0.082       not staves
#:     the same page at webcam resolution   no local maxima at all
#:
#: So this sits between the quietest real staff and the loudest thing that is
#: not one. It is deliberately *not* what refuses the webcam page — that page
#: has no peak at any threshold — so lowering it does not weaken the check it
#: exists inside.
_STAFF_PERIOD_STRENGTH = 0.10


def _band_staff_space(profile_segment) -> int | None:
    """The staff-line period within one band, or None if there isn't one.

    Five evenly spaced lines make the ink profile periodic, so the first
    prominent peak in its autocorrelation is the spacing. Capped at a quarter
    of the band's height because the four spaces have to fit inside the band
    the lines were found in — without that cap a 480px page returned a
    confident 28, which would have put a staff 112 rows tall inside an 80-row
    band, and that single spurious value was enough to pass a page with no
    resolvable notation on it at all.
    """
    import numpy as np

    segment = np.asarray(profile_segment, dtype=np.float64)
    if segment.size < 30:
        return None
    highest = int(segment.size / 4)
    if highest <= _MIN_STAFF_PERIOD + 1:
        return None

    centred = segment - segment.mean()
    correlation = np.correlate(centred, centred, mode="full")[segment.size - 1:]
    if correlation[0] <= 0:
        return None
    correlation = correlation / correlation[0]

    for lag in range(_MIN_STAFF_PERIOD, min(highest, correlation.size - 1)):
        if (
            correlation[lag] > correlation[lag - 1]
            and correlation[lag] >= correlation[lag + 1]
            and correlation[lag] > _STAFF_PERIOD_STRENGTH
        ):
            return lag
    return None


#: Which of the per-band periods to believe, as a percentile.
#:
#: **Not the median, and not the minimum.** Autocorrelation peaks at every
#: *multiple* of a period and never at a divisor, so a band that locks onto the
#: second harmonic reports double the truth and there is no error in the other
#: direction — which biases any central statistic upward. Measured: a page of
#: eight stacked fixture strips reports `[11, 11, 11, 33, 11, 11, 11, 33]` at
#: full size, where 11 is right and 33 is a harmonic of a 15 px band. At webcam
#: resolution the same page reports `[4, 13, 4, 13]`, and its median of 8.5
#: cleared the floor — passing a page with nothing readable on it.
#:
#: The strict minimum fixes that and introduces its own failure: orchestral
#: parts print cue staves and ossias smaller than the main staff, and one of
#: those would veto a page that reads perfectly. A low percentile is below
#: every harmonic and above a single small system.
_SPACING_PERCENTILE = 25


def _representative_spacing(spacings: list[int]) -> float:
    import numpy as np

    return float(np.percentile(spacings, _SPACING_PERCENTILE))


def staff_space_px(image_bytes: bytes) -> float | None:
    """How many pixels apart this page's staff lines are. None if unreadable.

    None means *no band on the page had a staff period in it* — not that the
    page is empty. A photograph of music taken from too far away still has
    systems in it, because `_bands` finds them by ink density and a row of
    notation is dense whatever size it is. What it no longer has is five
    distinguishable lines.

    That distinction is the whole point. On 2026-08-24 a musician photographed
    an orchestral contrabass part with a laptop webcam; it arrived as a
    480x640 PNG, this page's eight systems were found correctly, every one was
    cropped and sent, and the reading that came back was invented — its own
    `notes_to_human` called it "approximate reconstructions". Nothing in the
    pipeline could tell that page from a good one, because at every stage that
    looked, it *was* one.

    Only bands that yield a period are counted. Half of a real page's bands do
    not — a title block, a desk, a system of nothing but multi-bar rests — and
    requiring all of them would refuse pages that read perfectly well.

    **Both axes, and the reason is a photograph this project already had.**
    `homr_page.jpg` — the String Bass part homr read 74 measures and 267 notes
    from — is a page held sideways, so its staves run *down* the image. A
    row-wise profile finds no systems on it at all: the bands it reported were
    31 to 118 rows of handwriting and paper edge, too narrow to contain a staff,
    so every one was vetoed by the cap in `_band_staff_space` and the
    measurement came back `None`.

    `None` is what `too_small_to_read` refuses on. So a full-resolution
    4284x5712 photograph of a page homr reads perfectly was turned away with
    "the staff lines in this photograph are too small to read" — a wrong
    diagnosis carrying advice that cannot work, since re-shooting it at the same
    angle changes nothing. homr dewarps and finds its own staves; it was never
    troubled by the rotation this check could not survive.
    """
    return _legibility(image_bytes).spacing


#: How much better the columns must agree before a page is called sideways.
#:
#: Only consulted when both axes found the *same number* of staff periods, which
#: is the one case band-count cannot separate. Measured across every page to
#: hand, as a coefficient of variation of the periods each axis found:
#:
#:     musician's sideways bass part   rows 0.326   cols 0.208   -> sideways
#:     page-upright                    rows 0.057   cols 0.0     -> upright (4 bands vs 2)
#:     01..05 at phone resolution      rows 0.0     cols n/a     -> upright (5-12 bands vs 1)
#:
#: Four fifths, so a tie needs the columns to be clearly steadier and not merely
#: luckier. Everything here errs towards *not* rotating: leaving a page alone is
#: the behaviour that has always existed, and turning an upright page sideways
#: would break a page that reads today.
_SIDEWAYS_AGREEMENT_MARGIN = 0.8


def _axis_reading(ink):
    """The staff periods one orientation finds, and how well they agree."""
    import numpy as np

    read = _profile_of(ink)
    if read is None:
        return [], None
    profile, smoothed = read
    spacings = [
        space
        for top, bottom in _bands(smoothed)
        if (space := _band_staff_space(profile[top:bottom])) is not None
    ]
    if len(spacings) < 2:
        return spacings, None
    mean = float(np.mean(spacings))
    if mean <= 0:
        return spacings, None
    return spacings, float(np.std(spacings) / mean)


def is_sideways(image_bytes: bytes) -> bool:
    """Whether this page's staves run down the image instead of across it.

    **A page held sideways is unreadable to everything downstream**, and nothing
    said so. `homr` segments a page and finds its staves expecting them to run
    horizontally; handed a page turned ninety degrees it finds none and gives up
    — measured on the deployment at 2.6 seconds against the ~21 it takes to read
    a page it can see. The error that reached the musician was the default one,
    which blames the photograph and advises a flatter, better-lit shot. Their
    photograph was flat, sharp, evenly lit and 4284x5712. It was sideways.

    Two signals, because neither is enough alone:

    - **How many bands agreed.** A page has systems, each carrying the same
      staff period; the cross-axis has no systems and produces one blob. Every
      upright page to hand wins this outright — 7 to 1, 5 to 2, 12 to 1 — and
      `homr_page.jpg` loses it 0 to 1, which is how a page with no measurable
      rows is caught.
    - **How well they agreed**, and only when the counts tie. The musician's
      page found three periods each way: rows 16/34/38, columns 18/19/28. The
      columns are reading staff lines and the rows are reading whatever crosses
      them.

    Conservative on purpose: anything unclear returns False, which is exactly
    the behaviour that existed before this function. Rotating an upright page
    would break a page that reads today, and that is much worse than failing to
    rescue one that does not.
    """
    ink = _inked(image_bytes)
    if ink is None:
        return False

    across, across_cv = _axis_reading(ink)
    down, down_cv = _axis_reading(ink.T)

    if not down:
        return False
    if len(down) > len(across):
        return True
    if len(down) < len(across):
        return False
    # A tie. Steadier wins, and only by a clear margin.
    if across_cv is None or down_cv is None:
        return False
    return down_cv < across_cv * _SIDEWAYS_AGREEMENT_MARGIN


def upright(image_bytes: bytes) -> bytes:
    """The page with its staves running across it, ready to be read.

    Returns the bytes untouched when the page is already upright or cannot be
    judged — see `is_sideways`. Re-encoded rather than rotated in EXIF, because
    the thing that has to see it turned is `homr`, and an orientation tag is
    only honoured by whoever remembers to look.
    """
    if not is_sideways(image_bytes):
        return image_bytes
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover — Pillow is a declared dependency
        return image_bytes

    _register_heif()
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            turned = ImageOps.exif_transpose(image).convert("RGB").rotate(
                -90, expand=True
            )
        buffer = io.BytesIO()
        turned.save(buffer, format="JPEG", quality=95, optimize=True)
    except Exception:  # noqa: BLE001 — an unrotatable page is still a page
        log.warning("page looked sideways but could not be turned; sending as it arrived")
        return image_bytes
    log.info(
        "page was sideways: turned %dx%d for reading",
        turned.width, turned.height,
    )
    return buffer.getvalue()


def too_small_to_read(image_bytes: bytes) -> str | None:
    """Why this page cannot be read, in a sentence, or None if it can be.

    Checked **before** any provider sees the page, and on the photograph as it
    arrived rather than on the prepared copy — resizing a page up to
    `MODEL_MAX_EDGE` adds pixels and no detail, so the question is only ever
    about what was photographed.

    The alternative to refusing is what happened before this existed: the page
    goes to the models, they return something, and a musician is shown notes
    nobody read off a page. A scan that fails is a scan they can retake. A
    scan that invents is one they might practise against.
    """
    measured = _legibility(image_bytes)

    if not measured.decoded:
        # Not a judgement this can make. The page did not decode at all, and
        # `prepare_for_model` deliberately passes such bytes through untouched
        # so the provider refuses them by name. "Too small to read" would be a
        # confident wrong reason, which this project has shipped before.
        return None

    if not measured.bands:
        # Decodes, but carries no band of ink anywhere — blank, or a
        # photograph of something that is not sheet music. Not a resolution
        # problem, and the reader's own "nothing was read from this page" says
        # it better than a sentence about staff lines would.
        return None

    space = measured.spacing
    if space is None:
        return (
            "The staff lines in this photograph are too small to read — the app "
            "can find the systems on the page but not the five lines in them. "
            "A photo taken with a phone camera, close enough that one system "
            "fills the width of the frame, reads reliably; a laptop webcam "
            "usually does not have the resolution for a page of music."
        )

    if space < _MIN_STAFF_SPACE_PX:
        # **The pixel size is in the sentence on purpose.** Without it, working
        # out whether a refusal came from a webcam grab or a phone photograph
        # meant inferring the resolution from a byte count in the database —
        # which is what it took to explain one of these, and the answer was
        # sitting right here unsaid.
        width, height = measured.size
        return (
            "This photograph is too small to read the notation from — the staff "
            "lines are about "
            f"{space:.0f} pixels apart and the app needs {_MIN_STAFF_SPACE_PX}. "
            f"The image is {width}x{height}. Photographing the page again from "
            "closer, or with a phone rather than a webcam, is what fixes it."
        )
    return None


def _bands(smoothed) -> list[tuple[int, int]]:
    """The runs of rows carrying more ink than the page's own midpoint.

    The midpoint is between the profile's own floor and ceiling — 5th and 95th
    percentiles rather than min and max, so one very dark row cannot set the
    scale for the page.
    """
    import numpy as np

    low, high = np.percentile(smoothed, 5), np.percentile(smoothed, 95)
    if high - low < 1e-6:
        return []
    middle = low + (high - low) * 0.5

    bands: list[tuple[int, int]] = []
    start: int | None = None
    for row, loud in enumerate(smoothed > middle):
        if loud and start is None:
            start = row
        elif not loud and start is not None:
            bands.append((start, row))
            start = None
    if start is not None:
        bands.append((start, len(smoothed)))
    return bands


def find_systems(image_bytes: bytes) -> list[tuple[int, int]]:
    """The `(top, bottom)` of each staff system on the page, in pixels.

    **Found by ink density, not by darkness.** The earlier version projected
    rows and called the mostly-dark ones staff lines, on the reasoning that a
    staff line is the longest horizontal run of ink on any page. That is true,
    and it worked on every fixture here — all of which are flat scans of a
    single staff strip. On the first real page it saw, a photographed String
    Bass part with **ten** systems, it found **two**: a page held in the hand
    is not flat, each system slopes by more than its own height across the
    width, and a staff line spread over eighty rows is not mostly dark in any
    one of them. Rotation does not fix it, because every system slopes by a
    different amount. Measured: no angle in ±4° gives more than 15 of the ~55
    line-runs ten staves should produce.

    What survives a slope is that a band of rows holding a system carries
    several times the ink of the gap above it. Smoothed over roughly half a
    system's height, that makes each system one hill in a profile with clear
    valleys between. The same page now gives twelve bands — its ten systems, plus the desk visible above and below the sheet, and every fixture
    still gives exactly its own count.

    A measurement, and it reports what it found rather than judging it — see
    `_cuts_are_quiet`, which is where a split too unreliable to make gets
    refused.
    """
    read = _ink_profile(image_bytes)
    if read is None:
        return []
    return _bands(read[1])


def _cut_rows(bands: list[tuple[int, int]], smoothed) -> list[int]:
    """The whitest row between each pair of bands — where to cut the page.

    Not the midpoint of the gap. A gap between two systems is not uniformly
    empty: a low note hangs under one staff and a rehearsal mark sits above the
    next, so the quietest row is off-centre, and it is the one place a cut
    cannot take a notehead with it.
    """
    import numpy as np

    cuts: list[int] = []
    for index in range(len(bands) - 1):
        gap_top, gap_bottom = bands[index][1], bands[index + 1][0]
        if gap_bottom <= gap_top:
            cuts.append(gap_top)
        else:
            cuts.append(gap_top + int(np.argmin(smoothed[gap_top:gap_bottom])))
    return cuts


def _cuts_are_quiet(bands: list[tuple[int, int]], cuts: list[int], smoothed) -> bool:
    """Whether every cut falls in a gap rather than through a system.

    **The one way tiling crops can still damage a page.** Because the crops
    cover the whole page, nothing can be silently dropped any more — that class
    of failure is gone by construction. What is left is a cut placed *inside* a
    system: the bar it lands in is split between two crops, both halves come
    back short, and the bar count for the page is wrong from there on.

    So a cut has to be quiet. Measured: on the real page the loudest cut
    carries 0.044 of a row's width in ink against 0.20 for the quietest band,
    and on every fixture here the cuts are at exactly zero ink. Anything
    approaching a band's own density is not a gap.
    """
    if not cuts:
        return True

    quietest_band = min(float(smoothed[top:bottom].mean()) for top, bottom in bands)
    loudest_cut = max(float(smoothed[cut]) for cut in cuts)
    if loudest_cut >= quietest_band * _CUT_QUIET_RATIO:
        log.info(
            "the quietest row between two bands still carries %.3f ink against "
            "%.3f inside a band; the page will be read whole rather than cut "
            "through a system",
            loudest_cut, quietest_band,
        )
        return False
    return True


def _page_height(image_bytes: bytes) -> int:
    """The height, upright, of the image the crop boxes were measured on."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as image:
        return ImageOps.exif_transpose(image).height


def _crop_boxes(image_bytes: bytes) -> list[tuple[int, int]]:
    """The `(top, bottom)` source rows of each crop, in reading order.

    Separate from `crop_systems` because these are the numbers that decide
    whether a page survives being cut up, and they are worth being able to look
    at directly. Three properties have to hold, and each of them was once wrong:

    - **They tile the page.** The first starts at row 0, the last ends at the
      last row. Cropping the bands and discarding what lay between them is how
      the real page lost the music on eight of its ten systems.
    - **They overlap rather than abut**, by the same amount everywhere, so a low
      note hanging under a staff appears in both crops rather than in neither.
    - **The overlap comes from the page's typical band**, not each band's own
      height. On the real page the bottom band is the desk and is three times a
      system tall; padded by its own height it reached a whole system upward and
      that system came back in two crops — read twice, which lengthens the page
      and shifts every bar after it against the recording.

    Empty when the page cannot be read, holds fewer than
    `_MIN_SYSTEMS_TO_SPLIT` bands, or cannot be cut without going through a
    system.
    """
    read = _ink_profile(image_bytes)
    if read is None:
        return []
    _profile, smoothed = read
    height = len(smoothed)

    bands = _bands(smoothed)
    if len(bands) < _MIN_SYSTEMS_TO_SPLIT:
        return []

    cuts = _cut_rows(bands, smoothed)
    if not _cuts_are_quiet(bands, cuts, smoothed):
        return []

    band_heights = sorted(bottom - top for top, bottom in bands)
    typical = band_heights[len(band_heights) // 2]
    pad = max(8, int(typical * _SYSTEM_PADDING))

    edges = [0, *cuts, height]
    return [
        (max(0, top - (pad if top else 0)), min(height, bottom + (pad if bottom < height else 0)))
        for top, bottom in zip(edges, edges[1:])
    ]


def crop_systems(image_bytes: bytes, *, source: bytes | None = None) -> list[bytes]:
    """The page cut into one JPEG per staff system, top to bottom.

    Empty when the page holds fewer than `_MIN_SYSTEMS_TO_SPLIT` bands, could
    not be read at all, or could not be cut without going through a system —
    all of which mean "send it whole", which is what the caller did before this
    existed.

    **The crops tile the page.** Every row belongs to exactly one crop: the
    first runs from the top of the image, the last to the bottom, and the
    boundaries are the quietest rows between bands. This is a change of
    principle from cropping the bands and discarding what lay between them,
    and it is the fix for the worst failure this pipeline has had. On the first
    real page it saw, the detector found two bands out of eleven systems and
    the music on the rest was never sent to any model — silently, because
    nothing failed. Even with the detector rewritten, padded bands hold 85% of
    that page's ink; tiling holds all of it, by construction.

    **The overlap is still deliberate.** Neighbouring crops share
    `_SYSTEM_PADDING` of a band's height either side of the cut, so a low note
    hanging under one staff appears at the bottom of its own crop and the top of
    the next. Duplication is visible to the caller and correctable; a hole is
    neither — `alignment.py` accumulates durations, so a dropped note shifts
    every bar after it.

    **`source` is the photograph before `prepare_for_model` squeezed it**, and
    passing it is the difference between cropping being worth doing and not.
    Systems are *detected* on the prepared page — cheap, and every constant here
    was measured at that scale — but the pixels sent to the model should be the
    ones the camera captured. Without it a crop is carved out of an image already
    reduced 3.6×, so each system arrives at 1176×165 with about ten pixels
    between staff lines. Cut from the original and prepared individually, the
    same system arrives at 1568×220 — **1.8× the pixels**, and fourteen pixels
    between staff lines — because `MODEL_MAX_EDGE` is then spent on one system
    instead of on a whole page. That is the entire reason a page is cut up, and
    it was being thrown away one step before the cut.
    """
    boxes = _crop_boxes(image_bytes)
    if not boxes:
        return []

    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover — Pillow is a declared dependency
        return []

    _register_heif()
    crops: list[bytes] = []
    try:
        with Image.open(io.BytesIO(source if source is not None else image_bytes)) as image:
            image = ImageOps.exif_transpose(image)
            if image.mode != "RGB":
                image = image.convert("RGB")

            # The boxes were found on `image_bytes`, which is the page squeezed
            # onto `MODEL_MAX_EDGE`; the pixels being cut are the photograph as
            # it arrived. See the docstring — this ratio is the whole point.
            scale = image.height / _page_height(image_bytes) if source is not None else 1.0

            for box_top, box_bottom in boxes:
                top = int(box_top * scale)
                bottom = min(image.height, int(box_bottom * scale))
                box = (0, top, image.width, bottom)
                buffer = io.BytesIO()
                # Lossless out of Pillow, then through `prepare_for_model` —
                # so a crop obeys exactly the same size cap, quality ladder and
                # format the whole page does, rather than a second set of
                # numbers that could drift from it. PNG in between because
                # encoding to JPEG twice puts ringing on staff lines that are
                # one pixel wide, and those are the thing being read.
                image.crop(box).save(buffer, format="PNG")
                prepared, _media_type = prepare_for_model(buffer.getvalue())
                crops.append(prepared)
    except Exception:  # noqa: BLE001 — a page that will not crop is sent whole
        log.warning("could not cut the page into systems; sending it whole", exc_info=True)
        return []

    return crops
