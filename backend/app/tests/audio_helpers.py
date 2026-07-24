"""Synthetic-audio helpers for the Batch 3 pipeline tests.

We can't check real WAVs into the repo for CI, and the DoD's "10 real
recordings sound reasonable" check is a human-ear task that belongs to
the tuning loop (see TUNING_LOG.md), not to unit tests. What unit tests
CAN pin down deterministically is: given onsets at known times, does the
pipeline detect / align / classify them correctly? These helpers
synthesize click tracks with attacks sharp enough for librosa to pick
up, at times we control exactly.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np
import soundfile as sf


def synth_click_track(
    onset_times_s: Sequence[float],
    *,
    sr: int = 22050,
    note_dur_s: float = 0.08,
    freq_hz: float = 880.0,
    tail_s: float = 0.3,
) -> np.ndarray:
    """A mono waveform with a sharp decaying-sine attack at each onset time.

    Each note is a hard onset (no fade-in) with an exponential decay —
    close enough to a plucked/bowed attack that `librosa.onset.onset_detect`
    fires once per note.
    """
    total_s = (max(onset_times_s) if len(onset_times_s) else 0.0) + note_dur_s + tail_s
    y = np.zeros(int(total_s * sr), dtype=np.float32)
    t = np.arange(int(note_dur_s * sr)) / sr
    envelope = np.exp(-t * 30.0)  # sharp decay
    note = (0.8 * envelope * np.sin(2 * np.pi * freq_hz * t)).astype(np.float32)
    for onset in onset_times_s:
        start = int(onset * sr)
        end = min(start + note.size, y.size)
        y[start:end] += note[: end - start]
    return y


def write_wav(path: Path, y: np.ndarray, sr: int = 22050) -> Path:
    sf.write(str(path), y, sr)
    return path


def evenly_spaced(n: int, bpm: float, *, start_s: float = 0.2) -> list[float]:
    """`n` onsets a quarter-note apart at `bpm`, offset by `start_s` of lead-in."""
    sec_per_beat = 60.0 / bpm
    return [start_s + i * sec_per_beat for i in range(n)]
