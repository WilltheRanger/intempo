"""Does `instrumentation_signal.low_band_signal` flag the right takes?

Two kinds of evidence, for two different failure modes:

- the Batch 3 corpus clips (`fixtures/audio/*.wav`) are real recordings
  (synthesized, but of real spectra — see `audio_helpers.py`) all played on
  a double bass, at `OPEN_E1` and friends, well below the violin's G3. They
  should all flag.
- a melody in the violin's own register, synthesized the same way, should
  not.

The benchmark fixture (`fixtures/instrumentation/solo_violin_benchmark.json`)
is the other direction: given the real numbers a larger, more varied set of
real recordings produced, does the threshold this module chose agree with
the label a reviewer gave them? It is read-only evidence the thresholds were
not picked blind — see `instrumentation_signal`'s docstring for why the
labels themselves are not ground truth.
"""

from __future__ import annotations

import json
from pathlib import Path

import librosa
import numpy as np
import pytest

from app.services.instrumentation_signal import low_band_signal
from app.tests.audio_helpers import OPEN_E1, synth_bowed_take

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"
AUDIO_FIXTURES = sorted((FIXTURES / "audio").glob("*.synthetic.wav"))
BENCHMARK = json.loads(
    (FIXTURES / "instrumentation" / "solo_violin_benchmark.json").read_text()
)


@pytest.mark.parametrize("path", AUDIO_FIXTURES, ids=lambda p: p.name)
def test_double_bass_corpus_clips_flag(path: Path) -> None:
    """Every Batch 3 clip is a bass take; all six should read as "company"."""
    y, sr = librosa.load(str(path), sr=None, mono=True)
    signal = low_band_signal(y, sr)
    assert signal.low_band_ratio > 0.0
    assert signal.flagged, f"{path.name}: {signal}"


def test_violin_register_melody_is_not_flagged() -> None:
    """A melody that never leaves the violin's range should pass clean."""
    # G4 up to E6 — a scale that stays well clear of the 196 Hz floor.
    freqs = [392.0, 440.0, 523.25, 587.33, 659.25, 698.46, 783.99, 880.0]
    onsets = [0.3 * i for i in range(len(freqs))]
    y = synth_bowed_take(onsets, freqs_hz=freqs, sr=22050, noise=0.0)
    signal = low_band_signal(y, 22050)
    assert not signal.flagged, signal


def test_open_e1_double_bass_note_is_well_below_the_flag_threshold() -> None:
    """A single sustained low note should separate clearly, not marginally."""
    from app.services.instrumentation_signal import LOW_BAND_RATIO_FLAG

    y = synth_bowed_take([0.2], freqs_hz=[OPEN_E1], sr=22050, note_dur_s=1.0, noise=0.0)
    signal = low_band_signal(y, 22050)
    assert signal.low_band_ratio > 2 * LOW_BAND_RATIO_FLAG


def test_silence_is_not_flagged() -> None:
    """No active frames means nothing to measure, not a false positive."""
    y = np.zeros(22050, dtype=np.float32)
    signal = low_band_signal(y, 22050)
    assert signal.low_band_ratio == 0.0
    assert signal.frac_frames_low_band_heavy == 0.0
    assert not signal.flagged


def test_benchmark_thresholds_agree_with_the_visual_review() -> None:
    """The chosen thresholds, replayed against the off-pipeline numbers.

    Not a claim that the heuristic is correct — the labels are a visual
    review, not a verified ground truth (see the module docstring and
    `fixtures/instrumentation/SOURCES.md`). This is a regression guard: if a
    future change to the thresholds disagrees with this set far more than
    today's thresholds do, that is worth noticing before it ships.
    """
    from app.services.instrumentation_signal import FRAC_FRAMES_FLAG, LOW_BAND_RATIO_FLAG

    rows = [r for r in BENCHMARK if r["instrumentation_assessment"] != "uncertain"]
    assert len(rows) == 46

    correct = 0
    for row in rows:
        reviewer_flagged = row["instrumentation_assessment"] != "consistent_with_solo_violin"
        heuristic_flagged = (
            row["low_band_40_180hz_ratio_median"] >= LOW_BAND_RATIO_FLAG
            or row["frac_active_frames_low_band_gt_10pct"] >= FRAC_FRAMES_FLAG
        )
        correct += reviewer_flagged == heuristic_flagged

    # 46/46 on this set, since the thresholds were chosen in the gap between
    # the two groups (see the module docstring). A looser bound here so this
    # test is about the heuristic holding up, not about re-deriving the exact
    # midpoint of a 50-video sample.
    assert correct >= 44, f"only {correct}/{len(rows)} agreed with the visual review"
