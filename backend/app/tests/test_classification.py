"""Per-note band classification + rolling trend + verdict generation."""

from __future__ import annotations

import pytest

from app.services.alignment import CleanedAlignment, MatchedPair
from app.services.classification import (
    Band,
    classify_band,
    compute_deltas,
    generate_verdict,
    rolling_trend,
)
from app.tests._audio_helpers import synth_score


# ---- classify_band -------------------------------------------------------


@pytest.mark.parametrize(
    "delta_pct, expected_band",
    [
        (0.0, Band.on),
        (4.0, Band.on),
        (-4.0, Band.on),
        (5.0, Band.on),       # exact boundary still on
        (5.5, Band.slight_drag),
        (-5.5, Band.slight_rush),
        (10.0, Band.slight_drag),
        (15.0, Band.dragging),
        (-15.0, Band.rushing),
        (25.0, Band.severe_dragging),
        (-25.0, Band.severe_rushing),
    ],
)
def test_classify_band(delta_pct: float, expected_band: Band) -> None:
    assert classify_band(delta_pct) == expected_band


# ---- compute_deltas ------------------------------------------------------


def _cleaned(matched: list[tuple[int, int, float, float]]) -> CleanedAlignment:
    return CleanedAlignment(
        matched=[
            MatchedPair(detected_idx=d, expected_idx=e, detected_time_s=dt, expected_time_s=et)
            for d, e, dt, et in matched
        ],
        quality_score=1.0,
    )


def test_compute_deltas_zero_for_perfect_match() -> None:
    cleaned = _cleaned([(0, 0, 0.5, 0.5), (1, 1, 1.0, 1.0)])
    deltas = compute_deltas(cleaned, target_bpm=120.0)
    assert all(d.delta_ms == 0.0 for d in deltas)
    assert all(d.band == Band.on for d in deltas)


def test_compute_deltas_signs() -> None:
    """Late detection (drag) is positive; early (rush) is negative."""
    cleaned = _cleaned([
        (0, 0, 0.55, 0.50),  # 50 ms late
        (1, 1, 0.95, 1.00),  # 50 ms early
    ])
    deltas = compute_deltas(cleaned, target_bpm=60.0)  # beat = 1000 ms
    assert deltas[0].delta_ms == pytest.approx(50.0)
    assert deltas[0].delta_pct == pytest.approx(5.0)
    assert deltas[1].delta_ms == pytest.approx(-50.0)
    assert deltas[1].delta_pct == pytest.approx(-5.0)


def test_compute_deltas_rejects_zero_bpm() -> None:
    with pytest.raises(ValueError):
        compute_deltas(_cleaned([(0, 0, 0.5, 0.5)]), target_bpm=0)


# ---- rolling_trend -------------------------------------------------------


def test_rolling_trend_empty() -> None:
    assert rolling_trend([]) == []


def test_rolling_trend_partial_window() -> None:
    """For positions before the window fills, take the partial mean."""
    out = rolling_trend([10.0, 0.0, -10.0], window=3)
    assert out[0] == pytest.approx(10.0)        # window of 1
    assert out[1] == pytest.approx(5.0)         # mean of 10, 0
    assert out[2] == pytest.approx(0.0)         # mean of 10, 0, -10


def test_rolling_trend_full_window() -> None:
    out = rolling_trend([1.0] * 8 + [9.0], window=8)
    assert out[-1] == pytest.approx(2.0)  # mean of 7 ones + one 9


# ---- generate_verdict ----------------------------------------------------


def test_verdict_on_tempo_when_all_close() -> None:
    cleaned = _cleaned([(i, i, i * 0.5, i * 0.5) for i in range(8)])
    deltas = compute_deltas(cleaned, target_bpm=120.0)
    verdict = generate_verdict(deltas, [d.band for d in deltas], target_bpm=120.0)
    assert verdict.overall == Band.on
    assert "tolerance" in verdict.headline.lower() or "on" in verdict.headline.lower()


def test_verdict_flags_sustained_rush() -> None:
    """Player is consistently 100ms early on every note → 'rushed' verdict."""
    cleaned = _cleaned([(i, i, i * 0.5 - 0.1, i * 0.5) for i in range(8)])
    deltas = compute_deltas(cleaned, target_bpm=60.0)  # beat = 1000ms; 100ms = 10%
    verdict = generate_verdict(deltas, [d.band for d in deltas], target_bpm=60.0)
    assert "rushed" in verdict.headline.lower(), f"got: {verdict.headline}"
    assert verdict.largest_run_pct < 0  # negative = rushing


def test_verdict_with_score_uses_measure_numbers() -> None:
    score = synth_score(n_quarter_notes=8)  # 2 measures of 4 quarters each
    cleaned = _cleaned([(i, i, i * 0.5 + 0.08, i * 0.5) for i in range(8)])
    deltas = compute_deltas(cleaned, target_bpm=60.0)  # 80ms late = 8% drag
    verdict = generate_verdict(
        deltas, [d.band for d in deltas], target_bpm=60.0, score_measures=score.measures
    )
    assert "measures" in verdict.headline.lower() or "measure" in verdict.headline.lower(), (
        f"expected measure reference in headline; got: {verdict.headline}"
    )


def test_verdict_empty_deltas_returns_safe_message() -> None:
    verdict = generate_verdict([], [], target_bpm=120.0)
    assert "no notes" in verdict.headline.lower() or "empty" in verdict.headline.lower()
    assert verdict.overall == Band.on
