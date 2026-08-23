"""The one beat table, and the invariants that keep it one table.

Four separate copies of "how many beats is a dotted quarter" existed across
this repo: `score_schema`, `alignment`, `ocr/validate`, and the JavaScript in
two browser tools. Each carried a comment saying it was deliberately the same
as the others. When triplet durations were added, three of the four were
missed, and the failure was silent in the worst possible way — `validate.py`
defaulted an unrecognised duration to **zero beats** and reported correct bars
as short, while `alignment.py` defaulted to **one beat** and would have shifted
every onset after a triplet.

A comment is not an invariant. These are.
"""

from __future__ import annotations

import typing

import pytest

from app.services import alignment
from app.services.ocr import validate
from app.services.score_schema import DURATION_BEATS, Duration, Measure, Note, ScoreJson

DURATIONS = set(typing.get_args(Duration))


def test_the_table_covers_exactly_the_durations_the_schema_allows() -> None:
    """Add a duration to the Literal without adding it to the table and this
    fails here, rather than as a wrong tempo verdict weeks later."""
    assert set(DURATION_BEATS) == DURATIONS


def test_every_module_uses_the_same_table_object() -> None:
    """Not "equal" — the same object. Equal tables can be edited apart."""
    assert alignment._DURATION_BEATS is DURATION_BEATS
    assert validate.DURATION_BEATS is DURATION_BEATS


@pytest.mark.parametrize("duration", sorted(DURATIONS))
def test_no_duration_is_silently_worth_a_default(duration: str) -> None:
    assert alignment._beats(duration) == DURATION_BEATS[duration]


def test_an_unknown_duration_raises_rather_than_counting_as_a_quarter() -> None:
    with pytest.raises(KeyError, match="score_schema.DURATION_BEATS"):
        alignment._beats("hemidemisemiquaver")


def test_a_dot_adds_half_again() -> None:
    for plain, dotted in [
        ("whole", "dotted_whole"),
        ("half", "dotted_half"),
        ("quarter", "dotted_quarter"),
        ("eighth", "dotted_eighth"),
        ("sixteenth", "dotted_sixteenth"),
    ]:
        assert DURATION_BEATS[dotted] == DURATION_BEATS[plain] * 1.5


def test_three_triplets_fill_the_space_of_two_plain_notes() -> None:
    """The defining property. Checked to the tolerance the code actually uses,
    because thirds are not representable in binary and 3 x (1/3) is not 1.0."""
    for triplet, plain in [
        ("triplet_half", "whole"),
        ("triplet_quarter", "half"),
        ("triplet_eighth", "quarter"),
        ("triplet_sixteenth", "eighth"),
    ]:
        assert abs(3 * DURATION_BEATS[triplet] - DURATION_BEATS[plain]) < validate.TOLERANCE


def test_triplet_bars_still_sum_exactly_despite_the_thirds() -> None:
    """Documents the thing the tolerance exists *in case* stops being true.

    Thirds are not representable in binary, so the obvious expectation is that
    a triplet bar sums to 0.999... and needs the tolerance to pass. It does not:
    round-to-nearest recovers the bar length exactly for every grouping in this
    table. That is luck in these particular values, not a theorem — so the
    tolerance stays, and this test is what will notice if the luck runs out."""
    for triplet, count, expected in [
        ("triplet_eighth", 3, 1.0),
        ("triplet_eighth", 6, 2.0),
        ("triplet_quarter", 3, 2.0),
        ("triplet_half", 3, 4.0),
        ("triplet_sixteenth", 6, 1.0),
    ]:
        total = sum([DURATION_BEATS[triplet]] * count)
        assert total == expected, f"{count} x {triplet} summed to {total!r}"


# --- end to end: a triplet bar has to survive every stage -------------------

def _bar(*durations: str) -> Measure:
    return Measure(
        measure_number=1,
        notes=[Note(pitch="A4", duration=d, tied_to_next=False) for d in durations],
        slurs=[],
    )


def _score(*measures: Measure) -> ScoreJson:
    return ScoreJson(
        time_signature="4/4",
        key_signature="C major",
        tempo_marking=None,
        bpm_hint=None,
        clef="treble",
        measures=list(measures),
        repeats=[],
        ocr_confidence=0.9,
        notes_to_human="",
    )


def test_a_triplet_bar_validates_as_ok() -> None:
    """Six triplet eighths and a half note is four beats. Before the tables
    were unified this reported 2.0 beats and asked the model to re-read a bar
    it had read correctly."""
    score = _score(_bar(*["triplet_eighth"] * 6, "half"))
    (finding,) = validate.validate_measures(score)
    assert finding.verdict == "ok"
    assert not finding.is_problem
    assert abs(finding.actual_beats - 4.0) < validate.TOLERANCE


def test_a_triplet_bar_produces_evenly_spaced_onsets() -> None:
    """At 60bpm a quarter is one second, so a triplet eighth is a third of one.
    The timeline is what the tempo verdict is measured against; if a triplet
    were worth a quarter here, the player would be told they rushed."""
    score = _score(_bar(*["triplet_eighth"] * 6, "half"))
    timeline = alignment.build_timeline(score, 60.0)
    gaps = [
        round(b - a, 6)
        for a, b in zip(timeline.onsets, timeline.onsets[1:], strict=False)
    ]
    assert gaps[:5] == [round(1 / 3, 6)] * 5
    assert gaps[5] == round(1 / 3, 6)


def test_a_triplet_measure_asked_about_is_asked_about_by_name() -> None:
    """A short triplet bar still reaches the retry prompt, and the prompt says
    triplets are writable — it used to tell the model they were not."""
    # Not measure 1 — a short opening bar is read as a pickup, which is not a
    # problem and so is never asked about.
    full = _bar(*["triplet_eighth"] * 6, "half")
    short = _bar("triplet_eighth", "triplet_eighth", "triplet_eighth")
    short.measure_number = 2
    score = _score(full, short)
    findings = validate.validate_measures(score)
    assert [f.verdict for f in findings] == ["ok", "short"]
    text = validate.describe_for_retry(findings)
    assert "triplets can be written" in text
