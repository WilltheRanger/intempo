"""The check that runs where no metre could be read.

A metre comes from the header, which is illegible on most phone photographs of
an inner page, and `infer_beats_per_measure` refuses to name one when the bars
do not agree — correctly, since a wrong metre flags every correct bar. The cost
was that a page whose bars *wildly* disagree got no complaint at all, which is
the page a reading is most likely to have got wrong.

Read `LENGTH_MULTIPLE` for the measurements.
"""

from __future__ import annotations

from app.services.ocr.validate import describe_for_retry, validate_measures
from app.services.score_schema import Measure, Note, ScoreJson

#: `oemer_phone_photo`'s five bars, in quarter-beats, rounded to values this
#: schema can write. The real page is the reason this check exists.
_OEMER_SHAPE = [43.0, 1.0, 1.5, 22.0, 11.5]


def _bar(number: int, beats: float) -> Measure:
    """A bar holding `beats` quarter-beats, however many notes that takes."""
    notes: list[Note] = []
    left = beats
    for name, value in (("whole", 4.0), ("quarter", 1.0), ("eighth", 0.5)):
        while left >= value - 1e-9:
            notes.append(Note(pitch="A3", duration=name))  # type: ignore[arg-type]
            left = round(left - value, 6)
    return Measure(measure_number=number, notes=notes)


def _score(lengths: list[float], time_signature: str | None = None) -> ScoreJson:
    return ScoreJson(
        measures=[_bar(i, b) for i, b in enumerate(lengths, start=1)],
        time_signature=time_signature,
        clef="bass",
        ocr_confidence=0.9,
    )


def test_a_page_whose_bars_disagree_is_no_longer_silent() -> None:
    """**Forty-three beats in a bar is not a reading of music.**

    Before this the page produced five `unverifiable` findings and one concern
    in total: no metre, so no beat check, so nothing said.
    """
    findings = validate_measures(_score(_OEMER_SHAPE))
    assert [f.verdict for f in findings] == ["unverifiable"] * 5
    adrift = [f.measure_number for f in findings if f.out_of_line]
    assert adrift == [1, 2, 3]


def test_the_bars_that_agree_are_left_alone() -> None:
    """It is deliberately coarse: three times the median either way. The two
    bars nearest the middle of that page are wrong too, and this cannot say so
    — it compares bars with one another and does not name a metre."""
    findings = validate_measures(_score(_OEMER_SHAPE))
    assert [f.out_of_line for f in findings][3:] == [False, False]


def test_it_says_nothing_where_a_metre_was_read() -> None:
    """`short` and `long` say the same thing against a real number instead of a
    median, and two checks answering one question is how they come to
    disagree."""
    findings = validate_measures(_score([40.0, 1.0, 4.0, 4.0], "4/4"))
    assert not any(f.out_of_line for f in findings)
    # A short bar is a pickup only in first position; bar 2 is just short.
    assert [f.verdict for f in findings] == ["long", "short", "ok", "ok"]


def test_it_says_nothing_where_the_metre_was_inferred() -> None:
    """A page that agrees with itself well enough to name a metre is checked
    against that metre, not against itself twice."""
    findings = validate_measures(_score([4.0, 4.0, 4.0, 4.0, 40.0]))
    assert not any(f.out_of_line for f in findings)
    assert findings[-1].verdict == "long"


def test_a_page_too_short_to_be_evidence_says_nothing() -> None:
    """Two bars have no median worth the name. The same threshold the metre
    vote uses, and the same question: are there enough bars for the page to be
    evidence about itself."""
    findings = validate_measures(_score([40.0, 1.0]))
    assert not any(f.out_of_line for f in findings)


def test_an_empty_bar_neither_votes_nor_is_flagged() -> None:
    """It has no length to compare, and `empty` already reports it."""
    score = _score([4.0, 4.0, 4.0, 40.0])
    score.measures.insert(1, Measure(measure_number=99, notes=[]))
    findings = validate_measures(score)
    empty = next(f for f in findings if f.measure_number == 99)
    assert empty.verdict == "empty"
    assert empty.out_of_line is False


def test_a_bar_of_rest_votes_on_length() -> None:
    """**Unlike the density median, where it deliberately does not.**

    Density asks how many *notes* a bar of this page holds, and a bar of rest
    carries no evidence about that. Length asks how long a bar is, and a bar of
    rest is exactly one bar long — which is the whole question. A bass part is
    mostly bars of rest; excluding them would leave the median describing the
    handful of bars that are not.

    Exhibited on a page that agrees with itself too poorly to name a metre —
    which is the only page this check runs on. Two bars of rest at twelve
    beats, two bars at two, one at twenty. Counting the rest bars puts the
    median at 12 and flags the two short bars; excluding them puts it at 2 and
    flags the long one instead. The choice is visible either way, so it is
    made here rather than left to whichever list happened to be in scope.
    """
    score = _score([12.0, 12.0, 2.0, 2.0, 20.0])
    for index in (0, 1):
        score.measures[index] = Measure(
            measure_number=index + 1,
            notes=[Note(pitch="rest", duration="whole") for _ in range(3)],
        )
    findings = validate_measures(score)
    assert all(f.verdict == "unverifiable" for f in findings), [
        f.verdict for f in findings
    ]
    assert [f.measure_number for f in findings if f.out_of_line] == [3, 4]


def test_it_reaches_the_musician_and_the_re_read() -> None:
    findings = validate_measures(_score(_OEMER_SHAPE))
    adrift = next(f for f in findings if f.out_of_line)
    assert adrift.is_problem is True
    assert adrift.worth_a_re_read is True
    assert "far out of step with the rest of the page" in adrift.describe()
    # The instruction has to match the fault: telling a model the durations do
    # not sum, when nothing knows what they should sum to, aims it wrongly.
    retry = describe_for_retry(findings)
    assert "time signature could not be read" in retry
