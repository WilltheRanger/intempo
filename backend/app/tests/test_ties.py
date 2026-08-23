"""Ties, and the onset a bad one used to delete.

`tied_to_next` was a bare bool that nothing validated and one thing consumed:
`build_timeline` absorbed the next note into the previous onset. So a tie the
model invented **removed an onset the musician actually played**, and every
note after it aligned against the wrong one — the same damage a wrong duration
does, with no arithmetic guard anywhere.

A tie is one sustained sound written across two noteheads, so the two noteheads
are the same pitch by definition. A curve joining two *different* pitches is a
slur: same shape on the page, different meaning, and exactly the pair a vision
model confuses. The discriminator was sitting unused in the data.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.alignment import build_timeline
from app.services.ocr.validate import describe_for_retry, validate_measures
from app.services.score_schema import Measure, Note, ScoreJson, broken_ties, read_ties


def _score(measures: list[list[Note]], time_signature: str | None = "4/4") -> ScoreJson:
    return ScoreJson(
        time_signature=time_signature,
        key_signature="C major",
        clef="bass",
        measures=[
            Measure(measure_number=i + 1, notes=notes, slurs=[])
            for i, notes in enumerate(measures)
        ],
        ocr_confidence=0.9,
    )


def _n(pitch: str, duration: str = "quarter", tied: bool = False) -> Note:
    return Note(pitch=pitch, duration=duration, tied_to_next=tied)


# --- reading ---------------------------------------------------------------

def test_a_tie_between_the_same_pitch_is_real() -> None:
    ties = read_ties(_score([[_n("E2", tied=True), _n("E2"), _n("E2"), _n("E2")]]).measures)
    assert ties.absorbed == (False, True, False, False)
    assert not any(ties.broken)


def test_a_tie_between_different_pitches_is_not() -> None:
    score = _score([[_n("E2", tied=True), _n("G2"), _n("E2"), _n("E2")]])
    ties = read_ties(score.measures)
    assert not any(ties.absorbed), "a slur must not swallow an onset"
    assert ties.broken == (False, True, False, False)

    (tie,) = broken_ties(score.measures)
    assert (tie.measure_number, tie.pitch, tie.next_pitch) == (1, "E2", "G2")


def test_a_tie_across_the_barline_is_read() -> None:
    """The commonest use of a tie, and the reason this cannot be decided one
    measure at a time."""
    score = _score([
        [_n("E2"), _n("E2"), _n("E2"), _n("E2", tied=True)],
        [_n("E2"), _n("E2"), _n("E2"), _n("E2")],
    ])
    ties = read_ties(score.measures)
    assert ties.absorbed[4] is True, "the tie did not reach across the barline"
    assert broken_ties(score.measures) == []


def test_a_tie_across_the_barline_into_a_different_pitch_is_caught() -> None:
    score = _score([
        [_n("E2"), _n("E2"), _n("E2"), _n("E2", tied=True)],
        [_n("A2"), _n("E2"), _n("E2"), _n("E2")],
    ])
    (tie,) = broken_ties(score.measures)
    assert (tie.measure_number, tie.pitch, tie.next_pitch) == (1, "E2", "A2")


def test_a_rest_cannot_be_tied() -> None:
    score = _score([[_n("rest", tied=True), _n("E2"), _n("E2"), _n("E2")]])
    assert broken_ties(score.measures) == []
    assert not any(read_ties(score.measures).absorbed)


def test_a_tie_into_a_rest_is_reported() -> None:
    score = _score([[_n("E2", tied=True), _n("rest"), _n("E2"), _n("E2")]])
    (tie,) = broken_ties(score.measures)
    assert tie.next_pitch == "rest"


def test_a_tie_on_the_last_note_has_nothing_to_hold() -> None:
    """Changes no onset, but it is still evidence the page was misread."""
    score = _score([[_n("E2"), _n("E2"), _n("E2"), _n("E2", tied=True)]])
    (tie,) = broken_ties(score.measures)
    assert tie.next_pitch is None
    assert "isn't there" in tie.describe()


# --- what it costs the timeline -------------------------------------------

def test_a_bad_tie_no_longer_deletes_an_onset() -> None:
    """The bug, stated as arithmetic.

    Four written notes must produce four onsets. A tie to a different pitch
    used to produce three, so the third note was measured against the fourth
    note's written time and everything after it was wrong by a beat.
    """
    good = _score([[_n("E2"), _n("E2"), _n("E2"), _n("E2")]])
    slurred = _score([[_n("E2", tied=True), _n("G2"), _n("E2"), _n("E2")]])
    real_tie = _score([[_n("E2", tied=True), _n("E2"), _n("E2"), _n("E2")]])

    assert len(build_timeline(good, 60.0).notes) == 4
    assert len(build_timeline(slurred, 60.0).notes) == 4, "a slur ate an onset"
    assert len(build_timeline(real_tie, 60.0).notes) == 3, "a real tie is one sound"

    # And the surviving onsets sit where the notes are written.
    assert np.allclose(build_timeline(slurred, 60.0).onsets, [0.0, 1.0, 2.0, 3.0])


def test_a_note_after_a_bad_tie_is_not_timed() -> None:
    """It keeps its onset — that is what makes the timeline right — but whether
    the bow was re-attacked there is precisely what is in doubt, and timing a
    note that may have no attack is how phantom "dragging" gets reported."""
    slurred = _score([[_n("E2", tied=True), _n("G2"), _n("E2"), _n("E2")]])
    flags = [n.is_slur_interior for n in build_timeline(slurred, 60.0).notes]
    assert flags == [False, True, False, False]


def test_a_real_tie_leaves_the_timing_flags_alone() -> None:
    real_tie = _score([[_n("E2", tied=True), _n("E2"), _n("E2"), _n("E2")]])
    assert not any(n.is_slur_interior for n in build_timeline(real_tie, 60.0).notes)


# --- flagging --------------------------------------------------------------

def test_a_broken_tie_flags_the_measure_even_when_the_beats_add_up() -> None:
    """The two faults are independent, which is why the tie is not a `verdict`
    value: these four quarters sum to exactly 4.0 and the measure is still
    wrong."""
    score = _score([[_n("E2", tied=True), _n("G2"), _n("E2"), _n("E2")]])
    (finding,) = validate_measures(score)

    assert finding.verdict == "ok", "the arithmetic really is fine"
    assert finding.actual_beats == pytest.approx(4.0)
    assert finding.is_problem, "a clean beat sum must not hide a broken tie"
    assert finding.broken_ties


def test_a_clean_score_flags_nothing() -> None:
    score = _score([[_n("E2", tied=True), _n("E2"), _n("E2"), _n("E2")]])
    (finding,) = validate_measures(score)
    assert finding.is_problem is False
    assert finding.broken_ties == ()


def test_the_retry_prompt_says_slur_not_durations() -> None:
    """Telling the model its durations do not sum, when what is wrong is a tie
    between two pitches, aims the re-read at the wrong thing."""
    score = _score([[_n("E2", tied=True), _n("G2"), _n("E2"), _n("E2")]])
    note = describe_for_retry(validate_measures(score))

    assert "slur, not a" in note
    assert "tied_to_next false" in note
    assert "Correct the durations" not in note, "nothing is wrong with the durations"
    assert "E2 is tied to G2" in note
