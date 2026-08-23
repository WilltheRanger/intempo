"""Where the page says the tempo itself changes.

The timing check measures distance from a steady beat. `rit.` and `accel.` are
the marks that say the beat stops being steady — so under them a *correct*
performance stops matching the grid, and the app said so out loud. Measured on
eight bars slowing 60 → 45 BPM over the last four, played exactly as written:

    "You dragged across measures 5–6 by an average of 24 BPM."

The score says slow down and the app says you dragged. This module covers the
first half of the fix: getting the marking off the page and into the timeline.
What to *do* with those measures — judge how evenly the change was made, rather
than not judging them — is the other half.
"""

from __future__ import annotations

import pytest

from app.services.alignment import build_timeline
from app.services.score_schema import (
    Measure,
    Note,
    ScoreJson,
    TempoChange,
    measures_under_tempo_change,
    tempo_change_spans,
)


def _score(changes: list[TempoChange], measures: int = 8) -> ScoreJson:
    return ScoreJson(
        clef="bass",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(
                measure_number=i + 1,
                notes=[Note(pitch="E2", duration="quarter")] * 4,
            )
            for i in range(measures)
        ],
        tempo_changes=changes,
    )


def test_a_rit_with_nothing_after_it_runs_to_the_end_of_the_page() -> None:
    """Which is what a rit. near the end of a piece actually does."""
    score = _score([TempoChange(measure_number=5, kind="ritardando", text="rit.")])

    (span,) = tempo_change_spans(score)

    assert (span.start_measure, span.end_measure) == (5, 8)
    assert span.text == "rit."


def test_a_tempo_ends_the_change_and_starts_nothing() -> None:
    """Its whole job is to end the one before it, so it has no span of its own."""
    score = _score(
        [
            TempoChange(measure_number=3, kind="ritardando", text="rit."),
            TempoChange(measure_number=6, kind="a_tempo", text="a tempo"),
        ]
    )

    spans = tempo_change_spans(score)

    assert len(spans) == 1
    assert (spans[0].start_measure, spans[0].end_measure) == (3, 5)
    assert sorted(measures_under_tempo_change(score)) == [3, 4, 5]


def test_one_change_ends_another() -> None:
    """A rall. into an accel. with no a tempo between them is ordinary."""
    score = _score(
        [
            TempoChange(measure_number=2, kind="ritardando", text="rall."),
            TempoChange(measure_number=5, kind="accelerando", text="accel."),
        ]
    )

    first, second = tempo_change_spans(score)

    assert (first.start_measure, first.end_measure) == (2, 4)
    assert (second.start_measure, second.end_measure) == (5, 8)


def test_markings_out_of_order_are_read_in_order() -> None:
    """A model reading a page column by column can emit them any way round, and
    the extent of a change depends entirely on what comes next."""
    score = _score(
        [
            TempoChange(measure_number=6, kind="a_tempo", text="a tempo"),
            TempoChange(measure_number=3, kind="ritardando", text="rit."),
        ]
    )

    (span,) = tempo_change_spans(score)
    assert (span.start_measure, span.end_measure) == (3, 5)


def test_a_page_with_no_markings_has_no_spans() -> None:
    score = _score([])
    assert tempo_change_spans(score) == []
    assert measures_under_tempo_change(score) == set()


def test_a_lone_a_tempo_covers_nothing() -> None:
    """It ends a change that was on the previous page, or the model misread it.
    Either way it is not a span, and it must not become one."""
    score = _score([TempoChange(measure_number=4, kind="a_tempo", text="Tempo I")])
    assert tempo_change_spans(score) == []


def test_a_change_on_the_last_measure_covers_that_measure() -> None:
    score = _score([TempoChange(measure_number=8, kind="ritardando", text="rit.")])
    (span,) = tempo_change_spans(score)
    assert (span.start_measure, span.end_measure) == (8, 8)


def test_the_timeline_marks_the_notes_the_change_covers() -> None:
    """Nothing measures them differently yet. This is the plumbing that lets it."""
    score = _score([TempoChange(measure_number=5, kind="ritardando", text="rit.")])

    timeline = build_timeline(score, 60.0)

    marked = {n.measure_number for n in timeline.notes if n.under_tempo_change}
    assert marked == {5, 6, 7, 8}
    assert sum(n.under_tempo_change for n in timeline.notes) == 16


def test_a_score_without_markings_marks_nothing() -> None:
    timeline = build_timeline(_score([]), 60.0)
    assert not any(n.under_tempo_change for n in timeline.notes)


def test_the_onsets_are_untouched_by_the_marking() -> None:
    """A `rit.` carries no amount, so it cannot move a written onset — and the
    expected timeline must not pretend otherwise. What changes is how the
    deviations are *read*, not where the notes are written."""
    plain = build_timeline(_score([]), 60.0)
    marked = build_timeline(
        _score([TempoChange(measure_number=5, kind="ritardando", text="rit.")]), 60.0
    )
    assert list(plain.onsets) == list(marked.onsets)


@pytest.mark.parametrize("text", ["rit.", "poco rall.", "accel.", "a tempo", "Tempo I"])
def test_the_printed_words_are_kept(text: str) -> None:
    """So a screen can quote the page instead of paraphrasing it."""
    kind = "a_tempo" if "tempo" in text.lower() else "ritardando"
    change = TempoChange(measure_number=1, kind=kind, text=text)
    assert change.text == text


def test_the_prompt_asks_for_them() -> None:
    from pathlib import Path

    prompt = (
        Path(__file__).resolve().parents[1] / "prompts" / "ocr_prompt.txt"
    ).read_text()
    assert "TEMPO CHANGES" in prompt
    assert "tempo_changes" in prompt
    assert "how long a rit. lasts" in prompt, (
        "the extent is derived, and asking the model to invent it is the failure"
    )
