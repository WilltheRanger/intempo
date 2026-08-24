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
        main.ProcessingConfig = type("ProcessingConfig", (), {})
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
