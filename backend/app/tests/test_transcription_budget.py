"""The ceiling on how many times one page may be read.

Reading a page is a vision-model call per page, on somebody's bill. The
re-reading endpoint was guarded against two taps starting two workers and
against nothing else, and the free tier does not reach it: that quota counts
rows in `analyses`, and a re-read creates none. So the one endpoint in this API
that spends money on every call was the one with no ceiling on how often it
could be called.

The rules are here rather than in the route handler because the interesting
part is an off-by-one — the run about to start is not yet counted — and a rule
reachable only through HTTP is a rule tested once, at one call site, out of the
three that write the column.
"""

from __future__ import annotations

import pytest

from app.services.transcription_budget import (
    EXHAUSTED_MESSAGE,
    MAX_RUNS_PER_PAGE,
    has_room,
    next_run_count,
    runs_so_far,
)


def test_a_fresh_page_has_room() -> None:
    assert has_room({"transcription_runs": 0})


def test_the_last_allowed_reading_still_has_room() -> None:
    """The boundary in the direction that costs a musician something.

    At `MAX - 1` spent, one reading remains. Reading this as full would take
    away a reading the ceiling says is theirs, and nobody would ever see the
    difference except the person who wanted it.
    """
    assert has_room({"transcription_runs": MAX_RUNS_PER_PAGE - 1})


def test_the_ceiling_is_the_ceiling() -> None:
    assert not has_room({"transcription_runs": MAX_RUNS_PER_PAGE})


def test_a_count_past_the_ceiling_is_still_refused() -> None:
    """Not `== MAX`. Three call sites write this column and one of them resets
    it; a row that somehow reads higher is a row to refuse, not one to let
    through on a technicality."""
    assert not has_room({"transcription_runs": MAX_RUNS_PER_PAGE + 40})


def test_the_run_about_to_start_is_counted() -> None:
    assert next_run_count({"transcription_runs": 4}) == 5


def test_a_first_reading_counts_as_one() -> None:
    """`create_score` writes 1, not 0, for the same reason: leaving the first
    reading at the column's default would make the real ceiling one higher than
    the constant says."""
    assert next_run_count({"transcription_runs": 0}) == 1


@pytest.mark.parametrize(
    "value",
    [None, "3", 3.5, True, object()],
    ids=["missing", "string", "float", "bool", "junk"],
)
def test_a_column_that_did_not_answer_reads_as_zero(value: object) -> None:
    """**Guess low here, and that is the opposite of `tier_limits`.**

    The column is `NOT NULL DEFAULT 0` since migration 017, so a non-integer
    means a client stand-in that does not implement it — not an account that
    has run out. Guessing high would turn a missing column into a library
    nobody can re-read a page in. In `tier_limits` the same uncertainty is
    resolved the other way, because there guessing low hands out free
    analyses.

    `True` is in the list on purpose: `isinstance(True, int)` is True in
    Python, and a bool in this column is a client answering a different
    question.
    """
    assert runs_so_far({"transcription_runs": value}) == 0
    assert has_room({"transcription_runs": value})


def test_a_row_that_is_not_a_row_reads_as_zero() -> None:
    assert runs_so_far(None) == 0
    assert runs_so_far(["not", "a", "row"]) == 0


def test_a_negative_count_cannot_buy_extra_readings() -> None:
    """The column has a CHECK for this, and the CHECK is not the only reader."""
    assert runs_so_far({"transcription_runs": -5}) == 0
    assert next_run_count({"transcription_runs": -5}) == 1


def test_the_refusal_sends_the_musician_somewhere_they_can_go() -> None:
    """Twelve readings of one photograph have established that the photograph
    is the problem, so "try again" is the one thing it must not say. It is also
    not a quota — nothing here resets next month — so it must not read as
    one."""
    lowered = EXHAUSTED_MESSAGE.lower()
    assert "photograph" in lowered
    for wrong in ("try again", "quota", "limit", "upgrade", "next month", "plan"):
        assert wrong not in lowered, wrong
