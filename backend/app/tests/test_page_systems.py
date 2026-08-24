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


# ---------------------------------------------------------------------------
# Cutting the page up
# ---------------------------------------------------------------------------


def _stacked(order: list, gap: int = 60) -> bytes:
    from PIL import Image

    width = max(s.width for s in order)
    page = Image.new("RGB", (width, sum(s.height for s in order) + gap * (len(order) - 1)), "white")
    y = 0
    for strip in order:
        page.paste(strip.convert("RGB"), (0, y))
        y += strip.height + gap
    buffer = io.BytesIO()
    page.save(buffer, "JPEG", quality=92)
    return buffer.getvalue()


def test_one_crop_per_system() -> None:
    from app.services.page_image import crop_systems

    strips = _strips()

    assert len(crop_systems(_stacked(strips))) == len(strips)


def test_every_crop_is_one_system() -> None:
    """The property that makes the whole idea work. A crop holding two systems
    asks the model the same question the page did, only smaller."""
    from app.services.page_image import crop_systems

    for crop in crop_systems(_stacked(_strips())):
        assert len(find_systems(crop)) == 1


def test_the_crops_come_back_in_reading_order() -> None:
    """Reversing the page has to reverse the crops.

    Checked by *rebuilding the page the other way up* rather than by reading
    coordinates back, because coordinates are what the function returns and a
    test that re-derives them from the same source proves nothing. The two
    strips are chosen to be very different heights, so which one came first is
    visible in the answer.
    """
    from app.services.page_image import crop_systems

    strips = sorted(_strips(), key=lambda s: s.height)
    short, tall = strips[0], strips[-1]

    def heights(page: bytes) -> list[int]:
        from PIL import Image

        out = []
        for crop in crop_systems(page):
            with Image.open(io.BytesIO(crop)) as image:
                out.append(image.height)
        return out

    tall_first = heights(_stacked([tall, short]))
    short_first = heights(_stacked([short, tall]))

    assert len(tall_first) == len(short_first) == 2
    assert tall_first[0] > tall_first[1]
    assert short_first[0] < short_first[1]


def test_a_crop_keeps_the_markings_around_the_staff() -> None:
    """A system is not only its staff lines. Above them sit rehearsal marks,
    dynamics, bowings and the text that says `Meno mosso`; the pipeline reads a
    page for those as much as for its notes."""
    from PIL import Image

    from app.services.page_image import crop_systems

    strips = _strips()
    page = _stacked(strips)
    systems = find_systems(page)

    for crop, (top, bottom) in zip(crop_systems(page), systems):
        with Image.open(io.BytesIO(crop)) as image:
            assert image.height > bottom - top, "cropped tight to the staff lines"


def test_a_page_with_one_system_is_left_whole() -> None:
    """Cutting it up would be the same picture with an extra decode, and every
    fixture in this repository is exactly this case."""
    from app.services.page_image import crop_systems

    for path in sorted(FIXTURES.glob("*.jpg")):
        assert crop_systems(path.read_bytes()) == [], path.name


def test_a_page_that_cannot_be_read_is_left_whole() -> None:
    """Degrading to the behaviour that existed before this function is the
    whole safety story: it can only ever improve matters."""
    from app.services.page_image import crop_systems

    assert crop_systems(b"not an image") == []
    assert crop_systems(b"") == []


def test_every_crop_is_small_enough_to_send() -> None:
    from app.services.page_image import MODEL_MAX_BYTES, crop_systems

    for crop in crop_systems(_stacked(_strips())):
        assert len(crop) * 1.34 <= MODEL_MAX_BYTES, "a crop is too big for the request"


def test_every_crop_is_a_jpeg_the_model_will_take() -> None:
    """Proves the crop went through `prepare_for_model` rather than straight
    out of Pillow.

    Checked by *format*, not by size: the intermediate is PNG, so a JPEG on the
    way out can only have come from the shared preparation step. The obvious
    assertion — that each crop is under the request cap — passes whether or not
    that step ran, because a single system is small anyway. A mutation skipping
    it survived exactly that test.
    """
    from app.services.page_image import crop_systems

    for crop in crop_systems(_stacked(_strips())):
        assert crop[:3] == b"\xff\xd8\xff", "not a JPEG, so the size cap was skipped too"


def test_a_page_that_fails_halfway_through_cropping_is_sent_whole(monkeypatch) -> None:
    """The guard around the crop loop, which the unreadable-page cases never
    reach — they are turned away earlier, by `find_systems` finding nothing.

    Returning a partial set of crops would be the worst outcome available: the
    page would be transcribed with a system missing and nothing would say so,
    and a missing system shifts every bar after it in `alignment.py`'s
    timeline.
    """
    from app.services import page_image

    real = page_image.prepare_for_model
    done = 0

    def _explodes_partway(image_bytes):
        # On the *third* crop, not the first. Failing on the first leaves the
        # partial list empty, so `return crops` and `return []` are the same
        # answer and the mutation survives — which it did.
        nonlocal done
        done += 1
        if done >= 3:
            raise RuntimeError("out of memory decoding the crop")
        return real(image_bytes)

    monkeypatch.setattr(page_image, "prepare_for_model", _explodes_partway)

    assert page_image.crop_systems(_stacked(_strips())) == [], (
        "a partial set of crops was returned; the page would be transcribed "
        "with a system missing and nothing would say so"
    )
    assert done >= 3, "the failure never happened, so this proved nothing"


# ---------------------------------------------------------------------------
# At the size a phone actually produces
#
# Everything above works on the fixture strips and on pages stacked from them,
# which are 1200 px wide. A phone sends 3024x4032, the bands are blown up to
# match, and the detector behaves differently there — which is where the
# fragment-merging pass came from.
# ---------------------------------------------------------------------------


def _phone_page(source: Path, width: int = 3024, height: int = 4032) -> tuple[bytes, int]:
    """The fixture band pasted down a page, at the resolution a phone sends."""
    from PIL import Image

    strip = Image.open(source).convert("RGB")
    page = Image.new("RGB", (width, height), "white")
    band = strip.resize(
        (int(width * 0.92), max(1, int(strip.height * (width * 0.92) / strip.width))),
        Image.Resampling.LANCZOS,
    )
    y, pasted = int(height * 0.06), 0
    while y + band.height < height:
        page.paste(band, (int(width * 0.04), y))
        y += int(band.height * 1.9)
        pasted += 1
    buffer = io.BytesIO()
    page.save(buffer, format="JPEG", quality=95, subsampling=0)
    return buffer.getvalue(), pasted


@pytest.mark.parametrize("name", sorted(p.name for p in FIXTURES.glob("0*.jpg")))
def test_it_counts_the_systems_on_a_phone_photograph(name: str) -> None:
    """Exactly, not approximately.

    One too many means half a staff is sent to the model on its own, and half a
    staff is not readable — it would be asked what the notes are on the top
    three lines. One too few means two systems in one crop, which is the
    question the whole page was already failing to answer.

    `05_handwritten_messy` is why the merging pass exists: a hand-ruled staff
    has uneven line spacing, so one wide gap inside it cleared the split
    threshold and every staff came back as two. Twelve bands, twenty-four
    systems.
    """
    page, pasted = _phone_page(FIXTURES / name)

    assert len(find_systems(page)) == pasted


@pytest.mark.parametrize("name", sorted(p.name for p in FIXTURES.glob("0*.jpg")))
def test_a_phone_photograph_crops_to_one_staff_each(name: str) -> None:
    """One *substantial* staff per crop, not one run of ink.

    Re-running the detector on a padded crop and demanding exactly one answer
    is not a well-posed check, and asserting it was my mistake: the padding
    deliberately reaches into the neighbouring systems so that a low note
    hanging under a staff appears in both crops rather than in neither. A
    5-pixel sliver of the next line is the feature working.

    What has to be true is that each crop holds **one** thing worth reading —
    so fragments much shorter than the tallest run are the padding doing its
    job, and two comparable staves in one crop would be the failure.
    """
    from app.services.page_image import crop_systems

    page, pasted = _phone_page(FIXTURES / name)
    crops = crop_systems(page)

    assert len(crops) == pasted
    for index, crop in enumerate(crops):
        runs = find_systems(crop)
        assert runs, f"crop {index} holds no staff at all"
        tallest = max(bottom - top for top, bottom in runs)
        substantial = [r for r in runs if (r[1] - r[0]) > tallest / 2]
        assert len(substantial) == 1, (
            f"crop {index} holds {len(substantial)} staves, so the model is "
            "being asked the same question the whole page was failing"
        )


@pytest.mark.parametrize("name", sorted(p.name for p in FIXTURES.glob("0*.jpg")))
def test_the_padding_does_not_reach_the_next_staff(name: str) -> None:
    """How far the deliberate overlap actually goes — measured, not argued.

    `crop_systems` pads by `_SYSTEM_PADDING` of a system's own height on
    purpose, so a note hanging below a staff lands in both neighbouring crops
    rather than in the seam between them. The prompt note sent with each crop
    tells the model to read only the complete staff in the middle, and I wrote
    that having *asserted* the padding catches the notehead tips of the
    neighbours on a densely set page rather than having measured it.

    On these pages it does not reach the next band at all, and there is a
    reason it structurally almost cannot: `find_systems` merges any two bands
    closer than the page's median staff height, so every surviving gap is at
    least that, while the padding is 0.55 of one band's height. A band much
    taller than the median could still cross — which is why this measures
    rather than reasons.

    So the instruction in the note is a guard against something not
    demonstrated here, not a description of these crops. It costs a line of
    prompt and the failure it guards against — the same bars read twice, once
    per crop, lengthening the page and shifting every later bar against the
    recording — is silent, so it stays.
    """
    from app.services.page_image import _SYSTEM_PADDING

    page, _pasted = _phone_page(FIXTURES / name)
    systems = find_systems(page)
    assert len(systems) > 1

    for index, (top, bottom) in enumerate(systems[:-1]):
        pad = max(8, int((bottom - top) * _SYSTEM_PADDING))
        next_top = systems[index + 1][0]
        assert bottom + pad <= next_top, (
            f"crop {index + 1} reaches {bottom + pad - next_top}px into the "
            "next staff; the same bars would be read twice, once per crop, and "
            "the page would come out longer than the music"
        )


def test_the_padding_cannot_span_the_gap_the_detector_leaves() -> None:
    """The coupling between the two numbers, which is not obvious from either.

    `find_systems` merges bands closer together than the median staff height,
    so every gap it leaves is at least one staff tall. `crop_systems` then pads
    by `_SYSTEM_PADDING` of a staff. At 1.0 or above a crop could swallow the
    whole of its neighbour, and a system read twice is invisible downstream —
    the bars add up, the page is simply longer than the music, and every bar
    after the duplicate is compared against the wrong moment of the recording.

    Raising the padding is a reasonable thing to want; doing it past 1.0
    without changing the merge rule is not.
    """
    from app.services.page_image import _SYSTEM_PADDING

    assert 0 < _SYSTEM_PADDING < 1.0
