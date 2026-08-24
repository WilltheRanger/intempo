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


#: How dark a row has to be, as a fraction of its width, to look like a staff
#: line. Staff lines are the longest horizontal runs of ink on a page — longer
#: than any beam, slur or word — which is what makes them findable without
#: knowing anything else about the music.
_STAFF_ROW_DARKNESS = 0.45

#: Vertical padding around a system, as a multiple of its own height.
#:
#: Generous on purpose, and asymmetric would be better still: what sits above a
#: staff is rehearsal marks, dynamics, bowings and the tempo text that says
#: `Meno mosso`, and what sits below is more dynamics and the occasional
#: fingering. Cropping tight to the staff lines throws all of it away, and the
#: pipeline reads a page for its markings as well as its notes.
_SYSTEM_PADDING = 0.55

#: Below this, splitting is not worth doing: the page is already a single
#: system — which is what every fixture in this repository is — and one crop
#: of the whole thing is the same picture with an extra decode.
_MIN_SYSTEMS_TO_SPLIT = 2

#: How many dark runs a band has to hold to be a stave.
#:
#: **Not a tuned constant — the definition of a stave.** Five lines, and the
#: tolerance is one either way: two lines can merge into a single run at low
#: resolution, and a hand-ruled staff can put an extra run of ink inside its
#: own band (`05_handwritten_messy` gives 6 for half its staves).
#:
#: Measured on the first real orchestral part this repository has seen — a
#: photographed String Bass part, eleven staves — where the detector returned
#: **two** bands holding **9 and 2** runs: the first had swallowed the dark
#: desk at the top of the photograph and two staves with it, the second was a
#: fragment. Every fixture here gives 5 or 6 for every band. Nothing in between
#: occurred, which is why the check is a count and not a tolerance.
_STAFF_LINES = 5
_STAFF_LINE_SLACK = 1


def _systems_and_runs(
    image_bytes: bytes,
) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    """The `(top, bottom)` of each staff system on the page, in pixels.

    **Why this exists.** `MODEL_MAX_EDGE` squeezes a page onto a 1568 px edge,
    and the comment above it is right about the reason — Anthropic downsamples
    anything larger, so more pixels in *one* image buy nothing. The conclusion
    that followed was wrong: it is only true if the page has to be one image.

    Measured against this repository's own fixtures, which are the material the
    reader was tuned on: every one of them is a **single staff strip**, 1200 px
    wide and 72–168 px tall, and none is downscaled at all. A photographed page
    is ten systems in portrait; at 1568 px tall each system gets about 150 px
    *including its margins*, so the staff itself lands at 40–60 px — three to
    four times less than anything the reader was ever shown. That is why a real
    orchestral part comes back with 59 measures and 112 notes.

    Found by horizontal projection rather than a model: staff lines are the
    longest horizontal runs of ink on any page — longer than a beam, a slur or
    a word — so rows that are mostly dark are staff lines and nothing else is.
    No training, no dependency, and it degrades to "one system" rather than to
    a wrong answer.

    **It does not, in fact, degrade to "one system" on a real page.** Measured
    on a photographed String Bass part with eleven staves on it: two bands, of
    9 and 2 staff lines, because the dark desk visible around the paper is a
    full-width dark run that both skews the median gap and merges with the
    staves next to it, and because only about three of the eleven staves have
    any row reaching `_STAFF_ROW_DARKNESS` at all — a phone photograph of paper
    is unevenly lit and slightly skewed, and a staff line spread over a few
    rows by skew is never mostly dark in any one of them. Returns both the
    bands and the runs they were built from so `_bands_are_staves` can refuse a
    detection this unreliable.
    """
    try:
        import numpy as np
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover — both are declared dependencies
        return [], []

    _register_heif()
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image = ImageOps.exif_transpose(image).convert("L")
            pixels = np.asarray(image, dtype=np.float32)
    except Exception:  # noqa: BLE001 — an unreadable page is the caller's problem
        return [], []

    if pixels.size == 0 or pixels.shape[0] < 8:
        return [], []

    # Dark relative to *this* photograph. An absolute threshold fails on the
    # two things phone photographs of paper always are: unevenly lit, and grey
    # rather than white.
    dark = pixels < (pixels.mean() - pixels.std())
    staff_rows = dark.mean(axis=1) > _STAFF_ROW_DARKNESS

    runs: list[tuple[int, int]] = []
    start: int | None = None
    for row, is_staff in enumerate(staff_rows):
        if is_staff and start is None:
            start = row
        elif not is_staff and start is not None:
            runs.append((start, row))
            start = None
    if start is not None:
        runs.append((start, len(staff_rows)))

    if not runs:
        return [], []

    # The five lines of one staff are five separate runs, and the page has no
    # idea how far apart they should be — it depends on the engraving, the
    # photograph's distance and the crop. So the page is asked: the gaps
    # *within* a staff are all much the same, and the gap *between* systems is
    # several times larger. Splitting on a multiple of the median gap needs no
    # constant that could be wrong for a different page.
    #
    # Keyed to page height instead at first, which put the threshold below one
    # staff's own line spacing and returned every line as its own system.
    gaps = [
        runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)
    ]
    typical = sorted(gaps)[len(gaps) // 2] if gaps else 0
    gap = max(4, typical * 3)
    systems: list[tuple[int, int]] = []
    top, bottom = runs[0]
    for run_top, run_bottom in runs[1:]:
        if run_top - bottom <= gap:
            bottom = run_bottom
        else:
            systems.append((top, bottom))
            top, bottom = run_top, run_bottom
    systems.append((top, bottom))

    # Second pass: put back together anything that is one staff in pieces.
    #
    # The rule above splits on a multiple of the *median* gap, which is right
    # for evenly engraved music and wrong for handwriting: a hand-ruled staff
    # has uneven line spacing, so one wide gap inside it clears the threshold
    # and the staff comes back as two systems. Measured on
    # `05_handwritten_messy` at phone resolution — twelve bands on the page,
    # twenty-four "systems" found.
    #
    # Half a staff is not readable, so this is not a cosmetic miscount: it
    # would send the model the top three lines of a staff and ask what the
    # notes are.
    #
    # The test that separates the two cases is height. Systems on a page are
    # separated by *more* than a staff is tall — that is what a margin is —
    # while fragments of one staff are separated by less than its own height by
    # definition.
    if len(systems) > 1:
        heights = sorted(bottom - top for top, bottom in systems)
        staff_height = heights[len(heights) // 2]
        merged: list[tuple[int, int]] = [systems[0]]
        for top, bottom in systems[1:]:
            if top - merged[-1][1] < staff_height:
                merged[-1] = (merged[-1][0], bottom)
            else:
                merged.append((top, bottom))
        systems = merged

    return systems, runs


def find_systems(image_bytes: bytes) -> list[tuple[int, int]]:
    """The `(top, bottom)` of each staff system on the page, in pixels.

    A measurement, and it reports what it found rather than judging it — see
    `_bands_are_staves`, which is where a detection too unreliable to cut a page
    on gets refused.
    """
    return _systems_and_runs(image_bytes)[0]


def _bands_are_staves(
    systems: list[tuple[int, int]], runs: list[tuple[int, int]]
) -> bool:
    """Whether every detected band actually looks like one stave.

    **The check that stops a bad split silently eating the page.** A wrong split
    raises nothing: `crop_systems` returns crops, the pipeline reads them, and
    the music on every staff the detector missed is never sent to any model. The
    musician gets a short transcription that looks fine. That is strictly worse
    than the whole-page read this replaced, and the never-worse guard in
    `parse_sheet_music` cannot see it, because nothing failed.

    A stave is five lines. Every band on every fixture in this repository holds
    5 of them, or 6 where a hand-ruled staff adds a run of its own. The first
    real orchestral part measured here — a photographed String Bass part with
    eleven staves — produced two bands holding **9 and 2**: one had merged the
    dark desk at the top of the photograph with two staves, the other was a
    fragment. Nothing landed in between, on any page.

    All-or-nothing, deliberately. Dropping only the bands that fail would leave
    a page with holes in it, which is the thing being prevented.
    """
    low, high = _STAFF_LINES - _STAFF_LINE_SLACK, _STAFF_LINES + _STAFF_LINE_SLACK
    for top, bottom in systems:
        lines = sum(1 for run_top, run_bottom in runs if run_top >= top and run_bottom <= bottom)
        if not low <= lines <= high:
            log.info(
                "a band of %d px holds %d staff line(s), not %d; the page will "
                "be read whole rather than cut on a detection this unreliable",
                bottom - top, lines, _STAFF_LINES,
            )
            return False
    return True


def crop_systems(image_bytes: bytes) -> list[bytes]:
    """The page cut into one JPEG per staff system, top to bottom.

    Empty when the page holds fewer than `_MIN_SYSTEMS_TO_SPLIT` systems or
    could not be read at all — both of which mean "send it whole", which is
    what the caller did before this existed.

    **Padded generously**, because a system is not only its staff lines. Above
    them sit rehearsal marks, dynamics, bowings and the tempo text that says
    `Meno mosso`; below them sit more dynamics and the occasional fingering.
    The pipeline reads a page for its markings as much as its notes, and a crop
    crushed to the lines throws away the half that tells a musician what to do.

    **Overlap is deliberate and small.** Neighbouring crops share their
    padding, so a low note hanging under one staff appears at the bottom of its
    own crop and the top of the next. Better than the alternative: a note that
    falls in the seam belongs to no crop at all, and a dropped note shifts
    every bar after it in `alignment.py`'s timeline. Duplication is visible to
    the caller and correctable; a hole is neither.
    """
    systems, runs = _systems_and_runs(image_bytes)
    if len(systems) < _MIN_SYSTEMS_TO_SPLIT:
        return []
    if not _bands_are_staves(systems, runs):
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
            height = image.height

            for top, bottom in systems:
                pad = max(8, int((bottom - top) * _SYSTEM_PADDING))
                box = (0, max(0, top - pad), image.width, min(height, bottom + pad))
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
