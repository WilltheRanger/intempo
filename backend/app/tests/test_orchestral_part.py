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


# ---------------------------------------------------------------------------
# The same part, across a page break
# ---------------------------------------------------------------------------

PAGE_TWO = FIXTURE.with_name("orchestral_part_page2.musicxml")


@pytest.fixture(scope="module")
def both_pages(part):
    from app.services.ocr.pages import join_pages

    return join_pages(
        [part, score_json_from_musicxml(PAGE_TWO.read_text(encoding="utf-8"))]
    )


def test_a_part_that_returns_to_its_first_metre_on_page_two(both_pages) -> None:
    """**The realistic form of a bug found with synthetic bars.**

    Page one is headed 4/4 and changes to 2/4 partway. Page two is back in 4/4
    and says so in its own header — what a part does when a section ends at a
    page break. `join_pages` compared that header against page one's *header*,
    found both 4/4, stamped nothing, and left the 2/4 in force across every bar
    of page two.

    Asserted here on two documents actually put through the importer, because
    the bug lives exactly at the seam between them: each page reads perfectly
    alone, and this is the third time this session a rule has been right alone
    and wrong beside its neighbour.
    """
    metres = [m.time_signature for m in both_pages.measures]

    # Page one's change, then page two restating what it is in.
    assert metres[8] == "2/4", metres
    assert metres[11] == "4/4", metres
    assert [m for m in metres if m] == ["2/4", "4/4"], metres


def test_the_joined_part_still_adds_up_everywhere(both_pages) -> None:
    verdicts = Counter(f.verdict for f in validate_measures(both_pages))

    assert verdicts == {"ok": 15}, verdicts
    assert both_pages.ocr_confidence == 1.0


def test_the_second_page_s_rests_are_in_its_own_metre(both_pages) -> None:
    """A two-bar rest on page two is two bars of **4/4** — whole rests. Sized
    against the 2/4 left in force by page one they would be halves, and the
    page would run four beats short."""
    assert [
        (n.pitch, n.duration) for m in both_pages.measures[11:] for n in m.notes
    ] == [
        ("Eb3", "quarter"), ("D3", "quarter"), ("C3", "quarter"), ("Bb2", "quarter"),
        ("rest", "whole"), ("rest", "whole"),
        ("Bb2", "whole"),
    ]
