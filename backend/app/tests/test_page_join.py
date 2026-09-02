"""Several photographs of one part, joined into one piece of music.

Every rule here is in `pages.py` rather than in the worker, and tested here,
because a rule inside a worker is a rule that only runs when a real page is
read on a real host — which in this project has meant "a rule nothing checks".
"""

from __future__ import annotations

import pytest

from app.services.ocr.musicxml import score_json_from_musicxml
from app.services.ocr.pages import join_pages
from app.services.ocr.score_join_errors import NoPagesToJoin
from app.services.ocr.validate import validate_measures
from app.services.score_schema import (
    Measure,
    Note,
    Repeat,
    ScoreJson,
    TempoChange,
)


def _bar(number: int, beats: int, *, metre: str | None = None) -> Measure:
    return Measure(
        measure_number=number,
        notes=[
            Note(pitch="D3", duration="quarter") for _ in range(beats)
        ],
        time_signature=metre,
    )


def _page(
    bars: list[Measure],
    *,
    metre: str | None = "4/4",
    clef: str | None = "bass",
    confidence: float = 1.0,
    **rest,
) -> ScoreJson:
    return ScoreJson(
        time_signature=metre,
        clef=clef,
        measures=bars,
        ocr_confidence=confidence,
        **rest,
    )


# ---------------------------------------------------------------------------
# The common case must be untouched
# ---------------------------------------------------------------------------


def test_a_one_page_scan_comes_back_exactly_as_it_went_in() -> None:
    """Bit-identical, not merely equivalent.

    One page is what every scan was before this module existed and what most
    scans will keep being. Rebuilding it through the join would put this code
    in the path of the common case for no gain — and would renumber the
    measures of every single-page score already in the library.
    """
    only = _page([_bar(1, 4), _bar(2, 4)])

    assert join_pages([only]) is only


def test_no_pages_is_a_caller_bug_and_says_so() -> None:
    with pytest.raises(NoPagesToJoin):
        join_pages([])


# ---------------------------------------------------------------------------
# The timeline
# ---------------------------------------------------------------------------


def test_measures_are_renumbered_across_the_whole_part() -> None:
    """homr numbers each page from 1, so a three-page part would otherwise
    carry three measure 1s — and `MeasureEditScreen` addresses a bar by its
    number."""
    joined = join_pages(
        [
            _page([_bar(1, 4), _bar(2, 4)]),
            _page([_bar(1, 4), _bar(2, 4), _bar(3, 4)]),
        ]
    )

    assert [m.measure_number for m in joined.measures] == [1, 2, 3, 4, 5]


def test_a_repeat_and_a_tempo_change_move_with_their_measures() -> None:
    """Both name a measure by number, so both are wrong by a page's length if
    the measures are renumbered and they are not. A `rit.` that lands a page
    early tells a musician they dragged where the page says to slow down."""
    joined = join_pages(
        [
            _page([_bar(1, 4), _bar(2, 4)]),
            _page(
                [_bar(1, 4), _bar(2, 4)],
                repeats=[Repeat(start_measure=1, end_measure=2, type="repeat")],
                tempo_changes=[
                    TempoChange(measure_number=2, kind="ritardando", text="rit.")
                ],
            ),
        ]
    )

    assert [(r.start_measure, r.end_measure) for r in joined.repeats] == [(3, 4)]
    assert [c.measure_number for c in joined.tempo_changes] == [4]


# ---------------------------------------------------------------------------
# The metre across a page break
# ---------------------------------------------------------------------------


def test_a_page_in_a_different_metre_states_it_on_its_first_bar() -> None:
    """**The bug this module exists to avoid.**

    `musicxml.py` puts a page's metre in `score.time_signature` and leaves
    `Measure.time_signature` empty unless the metre changes *within* that page.
    So page 2 of a part in 3/4 states 3/4 in its own header and nowhere else —
    and joined naively under page 1's 4/4, every bar of it is checked against
    the wrong metre and the entire page reads as short.

    Stamping the change onto the first measure of the page is exactly what
    `meters_in_force` reads, and is how the printed page works: a metre holds
    until another one is printed.
    """
    joined = join_pages(
        [
            _page([_bar(1, 4), _bar(2, 4)], metre="4/4"),
            _page([_bar(1, 3), _bar(2, 3)], metre="3/4"),
        ]
    )

    assert joined.measures[2].time_signature == "3/4"
    assert [f.verdict for f in validate_measures(joined)] == ["ok"] * 4


def test_a_page_in_the_same_metre_states_nothing() -> None:
    """A metre reprinted on page 2 is the same fact printed twice, not a
    change. Writing it onto the measure would put a metre marking in the score
    where the page has none."""
    joined = join_pages(
        [
            _page([_bar(1, 4)], metre="4/4"),
            _page([_bar(1, 4)], metre="4/4"),
        ]
    )

    assert [m.time_signature for m in joined.measures] == [None, None]


@pytest.mark.parametrize("unread", [None, "unknown", "UNKNOWN"])
def test_a_page_whose_metre_was_not_read_does_not_cancel_the_one_in_force(
    unread: str | None,
) -> None:
    """A cropped header is the ordinary case for an inner page, and it means
    *not read* — not *changed*.

    **`"unknown"` is the half of this that a `None` check does not cover, and
    it is the dangerous half.** `meters_in_force` treats `"unknown"` on a
    measure as invalidating the metre in force — correctly, because a change
    that is printed and illegible is worse than no change. So writing a page's
    `"unknown"` header onto its first measure turns one cropped header into
    every later page losing its beat check, silently. Written with `None`
    alone this test passed against code that did exactly that, because `None`
    written onto a measure is indistinguishable from `None` left there.
    """
    joined = join_pages(
        [
            _page([_bar(1, 4)], metre="4/4"),
            _page([_bar(1, 4), _bar(2, 4)], metre=unread),
        ]
    )

    assert [m.time_signature for m in joined.measures] == [None, None, None]
    assert [f.verdict for f in validate_measures(joined)] == ["ok"] * 3


# ---------------------------------------------------------------------------
# The header
# ---------------------------------------------------------------------------


def test_the_clef_is_read_off_whichever_page_shows_one() -> None:
    """Never defaulted — the rule `ScoreJson.clef` has carried since it was
    made nullable. A part whose first page had its clef cut off but whose
    second page shows one is still being *read*, not guessed."""
    joined = join_pages(
        [_page([_bar(1, 4)], clef=None), _page([_bar(1, 4)], clef="bass")]
    )

    assert joined.clef == "bass"


def test_a_part_where_no_page_showed_a_clef_still_has_none() -> None:
    joined = join_pages(
        [_page([_bar(1, 4)], clef=None), _page([_bar(1, 4)], clef=None)]
    )

    assert joined.clef is None


def test_confidence_is_the_whole_parts_arithmetic_not_an_average() -> None:
    """Averaging the pages' own numbers weights a two-bar page the same as a
    forty-bar one. Recomputing asks the same question — what share of the bars
    add up — of the score that actually exists.

    Here: page 1 is four bars that add up, page 2 is one that does not. Five
    bars, four of them right.
    """
    joined = join_pages(
        [
            _page([_bar(n, 4) for n in range(1, 5)], confidence=1.0),
            _page([_bar(1, 3)], confidence=0.0),
        ]
    )

    assert joined.ocr_confidence == 0.8


def test_a_caveat_says_which_page_it_is_about() -> None:
    """The musician's next action is to re-photograph one page, and an
    unattributed caveat says which of three only by luck."""
    joined = join_pages(
        [
            _page([_bar(1, 4)]),
            _page([_bar(1, 4)], notes_to_human="2 note(s) were dropped."),
        ]
    )

    assert "Page 2:" in joined.notes_to_human


def test_a_page_that_returns_to_an_earlier_metre_states_it() -> None:
    """**Measured bug, and the third time this session a rule was right alone
    and wrong beside its neighbour.**

    The metre in force at a page break is the last one printed *anywhere* on
    the pages so far — not the header of the first. This tracked
    `readings[0].time_signature` and never moved, so a part headed 4/4 that
    changes to 2/4 partway down page one and returns to 4/4 on page two
    compared page two's "4/4" against page one's *header* "4/4", found them
    equal, and stamped nothing. The 2/4 stayed in force and every correctly
    read bar of page two came out `long` — confidence 1.00 → 0.67 on a reading
    with nothing wrong in it.

    Not an exotic shape: the one real photograph in this repository prints its
    only time signature mid-page, after a double barline.
    """
    page_one = _page(
        [_bar(1, 4), _bar(2, 4), _bar(3, 2, metre="2/4"), _bar(4, 2)], metre="4/4"
    )
    page_two = _page([_bar(1, 4), _bar(2, 4)], metre="4/4")

    joined = join_pages([page_one, page_two])

    assert [m.time_signature for m in joined.measures] == [
        None, None, "2/4", None, "4/4", None
    ]
    assert [f.verdict for f in validate_measures(joined)] == ["ok"] * 6
    assert joined.ocr_confidence == 1.0


def test_a_page_reprinting_the_metre_already_in_force_still_states_nothing() -> None:
    """The other branch, and the one the fix could have broken: page one ends
    in 2/4 because it changed there, and page two reprints 2/4 as its header.
    That is the same fact printed twice, not a change — and writing it onto the
    measure would put a metre marking in the score where the page has none."""
    page_one = _page([_bar(1, 4), _bar(2, 2, metre="2/4")], metre="4/4")
    page_two = _page([_bar(1, 2), _bar(2, 2)], metre="2/4")

    joined = join_pages([page_one, page_two])

    assert [m.time_signature for m in joined.measures] == [None, "2/4", None, None]
    assert [f.verdict for f in validate_measures(joined)] == ["ok"] * 4


# ---------------------------------------------------------------------------
# A repeat that spans the page break — known wrong, measured, unfixed
# ---------------------------------------------------------------------------


def _signed_page(bars: list[tuple[bool, bool]], *, first: bool = False) -> ScoreJson:
    """A page of 4/4 bars, each optionally carrying a forward/backward sign."""
    header = (
        "<attributes><divisions>1</divisions>"
        "<time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
    )
    note = (
        "<note><pitch><step>D</step><octave>3</octave></pitch>"
        "<duration>1</duration><type>quarter</type></note>"
    )
    forward = '<barline location="left"><repeat direction="forward"/></barline>'
    backward = '<barline location="right"><repeat direction="backward"/></barline>'
    body = ""
    for index, (opens, closes) in enumerate(bars, start=1):
        body += (
            f'<measure number="{index}">'
            + (header if first and index == 1 else "")
            + (forward if opens else "")
            + note * 4
            + (backward if closes else "")
            + "</measure>"
        )
    return score_json_from_musicxml(
        '<?xml version="1.0"?><score-partwise version="4.0"><part-list>'
        '<score-part id="P1"><part-name>Bass</part-name></score-part></part-list>'
        f'<part id="P1">{body}</part></score-partwise>'
    )


@pytest.mark.xfail(
    strict=True,
    reason=(
        "A repeat opening on one page and closing on another cannot be read. "
        "The importer sees each page alone, and `Repeat` has no way to say "
        "'a forward sign here, still open' — so page 1's sign is discarded and "
        "page 2's closing sign falls back to the start of its own page. "
        "Fixing it needs a field on a schema the app types against, which is "
        "the owner's call. Multi-page is inert behind the unapplied 011, so "
        "nothing reads this today."
    ),
)
def test_a_repeat_spanning_a_page_break_is_read_from_its_forward_sign() -> None:
    """**The convention is right for a piece and wrong for a page**, the same
    shape as `pickup_complement` and the metre join before it.

    Measured, on ten-bar pages:

    | shape | read | truth |
    |---|---|---|
    | forward p1 bar 5, backward p3 bar 4 | 4 bars repeated | 20 |
    | no forward at all, backward p2 bar 3 | 3 bars repeated | 13 |

    Extending such a span back to bar 1 of the part would be closer in both —
    but it is indistinguishable from a genuine forward sign printed at the top
    of a page, which happens at section boundaries, so it trades a known error
    for a guess. Left as an honest failure.
    """
    pages = [
        _signed_page([(index == 5, False) for index in range(1, 11)], first=True),
        _signed_page([(False, False) for _ in range(10)]),
        _signed_page([(False, index == 4) for index in range(1, 11)]),
    ]

    joined = join_pages(pages)

    assert [(r.start_measure, r.end_measure) for r in joined.repeats] == [(5, 24)]


# ---------------------------------------------------------------------------
# The key in force across a page break
# ---------------------------------------------------------------------------


def test_a_second_page_in_a_new_key_stamps_the_change_on_its_first_bar() -> None:
    """Page 2 of a part that turned to G major at the foot of page 1 prints one
    sharp in its own header and nowhere else. Joined naively under page 1's
    key, the whole of page 2 is engraved in the wrong signature."""
    joined = join_pages(
        [
            _page([_bar(1, 4), _bar(2, 4)], key_signature="Bb major"),
            _page([_bar(1, 4), _bar(2, 4)], key_signature="G major"),
        ]
    )

    assert joined.key_signature == "Bb major"
    assert [m.key_signature for m in joined.measures] == [None, None, "G major", None]


def test_a_second_page_restating_the_key_stamps_nothing() -> None:
    joined = join_pages(
        [
            _page([_bar(1, 4)], key_signature="D major"),
            _page([_bar(1, 4)], key_signature="D major"),
        ]
    )

    assert all(m.key_signature is None for m in joined.measures)


def test_the_same_signature_under_another_name_is_not_a_change() -> None:
    """B-flat major and G minor are the same two flats."""
    joined = join_pages(
        [
            _page([_bar(1, 4)], key_signature="Bb major"),
            _page([_bar(1, 4)], key_signature="G minor"),
        ]
    )

    assert all(m.key_signature is None for m in joined.measures)


def test_a_key_that_changed_mid_page_is_what_the_next_page_is_compared_to() -> None:
    """Page 1 opens in B-flat and turns to G at its bar 2; page 2's header says
    G. That is the key already in force, not a second change."""
    page_one = _page(
        [_bar(1, 4), Measure(measure_number=2, notes=_bar(2, 4).notes, key_signature="G major")],
        key_signature="Bb major",
    )
    joined = join_pages([page_one, _page([_bar(1, 4)], key_signature="G major")])

    assert [m.key_signature for m in joined.measures] == [None, "G major", None]


def test_an_unknown_key_on_an_inner_page_is_not_a_change() -> None:
    joined = join_pages(
        [
            _page([_bar(1, 4)], key_signature="D major"),
            _page([_bar(1, 4)], key_signature="unknown"),
        ]
    )

    assert all(m.key_signature is None for m in joined.measures)


def test_a_page_in_another_clef_is_stamped_at_the_break() -> None:
    """**The third of the same walk, and the one that moves the notes.**

    A part that climbs into tenor at the foot of page one prints a C clef in
    page two's own header and nowhere else. Without carrying it, the join
    records page two as continuing in bass — and `staveScoreFor` then places
    every note of it a sixth off. The metre version of this bug misreported bar
    lengths; this one draws the wrong pitches.
    """
    joined = join_pages(
        [
            _page([_bar(1, 4), _bar(2, 4)], clef="bass"),
            _page([_bar(1, 4), _bar(2, 4)], clef="tenor"),
        ]
    )

    assert joined.clef == "bass"
    assert [m.clef for m in joined.measures] == [None, None, "tenor", None]


def test_a_page_continuing_in_the_same_clef_stamps_nothing() -> None:
    """Every page of a bass part prints a bass clef in its own header. Stamping
    each one would put a clef change at the top of every page — a change to the
    clef already in force, which is the redundant-signature mistake one level
    up."""
    joined = join_pages(
        [
            _page([_bar(1, 4)], clef="bass"),
            _page([_bar(1, 4)], clef="bass"),
        ]
    )

    assert [m.clef for m in joined.measures] == [None, None]


def test_a_page_returning_to_the_opening_clef_is_still_stamped() -> None:
    """The trap the metre and the key both had: page three states bass, which
    equals the *header*, so a header comparison drops the return and leaves the
    rest of the part in tenor. Compared against what is in force."""
    joined = join_pages(
        [
            _page([_bar(1, 4)], clef="bass"),
            _page([_bar(1, 4)], clef="tenor"),
            _page([_bar(1, 4)], clef="bass"),
        ]
    )

    assert [m.clef for m in joined.measures] == [None, "tenor", "bass"]
