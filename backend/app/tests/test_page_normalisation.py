"""Getting a phone photograph into a shape a vision model accepts.

**This step did not exist, and its absence is the likeliest reason real scans
kept failing.** Every OCR test in this repo runs against `fixtures/scores/` —
five cropped excerpts of 30-50 KB. The app receives a full page, shot
handheld, 3000-4000 px on the long edge and several megabytes, carrying an
EXIF orientation flag. Nothing had ever exercised that path.

So these tests are built from the input the app actually gets, not from the
fixtures, which is the whole point.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from app.services.page_image import (
    MODEL_MAX_BYTES,
    MODEL_MAX_EDGE,
    prepare_for_model,
)

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "scores" / "03_complex_printed.jpg"

#: Base64 inflates by 4/3, and the API limit applies to the encoded payload.
B64 = 4 / 3


def _encoded(data: bytes) -> float:
    return len(data) * B64


def _photo(width: int, height: int, *, exif: bytes | None = None, mode: str = "RGB") -> bytes:
    """A page-shaped photograph at an arbitrary size."""
    src = Image.open(FIXTURE).convert("RGB")
    page = Image.new("RGB", (width, height), "white")
    band = src.resize(
        (int(width * 0.92), max(1, int(src.height * (width * 0.92) / src.width))),
        Image.Resampling.LANCZOS,
    )
    y = int(height * 0.06)
    while y + band.height < height:
        page.paste(band, (int(width * 0.04), y))
        y += int(band.height * 1.9)
    buffer = io.BytesIO()
    if mode != "RGB":
        # JPEG carries neither palette nor CMYK, so a source in those modes has
        # to be a PNG/TIFF — which is exactly how such a page reaches the app.
        page = page.convert(mode)
        page.save(buffer, format="PNG" if mode in {"P", "L"} else "TIFF")
        return buffer.getvalue()
    page.save(buffer, format="JPEG", quality=95, subsampling=0, **({"exif": exif} if exif else {}))
    return buffer.getvalue()


def _open(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


# ---- size ------------------------------------------------------------------


def test_a_full_page_photograph_comes_back_under_the_api_limit() -> None:
    """Anthropic caps one image at 5 MB, and the cap applies to the *base64*
    payload — so a 4 MB photograph is a 5.3 MB request and comes back 400,
    with a message about nothing the musician can act on."""
    out, media = prepare_for_model(_photo(3024, 4032))
    assert media == "image/jpeg"
    assert _encoded(out) <= MODEL_MAX_BYTES


def test_the_long_edge_is_brought_to_the_size_the_model_actually_sees() -> None:
    """Anything larger is downsampled server-side before the model reads it,
    so the extra pixels buy no accuracy — they are paid for in upload time and
    in the size limit."""
    out, _ = prepare_for_model(_photo(4032, 3024))
    assert max(_open(out).size) == MODEL_MAX_EDGE


def test_a_small_page_is_not_upscaled() -> None:
    """Enlarging invents detail that was never photographed, and costs bytes
    to deliver it."""
    small = _photo(900, 1200)
    out, _ = prepare_for_model(small)
    assert max(_open(out).size) <= 1200


# ---- orientation -----------------------------------------------------------


def test_a_sideways_photograph_is_turned_the_right_way_up() -> None:
    """A phone writes orientation into EXIF rather than rotating the pixels.

    Viewers honour that flag; an API reading raw bytes need not. A staff
    rotated 90 degrees is not sheet music to a reader expecting horizontal
    lines — and the page looks perfectly upright to the person who took it,
    which is the worst possible combination for diagnosing it.
    """
    exif = Image.Exif()
    exif[274] = 6  # "rotate 90° clockwise", what a phone held upright writes
    portrait_bytes = _photo(3024, 4032, exif=exif.tobytes())

    before = _open(portrait_bytes)
    after = _open(prepare_for_model(portrait_bytes)[0])

    # The flag said the stored pixels are rotated; applying it swaps the axes.
    assert before.width < before.height
    assert after.width > after.height


def test_orientation_is_applied_before_the_edge_is_measured() -> None:
    """Order matters: resizing first would fit the long edge to the axis the
    photograph is about to stop having."""
    exif = Image.Exif()
    exif[274] = 6
    out, _ = prepare_for_model(_photo(3024, 4032, exif=exif.tobytes()))
    assert max(_open(out).size) == MODEL_MAX_EDGE


# ---- formats ---------------------------------------------------------------


@pytest.mark.parametrize("mode", ["CMYK", "L", "P"])
def test_modes_jpeg_cannot_carry_are_converted(mode: str) -> None:
    """A page can arrive as CMYK from a scanner, greyscale, or palette from a
    PNG export. Saving any of them as JPEG unconverted either raises or writes
    something the model cannot read."""
    out, media = prepare_for_model(_photo(1200, 1600, mode=mode))
    assert media == "image/jpeg"
    assert _open(out).mode == "RGB"


def test_a_transparent_capture_does_not_become_a_transparent_page() -> None:
    """The web build captures to a canvas, which is RGBA. Flattened onto
    white, because alpha over sheet music is a page you cannot see."""
    canvas = Image.new("RGBA", (1200, 1600), (255, 255, 255, 0))
    buffer = io.BytesIO()
    canvas.save(buffer, format="PNG")
    out, media = prepare_for_model(buffer.getvalue())
    assert media == "image/jpeg"
    assert _open(out).mode == "RGB"


def test_a_png_page_is_handled() -> None:
    """What the web build actually uploads — the media-type bug earlier today
    was this same input arriving under a `.jpg` name.

    It comes back JPEG, which is the point: PNG of a photograph is several
    times the size for no gain, and the size limit is what refuses pages.
    """
    page = Image.open(io.BytesIO(_photo(1200, 1600)))
    buffer = io.BytesIO()
    page.save(buffer, format="PNG")
    png = buffer.getvalue()

    out, media = prepare_for_model(png)
    assert media == "image/jpeg"
    assert max(_open(out).size) == MODEL_MAX_EDGE
    assert len(out) < len(png)


# ---- never make things worse ----------------------------------------------


@pytest.mark.parametrize(
    "data", [b"", b"not an image at all", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64]
)
def test_something_undecodable_is_passed_through_rather_than_raising(data: bytes) -> None:
    """The worst case has to be the behaviour that existed before this
    function did. An unrecognised format is the provider's to refuse, with the
    provider's own message, not something for this to guess about — and a
    normalisation step that can lose a page is worse than none.
    """
    out, media = prepare_for_model(data)
    assert out == data
    assert media.startswith("image/")


def test_the_staff_lines_survive_the_resize() -> None:
    """The one thing that must not be lost.

    Staff lines are one or two pixels wide, and a cheap resampling filter drops
    them in patches — producing exactly the unreadable page this step exists to
    prevent. Measured as ink retained: a page reduced to nearly blank has lost
    the notation whatever its file size says.
    """
    out, _ = prepare_for_model(_photo(3024, 4032))
    grey = _open(out).convert("L")
    dark = sum(1 for pixel in grey.convert('L').tobytes() if pixel < 128)
    assert dark > 0.005 * grey.width * grey.height, "the page came back nearly blank"
