"""The backend's half of `fixtures/practice/long_rests.json`.

`mobile/src/lib/notation/longRests.parity.test.ts` checks the app against the
same file. If they drift, nothing looks broken from either side: the app
shortens the score to play and count it, the backend judges the recording
against a score it shortened differently, and a musician who came in exactly
where the app counted them in is told they were bars early.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.long_rests import rule, shorten_long_rests
from app.services.score_schema import Measure, Note, ScoreJson

CONTRACT = (
    Path(__file__).resolve().parents[3] / "fixtures" / "practice" / "long_rests.json"
)
FIXTURE = json.loads(CONTRACT.read_text(encoding="utf-8"))


def _score(bars: list[list[str]]) -> ScoreJson:
    return ScoreJson(
        measures=[
            Measure(
                measure_number=index + 1,
                notes=[
                    Note(pitch="rest" if d == "rest" else "E2", duration="whole" if d == "rest" else d)  # type: ignore[arg-type]
                    for d in durations
                ],
            )
            for index, durations in enumerate(bars)
        ],
        time_signature="4/4",
        clef="bass",
        ocr_confidence=1.0,
    )


def _shape(score: ScoreJson) -> list[list[str]]:
    return [
        ["rest" if n.pitch == "rest" else n.duration for n in m.notes]
        for m in score.measures
    ]


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_the_backend_shortens_what_the_contract_says(case) -> None:
    result = shorten_long_rests(_score(case["in"]))

    assert _shape(result.score) == case["out"], case["name"]
    assert result.skipped_bars == case["skipped_bars"], case["name"]


def test_the_numbers_come_from_the_contract_not_from_here() -> None:
    """Written down once. Two copies of a threshold is two chances to disagree
    about how long a rest has to be before it is skipped."""
    assert rule().min_bars == FIXTURE["min_bars"]
    assert rule().kept_bars == FIXTURE["kept_bars"]


def test_a_score_with_nothing_to_skip_is_returned_unchanged() -> None:
    """Bit-identical, not merely equivalent — the common case does not get
    rebuilt on its way past."""
    score = _score([["quarter"], ["quarter"]])
    result = shorten_long_rests(score)

    assert result.score is score
    assert result.skipped_bars == 0


def test_the_bar_that_survives_keeps_its_number_and_its_metre() -> None:
    """The *first* of the run, so it carries the number a musician reads off
    the page and any metre change printed on it. Taking the last would silently
    move a metre change to a bar that was skipped."""
    score = _score([["quarter"], ["rest"], ["rest"], ["rest"], ["rest"], ["quarter"]])
    score.measures[1] = score.measures[1].model_copy(update={"time_signature": "3/4"})

    result = shorten_long_rests(score)

    assert [m.measure_number for m in result.score.measures] == [1, 2, 6]
    assert result.score.measures[1].time_signature == "3/4"


def test_the_bars_after_a_skip_keep_the_numbers_off_the_page() -> None:
    """A gap in the numbering is the truth about what was played, and the app
    names measures by these numbers when it reports on the take."""
    result = shorten_long_rests(
        _score([["quarter"], ["rest"], ["rest"], ["rest"], ["rest"], ["quarter"], ["quarter"]])
    )

    assert [m.measure_number for m in result.score.measures] == [1, 2, 6, 7]


# --------------------------------------------------------------------------
# The reason any of this exists
# --------------------------------------------------------------------------


def test_skipping_a_rest_the_timeline_still_holds_destroys_the_analysis() -> None:
    """**The measurement that forced the flag onto the wire.**

    An otherwise perfect take, played exactly on the grid, with the rest
    skipped. Every note still matches — the shape simply cannot be explained by
    a steady grid, so the verdict becomes `alignment_failed`, "check you're on
    the right piece", on a take that was played correctly.

    True of a two-bar rest as much as a twenty-bar one, which is why the rule
    is not "only skip the long ones and hope".
    """
    from app.services.alignment import align_take, apply_fuzzy_match, build_timeline

    bpm = 60.0
    score = _score(
        [["quarter"] * 4] + [["rest"]] * 4 + [["quarter"] * 4, ["quarter"] * 4]
    )
    timeline = build_timeline(score, bpm)
    waited = timeline.onsets + 1.0
    # The notes after the rest arrive four bars early, because they were.
    skipped = waited.copy()
    skipped[4:] -= 4 * 4.0 * (60.0 / bpm)

    def quality(detected):
        anchored = align_take(detected, timeline.onsets, target_bpm=bpm)
        apply_fuzzy_match(anchored.alignment, anchored.onsets, timeline.onsets)
        return anchored.alignment.quality

    assert quality(waited) == pytest.approx(1.0)
    assert quality(skipped) == pytest.approx(0.0)


def test_the_same_take_is_perfect_against_the_shortened_score() -> None:
    """And the fix: the worker shortens the score the same way the app did."""
    from app.services.alignment import align_take, build_timeline

    bpm = 60.0
    score = _score(
        [["quarter"] * 4] + [["rest"]] * 4 + [["quarter"] * 4, ["quarter"] * 4]
    )
    shortened = shorten_long_rests(score).score
    timeline = build_timeline(shortened, bpm)

    played = timeline.onsets + 1.0
    anchored = align_take(played, timeline.onsets, target_bpm=bpm)

    assert anchored.alignment.quality == pytest.approx(1.0)
