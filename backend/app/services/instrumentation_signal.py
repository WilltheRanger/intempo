"""An advisory signal: does this take's audio sound like it has company?

The app asks the musician which instrument they played (`Instrument`, in
`models/user.py`) and tunes onset detection around that answer — it never
checks the answer against the sound. This module is a first, narrow check of
that kind: not an instrument classifier, and not wired into the analysis
pipeline. It answers one question — is there energy, or pitch, below the
violin's open G string (G3 = 196 Hz), more than a clean solo violin take
has any of?

**Where the thresholds come from.** A solo-violin video set (50 YouTube
performances, read-only, outside this repo) was analysed off-pipeline by
decoding the full soundtrack and measuring the share of spectral energy in
the 40-180 Hz band — below G3 and above room rumble. 37 of the 50 were judged
(by eye, from the score on screen) to be solo violin; 9 showed a piano or a
backing track in the score; 4 had audio with pitched content below the
violin range (one is a guitar transcription). The three numbers below are
the fields from that analysis, and on this set they separate cleanly: every
video judged solo violin had `low_band_ratio` under 0.001, and every one
judged to have company had it over 0.004. `fixtures/instrumentation/
solo_violin_benchmark.json` is the metrics table (not the audio) and
`test_instrumentation_signal.py` checks the thresholds against it.

**What this is not.** 0 of those 50 labels are a verified ground truth — they
are one reviewer's visual read of a YouTube video, not a listened-to
confirmation of what instruments actually sound on the track (see that
project's README, point on verified positives). So this is a signal to
surface, not a gate to enforce: a take flagged here may still be exactly what
the musician meant to record (a cello, a piano reduction played along with
on purpose), and a take that passes may still have something else going on
that this band happens not to catch.
"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

#: Hz. The violin's lowest open string.
VIOLIN_FLOOR_HZ = 196.0

#: The band this measures: below the violin floor, above room rumble and mains
#: hum. Matches the off-pipeline analysis exactly, so the fixture's numbers
#: and this function's numbers are the same quantity.
_LOW_BAND_HZ = (40.0, 180.0)

#: STFT window. Short enough to resolve the band edges, long enough that a
#: frame is several cycles of 180 Hz; librosa's default hop (a quarter of
#: this) follows.
_N_FFT = 2048

#: `low_band_ratio` at or above this means company — some instrument or
#: backing track with real energy below the violin's register. Set between
#: the highest clean-solo-violin value (0.0009) and the lowest flagged value
#: (0.0042) in the benchmark; see the fixture and its test.
LOW_BAND_RATIO_FLAG = 0.003

#: `frac_frames_low_band_heavy` at or above this is the same call made a
#: second way: not just some low energy somewhere, but a real share of the
#: take's active frames carrying it. Set the same way (benchmark max clean
#: 0.012, min flagged 0.034).
FRAC_FRAMES_FLAG = 0.02


@dataclass(frozen=True)
class LowBandSignal:
    """The two numbers `low_band_signal` measures, both in [0, 1]."""

    #: Median, across active frames, of this frame's share of spectral energy
    #: in `_LOW_BAND_HZ`. A single wandering number — the one the benchmark's
    #: cleanest separation is on.
    low_band_ratio: float
    #: Share of active frames whose low-band share exceeds 10% on its own —
    #: whether the energy is a steady floor (one low voice throughout) or a
    #: recurring one (chords landing under the melody), rather than a blip.
    frac_frames_low_band_heavy: float

    @property
    def flagged(self) -> bool:
        """Either number alone is enough — they catch different shapes."""
        return (
            self.low_band_ratio >= LOW_BAND_RATIO_FLAG
            or self.frac_frames_low_band_heavy >= FRAC_FRAMES_FLAG
        )


#: Below this RMS a frame is silence, not a quiet low note — same purpose as
#: the off-pipeline analysis's "active frames", so a silent passage does not
#: count toward either share.
_SILENCE_FLOOR_FRAC_OF_PEAK = 0.01


def low_band_signal(y: np.ndarray, sr: int) -> LowBandSignal:
    """Measure how much sub-violin-range content a take's audio carries.

    Args:
        y: Mono audio samples, as `audio.load_audio` returns them.
        sr: Sample rate.

    Returns:
        The two shares `LowBandSignal` holds. Both are 0.0 for audio with no
        frame loud enough to call active.
    """
    stft = np.abs(librosa.stft(y, n_fft=_N_FFT))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=_N_FFT)
    power = stft**2

    total = power.sum(axis=0)
    peak = float(total.max()) if total.size else 0.0
    active = total > (peak * _SILENCE_FLOOR_FRAC_OF_PEAK) if peak > 0 else np.zeros_like(total, dtype=bool)
    if not active.any():
        return LowBandSignal(low_band_ratio=0.0, frac_frames_low_band_heavy=0.0)

    low = (freqs >= _LOW_BAND_HZ[0]) & (freqs <= _LOW_BAND_HZ[1])
    low_share = np.divide(
        power[low].sum(axis=0),
        total,
        out=np.zeros_like(total),
        where=total > 0,
    )
    low_share = low_share[active]

    return LowBandSignal(
        low_band_ratio=round(float(np.median(low_share)), 4),
        frac_frames_low_band_heavy=round(float(np.mean(low_share > 0.10)), 4),
    )
