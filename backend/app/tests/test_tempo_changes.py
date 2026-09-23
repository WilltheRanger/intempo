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

import numpy as np
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


# ---------------------------------------------------------------------------
# Judging the change itself
# ---------------------------------------------------------------------------

SR = 22050


def _take(tempos: list[float]) -> np.ndarray:
    """A bowed take whose per-note tempo follows `tempos`."""
    from app.tests.audio_helpers import bass_scale, synth_bowed_take

    clock = 1.0
    times: list[float] = []
    for bpm in tempos:
        times.append(clock)
        clock += 60.0 / bpm
    return synth_bowed_take(
        times, freqs_hz=bass_scale(len(times)), note_dur_s=0.5
    )


STEADY = list(np.full(16, 60.0))
EVEN_RIT = STEADY + list(np.linspace(58, 45, 16))
LURCHING_RIT = (
    STEADY + list(np.linspace(58, 50, 8)) + [34.0] + list(np.linspace(49, 45, 7))
)
RIT_AT_5 = [TempoChange(measure_number=5, kind="ritardando", text="rit.")]


def _analyse(tempos: list[float], changes: list[TempoChange]):
    from app.services.analysis import analyze

    return analyze(
        (_take(tempos), SR), _score(changes), target_bpm=60.0, double_bass=True
    )


def test_slowing_exactly_as_marked_is_not_dragging() -> None:
    """The whole reason any of this exists.

    Before the marking could be transcribed, this take — played precisely as
    the page asks — came back *"You dragged across measures 5–6 by an average
    of 24 BPM"*, at quality 0.560, with the caveat showing. The score says slow
    down and the app said you dragged.
    """
    result = _analyse(EVEN_RIT, RIT_AT_5)

    assert result.status == "ok"
    assert result.quality > 0.9
    assert result.low_confidence is False
    assert [m.measure_number for m in result.per_measure if m.worst_band != "on"] == []
    assert "dragged" not in result.verdict


def test_the_same_take_unmarked_still_reads_as_dragging() -> None:
    """The control, and it matters: it shows the marking is what changed the
    answer, not a loosening of the bands. A page whose `rit.` never reached the
    transcription is a page the app genuinely cannot read correctly, and it
    should say the numbers are unreliable rather than quietly excuse them.
    """
    result = _analyse(EVEN_RIT, [])

    # **Refused, where it used to be read — and the reading was not a reading.**
    # Until 2026-09-22 this asserted a low-confidence "dragged" across bars
    # 5–8, and that verdict was computed with 25 of the 32 notes paired to the
    # wrong written note: a sideways step cost the matcher nothing, so it slid
    # through the slowing bars to shrink the residuals. Priced
    # (`STEP_PENALTY_CAPS`), every note pairs with its own, and a steady-tempo
    # alignment cannot explain a quarter's slowing — timing quality 0.324.
    # The page is still not quietly excused: the musician is told to check the
    # tempo, and the marked page below reads it correctly.
    assert result.status == "alignment_failed"
    assert "tempo" in result.verdict


def test_an_uneven_change_is_named_at_the_bar_it_lurched() -> None:
    result = _analyse(LURCHING_RIT, RIT_AT_5)

    uneven = [m.measure_number for m in result.per_measure if m.uneven]
    assert uneven == [7]
    assert result.verdict == "Your rit. lurched at bar 7."
    # And it is still not called dragging: the bands stay refused under a change.
    assert [m.measure_number for m in result.per_measure if m.worst_band != "on"] == []


def test_an_even_change_is_named_too() -> None:
    """Saying nothing would read as the app not having noticed the page."""
    result = _analyse(EVEN_RIT, RIT_AT_5)
    assert result.verdict == "Steady, and your rit. flowed."


def test_the_page_is_quoted_rather_than_paraphrased() -> None:
    result = _analyse(
        LURCHING_RIT,
        [TempoChange(measure_number=5, kind="ritardando", text="poco rall.")],
    )
    assert "poco rall." in result.verdict
    assert "ritardando" not in result.verdict


def test_drift_before_a_change_is_still_reported_alongside_it() -> None:
    """Two things happened, and one must not hide the other."""
    tempos = (
        list(np.linspace(60, 72, 16))
        + list(np.linspace(58, 50, 8))
        + [34.0]
        + list(np.linspace(49, 45, 7))
    )
    result = _analyse(tempos, RIT_AT_5)

    assert "rushed" in result.verdict
    assert "lurched at bar 7" in result.verdict


def test_an_accelerando_works_the_same_way() -> None:
    tempos = STEADY + list(np.linspace(62, 80, 16))
    result = _analyse(
        tempos, [TempoChange(measure_number=5, kind="accelerando", text="accel.")]
    )

    assert result.quality > 0.9
    assert [m.measure_number for m in result.per_measure if m.worst_band != "on"] == []


def test_the_notes_under_a_change_carry_the_flag_not_a_band() -> None:
    """`band` is `on` there by refusal, not measurement — a screen must not be
    able to paint a rushing colour on a bar the page said would not be steady."""
    result = _analyse(EVEN_RIT, RIT_AT_5)

    marked = [n for n in result.per_note if n.under_tempo_change]
    assert len(marked) == 16
    assert {n.band for n in marked} == {"on"}
    assert {n.direction for n in marked} == {"on"}


def test_a_page_with_no_marking_is_untouched() -> None:
    """The six corpus clips have no markings, and this is why they do not move."""
    result = _analyse(STEADY + STEADY, [])

    assert result.quality > 0.95
    assert not any(n.under_tempo_change for n in result.per_note)
    assert not any(m.uneven for m in result.per_measure)
    assert result.verdict == "Steady all the way through."
