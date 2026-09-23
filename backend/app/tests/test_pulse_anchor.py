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

from app.services.alignment import pulse_anchors as _pulse_anchors

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

    # Nothing re-anchored: one reference for the whole take, so every interval
    # between two deltas is the interval the musician played. (Where that one
    # reference sits is read from several notes rather than the first — see
    # the origin tests below — so the running sum is shifted, not reshaped.)
    assert np.diff(deltas) == pytest.approx(np.diff(np.cumsum(jitter)) * 1000.0)


def test_one_late_first_note_is_not_copied_onto_every_other_note() -> None:
    """**The reference used to be the first note, and one note is not a pulse.**

    A bow starting from silence speaks tens of milliseconds later than one
    already moving. Measured end to end, a take played exactly on the grid at
    120 BPM with only its first note 40 ms late: 27 of 32 notes `slight`, and
    "You rushed across measures 1–4 by an average of 9 BPM". The other
    thirty-one notes were perfect.
    """
    deltas = _deltas([0.04] + [0.0] * 19)

    assert deltas[0] == pytest.approx(40.0), "the late note is the one that was late"
    assert np.all(np.abs(deltas[1:]) < 1e-6), "the others were blamed for it"


def test_one_early_first_note_is_not_copied_onto_every_other_note() -> None:
    deltas = _deltas([-0.04] + [0.0] * 19)

    assert deltas[0] == pytest.approx(-40.0)
    assert np.all(np.abs(deltas[1:]) < 1e-6)


def test_the_origin_reads_through_a_varied_rhythm() -> None:
    """Projected along written time, not note count: a steady 5% rush through
    quarters and eighths is still a straight ramp in time, and the first note
    still sits exactly on it."""
    written = np.cumsum([0.0, 1.0, 0.5, 0.5, 1.0, 0.5, 0.5, 1.0, 1.0, 0.5, 0.5])
    offsets = -0.05 * written
    offsets[0] += 0.03  # and the first note alone a little late
    deltas = (
        offsets - _pulse_anchors(offsets, BEAT_S, positions=written)
    ) * 1000.0

    assert deltas[0] == pytest.approx(30.0, abs=1e-6)
    assert deltas[1:] == pytest.approx(-50.0 * written[1:], abs=1e-6)


def test_an_empty_take_does_not_raise() -> None:
    assert _pulse_anchors(np.array([]), BEAT_S).size == 0


class TestConfidenceAsksTheSameQuestionAsTheVerdict:
    """Quality has to read a take the way the verdict does.

    Once the verdict measured against the musician's pulse, a take with a
    hesitation was analysed *correctly* — every note matched, the two disturbed
    bars named exactly — and then labelled "results may be inaccurate", because
    the residuals were still fitted with one straight line across a genuine
    step. It scored 0.592, under `warn_quality`.

    Making the residuals pulse-relative fixes that, and the obvious worry is
    that it also makes a wrong piece look fine. It does not, and not by luck:
    a wrong piece has an enormous spread of interval errors, so its own
    disturbance threshold is enormous, so nothing is absorbed.
    """

    BPM = 72.0

    @staticmethod
    def _score(measures: int = 5) -> object:
        from app.services.score_schema import Measure, Note, ScoreJson

        return ScoreJson(
            clef="bass",
            time_signature="4/4",
            ocr_confidence=0.9,
            measures=[
                Measure(
                    measure_number=m + 1,
                    notes=[Note(pitch="E2", duration="eighth")] * 8,
                )
                for m in range(measures)
            ],
        )

    def _expected(self) -> np.ndarray:
        from app.services.alignment import build_timeline

        return build_timeline(self._score(), self.BPM).onsets

    def _quality(self, detected: np.ndarray) -> float:
        from app.services.alignment import align_dtw

        return align_dtw(
            detected - detected[0], self._expected(), target_bpm=self.BPM
        ).quality

    def test_a_take_with_one_hesitation_is_not_flagged_inaccurate(self) -> None:
        """Against `warn_quality`, which is the line the screen actually draws.

        Not against a round number: two notes are lost at the discontinuity, so
        coverage caps this below 1.0 however good the timing is. What matters
        is that the musician is not told to distrust a reading that named their
        hesitation exactly.
        """
        from app.services.audio_config import load_audio_config

        expected = self._expected()
        held = expected.copy()
        held[20:] += 0.8  # a beat lost at note 20, then the pulse resumes

        assert self._quality(held) > load_audio_config().alignment.warn_quality

    def test_a_steadily_rushing_take_is_still_trusted(self) -> None:
        """It always was. This is here so a change to the anchor rule that
        broke it would be caught by the confidence tests as well."""
        expected = self._expected()
        rushed = np.cumsum(
            np.concatenate([[0.0], np.diff(expected) * 0.94])
        )
        assert self._quality(rushed) > 0.9

    def test_half_a_take_is_reported_with_a_caveat_not_refused(self) -> None:
        """The documented contract, and it got *stronger* on 2026-09-14.

        A take of the first twenty notes maps to written notes 0–19 — the right
        ones. It used to score 0.500, over `broken_quality` but under
        `warn_quality`, and the caveat was the honest thing to show because the
        take was being stretched across all forty notes and the deltas were
        only roughly the right ones.

        It now scores 1.000, because it is matched against the twenty notes it
        actually covers rather than the forty on the page. There is nothing
        left to caveat: the passage was played in time.

        The test exists because an earlier draft asserted the take should be
        *refused*, which would have thrown away a real practice session — and
        that draft's instinct is what shipped in the coverage denominator and
        refused every early take. See `DECISIONS.md`, 2026-09-14.
        """
        expected = self._expected()
        detected = expected[: expected.size // 2]

        from app.services.alignment import align_dtw

        result = align_dtw(detected - detected[0], expected, target_bpm=self.BPM)

        assert max(e for _, e in result.mapping) <= 21
        assert result.quality > 0.9

    @pytest.mark.parametrize(
        "name",
        ["every other note", "note values drawn at random"],
    )
    def test_the_takes_that_must_be_refused_still_are(self, name: str) -> None:
        """Both of these span the whole page and neither is the music on it.

        **"last third" used to be here and was deliberately taken out**
        (2026-09-14, `DECISIONS.md`). It is a fragment, and refusing fragments
        is the defect that made every one of the first eight real takes fail —
        the same reason the test above gives for not refusing a first half.
        What is left here are the two takes that are *not* passages: one plays
        every other note of the page, the other note values the page never
        wrote, and both still score under `broken_quality`.
        """
        expected = self._expected()
        detected = {
            "first half": expected[: expected.size // 2],
            "every other note": expected[::2],
            "last third": expected[2 * expected.size // 3 :],
            # Was a 2:1 swing, which is now analysed rather than refused — see
            # `test_long_takes.py`, where the reason is pinned. Values drawn at
            # random are the rhythm the page never wrote that still is refused.
            "note values drawn at random": np.concatenate(
                [
                    [0.0],
                    np.cumsum(
                        np.random.default_rng(1).choice(
                            [0.21, 0.42, 0.83, 1.25], expected.size - 1
                        )
                    ),
                ]
            ),
        }[name]

        assert self._quality(detected) < 0.4

    def test_noise_is_refused_across_seeds(self) -> None:
        expected = self._expected()
        qualities = np.array(
            [
                self._quality(
                    np.sort(
                        np.random.default_rng(seed).uniform(
                            0, float(expected[-1]), expected.size
                        )
                    )
                )
                for seed in range(60)
            ]
        )
        assert int((qualities > 0.4).sum()) <= 2
