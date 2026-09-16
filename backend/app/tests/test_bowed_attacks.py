"""What a bow does to onset detection, on the repo's own bowed model.

**Nothing here changes a threshold.** It records what the pipeline does with a
slow attack, because until 2026-09-14 nothing did: every clip in
`fixtures/audio/` is a click track, `test_bass_onsets.py` checks the low
register at one rise time, and the behaviour as the rise *grows* — which is
what separates a bow from a pluck — was unmeasured.

The findings these pin, in the order they matter:

1. **A slow attack is not double-triggered.** The obvious theory is that a
   broad flux hump yields several peaks per note; measured, it does not. On a
   95-note page at a 120 ms rise, no two detections land closer than 279 ms
   while the closest written gap is 375 ms. `pre_max`/`post_max` — derived per
   take from that written gap — already exclude it.
2. **The onset arrives late, and by an amount that varies.** Same take: 61 ms
   late after a long note, 123 ms late inside a run of eighths. A *constant*
   lag costs nothing, because `_residuals` fits offset and rate before quality
   is measured; a lag that moves with the preceding gap is what survives that
   fit.
3. **Which is why a slow bass take is still refused**, and this file asserts
   that rather than hiding it.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.alignment import closest_expected_gap, build_timeline
from app.services.analysis import analyze, prepare_for_alignment
from app.services.audio_config import load_audio_config
from app.services.score_schema import Measure, Note, ScoreJson
from app.tests import audio_helpers as H
from app.tests.audio_helpers import OPEN_A1, OPEN_D2, OPEN_E1, OPEN_G2, synth_bowed_take

SR = 22050
BPM = 60.0
BASS = [OPEN_E1, OPEN_A1, OPEN_D2, OPEN_G2]


def _page(bars: int = 6) -> ScoreJson:
    return ScoreJson(
        ocr_confidence=0.9,
        measures=[
            Measure(measure_number=n + 1, notes=[Note(pitch="E2", duration="quarter")] * 4)
            for n in range(bars)
        ],
    )


def _take(score: ScoreJson, rise_s: float) -> tuple[np.ndarray, np.ndarray]:
    """A bowed take of `score` with the given attack, and the written times."""
    written = np.asarray(build_timeline(score, BPM).onsets, dtype=float)
    original = H.synth_bowed_note

    def slower(freq, seconds, *, sr=SR, rise_s=rise_s, decay=0.6):
        return original(freq, seconds, sr=sr, rise_s=rise_s, decay=0.6)

    H.synth_bowed_note = slower
    try:
        y = synth_bowed_take(written + 1.0, freqs_hz=BASS, note_dur_s=0.55)
    finally:
        H.synth_bowed_note = original
    return y, written + 1.0


@pytest.mark.parametrize("rise_s", [0.035, 0.090, 0.160])
def test_a_slow_attack_is_not_double_triggered(rise_s: float) -> None:
    """The theory that a broad hump fires twice per note. It does not."""
    score = _page()
    y, written = _take(score, rise_s)
    cfg = load_audio_config()

    heard = prepare_for_alignment((y, SR), score, BPM, double_bass=True, config=cfg)
    detected = np.sort(np.asarray(heard.onsets, dtype=float))
    floor = closest_expected_gap(
        np.asarray(build_timeline(score, BPM).onsets, dtype=float)
    )

    assert detected.size >= 2
    gaps = np.diff(detected)
    assert gaps.min() > floor * 0.6, (
        f"two detections {gaps.min() * 1000:.0f} ms apart on a page whose "
        f"closest written gap is {floor * 1000:.0f} ms — that is a re-trigger"
    )


def test_the_onset_arrives_late_and_the_lateness_moves() -> None:
    """The effect that actually costs quality, measured rather than asserted
    away. A constant lag is free — `_residuals` removes offset and rate. This
    one is not constant, and that is the whole problem."""
    score = _page()
    y, written = _take(score, 0.160)
    cfg = load_audio_config()

    heard = prepare_for_alignment((y, SR), score, BPM, double_bass=True, config=cfg)
    detected = np.sort(np.asarray(heard.onsets, dtype=float))
    lags = [
        float(d - max((t for t in written if t <= d + 0.03), default=written[0]))
        for d in detected
    ]
    lags = np.array([lag for lag in lags if -0.05 < lag < 0.5])

    assert lags.size >= 4
    assert lags.min() > 0.0, "a bowed onset is never detected early"
    # Late, and by a margin that moves. Both halves are the finding.
    assert np.median(lags) > 0.02


def test_a_bowed_bass_take_at_the_default_rise_is_still_read() -> None:
    """The guard on everything above: the case the repo's own model calls
    typical must keep working, or a repair aimed at slow attacks has broken
    the ordinary one."""
    score = _page()
    y, _ = _take(score, 0.035)

    result = analyze((y, SR), score, BPM, double_bass=True)

    assert result.status == "ok", result.verdict
    assert result.quality > load_audio_config().alignment.broken_quality
