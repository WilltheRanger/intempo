"""Tuplet ratios: what the bracket says, checked against what is inside it.

The durations already carry the beats. The ratio adds the one fault the beat
sum cannot see — three `triplet_eighth`s written where the page brackets a 5:4
quintuplet sum to **exactly 1.0**, the bar adds up, and the reading is silently
wrong. Before this, the vision path had no ratio to check against at all: the
model emitted a duration name and nothing else.
"""

from __future__ import annotations

import pytest

from app.services.ocr.musicxml import score_json_from_musicxml
from app.services.ocr.validate import describe_for_retry, validate_measures
from app.services.score_schema import (
    DURATION_BEATS,
    Measure,
    Note,
    ScoreJson,
    Tuplet,
    tuplet_faults,
)


def _measure(durations: list[str], tuplets: list[Tuplet] | None = None) -> Measure:
    return Measure(
        measure_number=1,
        notes=[Note(pitch="E2", duration=d) for d in durations],
        slurs=[],
        tuplets=tuplets or [],
    )


def _score(measure: Measure) -> ScoreJson:
    return ScoreJson(
        time_signature="4/4", key_signature="C major", clef="bass",
        measures=[measure], ocr_confidence=0.9,
    )


TRIPLET_3_2 = Tuplet(start_note_index=0, end_note_index=2, actual_notes=3, normal_notes=2)


# --- the ratio agrees with the bracket -------------------------------------

def test_a_well_formed_triplet_group_is_clean() -> None:
    measure = _measure(["triplet_eighth"] * 3 + ["quarter"] * 3, [TRIPLET_3_2])
    assert tuplet_faults([measure]) == []
    assert validate_measures(_score(measure))[0].is_problem is False


def test_two_triplet_groups_are_two_brackets() -> None:
    """The grouping a per-note marking could not express: six consecutive
    triplet eighths are two groups of three, and a flat key on each note cannot
    say which."""
    measure = _measure(
        ["triplet_eighth"] * 6 + ["half"],
        [
            Tuplet(start_note_index=0, end_note_index=2, actual_notes=3, normal_notes=2),
            Tuplet(start_note_index=3, end_note_index=5, actual_notes=3, normal_notes=2),
        ],
    )
    assert tuplet_faults([measure]) == []


def test_an_incomplete_group_is_caught() -> None:
    """Two notes claiming three-in-the-time-of-two."""
    measure = _measure(
        ["triplet_eighth"] * 2 + ["quarter"] * 3,
        [Tuplet(start_note_index=0, end_note_index=1, actual_notes=3, normal_notes=2)],
    )
    (fault,) = tuplet_faults([measure])
    assert fault.reason == "count"
    assert "holds 2 notes, not 3" in fault.describe()


def test_a_group_running_past_the_measure_is_caught() -> None:
    measure = _measure(
        ["triplet_eighth"] * 3,
        [Tuplet(start_note_index=0, end_note_index=5, actual_notes=6, normal_notes=4)],
    )
    (fault,) = tuplet_faults([measure])
    assert fault.reason == "range"


def test_a_ratio_the_durations_cannot_express_is_reported() -> None:
    """The case the beat sum is blind to, stated as arithmetic.

    Five notes bracketed 5:4, approximated as three triplet eighths plus two
    more — the durations sum to a plausible number and nothing else in the
    system can tell. Only the printed ratio can.
    """
    measure = _measure(
        ["triplet_eighth"] * 3 + ["sixteenth"] * 2,
        [Tuplet(start_note_index=0, end_note_index=4, actual_notes=5, normal_notes=4)],
    )
    (fault,) = tuplet_faults([measure])
    assert fault.reason == "unwritable"
    assert "three in the time of two" in fault.describe()


def test_a_bracket_over_plain_durations_is_caught() -> None:
    """A 3:2 bracket whose notes were written as plain eighths — the durations
    are half a beat each instead of a third, so the bar runs long, but this says
    *why*."""
    measure = _measure(
        ["eighth"] * 3 + ["quarter"] * 2,
        [TRIPLET_3_2],
    )
    (fault,) = tuplet_faults([measure])
    assert fault.reason == "durations"
    assert "not triplet values" in fault.describe()


# --- flagging --------------------------------------------------------------

def test_a_quintuplet_flags_a_measure_whose_beats_are_perfect() -> None:
    """The whole reason the ratio is worth its output tokens."""
    measure = _measure(
        ["triplet_eighth"] * 3 + ["quarter"] * 3,
        [Tuplet(start_note_index=0, end_note_index=2, actual_notes=5, normal_notes=4)],
    )
    (finding,) = validate_measures(_score(measure))

    assert finding.actual_beats == pytest.approx(4.0), "the arithmetic really is fine"
    assert finding.verdict == "ok"
    assert finding.is_problem, "a clean beat sum must not hide a misread bracket"
    assert finding.tuplet_faults


def test_the_retry_prompt_asks_about_the_bracket() -> None:
    measure = _measure(
        ["triplet_eighth"] * 2 + ["quarter"] * 3,
        [Tuplet(start_note_index=0, end_note_index=1, actual_notes=3, normal_notes=2)],
    )
    note = describe_for_retry(validate_measures(_score(measure)))
    assert "Count the notes inside each bracket" in note
    assert "actual_notes" in note and "normal_notes" in note


# --- the beats themselves are unchanged ------------------------------------

def test_three_triplet_eighths_still_fill_one_beat() -> None:
    """The ratio is a check, not a source of durations."""
    assert sum(DURATION_BEATS["triplet_eighth"] for _ in range(3)) == pytest.approx(1.0)


# --- the file path states the same thing -----------------------------------

_XML = """<?xml version="1.0"?><score-partwise version="4.0"><part id="P1">
<measure number="1">
  <attributes><time><beats>4</beats><beat-type>4</beat-type></time>
    <clef><sign>F</sign><line>4</line></clef></attributes>
  {notes}
</measure></part></score-partwise>"""

_TRIPLET_NOTE = (
    "<note><pitch><step>E</step><octave>2</octave></pitch><type>eighth</type>"
    "<time-modification><actual-notes>3</actual-notes>"
    "<normal-notes>2</normal-notes></time-modification></note>"
)
_PLAIN_QUARTER = (
    "<note><pitch><step>E</step><octave>2</octave></pitch><type>quarter</type></note>"
)


def test_an_imported_file_states_its_brackets_too() -> None:
    """Both provenances describe a tuplet the same way, so the check does not
    behave differently depending on how the piece arrived."""
    score = score_json_from_musicxml(
        _XML.format(notes=_TRIPLET_NOTE * 3 + _PLAIN_QUARTER * 3)
    )
    (measure,) = score.measures
    assert [n.duration for n in measure.notes[:3]] == ["triplet_eighth"] * 3
    assert len(measure.tuplets) == 1
    assert (measure.tuplets[0].actual_notes, measure.tuplets[0].normal_notes) == (3, 2)
    assert (measure.tuplets[0].start_note_index, measure.tuplets[0].end_note_index) == (0, 2)
    assert tuplet_faults(score.measures) == []


def test_an_imported_file_with_two_brackets_gets_two_entries() -> None:
    score = score_json_from_musicxml(
        _XML.format(notes=_TRIPLET_NOTE * 3 + _PLAIN_QUARTER + _TRIPLET_NOTE * 3)
    )
    (measure,) = score.measures
    assert len(measure.tuplets) == 2, "one run of triplets, a plain note, then another"
    assert [(t.start_note_index, t.end_note_index) for t in measure.tuplets] == [(0, 2), (4, 6)]


def test_a_file_with_no_brackets_states_none() -> None:
    score = score_json_from_musicxml(_XML.format(notes=_PLAIN_QUARTER * 4))
    assert score.measures[0].tuplets == []
