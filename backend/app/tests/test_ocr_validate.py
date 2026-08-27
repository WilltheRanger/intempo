"""Beat-sum validation: catching a transcription that contradicts itself.

The check is arithmetic, so these tests are mostly about the cases where the
arithmetic must *not* fire — a pickup measure, an unreadable time signature, a
score too short or too ambiguous to draw a conclusion from. A validator that
flags correct music is worse than none, because it trains people to dismiss it.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.score_schema import Measure, Note, ScoreJson
from app.services.ocr.validate import (
    MIN_AGREEMENT,
    describe_numbering,
    describe_repeats,
    numbering_gaps,
    repeated_runs,
    beats_per_measure,
    describe_for_retry,
    infer_beats_per_measure,
    problems,
    validate_measures,
)


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
        # A clear winner among scattered singletons — the shape of a real
        # phone photograph, `audiveris_phone_photo`: eight bars at 4.0 and
        # seven different wrong answers. Under the old share-of-everything
        # test this was 8/15 = 0.53 and the beat check switched itself off
        # for the whole page, with nothing to say about the seven bad bars.
        ([4.0] * 8 + [9.5, 5.0, 4.5, 8.0, 3.0, 3.5, 6.0], 4.0),
        # And the floor that keeps: three agreeing bars in fifteen of noise is
        # decisive against any single rival and still means nothing.
        ([4.0] * 3 + [float(n) for n in range(5, 17)], None),
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


# --- repetition ------------------------------------------------------------
#
# The failure the beat-sum check cannot see. A model that loses its place on a
# dense page does not emit nonsense — it emits a plausible measure again. Every
# copy sums to the time signature, every constraint passes, and the confidence
# comes back high. Internally consistent and wrong.
#
# Observed: a five-staff cello part came back as nine measures, "every measure
# adds up", confidence 0.85, with a three-measure block repeated three times.


def _patterned(patterns: list[list[str]]) -> ScoreJson:
    return ScoreJson.model_validate(
        {
            "time_signature": "4/4", "key_signature": "C major", "tempo_marking": None,
            "bpm_hint": None, "clef": "bass", "repeats": [],
            "ocr_confidence": 0.9, "notes_to_human": "",
            "measures": [
                {
                    "measure_number": i + 1, "slurs": [],
                    "notes": [
                        {"pitch": p, "duration": "quarter", "tied_to_next": False}
                        for p in pattern
                    ],
                }
                for i, pattern in enumerate(patterns)
            ],
        }
    )


A = ["C3", "D3", "E3", "F3"]
B = ["G3", "A3", "B3", "C4"]
C = ["D4", "C4", "B3", "A3"]
D = ["E3", "F3", "G3", "A3"]


def test_a_repeated_block_is_found() -> None:
    runs = repeated_runs(_patterned([A, B, C, A, B, C, A, B, C]))
    assert len(runs) == 1
    assert runs[0].length == 3


def test_one_repetition_is_reported_once_not_once_per_offset() -> None:
    """ABC ABC otherwise reports 1→4, 2→5 and 3→6 — one thing said three times."""
    assert len(repeated_runs(_patterned([A, B, C, A, B, C]))) == 1


def test_distinct_music_is_not_flagged() -> None:
    assert repeated_runs(_patterned([A, B, C, D])) == []


def test_two_identical_measures_alone_are_not_evidence() -> None:
    """An ostinato is music. `min_length` is 2, so a single pair is below it."""
    assert repeated_runs(_patterned([A, A, B, C])) == []


def test_empty_measures_are_not_a_repetition() -> None:
    """They are already reported as empty; counting them here would flag every
    page with two unreadable bars."""
    assert repeated_runs(_patterned([[], [], A, B])) == []


def test_the_longest_block_wins() -> None:
    """A four-measure repeat contains a two-measure one; report the real shape."""
    runs = repeated_runs(_patterned([A, B, C, D, A, B, C, D]))
    assert len(runs) == 1 and runs[0].length == 4


def test_repetition_survives_a_beat_sum_check() -> None:
    """The point of the whole thing, stated as a test.

    Every measure here is four quarter notes in 4/4, so `problems` is empty and
    the transcription looks sound. It is not.
    """
    score = _patterned([A, B, C, A, B, C])
    assert problems(score) == []
    assert repeated_runs(score) != []


def test_the_complaint_offers_the_legitimate_explanation() -> None:
    text = describe_repeats(repeated_runs(_patterned([A, B, C, A, B, C])))
    assert "notes_to_human" in text
    assert "really does repeat" in text


def test_no_complaint_without_repetition() -> None:
    assert describe_repeats(repeated_runs(_patterned([A, B, C, D]))) == ""


class TestAMeterThatChanges:
    """A score carries one header time signature and the repertoire ignores that.

    The cost was not a missed check — it was four false ones. Four bars of 3/4
    after four of 4/4 had every 3/4 bar reported "short", on a page written
    correctly and read correctly, with a "Fix bar 5" control offered for each.
    Nothing teaches a musician to ignore a caveat faster than four wrong ones.

    The onset timeline never cared: it accumulates durations, so where the
    barlines fall does not move a note. This is entirely about the beat check
    and what the musician is told.
    """

    @staticmethod
    def _page(shape: list[tuple[int, str | None]]) -> ScoreJson:
        """`(beats, meter stated here or None)` per measure, all quarters."""
        return ScoreJson(
            clef="bass",
            time_signature="4/4",
            ocr_confidence=0.9,
            measures=[
                Measure(
                    measure_number=i + 1,
                    notes=[Note(pitch="E2", duration="quarter")] * beats,
                    time_signature=meter,
                )
                for i, (beats, meter) in enumerate(shape)
            ],
        )

    @staticmethod
    def _problems(score: ScoreJson) -> list[tuple[int, str]]:
        return [
            (f.measure_number, f.verdict)
            for f in validate_measures(score)
            if f.is_problem
        ]

    def test_a_change_that_is_reported_is_not_a_problem(self) -> None:
        page = self._page([(4, None), (4, None), (3, "3/4"), (3, None), (3, None)])
        assert self._problems(page) == []

    def test_a_change_that_is_not_reported_still_is(self) -> None:
        """The check has not been softened, only told where the barlines are."""
        page = self._page([(4, None), (4, None), (3, None), (3, None), (3, None)])
        assert self._problems(page) == [(3, "short"), (4, "short"), (5, "short")]

    def test_a_genuinely_short_bar_after_a_change_still_shows(self) -> None:
        page = self._page([(4, None), (3, "3/4"), (2, None), (3, None)])
        assert self._problems(page) == [(3, "short")]

    def test_the_meter_can_change_back(self) -> None:
        """How a borrowed bar of 3/4 inside a 4/4 piece is printed."""
        page = self._page([(4, None), (3, "3/4"), (4, "4/4"), (4, None)])
        assert self._problems(page) == []

    def test_a_compound_meter_is_counted_in_quarter_beats(self) -> None:
        """6/8 is three quarter-beats, not six — `target_bpm` is always
        quarter-notes-per-minute, and the two have to agree."""
        page = ScoreJson(
            clef="bass",
            time_signature="4/4",
            ocr_confidence=0.9,
            measures=[
                Measure(
                    measure_number=1,
                    notes=[Note(pitch="E2", duration="quarter")] * 4,
                ),
                Measure(
                    measure_number=2,
                    notes=[Note(pitch="E2", duration="dotted_half")],
                    time_signature="6/8",
                ),
            ],
        )
        assert self._problems(page) == []

    def test_an_illegible_change_makes_what_follows_unverifiable(self) -> None:
        """Worse than no change at all: something *did* happen and cannot be
        read, so continuing with the old meter would invent a check."""
        page = self._page([(4, None), (3, "unknown"), (5, None)])
        verdicts = {f.measure_number: f.verdict for f in validate_measures(page)}
        assert verdicts[2] == "unverifiable"
        assert verdicts[3] == "unverifiable"

    def test_a_score_with_no_changes_reads_exactly_as_before(self) -> None:
        page = self._page([(4, None), (4, None), (5, None)])
        assert self._problems(page) == [(3, "long")]


def test_the_prompt_says_where_a_mid_piece_time_signature_goes() -> None:
    from pathlib import Path

    prompt = (
        Path(__file__).resolve().parents[1] / "prompts" / "ocr_prompt.txt"
    ).read_text()
    assert "TIME SIGNATURE PRINTED MID-PIECE" in prompt


def test_the_pickup_complement_rule_is_not_wired_to_anything() -> None:
    """**And measuring why is the point of this test.**

    `pickup_complement` reads like a check a musician would see, and it is
    reachable only from tests — `_concerns_for` builds concerns out of
    `validate_measures` alone. Somebody will eventually notice it and wire it
    in, so what they need is the measurement that says not to.

    It fires whenever the opening and closing bars do not sum to one measure,
    **including when the closing bar is simply full** — which is the ordinary
    state of a photographed page, because a page break is not the end of a
    piece. Sound for a whole piece; unsound for a page; and which one a
    `ScoreJson` holds is not knowable from inside it.
    """
    import app.routers.scores as scores_module
    from app.services.ocr.validate import pickup_complement

    source = Path(scores_module.__file__).read_text()
    assert "pickup_complement" not in source, (
        "the pickup rule is now reachable from the router — see this test's "
        "docstring for the measurement that says it flags ordinary pages"
    )

    def bar(number: int, beats: int) -> Measure:
        return Measure(
            measure_number=number,
            notes=[Note(pitch="D3", duration="quarter") for _ in range(beats)],
        )

    def page(last_beats: int) -> ScoreJson:
        return ScoreJson(
            time_signature="4/4",
            clef="bass",
            ocr_confidence=1.0,
            measures=[bar(1, 1), bar(2, 4), bar(3, last_beats)],
        )

    # A page that really does close the anacrusis: silent, as it should be.
    assert pickup_complement(page(3)) is None

    # A page that ends on a complete bar — the ordinary case — is flagged, and
    # the piece simply carries on over the page break.
    assert pickup_complement(page(4)) is not None
