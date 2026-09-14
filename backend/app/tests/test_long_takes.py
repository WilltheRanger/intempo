"""A practice session is longer than a fixture, and length was breaking it.

Every audio fixture in this repo is between 8 and 32 notes. A real session is
hundreds. The gap between those two numbers hid a bug that made the pipeline
lose confidence in proportion to how much someone practised:

    128 notes   quality 0.986
    256 notes   quality 0.761   ← `warn_quality` is 0.7
    768 notes   quality 0.759

The take is *perfect* in all three. The cause is arithmetic, not playing. Onset
times are quantised to the analysis hop — 23.2 ms — so a median of inter-onset
intervals snaps to a multiple of it: eighth notes written 416.67 ms apart come
back as a uniform 418.0 ms, which is 18 frames. The alignment rescales by that
ratio, inherits 0.3% of rate error, and accumulates it. Past half a note gap
the warp path has to give back a whole note at once, and what it leaves is two
parallel ramps with a step between them — a shape no straight line can remove,
so the residuals that measure "can this be trusted" explode.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.alignment import align_dtw, build_timeline, typical_gap
from app.services.analysis import analyze
from app.services.score_schema import Measure, Note, ScoreJson
from app.tests.audio_helpers import bass_scale, synth_bowed_take

SR = 22050
BPM = 72.0
GAP = 60.0 / BPM / 2  # eighth notes


def _score(measures: int) -> ScoreJson:
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


@pytest.mark.parametrize("measures", [8, 32, 96])
def test_confidence_does_not_fall_away_as_a_take_gets_longer(measures: int) -> None:
    """The headline. A perfect take is a perfect take at any length.

    Anything else means the app gets less sure of itself the more someone
    practises, which is precisely backwards.
    """
    notes = measures * 8
    times = [1.0 + i * GAP for i in range(notes)]
    y = synth_bowed_take(times, freqs_hz=bass_scale(notes), note_dur_s=GAP * 0.7)

    result = analyze((y, SR), _score(measures), target_bpm=BPM, double_bass=True)

    assert result.status == "ok"
    assert result.low_confidence is False
    assert result.quality > 0.95, f"{notes} notes scored {result.quality}"
    assert len(result.per_note) == notes, "notes went missing from a clean take"


def test_the_estimator_is_not_snapped_to_the_frame_grid() -> None:
    """The bug in one assertion.

    Gaps arrive quantised. A median returns whichever quantised value is most
    common — here 418.0 ms — while the interval that actually generated them is
    416.67. Over a few hundred notes that rounding is worth a whole note.
    """
    frame = 512 / SR
    true_gap = 60.0 / BPM / 2
    # What the detector produces: each onset on its nearest frame, so the gaps
    # are mostly 18 frames with a minority of 17.
    onsets = np.round(np.arange(600) * true_gap / frame) * frame
    gaps = np.diff(onsets)

    assert float(np.median(gaps)) == pytest.approx(18 * frame, abs=1e-9), (
        "the premise has changed — the median is no longer frame-snapped"
    )
    assert typical_gap(gaps) == pytest.approx(true_gap, rel=1e-4)


def test_a_pause_does_not_change_the_tempo() -> None:
    """Why this is not simply a mean.

    A mean has no quantisation bias and would fix the length bug on its own.
    It also believes a musician who stopped to turn a page slowed down for the
    whole take.
    """
    gaps = np.full(60, GAP)
    paused = gaps.copy()
    paused[30] = 6.0

    assert typical_gap(paused) == pytest.approx(GAP, rel=1e-6)
    assert float(paused.mean()) > GAP * 1.2, "the pause was too small to prove anything"


def test_a_doubled_detection_does_not_change_the_tempo() -> None:
    """The other direction: one attack reported twice, a few milliseconds apart."""
    gaps = np.concatenate([np.full(60, GAP), np.full(6, 0.05)])

    assert typical_gap(gaps) == pytest.approx(GAP, rel=1e-6)
    assert float(gaps.mean()) < GAP * 0.95, "the doubles were too few to prove anything"


def test_mixed_note_values_are_not_a_special_case() -> None:
    """Half eighths and half quarters have no single gap, and do not need one.

    The same statistic is applied to the written timeline, so the ratio between
    them is still the tempo whatever the writing looks like.
    """
    mixed = np.concatenate([np.full(30, GAP), np.full(30, GAP * 2)])
    assert typical_gap(mixed) == pytest.approx(float(np.median(mixed)), rel=1e-6)


def test_no_gaps_at_all_does_not_raise() -> None:
    assert typical_gap(np.array([])) == 0.0


class TestTheTempoClampStillRefusesWhatItRefused:
    """The bound this estimator feeds is the only thing standing between the
    matcher and a confident analysis of bars nobody played. Changing how the
    ratio is measured must not change what the clamp will accept.

    Synthetic onsets rather than audio: these are claims about the matcher, and
    a detector in the middle would only add noise to them.
    """

    @staticmethod
    def _expected() -> np.ndarray:
        return build_timeline(_score(5), BPM).onsets  # 40 notes

    def test_a_perfect_take_and_a_fast_one_both_score_full_marks(self) -> None:
        expected = self._expected()
        for detected in (expected.copy(), expected * 0.8):
            result = align_dtw(detected - detected[0], expected, target_bpm=BPM)
            assert result.quality == pytest.approx(1.0, abs=1e-3)

    def test_half_a_take_still_maps_to_half_the_score(self) -> None:
        """The failure the bound exists for: a take of the first twenty notes
        smeared across all forty, every delta measured against the wrong bar.

        **The mapping is the assertion.** This also carried
        `quality < 0.7, "half a take must not read as confident"`, which was a
        proxy for the smearing rather than a claim about it — and once
        `align_dtw` matched a passage against the passage it covers
        (2026-09-14, `DECISIONS.md`) the smearing stopped and the proxy started
        failing a take that is now correctly measured. What the bound is
        actually for is the line below it: the first half must reach written
        note 21 and no further. That still holds, and it is checked directly.
        """
        expected = self._expected()
        detected = expected[:20]

        result = align_dtw(detected - detected[0], expected, target_bpm=BPM)

        matched = [e for _, e in result.mapping]
        assert max(matched) <= 21, f"first half reached written note {max(matched)}"

    def test_every_other_note_is_not_read_as_a_slow_complete_take(self) -> None:
        expected = self._expected()
        detected = expected[::2]

        result = align_dtw(detected - detected[0], expected, target_bpm=BPM)

        assert result.quality < 0.4

    def test_a_different_piece_is_refused(self) -> None:
        """Across seeds, not one.

        This asserted `quality < 0.05` on a single random sequence, which was
        over-fitted: onsets scattered uniformly across the same span occasionally
        *do* line up, and the number that came out depended on the seed. What
        the product needs is that the take is refused — `broken_quality`, 0.4 —
        so that is what is measured, over enough draws to mean something.
        """
        from app.services.audio_config import load_audio_config

        expected = self._expected()
        broken = load_audio_config().alignment.broken_quality
        qualities = np.array(
            [
                align_dtw(
                    np.sort(
                        np.random.default_rng(seed).uniform(
                            0, float(expected[-1]), expected.size
                        )
                    ),
                    expected,
                    target_bpm=BPM,
                ).quality
                for seed in range(60)
            ]
        )

        assert float(np.median(qualities)) < 0.05, "the typical case must be nowhere near"
        # Not all sixty: uniform noise over the right span sometimes lands on
        # the beat. It was 4 in 60 before the cost function changed and is 1 now.
        assert int((qualities > broken).sum()) <= 2, (
            f"{int((qualities > broken).sum())} of 60 random takes were analysed "
            f"rather than refused"
        )

    def _in_rhythm(self, gaps: list[float]) -> float:
        """Quality for a take of the right note count in a rhythm of its own."""
        expected = self._expected()
        pattern = np.array((gaps * expected.size)[: expected.size - 1], dtype=float)
        detected = np.concatenate([[0.0], np.cumsum(pattern)])
        return align_dtw(detected, expected, target_bpm=BPM).quality

    def test_a_take_with_no_relation_to_the_written_rhythm_is_refused(self) -> None:
        """The right instrument, the wrong page.

        It has to differ in **rhythm**, not tempo. An earlier version of this
        used forty quarters against forty eighths and scored 1.000 — correctly,
        because that is the same uniform stream played half as fast, which is
        practising slowly. Quality removes offset and rate on purpose.
        """
        assert self._in_rhythm([0.55, 0.28]) < 0.4, "swung against straight eighths"
        assert (
            self._in_rhythm(
                list(np.random.default_rng(1).choice([0.21, 0.42, 0.83, 1.25], 40))
            )
            < 0.4
        ), "note values drawn at random"

    def test_a_rhythm_that_rescales_onto_the_written_one_is_analysed_not_refused(
        self,
    ) -> None:
        """A deliberate change of behaviour, pinned so it cannot drift back.

        Long-short-short against straight eighths used to score 0.000 and be
        refused; it now scores about 0.7 and is analysed. Once the take is put
        into the score's units it *is* mostly eighths with a long note every
        third — so the matcher lines the notes up and the verdict describes the
        rhythm error, note by note, instead of the app saying it could not hear
        the piece.

        That is the same tolerance that lets a hesitating musician keep their
        bar numbers, and it is the price of it: a take in the wrong rhythm gets
        a verdict rather than a refusal. Whether that is the better answer for
        a musician is a real question and it needs a real recording and an ear
        — see EDIT_LOG 2026-09-01.
        """
        assert self._in_rhythm([0.9, 0.35, 0.35]) > 0.4
        assert self._in_rhythm([0.62, 0.21]) > 0.4
