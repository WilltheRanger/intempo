"""Rushing and hesitating look the same to a clock and are opposite to a musician.

Playing steadily a little fast is a **ramp**: every interval is slightly short,
the offset grows note after note, and reporting it is the entire product.
Hesitating is a **step**: one or two intervals are much too long and then the
pulse resumes.

The app measured every note from the first note of the take, so it could not
tell them apart. A take that held bar 8 a beat too long was reported as:

    m8 +29%  m9 +99%  m10 +100%  m11 +99%  m12 +100%  m13 +99%  m14 +100%  m15 +99%

Eight bars named in a performance where one bar was long and the rest was
perfect. Asked what the app should say, the user chose "one bar dragged —
measure against your own pulse".

These tests run on offset series directly rather than audio. The question is
what the reference does, and a detector in the middle would only add noise to
it; `test_varied_rhythm.py` covers the same cases end to end.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.classification import _pulse_anchors

BEAT_S = 1.0


def _deltas(offsets: list[float]) -> np.ndarray:
    """Milliseconds of drift per note, as `compute_deltas` would report them."""
    series = np.array(offsets, dtype=float)
    return (series - _pulse_anchors(series, BEAT_S)) * 1000.0


def _steady(rate_s: float, notes: int = 20) -> list[float]:
    return list(np.cumsum([0.0] + [rate_s] * (notes - 1)))


@pytest.mark.parametrize("rate_ms", [-8, -30, 50, 120])
def test_playing_steadily_off_the_beat_still_accumulates(rate_ms: int) -> None:
    """The thing that must not be lost.

    The rushing fixture drifts 8 ms a beat and is *called* a rushing clip. Any
    reference that measures a note against only its neighbour reports that as
    steady, which is why this is not simply interval timing.
    """
    deltas = _deltas(_steady(rate_ms / 1000.0))

    assert deltas[0] == pytest.approx(0.0)
    assert deltas[-1] == pytest.approx(rate_ms * 19, abs=1e-6), (
        "a steady drift was absorbed instead of reported"
    )
    # Monotone: the whole point is that it grows.
    assert np.all(np.diff(deltas) * np.sign(rate_ms) > 0)


def test_a_take_played_exactly_reads_as_exact() -> None:
    assert np.all(_deltas([0.0] * 20) == 0.0)


def test_one_pause_is_reported_where_it_happened_and_nowhere_else() -> None:
    """A musician who stops for a third of a second and carries on has not
    dragged the rest of the piece."""
    deltas = _deltas([0.0] * 6 + [0.30] * 14)

    assert deltas[6] == pytest.approx(300.0)
    assert np.all(deltas[7:] == 0.0), "the bars after the pause were still blamed"
    assert np.all(deltas[:6] == 0.0)


def test_a_bar_played_slowly_is_dragging_and_says_so() -> None:
    """The other half, and the reason the reference re-anchors after a *run*.

    Four stretched intervals in a row is a bar played slow, not four separate
    hesitations. Absorbing them one at a time would report the bar as clean,
    which is the opposite mistake to the one being fixed.
    """
    offsets = list(np.cumsum([0.0] * 5 + [0.2] * 4 + [0.0] * 11))
    deltas = _deltas(offsets)

    assert list(deltas[5:9]) == pytest.approx([200.0, 400.0, 600.0, 800.0])
    assert np.all(deltas[9:] == 0.0), "the bars after the slow one were blamed"


def test_rushing_resumes_from_where_the_musician_actually_is() -> None:
    """The case that decides whether this is a reference or a filter.

    Someone rushing, who stops, and who then carries on rushing: the pause
    belongs to its own note, and the rushing on either side of it is still
    rushing. Nothing here may quietly swallow the second half.
    """
    offsets = list(np.cumsum([0.0] + [-0.03] * 5 + [0.35] + [-0.03] * 13))
    deltas = _deltas(offsets)

    assert list(deltas[:6]) == pytest.approx([0, -30, -60, -90, -120, -150])
    assert deltas[6] == pytest.approx(200.0), "the pause itself"
    assert list(deltas[7:11]) == pytest.approx([-30, -60, -90, -120]), (
        "the rushing after the pause was lost"
    )


def test_a_take_that_accelerates_is_not_mistaken_for_a_sequence_of_steps() -> None:
    """Getting faster and faster is a curve, and every point of it is real."""
    offsets = list(np.cumsum([0.0] + [-0.005 * i for i in range(1, 20)]))
    deltas = _deltas(offsets)

    assert np.all(np.diff(deltas) < 0), "an accelerating take was flattened"
    assert deltas[-1] < -800


def test_a_perfect_take_does_not_read_as_all_disturbance() -> None:
    """Why there is a floor as well as a multiple of the spread.

    A take played to machine precision has a median deviation of zero, so a
    pure multiple would make the threshold zero and *every* interval a
    disturbance. Ordinary human unevenness must sit under it too.
    """
    rng = np.random.default_rng(4)
    jitter = rng.normal(0, 0.012, 40)  # ±12 ms, a good player
    deltas = _deltas(list(np.cumsum(jitter)))

    # Nothing re-anchored: the deltas are the running sum, untouched.
    assert deltas == pytest.approx(np.cumsum(jitter) * 1000.0 - jitter[0] * 1000.0)


def test_an_empty_take_does_not_raise() -> None:
    assert _pulse_anchors(np.array([]), BEAT_S).size == 0
