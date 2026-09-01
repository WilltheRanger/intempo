"""Tests for services/classification.py — bands, deltas, trend, verdict."""

from __future__ import annotations

import numpy as np

from app.services.alignment import CleanedAlignment, build_timeline
from app.services.classification import (
    Band,
    Delta,
    Direction,
    classify_band,
    compute_deltas,
    generate_verdict,
    rolling_trend,
)
from app.services.score_schema import Measure, Note, ScoreJson


def _delta(
    pct: float,
    measure: int = 1,
    idx: int = 0,
    slur: bool = False,
    under_tempo_change: bool = False,
) -> Delta:
    band = classify_band(pct)
    direction = Direction.on if band is Band.on else (Direction.rush if pct < 0 else Direction.drag)
    return Delta(
        global_index=idx, measure_number=measure, expected_ms=0.0, actual_ms=0.0,
        delta_ms=pct * 5.0, delta_pct=pct, band=band, direction=direction, is_slur_interior=slur,
        under_tempo_change=under_tempo_change,
        # The two travel together in `compute_deltas`: a note under a change is
        # one whose deviation was not measured against a time the page states.
        # Setting only the first here made the trend test pass against a `Delta`
        # the pipeline never produces.
        timed=not under_tempo_change,
    )


def test_classify_band_dragging_side() -> None:
    assert classify_band(0.0) is Band.on
    assert classify_band(4.0) is Band.on
    assert classify_band(7.0) is Band.slight
    assert classify_band(15.0) is Band.rush_drag
    assert classify_band(25.0) is Band.severe


def test_classify_band_rushing_side_is_symmetric_by_default() -> None:
    assert classify_band(-4.0) is Band.on
    assert classify_band(-7.0) is Band.slight
    assert classify_band(-15.0) is Band.rush_drag
    assert classify_band(-25.0) is Band.severe


def test_compute_deltas_sign_convention() -> None:
    # 3 quarter notes at 120 BPM; expected onsets 0, 0.5, 1.0s.
    score = ScoreJson(clef="treble", ocr_confidence=0.9,
        measures=[Measure(measure_number=1, notes=[Note(pitch="A4", duration="quarter")] * 3)])
    timeline = build_timeline(score, 120.0)
    # Detected: on time, then 50ms late (drag), then 60ms early (rush).
    # 50ms at 120 BPM = 10% of a beat; 60ms = 12% — both clear of the
    # ±5% "on" band so the direction is unambiguous.
    detected = np.array([0.0, 0.55, 0.94])
    cleaned = CleanedAlignment(matched=[(0, 0), (1, 1), (2, 2)])
    deltas = compute_deltas(cleaned, detected, timeline, 120.0)
    assert deltas[0].delta_ms == 0.0  # origin anchored on first note
    assert deltas[1].delta_ms > 0 and deltas[1].direction is Direction.drag
    assert deltas[2].delta_ms < 0 and deltas[2].direction is Direction.rush


def test_rolling_trend_is_rush_positive() -> None:
    # All rushing (negative delta_pct) → trend should be positive (ahead).
    deltas = [_delta(-8.0, idx=i) for i in range(4)]
    trend = rolling_trend(deltas, window=2)
    assert len(trend) == 4
    assert all(v > 0 for v in trend)


def test_rolling_trend_excludes_slur_interior() -> None:
    deltas = [_delta(-8.0, idx=0), _delta(-8.0, idx=1, slur=True), _delta(-8.0, idx=2)]
    assert len(rolling_trend(deltas)) == 2  # interior note dropped


def test_rolling_trend_excludes_notes_under_a_written_tempo_change() -> None:
    """A `rit.` is not a drift, and the trend line said it was.

    `compute_deltas` already refuses to band these notes — the page has said
    the beat will not be steady, so their deviation is the musician doing what
    was asked. Leaving them in the trend drew a line diving at the end of any
    piece closing with a ritardando, on the same screen whose measure list
    says those bars were not timed.

    The same exclusion slur-interior notes get, one line above, for a weaker
    reason.
    """
    steady = [_delta(-2.0, idx=i) for i in range(3)]
    rit = [_delta(40.0, idx=3 + i, under_tempo_change=True) for i in range(3)]

    trend = rolling_trend(steady + rit)

    assert len(trend) == 3
    # Every point still reports the steady playing, not a collapse into drag.
    assert all(v > 0 for v in trend)


def test_rolling_trend_accepts_raw_floats() -> None:
    assert rolling_trend([1.0, 3.0], window=2) == [1.0, 2.0]


def test_generate_verdict_detects_rushing_run() -> None:
    deltas = [_delta(-15.0, measure=m, idx=m) for m in range(1, 6)]
    verdict = generate_verdict(deltas, target_bpm=120.0)
    assert verdict.direction is Direction.rush
    assert "rushed" in verdict.text
    assert verdict.start_measure == 1 and verdict.end_measure == 5


def test_generate_verdict_steady_when_within_tolerance() -> None:
    deltas = [_delta(2.0, measure=m, idx=m) for m in range(1, 6)]
    verdict = generate_verdict(deltas, target_bpm=120.0)
    assert verdict.direction is Direction.on
    assert "Steady" in verdict.text


def test_generate_verdict_uses_bpm_not_percent() -> None:
    deltas = [_delta(20.0, measure=m, idx=m) for m in range(1, 4)]
    verdict = generate_verdict(deltas, target_bpm=120.0)
    assert "BPM" in verdict.text
    assert "%" not in verdict.text


# ---------------------------------------------------------------------------
# Why a note went unjudged
# ---------------------------------------------------------------------------
#
# `timed` said *that* a note was not measured against a written time; nothing
# said *which* of the three reasons it was. The app therefore had one sentence
# for all of them — "Not timed" — which reads as the app failing rather than as
# the page speaking. "This bar is held" is a reading; "not timed" is an apology.
#
# The reason was known at the line that computes `timed` and thrown away one
# field short of the screen that needed it.


def _scored(fermata_at: tuple[int, int] | None = None, graces_at: tuple[int, int] | None = None):
    """Two bars of quarters, optionally with one fermata and one ornament."""
    measures = []
    for number in (1, 2):
        notes = []
        for index in range(4):
            notes.append(
                Note(
                    pitch="D3",
                    duration="quarter",
                    fermata=fermata_at == (number, index),
                    grace_notes=2 if graces_at == (number, index) else 0,
                )
            )
        measures.append(Measure(measure_number=number, notes=notes))
    return ScoreJson(
        time_signature="4/4", clef="bass", measures=measures, ocr_confidence=1.0
    )


def _deltas_for(score: ScoreJson):
    """Played exactly as written, so nothing is a deviation and the only thing
    under test is which notes the pipeline declined to judge, and why."""
    timeline = build_timeline(score, 60.0)
    detected = np.array([n.onset_s for n in timeline.notes], dtype=float)
    cleaned = CleanedAlignment(matched=[(i, i) for i in range(len(timeline.notes))])
    return compute_deltas(cleaned, detected, timeline, 60.0)


def test_a_note_after_a_fermata_says_so() -> None:
    """The mark exists precisely to hand the length to the player, so there is
    no written value for the interval after it to be measured against."""
    deltas = _deltas_for(_scored(fermata_at=(1, 3)))

    held = [d for d in deltas if not d.timed]

    assert [d.untimed_reason for d in held] == ["fermata"]


def test_an_ornament_and_the_note_it_decorates_say_ornament() -> None:
    """The narrowest of the three, and the only one that is a limitation of
    this code rather than something printed on the page: `ORNAMENT_SHARE` is a
    number the pipeline invented to split the difference between two readings
    an engraver may have meant."""
    deltas = _deltas_for(_scored(graces_at=(2, 1)))

    assert {d.untimed_reason for d in deltas if not d.timed} == {"ornament"}


def test_a_note_the_page_states_a_time_for_gives_no_reason() -> None:
    deltas = _deltas_for(_scored())

    assert all(d.timed for d in deltas)
    assert all(d.untimed_reason is None for d in deltas)
