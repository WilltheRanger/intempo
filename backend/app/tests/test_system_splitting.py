"""Cutting a page into staff systems so the engine reads one at a time.

**Why systems and not measures.** A measure crop is not readable on its own:
the clef and key live at the head of the system, and a bar lifted out of the
middle of one has neither, so every pitch in it is a guess. Printed music
repeats the clef and key on *every* system, which is exactly what makes a
system the smallest piece that still means something by itself.

Measured on a 3024x4032 page with Audiveris 5.4, peak RSS sampled from /proc:

    whole page at 2048px      9.5s   512 MB   10 measures
    all strips, one JVM      19.1s   570 MB   10 measures
    one strip on its own      6.2s   322 MB    2 measures
    per-system, end to end   31.2s   328 MB   10 measures

Half the memory, the same measures, for wall-clock that a background worker
does not spend anyone's attention on.
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw

from app.services.ocr.omr_provider import _merge
from app.services.page_image import split_systems
from app.services.score_schema import Measure, Note, ScoreJson

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "scores" / "03_complex_printed.jpg"


def _page(systems: int, width: int = 3024, height: int = 4032) -> bytes:
    """A page with a known number of staff systems on it."""
    src = Image.open(FIXTURE).convert("RGB")
    page = Image.new("RGB", (width, height), "white")
    band = src.resize(
        (int(width * 0.9), max(1, int(src.height * (width * 0.9) / src.width))),
        Image.Resampling.LANCZOS,
    )
    gap = (height - systems * band.height) // (systems + 1)
    for i in range(systems):
        page.paste(band, (int(width * 0.05), gap + i * (band.height + gap)))
    buffer = io.BytesIO()
    page.save(buffer, format="JPEG", quality=95, subsampling=0)
    return buffer.getvalue()


def _sizes(slices: list[bytes]) -> list[tuple[int, int]]:
    return [Image.open(io.BytesIO(s)).size for s in slices]


# ---- finding the systems ---------------------------------------------------


def test_a_page_is_cut_into_one_image_per_system() -> None:
    for count in (2, 3, 5):
        assert len(split_systems(_page(count))) == count, f"{count} systems"


def test_each_slice_keeps_the_full_width_and_the_original_resolution() -> None:
    """Cutting at full resolution is the point.

    A strip keeps the interline spacing of the original, which is the
    measurement Audiveris refuses a page for lacking — so slicing sidesteps the
    resolution floor rather than fighting it. Downscaling first would reproduce
    exactly the failure this avoids.
    """
    slices = split_systems(_page(4))
    assert all(w == 3024 for w, _ in _sizes(slices))


def test_a_single_system_page_is_not_split() -> None:
    """Nothing is gained, and a JVM start would be spent proving it."""
    assert split_systems(_page(1)) == []


def test_a_blank_page_is_not_split() -> None:
    blank = Image.new("RGB", (2000, 2600), "white")
    buffer = io.BytesIO()
    blank.save(buffer, format="JPEG")
    assert split_systems(buffer.getvalue()) == []


def test_a_page_of_noise_is_read_whole_rather_than_shredded() -> None:
    """The projection finding texture rather than systems has to fail closed.

    Returning forty slices would start forty JVMs to read a page that has no
    music on it.
    """
    noisy = Image.new("RGB", (1600, 4000), "white")
    draw = ImageDraw.Draw(noisy)
    for y in range(0, 4000, 60):
        draw.rectangle([0, y, 1600, y + 45], fill="black")
    buffer = io.BytesIO()
    noisy.save(buffer, format="JPEG")
    assert split_systems(buffer.getvalue(), max_systems=24) == []


def test_something_undecodable_is_read_whole() -> None:
    """Never fatal — the caller falls back to the page it already has."""
    assert split_systems(b"not an image") == []


def test_slices_carry_padding_for_what_sits_outside_the_staff() -> None:
    """Ledger lines, stems, slurs and dynamics live above and below the five
    lines. A tight crop amputates them, and the engine reads what is left."""
    page = _page(3)
    band_height = Image.open(io.BytesIO(page)).height
    heights = [h for _, h in _sizes(split_systems(page))]
    assert all(h > 100 for h in heights)
    assert sum(heights) < band_height, "the slices overlap the whole page"


# ---- putting them back together --------------------------------------------


def _part(count: int, first_measure: int = 1, **kw) -> ScoreJson:
    return ScoreJson(
        clef=kw.pop("clef", "bass"),
        time_signature=kw.pop("time_signature", None),
        ocr_confidence=kw.pop("ocr_confidence", 0.8),
        measures=[
            Measure(
                measure_number=first_measure + i,
                notes=[Note(pitch="C3", duration="quarter") for _ in range(4)],
            )
            for i in range(count)
        ],
    )


def test_measures_are_renumbered_across_the_whole_page() -> None:
    """Every strip is its own document to the engine and starts again at 1.

    Concatenating them unchanged gives a score with five measure 1s — and
    `alignment.py` builds its expected timeline in order, so a repeated number
    is not cosmetic.
    """
    merged = _merge([_part(2), _part(3), _part(2)])
    assert [m.measure_number for m in merged.measures] == [1, 2, 3, 4, 5, 6, 7]


def test_the_time_signature_is_taken_from_the_system_that_has_one() -> None:
    """It is printed once, at the head of the piece. A later system having none
    is correct, not a misread — so the first non-null is the only reading that
    survives being cut up."""
    merged = _merge([
        _part(2, time_signature="3/4"),
        _part(2, time_signature=None),
    ])
    assert merged.time_signature == "3/4"


def test_a_header_missing_from_the_first_system_is_found_later() -> None:
    merged = _merge([_part(1, time_signature=None), _part(1, time_signature="6/8")])
    assert merged.time_signature == "6/8"


def test_confidence_is_the_weakest_system_not_the_average() -> None:
    """A page is only as trustworthy as its worst-read line. Averaging would
    let four clean systems hide one the engine struggled with."""
    merged = _merge([_part(1, ocr_confidence=0.95), _part(1, ocr_confidence=0.30)])
    assert merged.ocr_confidence == 0.30


def test_the_merged_reading_says_how_it_was_read() -> None:
    assert "5 systems" in _merge([_part(1) for _ in range(5)]).notes_to_human
