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
    # A run of eighths: ordinary music, and the only bar dense enough for the
    # density check to look at — every other bar is under `DENSITY_MIN_NOTES`.
    [
        ("D3", "eighth"), ("Eb3", "eighth"), ("F3", "eighth"), ("G3", "eighth"),
        ("A3", "eighth"), ("G3", "eighth"), ("F3", "eighth"), ("Eb3", "eighth"),
    ],
    [("G2", "quarter"), ("Bb2", "quarter")],
    # A whole rest alone in a 2/4 bar is one bar of rest, not four beats.
    [("rest", "half")],
    # Typed `breve` — eight quarter-beats — and timed at half of one.
    [("rest", "eighth"), ("D3", "dotted_quarter")],
    # A bar of cue notes: somebody else's line, printed so you know where to
    # come in. Time you do not play, so rests.
    [("rest", "quarter"), ("rest", "quarter")],
    # The entry, with the tail of the cue line still above it. Four cue eighths
    # in voice 2 against two played quarters in voice 1 — the cues used to win
    # the vote and both real notes were thrown away.
    [("G2", "quarter"), ("D3", "quarter")],
    # A repeated strain with first and second endings: read as 15, 16, 15, 17.
    [("D3", "quarter"), ("F3", "quarter")],
    [("G2", "half")],
    [("Bb2", "half")],
]


def test_the_whole_part_reads_as_written(part) -> None:
    assert [
        [(n.pitch, n.duration) for n in m.notes] for m in part.measures
    ] == EXPECTED


def test_every_bar_adds_up(part) -> None:
    """**The property that makes this fixture worth having.**

    Fourteen bars across two metres, with four of them invented by the
    multi-rest expansion and three more rewritten by rules that guess nothing.
    If any of those rules is wrong the arithmetic says so here, on one
    document, rather than in seven separate snippets each of which can be
    right alone.

    Two of the rules cannot be caught by arithmetic at all: a cue read as a
    played note, and a cue voice outvoting the line, both leave a bar summing
    to exactly the right number of beats. `EXPECTED` is what catches those,
    which is why this file asserts the whole reading rather than the verdicts.
    """
    verdicts = Counter(f.verdict for f in validate_measures(part))

    assert verdicts == {"ok": 17}, verdicts


def test_the_header_is_read_and_the_change_rides_on_its_bar(part) -> None:
    """The part is in 4/4 and changes to 2/4 partway. `meters_in_force` reads a
    change off the measure, so the metre must be stated exactly once and on the
    bar where it is printed — not repeated, and not on the header."""
    assert part.time_signature == "4/4"
    assert part.clef == "bass"
    assert part.key_signature == "Bb major"
    assert [m.time_signature for m in part.measures] == [
        None, None, None, None, None, None, None, None, None, "2/4",
        None, None, None, None, None, None, None,
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
    assert [m.measure_number for m in part.measures] == list(range(1, 18))


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
    assert metres[9] == "2/4", metres
    assert metres[17] == "4/4", metres
    assert [m for m in metres if m] == ["2/4", "4/4"], metres


def test_the_joined_part_still_adds_up_everywhere(both_pages) -> None:
    verdicts = Counter(f.verdict for f in validate_measures(both_pages))

    assert verdicts == {"ok": 21}, verdicts
    assert both_pages.ocr_confidence == 1.0


def test_the_second_page_s_rests_are_in_its_own_metre(both_pages) -> None:
    """A two-bar rest on page two is two bars of **4/4** — whole rests. Sized
    against the 2/4 left in force by page one they would be halves, and the
    page would run four beats short."""
    assert [
        (n.pitch, n.duration) for m in both_pages.measures[17:] for n in m.notes
    ] == [
        ("Eb3", "quarter"), ("D3", "quarter"), ("C3", "quarter"), ("Bb2", "quarter"),
        ("rest", "whole"), ("rest", "whole"),
        ("Bb2", "whole"),
    ]


# ---------------------------------------------------------------------------
# What the reading is for
# ---------------------------------------------------------------------------


def test_the_timeline_counts_the_rest_the_way_a_player_does(part) -> None:
    """**The payoff, asserted where it is actually collected.**

    Every rule in this file exists to make one number right: the moment
    `alignment.build_timeline` expects the next note. A reading can be checked
    bar by bar and still hand the verdict a timeline nobody could play to.

    Bars 1–2 are 4/4, eight beats. Bars 3–6 are the four-bar rest. So at 60 bpm
    the first note of bar 7 falls at **24.0 s**, and a musician who counts four
    bars and comes back in on time is judged against that.

    Before the expansion those four bars were **one measure with no notes in
    it**, contributing nothing at all — so the same note was expected at 8.0 s.
    Sixteen seconds early, and `alignment.py` accumulates, so every note after
    it was wrong by the same amount for the rest of the page.
    """
    from app.services import alignment

    onsets = [round(float(o), 3) for o in alignment.build_timeline(part, 60.0).onsets]

    assert onsets[:5] == [0.0, 1.0, 2.0, 3.0, 4.0]
    assert 8.0 not in onsets, (
        "a note is expected where the collapsed rest used to end — the four-bar "
        "rest is contributing nothing again"
    )
    assert onsets[5] == 24.0, onsets


def test_a_rest_advances_the_clock_without_asking_for_a_note(part) -> None:
    """A rest is a note in this schema, with pitch `"rest"`, and it must carry
    time without carrying an onset. Bar 12 is an eighth rest then a dotted
    quarter: the rest moves the clock half a beat and the note is expected
    there, not at the barline.

    Asserted by value rather than by `onsets[-1]`, which was only the last
    onset while bar 12 was the last bar carrying one — adding the two cue bars
    after it broke this test without anything about rests having changed.
    """
    from app.services import alignment

    onsets = [round(float(o), 3) for o in alignment.build_timeline(part, 60.0).onsets]

    assert 40.5 in onsets, onsets
    assert 40.0 not in onsets, (
        "the note is expected at the barline — the eighth rest before it is "
        "carrying no time"
    )


def test_a_tie_costs_the_timeline_an_onset(part) -> None:
    """Bar 2 is two tied halves — one sustained sound, so one attack. The
    timeline holds an onset for every pitched note *except* the second half of
    each tie, which is why a tie invented by a reader deletes a note the
    musician actually played.

    Counted over the **played** order rather than the written one. Bar 15 sits
    inside a repeat and is sounded twice, so the page holds fewer notes than
    the musician plays — which is the entire point of `expand_repeats`.
    Counting against `part.measures` was right only while repeats were a no-op,
    and it stopped being right the moment the importer started reading them.
    """
    from app.services import alignment

    onsets = alignment.build_timeline(part, 60.0).onsets
    played = alignment.expand_repeats(part)
    pitched = sum(1 for m in played for n in m.notes if n.pitch != "rest")
    written = sum(1 for m in part.measures for n in m.notes if n.pitch != "rest")

    assert len(onsets) == pitched - 1 == 34
    assert pitched == written + 2, (
        "the repeat is contributing nothing — the played order holds no more "
        "notes than the page does"
    )


def test_a_correct_part_is_flagged_for_nothing_at_all(part) -> None:
    """**Four checks, and a clean part must trip none of them.**

    Three of the four fire on measures whose beats add up *exactly* — a slur
    written as a tie, a tuplet bracket contradicting its ratio, a bar far
    denser than the page's median — and they exist because arithmetic cannot
    see any of that. The cost of one firing wrongly is not a wrong number on a
    screen: it is that the next caveat, on the page that really is misread, is
    the second one this musician has been shown and the first was noise.

    This part contains a tie and a run of triplets — the first document in this
    corpus that holds what two of these checks look for at all — and is
    correct. So the assertion is that it says **nothing**.

    Checked live rather than assumed: the same document with its tie altered to
    run `Bb2` into a `D3` reports `BrokenTie(measure_number=2, ...)`. The
    silence below is the check working, not the check missing.
    """
    from app.services.ocr.validate import (
        broken_ties,
        numbering_gaps,
        pickup_complement,
        tuplet_faults,
        validate_measures,
    )

    findings = validate_measures(part)

    assert broken_ties(part.measures) == []
    assert tuplet_faults(part.measures) == []
    assert numbering_gaps(part) == []
    assert pickup_complement(part) is None
    assert [f for f in findings if getattr(f, "dense", False)] == []
    assert [f for f in findings if f.is_problem] == []
    assert part.notes_to_human == ""


def test_the_joined_pages_are_flagged_for_nothing_either(both_pages) -> None:
    """The same, across the page break — where a spurious caveat is likeliest,
    because the join is the one place a measure's neighbours change."""
    from app.services.ocr.validate import (
        broken_ties,
        numbering_gaps,
        tuplet_faults,
        validate_measures,
    )

    assert broken_ties(both_pages.measures) == []
    assert tuplet_faults(both_pages.measures) == []
    assert numbering_gaps(both_pages) == []
    assert [f for f in validate_measures(both_pages) if f.is_problem] == []
