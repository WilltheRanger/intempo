"""Recording from partway into a piece.

The app could always *play* from any bar and could only ever *record* from the
first one, so someone working on bar 40 had to play the preceding thirty-nine
to be told anything about it.
"""

from __future__ import annotations

from app.services.score_schema import Measure, Note, Repeat, ScoreJson, TempoChange
from app.services.start_at import start_from_measure


def _score(
    bars: int = 6,
    repeats: list[Repeat] | None = None,
    tempo_changes: list[TempoChange] | None = None,
) -> ScoreJson:
    return ScoreJson(
        time_signature="4/4",
        clef="treble",
        ocr_confidence=1.0,
        measures=[
            Measure(measure_number=n, notes=[Note(pitch="D4", duration="quarter")])
            for n in range(1, bars + 1)
        ],
        repeats=repeats or [],
        tempo_changes=tempo_changes or [],
    )


def test_the_bars_keep_the_numbers_they_have_on_the_page() -> None:
    """**Not rebased to one.** A verdict about the fourteenth bar has to say
    fourteen; renumbering would be the app and the page disagreeing about which
    bar is which, which is the one thing a practice report cannot afford."""
    trimmed = start_from_measure(_score(), 4)

    assert [m.measure_number for m in trimmed.measures] == [4, 5, 6]


def test_entering_at_the_first_bar_changes_nothing() -> None:
    score = _score()

    assert start_from_measure(score, 1) is score


def test_a_bar_the_piece_does_not_have_changes_nothing() -> None:
    """Refused at the API with a sentence a musician can act on. Here the score
    on file is simply the score that was played."""
    score = _score()

    assert start_from_measure(score, 99) is score


def test_a_repeat_the_musician_never_passed_is_dropped() -> None:
    """Including one that *spans* the entry bar: someone starting mid-passage
    plays straight on rather than jumping back to a sign they never saw.
    Keeping it would expand the timeline with bars nobody played."""
    score = _score(
        repeats=[
            Repeat(start_measure=2, end_measure=4, type="repeat"),
            Repeat(start_measure=5, end_measure=6, type="repeat"),
        ]
    )

    trimmed = start_from_measure(score, 4)

    assert [(r.start_measure, r.end_measure) for r in trimmed.repeats] == [(5, 6)]


def test_a_tempo_change_still_in_force_is_carried_to_the_entry_bar() -> None:
    """**The one that matters.** A `rit.` printed at bar 3 is still in force at
    bar 4, and `classification.py` refuses to time notes under a written
    change. Dropping it would judge a passage the page told the musician to
    slow through, and report them dragging for reading it correctly — the exact
    failure `under_tempo_change` exists to prevent, reintroduced by trimming.
    """
    score = _score(
        tempo_changes=[TempoChange(measure_number=3, kind="ritardando", text="rit.")]
    )

    trimmed = start_from_measure(score, 4)

    assert [(c.measure_number, c.kind) for c in trimmed.tempo_changes] == [
        (4, "ritardando")
    ]


def test_only_the_last_change_before_the_entry_bar_is_carried() -> None:
    # A `rit.` cancelled by an `a tempo` before the cut is over; carrying both
    # would put two markings on one bar.
    score = _score(
        tempo_changes=[
            TempoChange(measure_number=1, kind="ritardando", text="rit."),
            TempoChange(measure_number=3, kind="a_tempo", text="a tempo"),
        ]
    )

    trimmed = start_from_measure(score, 4)

    assert [(c.measure_number, c.kind) for c in trimmed.tempo_changes] == [(4, "a_tempo")]


def test_a_change_printed_on_the_entry_bar_wins_over_the_carried_one() -> None:
    score = _score(
        tempo_changes=[
            TempoChange(measure_number=2, kind="ritardando", text="rit."),
            TempoChange(measure_number=4, kind="a_tempo", text="a tempo"),
        ]
    )

    trimmed = start_from_measure(score, 4)

    assert [(c.measure_number, c.kind) for c in trimmed.tempo_changes] == [(4, "a_tempo")]


def test_changes_after_the_entry_bar_are_untouched() -> None:
    score = _score(
        tempo_changes=[TempoChange(measure_number=5, kind="ritardando", text="rit.")]
    )

    trimmed = start_from_measure(score, 4)

    assert [(c.measure_number, c.kind) for c in trimmed.tempo_changes] == [
        (5, "ritardando")
    ]
