"""Tests for services/classification.py — bands, deltas, trend, verdict."""

from __future__ import annotations

import re

import numpy as np
import pytest

from app.services.alignment import CleanedAlignment, build_timeline
from app.services.analysis import bar_pacing
from app.services.classification import (
    Band,
    BarTempi,
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
    # One quarter at 120 BPM per index, as `compute_deltas` would place it. The
    # verdict reads a run's pace from these, so a helper that left them at zero
    # would test a `Delta` the pipeline never produces.
    expected_ms = idx * 500.0
    return Delta(
        global_index=idx, measure_number=measure, expected_ms=expected_ms,
        actual_ms=expected_ms + pct * 5.0,
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
    # Early by the same share throughout: a side, and no tempo to quote.
    assert verdict.text == "Bars 1–5 ran ahead."
    assert verdict.start_measure == 1 and verdict.end_measure == 5


def test_generate_verdict_steady_when_within_tolerance() -> None:
    deltas = [_delta(2.0, measure=m, idx=m) for m in range(1, 6)]
    verdict = generate_verdict(deltas, target_bpm=120.0)
    assert verdict.direction is Direction.on
    assert "Steady" in verdict.text


def test_generate_verdict_uses_bpm_not_percent() -> None:
    # A drift that grows, which is what a tempo difference looks like. A run
    # sitting at one constant displacement has no pace of its own to report.
    deltas = [_delta(15.0 * m, measure=m, idx=m) for m in range(1, 5)]
    verdict = generate_verdict(deltas, target_bpm=120.0)
    assert re.fullmatch(r"Bars 1–4 went at \d+\.", verdict.text), verdict.text
    assert "%" not in verdict.text


# ---------------------------------------------------------------------------
# The verdict's figure is a tempo, and it takes more than chance to earn one
# ---------------------------------------------------------------------------


def _quarters(bars: int) -> ScoreJson:
    return ScoreJson(
        clef="treble",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(measure_number=m + 1, notes=[Note(pitch="A4", duration="quarter")] * 4)
            for m in range(bars)
        ],
    )


def _verdict_for(detected: list[float], target_bpm: float, bars: int = 8):
    timeline = build_timeline(_quarters(bars), target_bpm)
    matched = [(i, i) for i in range(len(detected))]
    deltas = compute_deltas(
        CleanedAlignment(matched=matched), np.asarray(detected), timeline, target_bpm
    )
    return deltas, generate_verdict(deltas, target_bpm)


@pytest.mark.parametrize("played_bpm", [57.0, 61.5, 63.0, 66.0])
def test_the_figure_is_the_tempo_the_run_was_played_at(played_bpm: float) -> None:
    """**It used to be a position, and it grew with the length of the piece.**

    `target_bpm × mean(|delta_pct|) / 100` — where `delta_pct` is how far a note
    sits from the grid. Thirty-two quarters played steadily at 63 against a
    target of 60 were told "You rushed across measures 1–8 by an average of
    **48 BPM**", on a result whose own `insights` said 63.0.
    """
    detected = [i * 60.0 / played_bpm for i in range(32)]
    _, verdict = _verdict_for(detected, 60.0)

    assert verdict.avg_bpm_delta == pytest.approx(abs(played_bpm - 60.0), abs=1.0)
    assert verdict.direction is (Direction.rush if played_bpm > 60 else Direction.drag)


def test_a_run_that_got_ahead_but_kept_the_tempo_names_no_figure() -> None:
    """A jump, not a slope: ahead of the beat for six bars, at the tempo.

    It was rushed — the notes are early — but across the run the pace is the
    target's to within a fraction of a BPM, so there is no figure that is true.
    "By an average of 0 BPM" would say nothing, so the sentence stops at where.
    """
    detected = [i * 0.5 for i in range(32)]
    for i in range(8, 32):
        detected[i] -= 0.035  # 7% of a beat early, from bar 3 to the end
    _, verdict = _verdict_for(detected, 120.0)

    assert verdict.direction is Direction.rush
    assert "BPM" not in verdict.text
    assert verdict.text.endswith(".")


def test_two_notes_just_outside_the_band_are_not_a_verdict() -> None:
    """**What chance produces, and what the app used to name.**

    Two consecutive notes a few milliseconds outside the inner band, on the
    same side, is what a steady player's ordinary spread throws up on most
    takes — and was enough to be told "You rushed in measure 7".
    """
    pcts = [0.0] * 8 + [-6.0, -6.5] + [0.0] * 8
    deltas = [_delta(p, measure=1 + i // 4, idx=i) for i, p in enumerate(pcts)]

    assert generate_verdict(deltas, target_bpm=120.0).direction is Direction.on


def test_two_notes_well_outside_the_band_still_are() -> None:
    """A short run is still named when it is far enough out that chance does
    not put two consecutive notes there — a real lurch is short."""
    pcts = [0.0] * 8 + [-15.0, -30.0] + [0.0] * 8
    deltas = [_delta(p, measure=1 + i // 4, idx=i) for i, p in enumerate(pcts)]

    verdict = generate_verdict(deltas, target_bpm=120.0)
    assert verdict.direction is Direction.rush
    assert verdict.start_measure == 3


def test_a_steady_player_is_not_told_they_drifted() -> None:
    """End to end through `compute_deltas`: no drift, only a good player's
    spread — each note independently ±12 ms, 2.4% of a beat at 120 BPM.

    Measured before: 14 of these 40 seeds were told they rushed or dragged.
    """
    told = 0
    for seed in range(40):
        rng = np.random.default_rng(100 + seed)
        detected = [i * 0.5 + rng.normal(0, 0.012) for i in range(32)]
        _, verdict = _verdict_for(detected, 120.0)
        told += verdict.direction is not Direction.on
    assert told <= 2, f"{told} of 40 steady takes were told they drifted"


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


# ---------------------------------------------------------------------------
# Given the take's bar tempi, the sentence names the run the chart draws
# ---------------------------------------------------------------------------


def _tempi(by_bar: dict[int, float], across: float | None = None) -> BarTempi:
    return BarTempi(by_bar=by_bar, across=lambda first, last: across)


def _behind_from_the_start(bars: int) -> list[Delta]:
    """Four notes a bar, every one of them behind — the drift a take held
    steadily slow piles up from its first note."""
    return [
        _delta(10.0 + i, measure=1 + i // 4, idx=i) for i in range(bars * 4)
    ]


def test_the_sentence_names_the_bars_the_chart_shows_off_tempo() -> None:
    """**The owner's take, 2026-09-25.** "You dragged bars 1–12 by 7 BPM",
    over a chart whose bars 1–12 sat near 100 and whose bars 18–25 sat at 78:
    the note rule's longest run was the stretch before a re-anchor, not the
    slowing. By bars, it is the slowing."""
    deltas = _behind_from_the_start(20)
    by_bar = {m: 101.0 for m in range(1, 13)} | {m: 78.0 for m in range(13, 21)}

    verdict = generate_verdict(deltas, 104.0, tempi=_tempi(by_bar, across=80.0))

    assert verdict.text == "Bars 13–20 went at 80."
    assert verdict.direction is Direction.drag
    assert (verdict.start_measure, verdict.end_measure) == (13, 20)


def test_a_bar_is_banded_as_the_card_bands_it() -> None:
    """98.3 against 104 is 5.5% under: the card says it dragged, so the
    sentence counts it. 100.2 is 3.7%: on, for both."""
    deltas = _behind_from_the_start(6)
    by_bar = {1: 100.2, 2: 100.2, 3: 98.3, 4: 97.0, 5: 96.0, 6: 100.2}

    verdict = generate_verdict(deltas, 104.0, tempi=_tempi(by_bar, across=97.0))

    assert (verdict.start_measure, verdict.end_measure) == (3, 5)


def test_a_rushed_run_by_bars() -> None:
    deltas = [_delta(-8.0 - i, measure=1 + i // 4, idx=i) for i in range(16)]
    by_bar = {1: 104.0, 2: 118.0, 3: 120.0, 4: 104.0}

    verdict = generate_verdict(deltas, 104.0, tempi=_tempi(by_bar, across=119.0))

    assert verdict.text == "Bars 2–3 went at 119."
    assert verdict.direction is Direction.rush


def test_one_bar_is_named_only_when_it_is_clearly_out() -> None:
    """A single bar's tempo is the least certain point on the chart."""
    deltas = _behind_from_the_start(4)
    slight = {1: 104.0, 2: 97.0, 3: 104.0, 4: 104.0}  # 6.7% under
    clear = {1: 104.0, 2: 85.0, 3: 104.0, 4: 104.0}  # 18% under

    alone = generate_verdict(deltas, 104.0, tempi=_tempi(slight))
    assert (alone.start_measure, alone.end_measure) != (2, 2)
    verdict = generate_verdict(deltas, 104.0, tempi=_tempi(clear, across=85.0))
    assert verdict.text == "Bar 2 went at 85."


def test_a_bar_with_too_few_timed_notes_is_not_a_run() -> None:
    """One note is one note's timing, however far out its bar reads."""
    deltas = [_delta(0.0, measure=1 + i // 4, idx=i) for i in range(8)]
    deltas.append(_delta(0.0, measure=3, idx=8))
    by_bar = {1: 104.0, 2: 104.0, 3: 70.0}

    verdict = generate_verdict(deltas, 104.0, tempi=_tempi(by_bar, across=70.0))

    assert verdict.direction is Direction.on


def test_a_bar_under_a_written_change_is_left_out() -> None:
    """The page asked for another tempo there: not a drag, and not a break
    in the run around it either."""
    deltas = [
        _delta(10.0 + i, measure=1 + i // 4, idx=i, under_tempo_change=i // 4 == 2)
        for i in range(20)
    ]
    by_bar = {1: 104.0, 2: 90.0, 3: 60.0, 4: 90.0, 5: 104.0}

    verdict = generate_verdict(deltas, 104.0, tempi=_tempi(by_bar, across=90.0))

    assert (verdict.start_measure, verdict.end_measure) == (2, 4)
    assert verdict.text == "Bars 2–4 went at 90."


def test_no_figure_when_the_run_has_no_tempo_of_its_own() -> None:
    deltas = _behind_from_the_start(4)
    by_bar = {1: 90.0, 2: 90.0, 3: 90.0, 4: 90.0}

    verdict = generate_verdict(deltas, 104.0, tempi=_tempi(by_bar, across=None))

    assert verdict.text == "Bars 1–4 fell behind."


def test_on_tempo_bar_by_bar_the_note_rule_still_speaks() -> None:
    """A take held 3% slow is on tempo in every bar and a beat behind by the
    end — and the title above the sentence, which reads the drift, says it
    dragged. The sentence must not answer "steady" under that title."""
    deltas = _behind_from_the_start(6)
    by_bar = {m: 101.0 for m in range(1, 7)}

    verdict = generate_verdict(deltas, 104.0, tempi=_tempi(by_bar, across=101.0))

    assert verdict.direction is Direction.drag
    assert verdict.text.startswith("Bars 1–6 ")


def test_end_to_end_the_sentence_follows_the_bars() -> None:
    """Through `compute_deltas` and `bar_pacing`, as `analyze()` runs them:
    six bars at 100 against 104 — on, bar by bar — then two at 80. Every note
    is behind from bar 2, so the note rule named bars 1–8; the chart shows
    the last two."""
    target = 104.0
    timeline = build_timeline(_quarters(8), target)
    detected, t = [], 0.0
    for i in range(32):
        detected.append(t)
        t += 60.0 / (100.0 if i < 24 else 80.0)
    matched = [(i, i) for i in range(32)]
    onsets = np.asarray(detected)
    deltas = compute_deltas(CleanedAlignment(matched=matched), onsets, timeline, target)

    verdict = generate_verdict(
        deltas, target, tempi=bar_pacing(matched, onsets, timeline, target)
    )

    assert (verdict.start_measure, verdict.end_measure) == (7, 8)
    assert verdict.text == "Bars 7–8 went at 80."
