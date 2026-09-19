"""The three numbers a musician gets that the verdict cannot carry.

Each one is checked against a take built to have a known answer, because the
failure mode here is not a crash — it is a plausible number that is wrong by a
factor, shown confidently on a screen nobody can check it against.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.insights import (
    MIN_NOTES_FOR_INSIGHT,
    insights_for,
    played_tempo,
    steadiness,
    tempo_drift,
)

TARGET = 60.0
N = 24


def _take(factor: float, *, n: int = N):
    """A take of `n` notes played `factor` times the written duration.

    `factor` below 1 is faster than written: every gap is shorter, so the take
    finishes early.
    """
    expected = np.arange(n, dtype=float)  # one written second per note
    detected = 0.4 + expected * factor
    matched = [(i, i) for i in range(n)]
    return matched, detected, expected


class TestPlayedTempo:
    @pytest.mark.parametrize(
        "factor,expected_bpm",
        [(0.8, 75.0), (0.9, 66.7), (1.0, 60.0), (1.1, 54.5), (1.25, 48.0)],
    )
    def test_the_pace_is_recovered_exactly(self, factor, expected_bpm):
        """The measurement this module was written from: against takes
        synthesised at known tempi the recovered figure is exact, not an
        estimate that needs hedging."""
        matched, detected, expected = _take(factor)

        assert played_tempo(matched, detected, expected, TARGET) == pytest.approx(
            expected_bpm, abs=0.1
        )

    def test_a_take_that_starts_late_still_reports_its_pace(self):
        """Offset is not pace. A musician who came in a bar late played the
        piece at the speed they played it, and reporting them slow for
        starting late would be reporting the count-in."""
        matched, detected, expected = _take(1.0)
        detected = detected + 5.0

        assert played_tempo(matched, detected, expected, TARGET) == pytest.approx(
            TARGET, abs=0.1
        )

    def test_too_few_notes_reports_nothing(self):
        matched, detected, expected = _take(1.0, n=MIN_NOTES_FOR_INSIGHT - 1)

        assert played_tempo(matched, detected, expected, TARGET) is None

    def test_a_take_matched_onto_one_written_instant_has_no_pace(self):
        """`polyfit` will return a slope for a vertical set of points. A
        number is not better than nothing when it means nothing."""
        matched = [(i, i) for i in range(N)]
        detected = np.arange(N, dtype=float)
        expected = np.zeros(N)

        assert played_tempo(matched, detected, expected, TARGET) is None


class TestTempoDrift:
    def test_a_take_that_speeds_up_is_reported_as_speeding_up(self):
        """The insight the verdict cannot give: not "you were fast" but
        "you got faster"."""
        n = 30
        expected = np.arange(n, dtype=float)
        # Each gap shrinks steadily: an accelerando across the take.
        gaps = np.linspace(1.15, 0.85, n)
        detected = 0.4 + np.cumsum(np.concatenate([[0.0], gaps[:-1]]))
        matched = [(i, i) for i in range(n)]

        drift = tempo_drift(matched, detected, expected, TARGET)

        assert drift is not None and drift > 5.0

    def test_an_even_take_has_no_drift(self):
        matched, detected, expected = _take(1.0, n=30)

        assert tempo_drift(matched, detected, expected, TARGET) == pytest.approx(
            0.0, abs=0.5
        )

    def test_playing_fast_evenly_is_not_drift(self):
        """**The distinction the whole function exists for.** A take played
        evenly at 75 against a target of 60 has a large tempo *difference* and
        no drift at all. Conflating them would tell a musician who held a
        steady, deliberately brisk tempo that they were accelerating."""
        matched, detected, expected = _take(0.8, n=30)

        assert played_tempo(matched, detected, expected, TARGET) == pytest.approx(
            75.0, abs=0.1
        )
        assert tempo_drift(matched, detected, expected, TARGET) == pytest.approx(
            0.0, abs=0.5
        )

    def test_a_take_too_short_to_have_two_ends_reports_nothing(self):
        """Three windows of eight, or nothing. A drift computed from four
        notes at each end moves with any one mistimed note."""
        matched, detected, expected = _take(1.0, n=20)

        assert tempo_drift(matched, detected, expected, TARGET) is None


class TestSteadiness:
    def test_two_takes_with_the_same_average_are_told_apart(self):
        """The reason this number exists. Both average zero; only one of them
        is control."""
        even = [1.0, -1.0] * 12
        swinging = [40.0, -40.0] * 12

        assert steadiness(even) is not None
        assert steadiness(swinging) > steadiness(even) * 10

    def test_a_consistent_offset_is_not_unsteady(self):
        """Playing consistently 8% behind the beat is a tempo finding, not a
        steadiness one — the notes are perfectly even with each other."""
        assert steadiness([8.0] * 24) == pytest.approx(0.0, abs=0.01)

    def test_playing_evenly_at_a_different_tempo_is_steady(self):
        """**The bug the first version shipped with, caught by measuring.**

        A take played perfectly evenly at 75 against a target of 60 has a
        delta that grows note after note, so an undetrended spread is
        dominated by that slope: it scored 138.5, against 6.0 for a take with
        genuine ±60 ms swings. The figure was ranking an even performance as
        the least steady thing in the set, and merely restating
        `tempo_difference_bpm` in another unit.
        """
        even_but_fast = [i * 2.0 for i in range(24)]

        assert steadiness(even_but_fast) == pytest.approx(0.0, abs=0.01)

    def test_an_accelerando_is_not_hidden_by_detrending(self):
        """Detrending removes a *constant* pace difference, not a changing
        one. A take that accelerates departs from any straight line, which is
        what keeps it visible here as well as in `drift_bpm`."""
        accelerating = [i * i * 0.5 for i in range(24)]

        assert steadiness(accelerating) > 5.0

    def test_too_few_notes_reports_nothing(self):
        assert steadiness([1.0, -1.0, 2.0]) is None


class TestInsightsFor:
    def test_each_field_is_independently_unknowable(self):
        """A twelve-note take has a pace and a spread but no trustworthy
        drift. Reporting nothing because one of three cannot be computed
        would throw away the two that can."""
        matched, detected, expected = _take(0.8, n=12)

        out = insights_for(matched, detected, expected, TARGET, [2.0] * 12)

        assert out.played_bpm == pytest.approx(75.0, abs=0.1)
        assert out.steadiness_pct is not None
        assert out.drift_bpm is None

    def test_the_difference_is_signed_from_the_musicians_point_of_view(self):
        """Positive means faster than asked for, which is the direction a
        musician reads it in."""
        matched, detected, expected = _take(0.8, n=N)

        out = insights_for(matched, detected, expected, TARGET, [1.0] * N)

        assert out.tempo_difference_bpm == pytest.approx(15.0, abs=0.1)

    def test_a_take_too_small_to_describe_says_nothing_rather_than_zero(self):
        """Zero is a claim. `None` is the absence of one, and a screen can
        tell them apart."""
        out = insights_for([], np.array([]), np.array([]), TARGET, [])

        assert out.as_dict() == {
            "played_bpm": None,
            "tempo_difference_bpm": None,
            "drift_bpm": None,
            "steadiness_pct": None,
        }
