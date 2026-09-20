"""The second-look rule, and the guards that stop it inventing notes.

Every test here is about the same question from one side or the other: can
this add a note where there was not one? The recovery pass exists because the
detector loses quiet notes in a live room, and the reason it is shaped as
"look only where the score writes a note and the alignment found nothing" is
that a more sensitive detector was tried first and broke thirteen tests. See
the module docstring.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.onset_recovery import predict_audio_times, recover_onsets

SR = 22050
HOP = 512


def _envelope(peaks_s: list[float], *, seconds: float = 6.0, height: float = 1.0):
    """A flat floor with a narrow hump at each named time."""
    frames = int(seconds * SR / HOP)
    env = np.full(frames, 0.02, dtype=np.float32)
    for at in peaks_s:
        centre = int(at * SR / HOP)
        for offset, scale in ((-1, 0.4), (0, 1.0), (1, 0.4)):
            index = centre + offset
            if 0 <= index < frames:
                env[index] = max(env[index], height * scale)
    return env


def _recover(env, detected, predicted, **kw):
    return recover_onsets(
        env,
        hop_length=HOP,
        sr=SR,
        detected=np.array(detected, dtype=float),
        predicted_s=np.array(predicted, dtype=float),
        search_s=kw.get("search_s", 0.12),
        floor_ratio=kw.get("floor_ratio", 0.08),
        min_separation_s=kw.get("min_separation_s", 0.15),
    )


class TestPredictAudioTimes:
    def test_a_missed_note_is_predicted_at_the_takes_own_pace(self):
        """Not at the metronome's pace — at the one the take actually played.

        The musician set 92 and played 100; a note looked for where 92 says it
        belongs is looked for in the wrong place, by more than the search
        window, on exactly the takes this is meant to help.
        """
        expected = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
        # Played 10% fast, starting 0.5 s in.
        detected = np.array([0.5, 1.4, 3.2, 4.1])
        matched = [(0, 0), (1, 1), (2, 3), (3, 4)]

        predicted = predict_audio_times(matched, detected, expected, [2])

        assert predicted.size == 1
        assert predicted[0] == pytest.approx(2.3, abs=0.05)

    def test_nothing_is_predicted_from_a_single_pair(self):
        """One matched note is not a take, and two points are the minimum a
        line needs. Rescuing from one anchor would place notes by an offset
        with no pace at all."""
        out = predict_audio_times([(0, 0)], np.array([0.5]), np.array([0.0, 1.0]), [1])

        assert out.size == 0

    def test_nothing_is_predicted_when_nothing_is_missing(self):
        out = predict_audio_times(
            [(0, 0), (1, 1)], np.array([0.0, 1.0]), np.array([0.0, 1.0]), []
        )

        assert out.size == 0


class TestRecoverOnsets:
    def test_a_quiet_hump_where_a_note_was_written_is_recovered(self):
        """The case the whole pass exists for."""
        env = _envelope([1.0, 3.0])
        # A quiet third note at 2.0 that the detector did not report.
        env[int(2.0 * SR / HOP)] = 0.25
        env[int(2.0 * SR / HOP) - 1] = 0.10
        env[int(2.0 * SR / HOP) + 1] = 0.10

        found = _recover(env, [1.0, 3.0], [2.0])

        assert found.size == 1
        assert found[0] == pytest.approx(2.0, abs=0.03)

    def test_a_written_note_the_musician_did_not_play_recovers_nothing(self):
        """**The guard that matters most.** The page says a note belongs here
        and the take is silent there. Recovering one would report a note
        nobody played, which is worse than reporting a missed one."""
        env = _envelope([1.0, 3.0])

        found = _recover(env, [1.0, 3.0], [2.0])

        assert found.size == 0

    def test_a_flat_plateau_is_not_an_attack(self):
        """A level is not an onset. A reverb tail or a noise floor sitting
        above the absolute floor still has no peak in it, and requiring an
        interior maximum is what tells them apart."""
        env = _envelope([1.0, 3.0])
        lo = int(1.8 * SR / HOP)
        hi = int(2.2 * SR / HOP)
        env[lo:hi] = 0.30  # loud, and utterly featureless

        found = _recover(env, [1.0, 3.0], [2.0])

        assert found.size == 0

    def test_nothing_is_recovered_on_top_of_something_already_detected(self):
        """A note the first pass found and the alignment simply mapped
        elsewhere must not be added a second time."""
        env = _envelope([1.0, 2.0, 3.0])

        found = _recover(env, [1.0, 2.0, 3.0], [2.0])

        assert found.size == 0

    def test_two_predictions_onto_one_attack_recover_it_once(self):
        """Two adjacent written notes, one broad attack. Without the
        separation guard the same hump answers both predictions and a take
        gains a note it did not contain."""
        env = _envelope([1.0, 3.0])
        centre = int(2.0 * SR / HOP)
        env[centre - 1 : centre + 2] = [0.10, 0.25, 0.10]

        found = _recover(env, [1.0, 3.0], [1.97, 2.03])

        assert found.size == 1

    def test_the_search_window_bounds_how_far_a_note_may_move(self):
        """A hump well outside the window belongs to a different note, and
        pulling it in would report the right count in the wrong places —
        which reads as a played-correctly take and is the harder error to
        notice."""
        env = _envelope([1.0, 3.0])
        far = int(2.5 * SR / HOP)
        env[far - 1 : far + 2] = [0.10, 0.25, 0.10]

        found = _recover(env, [1.0, 3.0], [2.0], search_s=0.12)

        assert found.size == 0

    def test_an_empty_prediction_list_is_a_no_op(self):
        """The byte-identical property, asserted rather than assumed: a take
        where the alignment missed nothing cannot be changed by this pass."""
        env = _envelope([1.0, 2.0, 3.0])

        assert _recover(env, [1.0, 2.0, 3.0], []).size == 0

    def test_a_silent_take_recovers_nothing(self):
        assert _recover(np.zeros(400, dtype=np.float32), [], [1.0]).size == 0
