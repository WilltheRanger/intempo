"""Synthetic audio + score generators for the Batch 3 test suite.

We generate clean, ground-truth-known signals so each layer can be tested
without real recordings (which arrive from the user in Phase 3). Helpers
live here, not in conftest, so test files import them explicitly.
"""

from __future__ import annotations

import numpy as np

from app.services.score_schema import ScoreJson


def synth_audio(
    onset_times_s: list[float] | tuple[float, ...] | np.ndarray,
    *,
    duration_s: float | None = None,
    sr: int = 22050,
    burst_freq_hz: float = 440.0,
    burst_duration_s: float = 0.05,
    burst_decay: float = 30.0,
    leading_silence_s: float = 0.1,
) -> tuple[np.ndarray, int]:
    """Build a mono float32 waveform with a tone-burst at each onset time.

    A small `leading_silence_s` is prepended so librosa's onset detector
    has peak-pick context for the very first burst — otherwise the first
    onset gets dropped (peak-pick needs a `pre_max` window).
    """
    times = np.asarray(onset_times_s, dtype=np.float64) + leading_silence_s
    if duration_s is None:
        duration_s = float(times[-1]) + 0.5 if len(times) else 1.0
    duration_s += leading_silence_s
    total_samples = int(duration_s * sr)
    y = np.zeros(total_samples, dtype=np.float32)

    burst_len = int(burst_duration_s * sr)
    burst_t = np.arange(burst_len) / sr
    burst = (np.sin(2 * np.pi * burst_freq_hz * burst_t) *
             np.exp(-burst_t * burst_decay)).astype(np.float32)

    for onset in times:
        start = int(onset * sr)
        end = start + burst_len
        if start < 0 or end > total_samples:
            continue
        y[start:end] += burst
    # Add a tiny noise floor so the silence isn't dead-zero (more realistic).
    y += (np.random.RandomState(42).normal(0, 1e-4, total_samples)).astype(np.float32)
    return y, sr


def synth_score(
    *,
    n_quarter_notes: int = 8,
    pitch: str = "D3",
    time_signature: str = "4/4",
    key_signature: str = "C major",
    clef: str = "treble",
) -> ScoreJson:
    """Single-measure (or multi-measure split-as-needed) score with N quarter notes."""
    notes_per_measure = 4 if "/" not in time_signature else int(time_signature.split("/")[0])
    measures = []
    note_count = n_quarter_notes
    measure_number = 1
    while note_count > 0:
        in_this_measure = min(notes_per_measure, note_count)
        measures.append({
            "measure_number": measure_number,
            "notes": [
                {"pitch": pitch, "duration": "quarter"} for _ in range(in_this_measure)
            ],
        })
        note_count -= in_this_measure
        measure_number += 1
    return ScoreJson.model_validate({
        "time_signature": time_signature,
        "key_signature": key_signature,
        "clef": clef,
        "measures": measures,
        "ocr_confidence": 1.0,
    })


def synth_score_with_durations(
    durations: list[str],
    *,
    pitch: str = "D3",
    time_signature: str = "4/4",
) -> ScoreJson:
    """Score with custom durations per note (single measure for simplicity)."""
    return ScoreJson.model_validate({
        "time_signature": time_signature,
        "key_signature": "C major",
        "clef": "treble",
        "measures": [
            {
                "measure_number": 1,
                "notes": [{"pitch": pitch, "duration": d} for d in durations],
            }
        ],
        "ocr_confidence": 1.0,
    })


def quarter_note_onsets(n: int, bpm: float = 120.0) -> np.ndarray:
    """Onset timestamps for `n` quarter notes at `bpm`, starting at t=0."""
    seconds_per_beat = 60.0 / bpm
    return np.arange(n) * seconds_per_beat
