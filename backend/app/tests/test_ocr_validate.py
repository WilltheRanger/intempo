"""Beat-sum validation: catching a transcription that contradicts itself.

The check is arithmetic, so these tests are mostly about the cases where the
arithmetic must *not* fire — a pickup measure, an unreadable time signature, a
score too short or too ambiguous to draw a conclusion from. A validator that
flags correct music is worse than none, because it trains people to dismiss it.
"""

from __future__ import annotations

import pytest

from app.services.ocr.validate import (
    MIN_AGREEMENT,
    describe_numbering,
    numbering_gaps,
    beats_per_measure,
    describe_for_retry,
    infer_beats_per_measure,
    problems,
    validate_measures,
)
from app.services.score_schema import ScoreJson


def _score(measures: list[list[str]], time_signature: str | None = "4/4") -> ScoreJson:
    """A score from durations alone — pitch is irrelevant to this check."""
    return ScoreJson.model_validate(
        {
            "time_signature": time_signature,
            "key_signature": "C major",
            "tempo_marking": None,
            "bpm_hint": None,
            "clef": "treble",
            "measures": [
                {
                    "measure_number": i + 1,
                    "notes": [
                        {"pitch": "A4", "duration": d, "tied_to_next": False}
                        for d in durations
                    ],
                    "slurs": [],
                }
                for i, durations in enumerate(measures)
            ],
            "repeats": [],
            "ocr_confidence": 0.9,
            "notes_to_human": "",
        }
    )


QUARTERS = ["quarter"] * 4


# --- the meter, stated --------------------------------------------------


@pytest.mark.parametrize(
    ("signature", "expected"),
    [
        ("4/4", 4.0),
        ("3/4", 3.0),
        ("2/4", 2.0),
        ("2/2", 4.0),
        # Quarter-note beats, not notated beats: `target_bpm` is always
        # quarter-notes-per-minute in `alignment.py`, so 6/8 is three of them.
        ("6/8", 3.0),
        ("unknown", None),
        (None, None),
        ("", None),
        ("nonsense", None),
        ("0/4", None),
    ],
)
def test_beats_per_measure(signature, expected) -> None:
    assert beats_per_measure(signature) == expected


def test_a_correct_score_produces_no_problems() -> None:
    assert problems(_score([QUARTERS, QUARTERS, QUARTERS])) == []


def test_a_short_measure_is_caught() -> None:
    found = problems(_score([QUARTERS, ["quarter"] * 3, QUARTERS]))
    assert [f.measure_number for f in found] == [2]
    assert found[0].verdict == "short"
    assert found[0].actual_beats == 3.0


def test_a_long_measure_is_caught() -> None:
    found = problems(_score([QUARTERS, ["quarter"] * 5]))
    assert [f.verdict for f in found] == ["long"]


def test_dotted_and_subdivided_durations_add_up() -> None:
    """Real music, not four quarters. 0.375 + friends must not drift."""
    measure = ["dotted_quarter", "eighth", "sixteenth", "sixteenth", "eighth", "quarter"]
    assert sum(1 for _ in measure)  # 1.5+.5+.25+.25+.5+1 = 4
    assert problems(_score([measure])) == []


# --- the cases where it must stay quiet ---------------------------------


def test_a_first_measure_may_be_a_pickup() -> None:
    """Short openings are how music is written, not how OCR fails."""
    findings = validate_measures(_score([["quarter"], QUARTERS, QUARTERS]))
    assert findings[0].verdict == "pickup"
    assert problems(_score([["quarter"], QUARTERS, QUARTERS])) == []


def test_a_short_measure_elsewhere_is_not_forgiven() -> None:
    """Only the first measure can be a pickup — the rest is a dropped note."""
    found = problems(_score([QUARTERS, QUARTERS, ["quarter"]]))
    assert [f.measure_number for f in found] == [3]


def test_an_unreadable_meter_with_too_little_music_is_unverifiable() -> None:
    """Two measures agreeing is a coincidence, not a majority."""
    findings = validate_measures(_score([QUARTERS, QUARTERS], time_signature="unknown"))
    assert {f.verdict for f in findings} == {"unverifiable"}


def test_an_empty_measure_is_reported_but_not_as_arithmetic() -> None:
    """The prompt tells the model to leave illegible measures empty."""
    findings = validate_measures(_score([QUARTERS, [], QUARTERS]))
    assert findings[1].verdict == "empty"
    assert findings[1].is_problem


# --- inferring the meter from the music ---------------------------------


def test_the_meter_is_inferred_when_the_header_is_unreadable() -> None:
    """The common case: a phone photo of an inner page has no header.

    Three of the five bundled fixtures come back `unknown`, so without this the
    check is switched off for most real scores.
    """
    findings = validate_measures(
        _score([["half"] * 1] * 5, time_signature="unknown")
    )
    assert all(f.meter_inferred for f in findings)
    assert all(f.expected_beats == 2.0 for f in findings)
    assert all(f.verdict == "ok" for f in findings)


def test_an_outlier_against_an_inferred_meter_is_caught() -> None:
    """The error that was invisible before: no header, one bad measure."""
    measures = [QUARTERS, QUARTERS, ["quarter"] * 3, QUARTERS, QUARTERS]
    found = problems(_score(measures, time_signature="unknown"))
    assert [f.measure_number for f in found] == [3]
    assert found[0].meter_inferred


def test_a_stated_meter_beats_an_inferred_one() -> None:
    """The header is a reading; the mode is a vote. Prefer the reading.

    Measures of 3 beats under a stated 4/4 are errors, not evidence of a meter
    nobody wrote down — otherwise a consistently mis-read score would vote
    itself correct, which is the one thing this check exists to prevent.

    Measure 1 is still exempt: a 4/4 piece opening with a one-beat anacrusis is
    ordinary music, and the pickup rule does not stop applying because the
    header was legible. So four bad measures produce three findings, and the
    first is a pickup.
    """
    findings = validate_measures(_score([["quarter"] * 3] * 4, time_signature="4/4"))
    assert findings[0].verdict == "pickup"
    assert [f.measure_number for f in findings if f.is_problem] == [2, 3, 4]
    assert not any(f.meter_inferred for f in findings)


@pytest.mark.parametrize(
    ("sums", "expected"),
    [
        ([2.0] * 8, 2.0),
        ([4.0, 4.0, 4.0, 3.0, 4.0, 4.0], 4.0),
        ([1.0, 4.0, 4.0, 4.0, 4.0], 4.0),  # a pickup does not derail it
        ([4.0, 3.0, 2.0, 5.0, 1.0, 6.0], None),  # no majority
        ([4.0, 4.0], None),  # too little music
        ([4.0, 4.0, 4.0, 3.0, 3.0, 3.0], None),  # a real 50/50 is not a meter
    ],
)
def test_infer_beats_per_measure(sums, expected) -> None:
    assert infer_beats_per_measure(sums) == expected


def test_agreement_below_the_threshold_infers_nothing() -> None:
    """Guards the constant itself, so lowering it is a deliberate act."""
    assert MIN_AGREEMENT > 0.5, "a plurality is not a majority"


# --- what the model is told ---------------------------------------------


def test_retry_text_names_the_measures_and_the_arithmetic() -> None:
    """A bare "try again" re-rolls the same dice."""
    findings = validate_measures(_score([QUARTERS, ["quarter"] * 3, QUARTERS]))
    text = describe_for_retry(findings)
    assert "measure 2" in text
    assert "3 beats" in text and "expected 4" in text
    assert "measure 1" not in text and "measure 3" not in text


def test_retry_text_offers_the_tuplet_escape() -> None:
    """A triplet cannot be written in this schema, so it cannot sum.

    Without somewhere to say that, the model is asked to fix a measure that is
    already as right as the schema allows, and will invent something worse.
    """
    findings = validate_measures(_score([QUARTERS, ["quarter"] * 3]))
    assert "tuplet" in describe_for_retry(findings).lower()


def test_a_clean_score_asks_for_no_retry() -> None:
    assert describe_for_retry(validate_measures(_score([QUARTERS] * 3))) == ""


# --- measure numbering -----------------------------------------------------
#
# From a real photograph: a boxed rehearsal mark reading 49 came back as
# measure 409, which inserted an empty measure and renumbered the whole line.
# The prompt now names that case; this is what catches it when the prompt is
# not enough.


def _numbered(numbers: list[int]) -> ScoreJson:
    score = _score([QUARTERS] * len(numbers))
    return ScoreJson.model_validate(
        {
            **score.model_dump(),
            "measures": [
                {**m.model_dump(), "measure_number": n}
                for m, n in zip(score.measures, numbers, strict=True)
            ],
        }
    )


def test_sequential_numbering_has_no_gaps() -> None:
    assert numbering_gaps(_numbered([1, 2, 3, 4])) == []


def test_a_jump_is_reported_with_how_many_are_missing() -> None:
    gaps = numbering_gaps(_numbered([409, 414, 415]))
    assert len(gaps) == 1
    assert gaps[0].missing == 4
    assert "409" in gaps[0].describe() and "414" in gaps[0].describe()


def test_several_jumps_are_all_reported() -> None:
    assert len(numbering_gaps(_numbered([1, 2, 7, 8, 20]))) == 2


def test_numbers_going_backwards_count_as_a_gap() -> None:
    """Not only skips — any non-consecutive step means the numbering is wrong."""
    assert numbering_gaps(_numbered([5, 4, 3])) != []


def test_a_score_that_starts_high_but_runs_on_is_fine() -> None:
    """The complaint is about jumps, not about where the numbering starts.

    A prompt asking for numbering from 1 does not make 409, 410, 411 evidence
    of a misread page — it makes it evidence of an ignored instruction, which
    is a different and much weaker signal.
    """
    assert numbering_gaps(_numbered([409, 410, 411])) == []


def test_the_numbering_complaint_names_the_fix() -> None:
    text = describe_numbering(numbering_gaps(_numbered([409, 414])))
    assert "sequentially from 1" in text
    assert "rehearsal" in text


def test_no_complaint_when_the_numbering_is_sound() -> None:
    assert describe_numbering(numbering_gaps(_numbered([1, 2, 3]))) == ""
