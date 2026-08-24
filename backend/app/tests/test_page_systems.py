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
    asks the model the same question the page did, only smaller.

    One *substantial* band, not exactly one band: the crops overlap on purpose,
    so a crop shows a sliver of its neighbour — a few rows of notehead tips. A
    fragment a fraction of the tallest band's height is that overlap working;
    two comparable bands in one crop would be the failure.
    """
    from app.services.page_image import crop_systems

    for index, crop in enumerate(crop_systems(_stacked(_strips()))):
        found = find_systems(crop)
        heights = sorted((bottom - top for top, bottom in found), reverse=True)
        assert heights, f"crop {index} holds nothing"
        substantial = [h for h in heights if h > heights[0] * 0.5]
        assert len(substantial) == 1, (
            f"crop {index} holds {len(substantial)} comparable bands: {heights}"
        )


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


# ---------------------------------------------------------------------------
# A real page, and the shape of how it failed
#
# Measured on a photographed String Bass part with **ten** systems on it — the
# first real orchestral page this repository has seen. The old detector returned
# **two** bands, and `crop_systems` handed the pipeline two crops covering a
# fraction of the music. Nothing raised: the other eight systems were simply
# never sent to any model, and the musician would have got a short
# transcription that looked fine. It now returns twelve crops: its ten systems,
# and the desk above and below the sheet.
#
# The photograph is not in the repository — it is a copyrighted part — so these
# reproduce what was measurably wrong with it: the desk in shot, a cut that
# would go through a system, and a band far taller than a system.
# ---------------------------------------------------------------------------


def _with_a_dark_edge(page: bytes, *, rows: int = 40) -> bytes:
    """The desk, at the top of the photograph.

    A full-width dark run. To a projection of mostly-dark rows this was
    indistinguishable from a staff line, and worse than that: it inflated the
    standard deviation the threshold was derived from, so the ink on the
    well-lit paper stopped counting.
    """
    from PIL import Image, ImageDraw

    with Image.open(io.BytesIO(page)) as image:
        shot = image.convert("RGB")
    ImageDraw.Draw(shot).rectangle([0, 0, shot.width, rows], fill=(28, 26, 24))
    buffer = io.BytesIO()
    shot.save(buffer, format="JPEG", quality=95, subsampling=0)
    return buffer.getvalue()


def test_a_dark_edge_no_longer_stops_the_page_being_cut_up() -> None:
    """The desk in the photograph, which is what defeated the old detector.

    A full-width dark band looked exactly like a staff line to a projection of
    mostly-dark rows: it merged with the staves nearest it and it inflated the
    standard deviation the threshold was derived from, so the ink on the
    well-lit paper stopped counting. Ink density measured against the paper
    immediately around each pixel does not care — a uniform dark region has the
    same brightness as its own background, so it is not ink.

    The desk still becomes a band of its own, and that is deliberate: it gets a
    crop, and a crop with no music on it is what `NoMusicFound` is for at the
    first and last position. What must not happen is the page failing to split.
    """
    from app.services.page_image import crop_systems

    page, pasted = _phone_page(FIXTURES / "01_simple_printed.jpg")
    shot = _with_a_dark_edge(page)

    crops = crop_systems(shot)
    assert len(crops) >= pasted, (
        f"a dark edge cost the page {pasted - len(crops)} crop(s); the music on "
        "those systems would never have been read"
    )


@pytest.mark.parametrize("name", sorted(p.name for p in FIXTURES.glob("0*.jpg")))
def test_a_page_the_detector_reads_properly_is_still_cut_up(name: str) -> None:
    """The other side of the guard, and the one that makes it a guard rather
    than a switch. Every one of these pages still splits into exactly its own
    systems."""
    from app.services.page_image import crop_systems

    page, pasted = _phone_page(FIXTURES / name)

    assert len(crop_systems(page)) == pasted


def test_the_crops_tile_the_page() -> None:
    """The property that retires an entire class of failure.

    Cropping the *bands* and discarding what lay between them is how the real
    page lost its music: the detector found two bands out of ten systems and
    nothing raised, so the rest was never sent to any model. Even with the
    detector rewritten, padded bands hold 85% of that page's ink.

    The crops tile it instead. Asserted on the source rows rather than on crop
    heights, because heights include the overlap and therefore sum to more than
    the page whether or not there is a gap in the middle — an assertion on the
    total passed with the tiling removed.
    """
    from PIL import Image

    from app.services.page_image import _crop_boxes, prepare_for_model

    page, pasted = _phone_page(FIXTURES / "02_medium_printed.jpg")
    prepared, _media = prepare_for_model(page)
    with Image.open(io.BytesIO(prepared)) as image:
        height = image.height

    boxes = _crop_boxes(prepared)

    assert len(boxes) == pasted
    assert boxes[0][0] == 0, f"rows 0..{boxes[0][0]} belong to no crop"
    assert boxes[-1][1] == height, (
        f"rows {boxes[-1][1]}..{height} belong to no crop"
    )
    for index, ((_top, bottom), (next_top, _next_bottom)) in enumerate(
        zip(boxes, boxes[1:])
    ):
        assert next_top < bottom, (
            f"crops {index} and {index + 1} leave rows {bottom}..{next_top} "
            "in no crop at all"
        )


def test_the_overlap_is_the_same_everywhere() -> None:
    """Which is what "padding from the page's typical band" means, stated as a
    property rather than as an implementation.

    Padding each crop by its own band's height makes the overlap vary — and on
    the real page the odd band is the desk, three times a system tall, whose
    padding reached a whole system upward so that system came back in two crops.
    Read twice, the page is longer than the music and every bar after it is
    compared against the wrong moment of the recording.
    """
    from app.services.page_image import _crop_boxes, prepare_for_model

    # On a page of identical pasted strips every band is the same height, so
    # per-band padding and median padding agree and this proves nothing — which
    # is how it was written first. The dark edge is what makes the heights
    # differ, the same way the desk does on a real photograph.
    page, _pasted = _phone_page(FIXTURES / "01_simple_printed.jpg")
    prepared, _media = prepare_for_model(_with_a_dark_edge(page, rows=140))
    boxes = _crop_boxes(prepared)

    from app.services.page_image import _bands, _ink_profile

    heights = [bottom - top for top, bottom in _bands(_ink_profile(prepared)[1])]
    assert len(set(heights)) > 1, (
        f"every band is {heights[0]}px tall, so per-band padding cannot differ "
        "from the median and this test cannot fail"
    )

    overlaps = [bottom - next_top for (_t, bottom), (next_top, _b) in zip(boxes, boxes[1:])]
    assert len(set(overlaps)) == 1, (
        f"the overlap between crops varies: {overlaps} for bands {heights}"
    )
    assert overlaps[0] > 0


def test_a_gap_is_cut_at_its_quietest_row_not_its_middle() -> None:
    """A gap between two systems is not uniformly empty: a low note hangs under
    one staff and a rehearsal mark sits above the next, so the quietest row is
    off-centre. Cutting at the midpoint takes a notehead with it, and the bar it
    belonged to comes back short in both crops.

    Asserted on a profile rather than on a page, because every gap on every
    fixture here is uniformly white — midpoint and minimum coincide, and the
    difference is invisible on all of them.
    """
    import numpy as np

    from app.services.page_image import _cut_rows

    # Two bands with a gap from 40 to 100. The gap is not empty: something
    # hangs under the first staff, so its quietest row is at 90, not 70.
    smoothed = np.zeros(200, dtype=np.float32)
    smoothed[0:40] = 0.30
    smoothed[100:140] = 0.30
    smoothed[40:88] = 0.05
    smoothed[88:100] = 0.001

    assert _cut_rows([(0, 40), (100, 140)], smoothed) == [88]


def test_a_cut_that_would_go_through_a_system_stops_the_page_being_cut_up() -> None:
    """The one way tiling crops can still damage a page.

    A cut inside a system splits the bar it lands in between two crops, both
    halves come back short, and the bar count is wrong from there to the end.
    So a cut has to be quiet: measured, the loudest cut on the real page carries
    0.044 of a row's width in ink against 0.20 inside the quietest band, and on
    every fixture here the cuts are at exactly zero.
    """
    import numpy as np

    from app.services.page_image import _cuts_are_quiet

    bands = [(0, 40), (100, 140)]
    quiet = np.zeros(200, dtype=np.float32)
    quiet[0:40] = 0.3
    quiet[100:140] = 0.3
    assert _cuts_are_quiet(bands, [70], quiet)

    # The same two bands, but the gap between them is nearly as inky as they
    # are — which is what a cut aimed at the middle of a system looks like.
    loud = quiet.copy()
    loud[40:100] = 0.2
    assert not _cuts_are_quiet(bands, [70], loud)


def test_a_page_with_no_gaps_at_all_is_read_whole() -> None:
    """A profile with no valleys is not a page of systems — it is one block of
    ink, or a photograph of something that is not music. Cutting it anywhere
    goes through the middle of whatever it is."""
    import numpy as np

    from app.services.page_image import _cuts_are_quiet

    solid = np.full(200, 0.3, dtype=np.float32)
    assert not _cuts_are_quiet([(0, 90), (110, 200)], [100], solid)


def test_a_dense_page_is_not_the_problem() -> None:
    """How much music is on the page is not what defeated the detector, and it
    matters that this is written down: "a real page holds more systems than a
    fixture" was the obvious explanation and it is wrong. A page carrying eleven
    bands at real spacing was detected exactly even by the old projection.

    What defeated it was that a page held in the hand is not flat — each system
    slopes by more than its own height across the width — and that the desk in
    shot dragged the darkness threshold below the ink. Neither is a property of
    how much music is on the page.
    """
    from PIL import Image

    from app.services.page_image import crop_systems

    strip = Image.open(FIXTURES / "01_simple_printed.jpg").convert("RGB")
    width, height = 3024, 4032
    page = Image.new("RGB", (width, height), "white")
    band = strip.resize(
        (int(width * 0.92), max(1, int(strip.height * (width * 0.92) / strip.width))),
        Image.Resampling.LANCZOS,
    )
    # 1.15x the band's own height, which is roughly how a real part is set —
    # `_phone_page` uses 1.9x and gets seven systems onto a page.
    y, pasted = int(height * 0.03), 0
    while y + band.height < height:
        page.paste(band, (int(width * 0.04), y))
        y += int(band.height * 1.15)
        pasted += 1
    buffer = io.BytesIO()
    page.save(buffer, format="JPEG", quality=95, subsampling=0)

    assert pasted >= 11, f"only {pasted} bands fitted; this is not a dense page"
    assert len(crop_systems(buffer.getvalue())) == pasted


# ---------------------------------------------------------------------------
# Cutting the photograph, not the reduced copy of it
# ---------------------------------------------------------------------------


def test_a_crop_carries_more_detail_than_the_page_it_came_from() -> None:
    """The entire reason a page is cut up, and it was being thrown away one
    step before the cut.

    `MODEL_MAX_EDGE` squeezes a photograph onto 1568px. Cutting *that* into
    systems gives each one a slice of a budget already spent — on the real page,
    1176×165 with about ten pixels between staff lines, which is no more detail
    per system than sending the whole page. Cutting the photograph and preparing
    each crop separately spends the whole budget on one system: 1568×220,
    fourteen pixels between staff lines, 1.8× the pixels.
    """
    from PIL import Image

    from app.services.page_image import MODEL_MAX_EDGE, crop_systems, prepare_for_model

    page, _pasted = _phone_page(FIXTURES / "02_medium_printed.jpg")
    prepared, _media = prepare_for_model(page)

    def sizes(**kwargs):
        out = []
        for crop in crop_systems(prepared, **kwargs):
            with Image.open(io.BytesIO(crop)) as image:
                out.append((image.width, image.height))
        return out

    reduced = sizes()
    full = sizes(source=page)

    assert len(reduced) == len(full)
    assert all(f[0] > r[0] and f[1] > r[1] for r, f in zip(reduced, full)), (
        f"cutting the photograph gained nothing: {reduced} vs {full}"
    )
    assert full[0][0] == MODEL_MAX_EDGE, (
        f"a crop's long edge is {full[0][0]}, not the {MODEL_MAX_EDGE} budget "
        "it is entitled to on its own"
    )
    gained = (full[0][0] * full[0][1]) / (reduced[0][0] * reduced[0][1])
    assert gained > 1.5, f"only {gained:.2f}x the pixels"


def test_the_systems_are_the_same_ones_whichever_image_is_cut() -> None:
    """Detection happens on the reduced page and the cut happens on the
    photograph, so the two coordinate spaces have to be mapped, and getting the
    ratio wrong would slide every crop down the page — each one holding the
    bottom half of one system and the top of the next, with every bar split."""

    from app.services.page_image import crop_systems, prepare_for_model

    page, pasted = _phone_page(FIXTURES / "01_simple_printed.jpg")
    prepared, _media = prepare_for_model(page)

    crops = crop_systems(prepared, source=page)
    assert len(crops) == pasted

    for index, crop in enumerate(crops):
        found = find_systems(crop)
        heights = sorted((bottom - top for top, bottom in found), reverse=True)
        assert heights, f"crop {index} holds nothing at all"
        substantial = [h for h in heights if h > heights[0] * 0.5]
        assert len(substantial) == 1, (
            f"crop {index} holds {len(substantial)} comparable bands {heights}: "
            "the boxes were mapped onto the photograph at the wrong scale"
        )


def test_every_crop_of_the_photograph_is_still_small_enough_to_send() -> None:
    """More pixels per system is only worth having if it still arrives. Each
    crop goes through `prepare_for_model` individually, so the cap applies to
    each of them — but the cap is on the *encoded* size and a crop of the
    photograph is a bigger picture than a crop of the reduced page."""
    from app.services.page_image import MODEL_MAX_BYTES, crop_systems, prepare_for_model

    page, _pasted = _phone_page(FIXTURES / "03_complex_printed.jpg")
    prepared, _media = prepare_for_model(page)

    for index, crop in enumerate(crop_systems(prepared, source=page)):
        assert crop[:3] == b"\xff\xd8\xff", f"crop {index} is not a JPEG"
        assert len(crop) * 4 / 3 <= MODEL_MAX_BYTES, f"crop {index} is over the limit"


def test_without_the_photograph_the_reduced_page_is_cut_as_before() -> None:
    """`source` is optional and its absence is not a failure: a caller holding
    only the prepared page — which is every caller that existed before this —
    gets exactly what it got before."""
    from app.services.page_image import crop_systems, prepare_for_model

    page, pasted = _phone_page(FIXTURES / "02_medium_printed.jpg")
    prepared, _media = prepare_for_model(page)

    assert len(crop_systems(prepared)) == pasted
    assert crop_systems(prepared) == crop_systems(prepared, source=prepared), (
        "passing the same image as the source changed the answer, so the scale "
        "mapping is not the identity when the two images are the same size"
    )
