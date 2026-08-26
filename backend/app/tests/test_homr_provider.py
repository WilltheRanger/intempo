"""homr as a provider, and the one thing it must not be handed.

The engine itself is not installed on a box running these tests — 150 MB of
ONNX weights for a container that never reads a page — so `process_image` is
stubbed. What is real here is everything on either side of it: the temporary
file it is given, the MusicXML it writes coming back through this project's own
importer, the confidence that is *not* the importer's, and the routing that
gives a whole-page reader a whole page.
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass
from pathlib import Path

import pytest

from app.services.ocr.base import OCRProviderError
from app.services.ocr.homr_provider import HomrProvider, homr_available

MUSICXML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions></attributes>
      <attributes>
        <key><fifths>2</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      {notes}
    </measure>
  </part>
</score-partwise>
"""

_FOUR_QUARTERS = "".join(
    f'<note><pitch><step>{step}</step><octave>3</octave></pitch>'
    f"<duration>2</duration><type>quarter</type></note>"
    for step in "DEFG"
)
#: A full bar and then a short one.
#:
#: Two measures, not one, and that is the test rather than the fixture: a short
#: **first** measure is a pickup, which `validate_measures` counts as fine and
#: should. Written with one measure this could not fail — the only bar was the
#: first, so a quarter note in 4/4 came back as a confident reading.
_ONE_GOOD_BAR_THEN_A_SHORT_ONE = (
    _FOUR_QUARTERS
    + "</measure><measure number=\"2\">"
    + '<note><pitch><step>D</step><octave>3</octave></pitch>'
    + "<duration>2</duration><type>quarter</type></note>"
)


@pytest.fixture()
def homr(monkeypatch):
    """`homr.main.process_image`, replaced, with the page it was handed."""
    seen: dict = {}

    def _install(xml: str | None):
        def process_image(path, config, args):
            seen["path"] = Path(path)
            seen["bytes"] = Path(path).read_bytes()
            seen["config"] = config
            if xml is not None:
                Path(path).with_suffix(".musicxml").write_text(xml, encoding="utf-8")

        main = types.ModuleType("homr.main")
        main.process_image = process_image
        # **The stub has homr's real signature, and that is the point.**
        #
        # It used to be `type("ProcessingConfig", (), {})` — a class taking no
        # arguments. The provider called `ProcessingConfig()` with none, the
        # stub accepted it, and every test passed. Against real homr 0.7.0,
        # where all eight parameters are required positionals, that same call
        # raised `TypeError` on **every page ever scanned** — reported to the
        # musician as "a flatter, better-lit shot of the page usually fixes
        # it", advice about a photograph for a call that never reached one.
        #
        # A double that is more permissive than the real thing does not test
        # the code, it agrees with it.
        @dataclass
        class ProcessingConfig:
            enable_debug: bool
            enable_cache: bool
            write_staff_positions: bool
            read_staff_positions: bool
            selected_staff: int
            transformer_use_gpu: bool
            segnet_use_gpu: bool
            coreml_encoder: bool

        main.ProcessingConfig = ProcessingConfig
        generator = types.ModuleType("homr.music_xml_generator")
        generator.XmlGeneratorArguments = lambda **kwargs: kwargs
        package = types.ModuleType("homr")
        monkeypatch.setitem(sys.modules, "homr", package)
        monkeypatch.setitem(sys.modules, "homr.main", main)
        monkeypatch.setitem(sys.modules, "homr.music_xml_generator", generator)
        return seen

    return _install


def test_a_page_comes_back_as_a_score(homr) -> None:
    homr(MUSICXML.format(notes=_FOUR_QUARTERS))

    response = HomrProvider().parse(b"<the photograph>", mime_type="image/jpeg")

    assert response.model == "homr"
    assert response.score.clef == "bass"
    assert response.score.key_signature == "D major"
    assert len(response.score.measures[0].notes) == 4


def test_the_photograph_reaches_it_untouched(homr) -> None:
    """It reads a *path*, so the bytes go to a file — and the file must be the
    page, not a re-encoding of it. Every other provider takes bytes."""
    seen = homr(MUSICXML.format(notes=_FOUR_QUARTERS))

    HomrProvider().parse(b"\xff\xd8\xff the photograph", mime_type="image/jpeg")

    assert seen["bytes"] == b"\xff\xd8\xff the photograph"
    assert seen["path"].suffix == ".jpg", "it was given a name it cannot open"


def test_nothing_is_left_on_disk(homr) -> None:
    """A container reads many pages. `process_image` writes its output beside
    the input, so both have to go."""
    seen = homr(MUSICXML.format(notes=_FOUR_QUARTERS))

    HomrProvider().parse(b"<page>")

    assert not seen["path"].exists()
    assert not seen["path"].parent.exists()


def test_confidence_is_measured_here_not_taken_from_the_importer(homr) -> None:
    """The importer reports the fraction of notes that survived conversion,
    which on real homr output is **1.0** — it says the XML parsed, not that the
    page was read correctly. Passing that on would claim certainty about a
    photograph, which `import_score` explicitly refuses to do.

    What is reported instead is the share of bars that add up: real evidence,
    computed by our checks rather than by the engine marking its own homework,
    and it *falls* when a reading goes wrong.
    """
    homr(MUSICXML.format(notes=_FOUR_QUARTERS))
    good = HomrProvider().parse(b"<page>").score
    assert good.ocr_confidence == 1.0

    homr(MUSICXML.format(notes=_ONE_GOOD_BAR_THEN_A_SHORT_ONE))
    short = HomrProvider().parse(b"<page>").score
    assert short.ocr_confidence == 0.5, (
        "one bar of two holding a quarter of its beats was reported as a "
        f"confident reading: {short.ocr_confidence}"
    )


def test_a_reading_whose_bars_do_not_add_up_falls_below_the_gate(homr) -> None:
    """Which is the number's job: under `CONFIDENCE_THRESHOLD` the pipeline
    stops trusting it and the vision chain gets its turn."""
    from app.services.ocr.pipeline import CONFIDENCE_THRESHOLD

    homr(MUSICXML.format(notes=_ONE_GOOD_BAR_THEN_A_SHORT_ONE))

    assert HomrProvider().parse(b"<page>").score.ocr_confidence < CONFIDENCE_THRESHOLD


def test_a_page_with_no_staves_on_it_is_a_provider_failure(homr) -> None:
    """homr reports "no staffs detected" by writing nothing at all, and a
    missing file is not an answer this project can distinguish from a crash
    unless it says so."""
    homr(None)

    with pytest.raises(OCRProviderError, match="no staves"):
        HomrProvider().parse(b"<page>")


def test_a_media_type_it_cannot_open_is_refused_before_the_page_is_written(homr) -> None:
    seen = homr(MUSICXML.format(notes=_FOUR_QUARTERS))

    with pytest.raises(OCRProviderError, match="unsupported media type"):
        HomrProvider().parse(b"<page>", mime_type="image/heic")

    assert "path" not in seen, "it wrote the file before checking it could read it"


def test_it_charges_nothing_rather_than_a_made_up_price(homr) -> None:
    """Modal bills by the second, not by the thousand tokens. A fabricated cost
    would sit in the telemetry beside real ones."""
    homr(MUSICXML.format(notes=_FOUR_QUARTERS))

    response = HomrProvider().parse(b"<page>")

    assert (response.cost_usd, response.input_tokens, response.output_tokens) == (0.0, 0, 0)
    assert response.latency_ms >= 0


def test_it_reads_whole_pages_and_says_so() -> None:
    """The flag the pipeline routes on. homr finds and *dewarps* the staves
    itself — better than the crops this repo cuts, which is the reason to run it
    — so handing it a crop throws away the part that works."""
    assert HomrProvider().reads_whole_page is True


def test_availability_is_reported_rather_than_assumed(monkeypatch) -> None:
    """A chain naming `homr` on a host without it falls through to the vision
    models and reads every page the slower, worse way while appearing to work.
    `/v1/ready` asks this."""
    monkeypatch.setitem(sys.modules, "homr", types.ModuleType("homr"))
    assert homr_available() is True

    monkeypatch.setenv("HOMR_DISABLED", "1")
    assert homr_available() is False


def test_a_pickup_is_not_counted_against_the_reading(homr) -> None:
    """A short opening measure is an anacrusis, not an error, and
    `validate_measures` says so — this has to agree with it or every piece that
    starts on an upbeat would report a doubtful reading.

    This is the rule that corrected the test above: written with a single short
    measure, that measure *was* the first, so a quarter note in 4/4 came back at
    full confidence and the assertion could not fail.
    """
    pickup_then_full = (
        '<note><pitch><step>A</step><octave>2</octave></pitch>'
        "<duration>2</duration><type>quarter</type></note>"
        '</measure><measure number="2">' + _FOUR_QUARTERS
    )
    homr(MUSICXML.format(notes=pickup_then_full))

    score = HomrProvider().parse(b"<page>").score

    assert score.ocr_confidence == 1.0, (
        "a piece starting on an upbeat was reported as a doubtful reading"
    )


def test_arithmetic_cannot_see_a_page_read_entirely_in_quarters(homr) -> None:
    """The blind spot, pinned so nobody reads the confidence as a grade.

    A bar of four quarters adds up in 4/4 whether or not the page shows eight
    eighths. So a reading that quantised an entire page scores **1.0** here and
    is wrong in every bar in the way that matters most — `alignment.py`
    accumulates durations, so the musician is told they rushed every passage the
    page writes short.

    Measured on the first real page: 55 of its 74 bars are exactly four
    quarters, no sixteenth appears anywhere, and 73 of 74 bars add up. That may
    be a correct reading of a march; this number cannot say, and the docstring
    it lives under must not imply otherwise.
    """
    four_bars_of_quarters = ("</measure><measure>".join([_FOUR_QUARTERS] * 4))
    homr(MUSICXML.format(notes=four_bars_of_quarters))

    score = HomrProvider().parse(b"<page>").score

    assert score.ocr_confidence == 1.0
    assert {n.duration for m in score.measures for n in m.notes} == {"quarter"}, (
        "this fixture is meant to be uniform — it is the point of the test"
    )


def test_the_shape_of_a_reading_is_logged_not_just_its_size(homr, caplog) -> None:
    """Totals hide the failure above; the duration mix does not.

    "74 measures, 267 notes" reads as a good page. "230 quarters, 20 eighths, no
    sixteenths" is the same reading with the question visible in it.
    """
    import logging

    homr(MUSICXML.format(notes=_FOUR_QUARTERS))
    with caplog.at_level(logging.INFO, logger="intempo.ocr"):
        HomrProvider().parse(b"<page>")

    said = " ".join(r.getMessage() for r in caplog.records)
    assert "quarter" in said, f"the durations were not reported: {said}"
    assert "'quarter': 4" in said or "quarter': 4" in said, said


# ---------------------------------------------------------------------------
# A reading where nothing adds up is not a reading
# ---------------------------------------------------------------------------

#: A bar of five quarters in 4/4, then a bar of one. Neither adds up.
#:
#: Long **first**, short second, and that ordering is the fixture doing work:
#: a short first measure is a pickup, which `validate_measures` forgives and
#: should. Written the other way round this page would score 0.5 and the test
#: would pass against a provider that refuses nothing.
_NOTHING_ADDS_UP = (
    "".join(
        f'<note><pitch><step>{step}</step><octave>3</octave></pitch>'
        f"<duration>2</duration><type>quarter</type></note>"
        for step in "DEFGA"
    )
    + '</measure><measure number="2">'
    + '<note><pitch><step>D</step><octave>3</octave></pitch>'
    + "<duration>2</duration><type>quarter</type></note>"
)


def test_a_page_where_no_bar_adds_up_is_refused(homr) -> None:
    """**Measured on `04_handwritten_clean`.** homr returns 8 measures and 17
    notes at confidence 0.00 with no clef, and that was stored and shown to a
    musician as their score.

    Every mechanism this project has for doubt was working and none of them
    applies: the caveat line names the bars that do not add up, and *all* of
    them do not; the confidence sentence says a reading might be wrong, and the
    true statement is that there was no reading. The verdict compares a
    recording against bar durations, and not one of this page's survived.
    """
    homr(MUSICXML.format(notes=_NOTHING_ADDS_UP))

    with pytest.raises(OCRProviderError) as caught:
        HomrProvider().parse(b"<page>")

    said = str(caught.value)
    assert "could be read as music" in said, said
    assert "2 bars" in said, f"the musician is not told how much was found: {said}"


def test_the_refusal_reaches_the_musician_as_words_about_the_page(homr) -> None:
    """A refusal nothing in `_FAILURE_REASONS` matches lands on *"a flatter,
    better-lit shot of the page usually fixes it"* — advice about a photograph,
    which for the fourth time here would blame the musician for something else.

    So the wording of the error and the needle that catches it are one fact,
    and this is the test that keeps them together.
    """
    from app.workers.transcription_runner import _why_it_failed

    homr(MUSICXML.format(notes=_NOTHING_ADDS_UP))

    with pytest.raises(OCRProviderError) as caught:
        HomrProvider().parse(b"<page>")

    said = _why_it_failed(str(caught.value))
    assert "could not be read" in said, said
    assert "better-lit" not in said, (
        f"a page that was found and could not be read was blamed on the "
        f"photograph: {said}"
    )


def test_a_page_where_some_bars_add_up_is_kept(homr) -> None:
    """The distinction the refusal turns on, and the more expensive mistake.

    A page read at 0.5 is worth having: the app names the bars that do not add
    up and `MeasureEditScreen` fixes them. Refusing it would throw away a
    usable scan over an imperfect one — and by then the photograph has already
    been taken, so the musician pays for that in a second trip to the stand.
    """
    homr(MUSICXML.format(notes=_ONE_GOOD_BAR_THEN_A_SHORT_ONE))

    score = HomrProvider().parse(b"<page>").score

    assert 0 < score.ocr_confidence < 1
    assert len(score.measures) == 2


def test_a_file_with_no_bars_in_it_is_refused_in_its_own_words(homr) -> None:
    """A `<part>` holding no measures parses cleanly and returns a score with
    nothing in it — `score_json_from_musicxml` raises only on XML it cannot
    read or a part it cannot find, and an empty part is neither.

    Refused separately from the bars-do-not-add-up case because the advice
    differs. Nothing was read here, so *"a flatter, better-lit shot"* is the
    right thing to say; on a page whose notation was found and misread it is
    the wrong thing, and it is what a musician hears when a needle is missing.
    """
    from app.workers.transcription_runner import _UNKNOWN_REASON, _why_it_failed

    homr(
        '<?xml version="1.0"?><score-partwise version="4.0"><part-list>'
        '<score-part id="P1"><part-name>Voice</part-name></score-part>'
        '</part-list><part id="P1"></part></score-partwise>'
    )

    with pytest.raises(OCRProviderError, match="no bars of music") as caught:
        HomrProvider().parse(b"<page>")

    assert _why_it_failed(str(caught.value)) == _UNKNOWN_REASON


#: A page written with no metre anywhere and no two bars the same length.
#:
#: `infer_beats_per_measure` needs three measures and 60% agreement, and gets
#: neither, so every bar comes back `unverifiable` — not *wrong*, **not shown
#: to add up**. It is the ordinary shape of a photograph of an inner page.
_NO_METRE_ANYWHERE = "".join(
    f'<measure number="{n}">'
    + "".join(
        f'<note><pitch><step>{step}</step><octave>3</octave></pitch>'
        f"<duration>2</duration><type>quarter</type></note>"
        for step in "DEFGA"[:n]
    )
    + "</measure>"
    for n in (1, 2, 3, 4, 5)
)

_UNMETERED_PAGE = (
    '<?xml version="1.0"?><score-partwise version="4.0"><part-list>'
    '<score-part id="P1"><part-name>Voice</part-name></score-part></part-list>'
    '<part id="P1">' + _NO_METRE_ANYWHERE + "</part></score-partwise>"
)


def test_a_page_whose_metre_is_unknown_is_kept(homr) -> None:
    """**The regression the refusal was one version away from causing.**

    `_confidence_from_arithmetic` scores an `unverifiable` bar zero, because a
    bar whose metre is unknown has not been *shown* to add up. Refusing on that
    number alone — which the first version of this did — throws away a
    correctly read inner page, which is the commonest page anyone photographs:
    no header, no metre, nothing to check the durations against.

    The durations are all still there. The timeline builds, the caveat line has
    nothing to complain about, and `MeasureEditScreen` works. Zero here means
    *not proven*, and refusing on it would read it as *disproven*.
    """
    homr(_UNMETERED_PAGE)

    score = HomrProvider().parse(b"<page>").score

    assert score.ocr_confidence == 0.0
    assert len(score.measures) == 5
    assert sum(len(m.notes) for m in score.measures) == 15


def test_a_page_that_is_mostly_holes_is_refused(homr) -> None:
    """**Measured on `04_handwritten_clean`:** seven measures, five of them
    empty, thirteen notes crowded into the other two, no clef and no metre.
    Not one bar was *wrong* — five of them held nothing at all — so a check
    that only asks whether the arithmetic works has nothing to say about it.

    An empty measure is a barline with nothing between it, which `validate.py`
    already calls "not a reading, a hole". A rest is a note here, with pitch
    `"rest"`, so the multi-bar rests in an orchestral part are music and are
    counted as music — this cannot be triggered by a quiet page.
    """
    from app.workers.transcription_runner import _UNKNOWN_REASON, _why_it_failed

    one_bar_and_two_holes = (
        _FOUR_QUARTERS
        + '</measure><measure number="2"></measure>'
        + '<measure number="3">'
    )
    homr(MUSICXML.format(notes=one_bar_and_two_holes))

    with pytest.raises(OCRProviderError) as caught:
        HomrProvider().parse(b"<page>")

    said = str(caught.value)
    assert "2 of the 3 bars" in said and "came out empty" in said, said

    reason = _why_it_failed(said)
    assert reason != _UNKNOWN_REASON, (
        f"a page whose barlines were found and whose notes were not was blamed "
        f"on the photograph: {reason}"
    )
    assert "blank" in reason, reason


def test_a_page_with_one_hole_in_it_is_kept(homr) -> None:
    """The other side of the same line. One smudged bar in a page of music is a
    page with a hole in it; the app names it and the editor fills it in.
    Refusing that would cost a scan that is almost entirely right."""
    two_bars_and_a_hole = (
        _FOUR_QUARTERS
        + '</measure><measure number="2">'
        + _FOUR_QUARTERS
        + '</measure><measure number="3">'
    )
    homr(MUSICXML.format(notes=two_bars_and_a_hole))

    score = HomrProvider().parse(b"<page>").score

    assert len(score.measures) == 3


def test_the_refusal_and_the_confidence_read_the_same_page_the_same_way(homr) -> None:
    """A pickup counts as a bar that read, in both places or in neither.

    `_confidence_from_arithmetic` counts `pickup` alongside `ok` — a short
    first measure is how a great deal of music is actually written, and
    `pickup_complement` is what catches the case where it was not. If the
    refusal did not count it too, the two would disagree about the same page:
    a scan reported at 0.5 confidence, refused outright. One of those numbers
    reaches the musician and the other decides whether anything does, so they
    have to be reading the same findings the same way.
    """
    a_pickup_then_a_long_bar = (
        '<note><pitch><step>D</step><octave>3</octave></pitch>'
        "<duration>2</duration><type>quarter</type></note>"
        + '</measure><measure number="2">'
        + "".join(
            f'<note><pitch><step>{step}</step><octave>3</octave></pitch>'
            f"<duration>2</duration><type>quarter</type></note>"
            for step in "DEFGA"
        )
    )
    homr(MUSICXML.format(notes=a_pickup_then_a_long_bar))

    score = HomrProvider().parse(b"<page>").score

    assert score.ocr_confidence == 0.5
