"""Measures holding far more notes than the page around them.

`note_count` had been populated on `MeasureFinding` since the dataclass was
written and read by **nothing**, so a bar with nineteen notes that happened to
sum correctly was trusted in silence.

That silence is the point. The failure this guards is a model reading a
tremolo, a trill or a turn as a run of separate notes — one half note with a
mark over it becomes sixteen sixteenths, which sums to *exactly the same number
of beats*. The arithmetic check cannot see it. Nothing could.
"""

from __future__ import annotations

import pytest

from app.services.ocr.validate import (
    DENSITY_MIN_NOTES,
    DENSITY_MULTIPLE,
    describe_for_retry,
    validate_measures,
)
from app.services.score_schema import Measure, Note, ScoreJson


def _score(measures: list[list[str]], time_signature: str = "4/4") -> ScoreJson:
    return ScoreJson(
        time_signature=time_signature, key_signature="C major", clef="bass",
        measures=[
            Measure(
                measure_number=i + 1,
                notes=[Note(pitch="E2", duration=d) for d in durations],
                slurs=[],
            )
            for i, durations in enumerate(measures)
        ],
        ocr_confidence=0.9,
    )


QUARTERS = ["quarter"] * 4
SIXTEENTHS = ["sixteenth"] * 16


def test_a_tremolo_read_as_sixteen_notes_is_flagged() -> None:
    """The case the beat sum is blind to, stated as arithmetic: the dense bar
    sums to exactly 4.0, the same as every bar around it."""
    score = _score([QUARTERS, QUARTERS, SIXTEENTHS, QUARTERS])
    findings = validate_measures(score)

    dense = findings[2]
    assert dense.actual_beats == pytest.approx(4.0), "it really does add up"
    assert dense.verdict == "ok"
    assert dense.too_dense
    assert dense.is_problem

    assert [f.too_dense for f in findings] == [False, False, True, False]


def test_a_page_written_in_sixteenths_flags_nothing() -> None:
    """Relative to the page, not to an absolute idea of busy. Sixteenths are
    only remarkable next to quarters."""
    score = _score([SIXTEENTHS] * 4)
    assert not any(f.too_dense for f in validate_measures(score))


def test_thirty_seconds_on_a_page_of_sixteenths_are_unremarkable() -> None:
    score = _score([SIXTEENTHS, SIXTEENTHS, ["thirty_second"] * 32, SIXTEENTHS])
    assert not any(f.too_dense for f in validate_measures(score))


def test_thirty_seconds_on_a_page_of_quarters_are_not() -> None:
    score = _score([QUARTERS, QUARTERS, ["thirty_second"] * 32, QUARTERS])
    assert validate_measures(score)[2].too_dense


def test_a_small_multiple_of_a_sparse_page_is_not_dense() -> None:
    """Three times the median is meaningless when the median is one note. The
    floor is why a bar of four on a page of whole notes stays quiet."""
    score = _score([["whole"], ["whole"], QUARTERS, ["whole"]])
    findings = validate_measures(score)
    assert findings[2].note_count == 4 < DENSITY_MIN_NOTES
    assert not findings[2].too_dense


def test_the_floor_is_what_makes_that_true() -> None:
    """Same shape, past the floor: eight notes against a page of whole notes is
    both above the multiple and above the count floor."""
    score = _score([["whole"], ["whole"], ["half"] + ["thirty_second"] * 16, ["whole"]])
    finding = validate_measures(score)[2]
    assert finding.note_count >= DENSITY_MIN_NOTES
    assert finding.note_count / 4.0 > DENSITY_MULTIPLE * 0.25
    assert finding.too_dense


def test_density_needs_a_meter_to_judge_against() -> None:
    """With no time signature and nothing to infer from, there is no density to
    compare — and claiming one would be inventing the denominator."""
    score = _score([QUARTERS, SIXTEENTHS], time_signature="unknown")
    findings = validate_measures(score)
    assert all(f.verdict == "unverifiable" for f in findings) or not any(
        f.too_dense for f in findings
    )


def test_the_retry_prompt_names_the_ornament() -> None:
    score = _score([QUARTERS, QUARTERS, SIXTEENTHS, QUARTERS])
    note = describe_for_retry(validate_measures(score))
    assert "tremolo" in note and "trill" in note
    assert "measure 3" in note


# ---------------------------------------------------------------------------
# A bar of rest is not evidence about how dense the music is
# ---------------------------------------------------------------------------


def test_bars_of_rest_do_not_drag_the_median_down() -> None:
    """**Measured, and made worse by a fix made the same day.**

    The density is notes per beat, and a rest is a note in this schema — so a
    bar of rest contributes to a median that is supposed to say how many
    *notes* a bar of this page holds. It carries no evidence about that.

    On the two-page part fixture: 16 bars counted, 7 of them nothing but rests,
    median 0.50 and a limit of 1.50 — so an ordinary run of **eight eighths**,
    at 2.0 notes per beat, was flagged as three times the density of its own
    page. A musician would be told to look again at a bar of perfectly
    ordinary music.

    A bass part is mostly bars of rest, and `_expand_multiple_rests` turns one
    four-bar rest into four voting bars — so today's multi-rest fix multiplied
    this on precisely the repertoire it was written for.
    """
    from app.services.ocr.validate import validate_measures

    def bar(number: int, notes: list[Note]) -> Measure:
        return Measure(measure_number=number, notes=notes)

    quarters = [Note(pitch="D3", duration="quarter") for _ in range(4)]
    eighths = [Note(pitch="D3", duration="eighth") for _ in range(8)]
    rest = [Note(pitch="rest", duration="whole")]

    score = ScoreJson(
        time_signature="4/4",
        clef="bass",
        ocr_confidence=1.0,
        measures=(
            [bar(1, quarters), bar(2, quarters)]
            + [bar(n, list(rest)) for n in range(3, 11)]
            + [bar(11, eighths)]
        ),
    )

    flagged = [f.measure_number for f in validate_measures(score) if f.too_dense]

    assert flagged == [], (
        f"a run of eight eighths was called too dense because the page around "
        f"it is resting: {flagged}"
    )


def test_a_tremolo_read_as_a_run_is_still_caught_on_a_resting_page() -> None:
    """The other side, and the reason this is a narrowing rather than a
    removal. The check exists for a half note with a tremolo mark read as
    sixteen separate notes; that is four notes per beat against a limit of
    three, and it is still caught on a page full of rests."""
    from app.services.ocr.validate import validate_measures

    def bar(number: int, notes: list[Note]) -> Measure:
        return Measure(measure_number=number, notes=notes)

    quarters = [Note(pitch="D3", duration="quarter") for _ in range(4)]
    rest = [Note(pitch="rest", duration="whole")]
    tremolo = [Note(pitch="D3", duration="sixteenth") for _ in range(16)]

    score = ScoreJson(
        time_signature="4/4",
        clef="bass",
        ocr_confidence=1.0,
        measures=(
            [bar(1, quarters), bar(2, quarters)]
            + [bar(n, list(rest)) for n in range(3, 11)]
            + [bar(11, tremolo)]
        ),
    )

    flagged = [f.measure_number for f in validate_measures(score) if f.too_dense]

    assert flagged == [11], flagged


def test_a_bar_with_a_rest_in_it_still_votes() -> None:
    """**The narrowing is `all`, not `any`, and the difference lets a real
    fault through.**

    A bar of three quarters and a quarter rest is music, and it says what a bar
    of this page holds. Excluding every bar that merely *contains* a rest
    leaves only the densest bars voting — which raises the median, raises the
    limit with it, and makes the check quieter exactly where it should not be.

    Here: a page of ordinary bars each carrying one rest, and one bar of
    sixteen sixteenths, which is the tremolo-read-as-a-run this check exists
    for. Counting the mixed bars, the median is 1.0 and the limit 3.0, so four
    notes per beat is caught. Excluding them, the tremolo becomes the only
    voter, the median is its own 4.0, and it is compared against a limit of
    twelve — silence, on the one bar that is actually wrong.
    """
    from app.services.ocr.validate import validate_measures

    mixed = [
        Note(pitch="D3", duration="quarter"),
        Note(pitch="rest", duration="quarter"),
        Note(pitch="F3", duration="quarter"),
        Note(pitch="A3", duration="quarter"),
    ]
    tremolo = [Note(pitch="D3", duration="sixteenth") for _ in range(16)]

    score = ScoreJson(
        time_signature="4/4",
        clef="bass",
        ocr_confidence=1.0,
        measures=(
            [Measure(measure_number=n, notes=list(mixed)) for n in range(1, 7)]
            + [Measure(measure_number=7, notes=tremolo)]
        ),
    )

    flagged = [f.measure_number for f in validate_measures(score) if f.too_dense]

    assert flagged == [7], (
        f"the tremolo bar was not caught: {flagged}. If the bars carrying a "
        f"rest stopped voting, it became the only voter and was measured "
        f"against itself."
    )
