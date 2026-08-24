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


def _ink_profile(image_bytes: bytes):
    """How much ink each row of the page holds, and the smoothed version.

    Returns `(profile, smoothed)` or `None` if the page cannot be read.
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

    profile = (pixels < np.maximum(background, 1.0) * _INK_RATIO).mean(axis=1)

    # Scaled by the page's width — see `_BAND_SMOOTH_FRACTION`. Using the
    # height makes the window depend on how many systems are on the page.
    window = max(3, int(pixels.shape[1] * _BAND_SMOOTH_FRACTION) | 1)
    pad = window // 2
    kernel = np.ones(window, dtype=np.float32) / window
    padded = np.pad(profile, pad, mode="edge")
    smoothed = np.convolve(padded, kernel, mode="same")[pad:pad + len(profile)]
    return profile, smoothed


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


def crop_systems(image_bytes: bytes) -> list[bytes]:
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
        with Image.open(io.BytesIO(image_bytes)) as image:
            image = ImageOps.exif_transpose(image)
            if image.mode != "RGB":
                image = image.convert("RGB")

            for top, bottom in boxes:
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
