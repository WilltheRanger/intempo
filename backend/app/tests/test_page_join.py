"""Several photographs of one part, joined into one piece of music.

Every rule here is in `pages.py` rather than in the worker, and tested here,
because a rule inside a worker is a rule that only runs when a real page is
read on a real host — which in this project has meant "a rule nothing checks".
"""

from __future__ import annotations

import pytest

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
