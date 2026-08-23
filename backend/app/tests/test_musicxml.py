"""MusicXML → `ScoreJson`.

The fixture is hand-authored rather than captured from an engine run, because
what matters is the awkward cases — a chord, a grace note, a double accidental
— and no single photograph is guaranteed to contain them. See
`fixtures/musicxml/bass_excerpt.musicxml`.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.ocr.musicxml import MusicXMLError, score_json_from_musicxml
from app.services.ocr.validate import validate_measures

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "fixtures"
    / "musicxml"
    / "bass_excerpt.musicxml"
)


@pytest.fixture(scope="module")
def score():
    return score_json_from_musicxml(FIXTURE.read_text(encoding="utf-8"))


def test_reads_the_header(score) -> None:
    # F clef on line 4 is bass; on line 3 it would be baritone. Sign alone is
    # not enough, which is the reason the lookup is keyed on both.
    assert score.clef == "bass"
    assert score.time_signature == "4/4"
    assert score.key_signature == "Bb major"
    assert score.tempo_marking == "Poco meno"
    assert score.bpm_hint == 76


def test_accidentals_become_pitch_names(score) -> None:
    assert score.measures[0].notes[1].pitch == "Bb2"
    assert score.measures[1].notes[2].pitch == "F#3"


def test_rests_survive_as_rests(score) -> None:
    """`alignment.py` reads `pitch` in exactly one place, to ask this."""
    assert score.measures[0].notes[2].pitch == "rest"


def test_dot_is_folded_into_the_duration_name(score) -> None:
    assert score.measures[1].notes[0].duration == "dotted_quarter"


def test_tie_and_slur_are_kept(score) -> None:
    assert score.measures[1].notes[0].tied_to_next is True
    assert score.measures[0].slurs == [
        type(score.measures[0].slurs[0])(start_note_index=0, end_note_index=1)
    ]


def test_articulation_is_kept(score) -> None:
    assert score.measures[0].notes[1].articulation == "staccato"


def test_chord_members_are_not_counted(score) -> None:
    """A chord shares one onset.

    Counting the second notehead would push the measure over the metre, and the
    beat-sum check would then report a correctly-read measure as long — sending
    a repair pass at the one measure that did not need one.
    """
    assert [n.pitch for n in score.measures[1].notes] == ["D3", "D3", "F#3"]


def test_grace_notes_are_not_counted(score) -> None:
    """Same reasoning: a grace note carries no duration of its own."""
    assert all(n.pitch != "E3" for n in score.measures[1].notes)


def test_first_measure_sums_to_the_metre(score) -> None:
    rows = validate_measures(score)
    assert rows[0].verdict == "ok"


def test_an_unrepresentable_note_is_dropped_and_declared(score) -> None:
    """E-double-flat has no name in the pitch grammar.

    Writing "Eb3" instead would be a wrong note that reads as a confident one.
    Dropping it leaves the measure short, which the beat-sum check can see, and
    the count is reported rather than buried.
    """
    assert "1 note(s)" in score.notes_to_human
    assert score.ocr_confidence == pytest.approx(6 / 7, abs=1e-3)
    rows = validate_measures(score)
    assert rows[1].verdict == "short"


def test_namespaced_document_is_read() -> None:
    """A compressed .mxl unpacked by some tools carries a namespace.

    Without stripping it every `find()` returns None and the result is an empty
    score rather than an error — the worst failure available to a transcription.
    """
    xml = FIXTURE.read_text(encoding="utf-8").replace(
        "<score-partwise version=\"4.0\">",
        '<score-partwise xmlns="http://www.musicxml.org/ns" version="4.0">',
    )
    assert score_json_from_musicxml(xml).measures


def test_a_document_with_no_part_is_refused() -> None:
    with pytest.raises(MusicXMLError):
        score_json_from_musicxml("<score-partwise/>")


def test_unparseable_input_is_refused() -> None:
    with pytest.raises(MusicXMLError):
        score_json_from_musicxml("not xml at all")


# --- real engine output ------------------------------------------------------

REAL = (
    Path(__file__).resolve().parents[3]
    / "fixtures"
    / "musicxml"
    / "oemer_phone_photo.musicxml"
)


@pytest.fixture(scope="module")
def oemer_score():
    """What oemer actually produced from a phone photo of a cello part.

    Kept because the hand-authored fixture above is *tidy* — it exercises the
    awkward constructs but every one of them is well-formed. A real engine on a
    real photograph produces something else entirely, and the converter has to
    survive it rather than raise.
    """
    return score_json_from_musicxml(REAL.read_text(encoding="utf-8"), clef_fallback="bass")


def test_real_engine_output_converts_without_raising(oemer_score) -> None:
    assert oemer_score.measures


def test_the_validator_catches_that_this_reading_is_wrong(oemer_score) -> None:
    """The point of the beat-sum check, on a real failure.

    The page is five systems of common-time cello music in bass clef with two
    flats. oemer read it as five measures of C major in treble clef, one of them
    holding forty-three beats — it found no barlines at all, so each system
    became one measure. Nothing here compares against the page; the reading
    contradicts itself, and that is enough to reject it.
    """
    beats = [
        sum(_DURATION_BEATS[n.duration] for n in m.notes) for m in oemer_score.measures
    ]
    assert max(beats) > 16, "a measure holding four bars' worth is the tell"
    assert len(oemer_score.measures) < 10, "five systems collapsed into five measures"


_DURATION_BEATS = {
    "whole": 4.0, "dotted_whole": 6.0, "half": 2.0, "dotted_half": 3.0,
    "quarter": 1.0, "dotted_quarter": 1.5, "eighth": 0.5, "dotted_eighth": 0.75,
    "sixteenth": 0.25, "dotted_sixteenth": 0.375, "thirty_second": 0.125,
}


def test_duplicate_measure_numbers_survive_conversion(oemer_score) -> None:
    """oemer emitted `number="3"` three times.

    `Measure.measure_number` does not have to be unique and nothing downstream
    assumes it is — `validate.py` reports by position. Worth a test because the
    obvious "fix" is to renumber, which would hide exactly the damage that
    tells you the reading is broken.
    """
    numbers = [m.measure_number for m in oemer_score.measures]
    assert len(numbers) != len(set(numbers))


AUDIVERIS = (
    Path(__file__).resolve().parents[3]
    / "fixtures"
    / "musicxml"
    / "audiveris_phone_photo.musicxml"
)


@pytest.fixture(scope="module")
def audiveris_score():
    """The same photograph, read by Audiveris 5.4 instead of oemer."""
    return score_json_from_musicxml(
        AUDIVERIS.read_text(encoding="utf-8"), clef_fallback="treble"
    )


def test_audiveris_reads_the_header_correctly(audiveris_score) -> None:
    """Both engines were given the same photograph of the same page.

    oemer said treble clef and C major; Audiveris says bass clef and B-flat
    major, which is what is printed. Kept as a test because it is the only
    direct comparison in the repository between two OMR engines on real input,
    and it is the evidence behind preferring one of them.
    """
    assert audiveris_score.clef == "bass"
    assert audiveris_score.key_signature == "Bb major"


def test_audiveris_finds_barlines_where_oemer_found_none(
    audiveris_score, oemer_score
) -> None:
    """The difference that matters for this product.

    InTempo reports rushing and dragging *per measure*, so measure boundaries
    are not a nicety — without them there is nothing to report against. oemer
    returned one measure per system; Audiveris returned fifteen.
    """
    assert len(audiveris_score.measures) > 2 * len(oemer_score.measures)


def test_audiveris_measures_mostly_add_up(audiveris_score) -> None:
    """Not all of them, and the ones that do not are the honest finding.

    Eight of fifteen sum to exactly four beats. The rest run long, which is what
    a missed barline looks like from here — two bars merged into one. No time
    signature was found, so `validate.py` cannot infer a metre (the modal beat
    count is 4.0 but only in 6 of 15 measures, under the 0.6 agreement floor)
    and correctly reports every measure as unverifiable rather than guessing.
    """
    sums = [
        sum(_DURATION_BEATS[n.duration] for n in m.notes)
        for m in audiveris_score.measures
    ]
    assert sum(1 for value in sums if value == 4.0) >= 6
    assert audiveris_score.time_signature is None
    assert all(row.verdict == "unverifiable" for row in validate_measures(audiveris_score))


def test_clef_falls_back_when_absent() -> None:
    """`ScoreJson.clef` has no null. A missing clef must resolve to something,
    and the caller says to what rather than this file guessing treble."""
    xml = """<score-partwise><part id="P1"><measure number="1">
      <note><rest/><duration>4</duration><type>quarter</type></note>
    </measure></part></score-partwise>"""
    assert score_json_from_musicxml(xml, clef_fallback="bass").clef == "bass"
