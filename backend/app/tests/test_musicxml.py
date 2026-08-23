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


def test_clef_falls_back_when_absent() -> None:
    """`ScoreJson.clef` has no null. A missing clef must resolve to something,
    and the caller says to what rather than this file guessing treble."""
    xml = """<score-partwise><part id="P1"><measure number="1">
      <note><rest/><duration>4</duration><type>quarter</type></note>
    </measure></part></score-partwise>"""
    assert score_json_from_musicxml(xml, clef_fallback="bass").clef == "bass"
