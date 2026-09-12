"""Measure numbers have to identify a bar.

Everything downstream keys off `measure_number`: `validate_measures` groups
broken ties and tuplet faults by it, `MeasureConcern` is how a screen points at
a bar, `MeasureEditScreen` is opened by it, and the verdict groups per-note
deltas by it. A number that repeats identifies none of them.
"""

from __future__ import annotations

from pathlib import Path

from app.services.ocr.musicxml import score_json_from_musicxml
from app.services.ocr.pipeline import numbering_gaps
from app.services.ocr.validate import validate_measures
from app.services.score_schema import Measure, Note, ScoreJson

_ATTRS = (
    "<attributes><divisions>4</divisions><key><fifths>0</fifths></key>"
    "<time><beats>4</beats><beat-type>4</beat-type></time>"
    "<clef><sign>F</sign><line>4</line></clef></attributes>"
)
_FOUR = (
    "<note><pitch><step>A</step><octave>3</octave></pitch>"
    "<duration>4</duration><type>quarter</type></note>"
) * 4


def _score(numbers: list[int | str]) -> ScoreJson:
    bars = "".join(
        f'<measure number="{n}">{_ATTRS if i == 0 else ""}{_FOUR}</measure>'
        for i, n in enumerate(numbers)
    )
    return score_json_from_musicxml(
        "<?xml version='1.0'?><score-partwise version='4.0'>"
        "<part-list><score-part id='P1'><part-name>B</part-name></score-part>"
        f"</part-list><part id='P1'>{bars}</part></score-partwise>"
    )


def test_a_repeated_number_is_renumbered() -> None:
    """**Real, and not hypothetical.** `oemer_phone_photo` reads back as
    `[1, 2, 3, 3, 3]`."""
    assert [m.measure_number for m in _score([1, 2, 3, 3, 3]).measures] == [
        1,
        2,
        3,
        4,
        5,
    ]


def test_the_bundled_oemer_reading_no_longer_repeats_a_number() -> None:
    fixture = (
        Path(__file__).resolve().parents[3]
        / "fixtures"
        / "musicxml"
        / "oemer_phone_photo.musicxml"
    )
    score = score_json_from_musicxml(fixture.read_text(encoding="utf-8"))
    numbers = [m.measure_number for m in score.measures]
    assert numbers == sorted(set(numbers))


def test_numbers_that_go_backwards_are_renumbered() -> None:
    assert [m.measure_number for m in _score([1, 2, 9, 3, 4]).measures] == [
        1,
        2,
        3,
        4,
        5,
    ]


def test_a_gap_is_left_alone() -> None:
    """**On purpose, and it is the whole reason this test is narrow.**

    1, 2, 3, 409 is a boxed rehearsal mark counted as a bar — the single most
    common failure this pipeline has, by `renumber`'s own account — and
    `numbering_gaps` is what catches it. Renumbering it away is exactly the
    signal `_expand_multiple_rests` shifts rather than renumbers to protect.
    """
    score = _score([1, 2, 3, 409])
    assert [m.measure_number for m in score.measures] == [1, 2, 3, 409]
    assert [(g.after, g.next) for g in numbering_gaps(score)] == [(3, 409)]


def test_a_part_that_starts_at_bar_forty_seven_keeps_its_numbers() -> None:
    """An imported file's numbering is usually the printed part's, and a bar
    labelled 47 should stay 47. `pipeline.renumber` is positional and always,
    which is right for a page read by a model and wrong for a stated file — so
    the rule here is the narrow one that serves both."""
    assert [m.measure_number for m in _score([47, 48, 49]).measures] == [47, 48, 49]


def test_the_musician_is_told_the_numbering_was_changed() -> None:
    score = _score([1, 2, 3, 3, 3])
    assert "do not run in order" in score.notes_to_human
    assert "numbered from 1" in score.notes_to_human


def test_nothing_is_said_when_nothing_was_changed() -> None:
    assert _score([1, 2, 3]).notes_to_human == ""


def test_the_renumbering_sentence_does_not_displace_the_others() -> None:
    """A page can lose notes *and* be misnumbered, and the dropped-note
    sentence names the bar — by its new number, since it is read off the
    measures after they are renumbered."""
    # A *triple* accidental. This used to be a double flat, which the pitch
    # grammar has since learned to spell — so the note is no longer dropped and
    # the sentence this test is about no longer appeared. The subject is the two
    # sentences coexisting, not which note it is that goes missing.
    unspellable = (
        "<note><pitch><step>E</step><alter>3</alter><octave>3</octave></pitch>"
        "<duration>4</duration><type>quarter</type></note>"
    )
    bars = (
        f'<measure number="1">{_ATTRS}{_FOUR}</measure>'
        f'<measure number="1">{_FOUR}</measure>'
        f'<measure number="1">{unspellable}{_FOUR}</measure>'
    )
    score = score_json_from_musicxml(
        "<?xml version='1.0'?><score-partwise version='4.0'>"
        "<part-list><score-part id='P1'><part-name>B</part-name></score-part>"
        f"</part-list><part id='P1'>{bars}</part></score-partwise>"
    )
    assert "do not run in order" in score.notes_to_human
    assert "could not be represented" in score.notes_to_human
    assert "in measure 3." in score.notes_to_human


def test_one_broken_tie_is_one_concern_not_three() -> None:
    """**What a repeated number actually cost.**

    `validate_measures` groups ties and tuplet faults by measure number, so a
    single tie between two pitches in one bar was reported on every bar sharing
    its number — two of them perfectly correct, each offering to open bar 3.
    """
    bars = [
        Measure(
            measure_number=n,
            notes=[
                Note(pitch="A3", duration="half", tied_to_next=(n == 1)),
                Note(pitch="C4" if n == 1 else "A3", duration="half"),
            ],
        )
        for n in (1, 2, 3)
    ]
    score = ScoreJson(
        measures=bars, time_signature="4/4", clef="bass", ocr_confidence=1.0
    )
    flagged = [f.measure_number for f in validate_measures(score) if f.is_problem]
    assert flagged == [1]
