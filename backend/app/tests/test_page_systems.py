"""Finding the staff systems on a photographed page.

**Why the page has to be cut up at all.** A fixture in this repository is a
single staff strip — 1200 px wide, 72–168 px tall — and the reader was tuned on
those. A photographed page asks the same reader for ten systems and four
hundred notes in one response.

A real scan came back with **59 measures and 112 notes**: it found the systems
and the bar structure, then emitted under two notes a bar, stopping normally
well inside a 16,000-token budget. That is not a reader that could not see the
page. It is a reader that did not enumerate it.

Resolution is a smaller part of this than it first looks, and the numbers are
worth writing down because I got them wrong by guessing before measuring. For a
3024x4032 photograph of ten systems: the whole page in one image gives a staff
**157 px**, one system full-width gives **209 px**, half a system gives 403.
157 is *inside* the 72–168 the fixtures give. So the cut is about how much is
being asked for in one answer, and the extra pixels are a bonus rather than the
point.

Found by horizontal projection rather than a model: staff lines are the longest
horizontal runs of ink on any page, longer than a beam, a slur or a word.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest

from app.services.page_image import find_systems

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "scores"


def _strips():
    from PIL import Image

    return [Image.open(p).convert("L") for p in sorted(FIXTURES.glob("*.jpg"))]


def _page(strips, gap: int = 60) -> bytes:
    """Real photographs stacked into a page, which is what a page is."""
    from PIL import Image

    width = max(s.width for s in strips)
    height = sum(s.height for s in strips) + gap * (len(strips) - 1)
    page = Image.new("L", (width, height), 255)
    y = 0
    for strip in strips:
        page.paste(strip, (0, y))
        y += strip.height + gap
    buffer = io.BytesIO()
    page.save(buffer, "JPEG", quality=92)
    return buffer.getvalue()


@pytest.mark.parametrize("name", sorted(p.name for p in FIXTURES.glob("*.jpg")))
def test_a_single_staff_strip_is_one_system(name: str) -> None:
    """Every fixture here is one staff, so anything else is the detector
    splitting a staff's own five lines apart — which is exactly what the first
    version did, because it keyed the gap to page height rather than to the
    spacing the page itself shows.
    """
    found = find_systems((FIXTURES / name).read_bytes())

    assert len(found) == 1, f"{name} split into {len(found)}"


def test_a_stacked_page_splits_back_into_its_systems() -> None:
    """Built from the real strips rather than drawn, so the staff lines,
    lighting and paper are a photograph's rather than a test's."""
    strips = _strips()

    found = find_systems(_page(strips))

    assert len(found) == len(strips)


def test_the_systems_come_back_in_reading_order() -> None:
    """Concatenating transcriptions depends on it. Bars numbered from a page
    read bottom-up would put the end of the piece at the beginning, and every
    measure number after that would be wrong."""
    found = find_systems(_page(_strips()))

    assert found == sorted(found)
    for (_, bottom), (top, _) in zip(found, found[1:]):
        assert top >= bottom, "systems overlap, so a bar could be read twice"


def test_a_system_is_tall_enough_to_be_a_staff() -> None:
    """A one-pixel 'system' is a smudge. Cropping to it would send the model a
    band of paper and get back a page with a hole in it."""
    strips = _strips()
    found = find_systems(_page(strips))

    for top, bottom in found:
        assert bottom - top >= 8, f"{bottom - top}px is not a staff"


def test_an_unreadable_page_asks_for_no_crops_rather_than_wrong_ones() -> None:
    """Degrades to "I found nothing", which the caller reads as "send the page
    whole" — the behaviour that existed before this function did. Guessing a
    split on a page it cannot see would turn a bad reading into no reading."""
    assert find_systems(b"not an image at all") == []
    assert find_systems(b"") == []


def test_blank_paper_has_no_systems_on_it() -> None:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("L", (1200, 900), 255).save(buffer, "JPEG")

    assert find_systems(buffer.getvalue()) == []
