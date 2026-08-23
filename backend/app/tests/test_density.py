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
