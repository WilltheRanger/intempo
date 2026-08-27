"""One document shaped like a real part, holding every shape this reader gets
wrong.

`CLAUDE.md` says nothing in this corpus resembles real repertoire, and it is
right: the five JPEGs are single cropped lines from exercise books and
`bass_excerpt.musicxml` is six notes of awkward cases. Every importer fix made
on 2026-08-26 was tested against a one-shape snippet written for it, and
passed. A part is not a snippet — the shapes arrive together, in one document,
with a metre that changes and a reader carrying state across all of it.

This asserts the **whole** reading rather than spot-checking, because that is
the point: any of the six rules regressing changes this list, and a test that
only looked at the bar it cared about would not notice the bar next to it
moving.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

from app.services.ocr.musicxml import score_json_from_musicxml
from app.services.ocr.validate import validate_measures

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "fixtures"
    / "musicxml"
    / "orchestral_part.musicxml"
)


@pytest.fixture(scope="module")
def part():
    return score_json_from_musicxml(FIXTURE.read_text(encoding="utf-8"))


#: What the file says, bar by bar, once every rule has had its turn.
EXPECTED = [
    [("Bb2", "quarter"), ("D3", "quarter"), ("F3", "quarter"), ("D3", "quarter")],
    [("Bb2", "half"), ("Bb2", "half")],
    # Four bars' rest, written as one measure and drawn with rest symbols.
    [("rest", "whole")],
    [("rest", "whole")],
    [("rest", "whole")],
    [("rest", "whole")],
    # The rest voice was written first; the music is what survives.
    [("D3", "quarter"), ("Eb3", "quarter"), ("F3", "quarter"), ("G3", "quarter")],
    # A triplet and a dot: type and duration disagree by design, and the
    # contradiction rule declines both.
    [
        ("F3", "triplet_eighth"),
        ("Eb3", "triplet_eighth"),
        ("D3", "triplet_eighth"),
        ("Bb2", "dotted_quarter"),
        ("D3", "eighth"),
        ("F3", "quarter"),
    ],
    [("G2", "quarter"), ("Bb2", "quarter")],
    # A whole rest alone in a 2/4 bar is one bar of rest, not four beats.
    [("rest", "half")],
    # Typed `breve` — eight quarter-beats — and timed at half of one.
    [("rest", "eighth"), ("D3", "dotted_quarter")],
]


def test_the_whole_part_reads_as_written(part) -> None:
    assert [
        [(n.pitch, n.duration) for n in m.notes] for m in part.measures
    ] == EXPECTED


def test_every_bar_adds_up(part) -> None:
    """**The property that makes this fixture worth having.**

    Eleven bars across two metres, with four of them invented by the
    multi-rest expansion and two more rewritten by rules that guess nothing.
    If any of those rules is wrong the arithmetic says so here, on one
    document, rather than in six separate snippets each of which can be right
    alone.
    """
    verdicts = Counter(f.verdict for f in validate_measures(part))

    assert verdicts == {"ok": 11}, verdicts


def test_the_header_is_read_and_the_change_rides_on_its_bar(part) -> None:
    """The part is in 4/4 and changes to 2/4 partway. `meters_in_force` reads a
    change off the measure, so the metre must be stated exactly once and on the
    bar where it is printed — not repeated, and not on the header."""
    assert part.time_signature == "4/4"
    assert part.clef == "bass"
    assert part.key_signature == "Bb major"
    assert [m.time_signature for m in part.measures] == [
        None, None, None, None, None, None, None, None, "2/4", None, None
    ]


def test_the_tie_survives(part) -> None:
    """A tie deletes an onset from the expected timeline, so it is one of the
    few things in a reading that changes what a musician is judged against."""
    assert part.measures[1].notes[0].tied_to_next is True
    assert part.measures[1].notes[1].tied_to_next is False


def test_nothing_was_dropped(part) -> None:
    """`notes_to_human` is written when the importer throws a note away. A part
    made of shapes this schema can hold should throw nothing away — and if a
    future change starts dropping one, this says so before the beat check
    quietly absorbs it."""
    assert part.notes_to_human == ""


def test_the_bars_are_numbered_as_a_player_would_count_them(part) -> None:
    """The file numbers four bars' rest as one bar, so everything after it is
    three too low until the expansion renumbers. `MeasureEditScreen` and every
    caveat line address a bar by its number."""
    assert [m.measure_number for m in part.measures] == list(range(1, 12))
