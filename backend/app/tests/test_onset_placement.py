"""Where the detector puts an onset, and what it can hear.

Two findings, both measured on bowed-note fixtures rather than click tracks,
because a click has no attack shape and no low register to filter.

**Onsets sat on a 23 ms grid, and where on the attack they landed depended on
the attack.** A steady quarter at 120 BPM was reported 21 and 22 frames apart in
turn — ±12 ms of alternation on a metronomic take — and the flux peak of a 93 ms
window lags a note's start by however long the note takes to speak: 30 ms after
a 5 ms rise, 65 ms after a 120 ms one. See `audio._REFINE_N_FFT`.

**The instrument's high-pass never reached the detector, and cannot.** The
flux is a difference of log spectra, and a fixed filter is a constant number of
decibels per band that the difference removes. Moving the cutoff into the
detector's own bands was tried and measured no better, because leakage sixty
decibels down makes the same log-flux as the note. What makes that harmless is
the third fact here: the room boom the filter was for is not detected anyway.
See `audio.high_pass`.
"""

from __future__ import annotations

import numpy as np

from app.services import audio as audio_svc
from app.tests.audio_helpers import (
    MIC_NOISE_FLOOR,
    bass_scale,
    synth_bowed_note,
    synth_bowed_take,
    synth_click_track,
)

SR = 22050


def _with_floor(y: np.ndarray) -> np.ndarray:
    rng = np.random.default_rng(1)
    return (y + rng.normal(0, 1e-3, y.size)).astype(np.float32)


def _bowed(times: list[float], rise_s: float, beat: float) -> np.ndarray:
    y = np.zeros(int((times[-1] + 1.5) * SR), dtype=np.float32)
    for index, at in enumerate(times):
        note = synth_bowed_note(440.0 * 2 ** ((index % 5) / 12), beat * 0.95, rise_s=rise_s)
        start = int(at * SR)
        y[start : start + note.size] += note[: y.size - start]
    return _with_floor(y * 0.5)


def test_a_metronomic_take_is_detected_metronomically() -> None:
    """Before: every interval 487.6 or 510.8 ms, the frame grid showing through."""
    times = [0.5 + i * 0.5 for i in range(16)]
    detected = audio_svc.detect_onsets(_with_floor(synth_click_track(times)), SR, min_gap_s=0.5)

    assert detected.size == 16
    assert np.abs(np.diff(detected) - 0.5).max() < 0.003


def test_how_a_note_starts_moves_its_onset_far_less() -> None:
    """Five-millisecond against 120 ms bow attacks, both exactly on the grid.
    The two used to be placed 35 ms apart — the whole inner band at 90 BPM."""
    beat = 60.0 / 90.0
    times = [0.8 + i * beat for i in range(12)]

    def latency(rise_s: float) -> float:
        detected = audio_svc.detect_onsets(
            audio_svc.pre_emphasis(_bowed(times, rise_s, beat)), SR,
            instrument="violin", min_gap_s=beat,
        )
        return float(np.mean([detected[np.argmin(np.abs(detected - t))] - t for t in times]))

    assert abs(latency(0.12) - latency(0.005)) < 0.02


def test_placing_an_onset_never_crosses_its_neighbours() -> None:
    """Sixteenths at 150 BPM, 100 ms apart: every onset stays in its own half of
    each gap, so nothing is reordered and nothing moves onto the next note."""
    gap = 60.0 / 150.0 / 4
    times = [0.5 + i * gap for i in range(32)]
    y = _with_floor(synth_click_track(times))
    coarse = audio_svc.librosa.frames_to_time(
        audio_svc.librosa.onset.onset_detect(
            y=y, sr=SR, hop_length=512, units="frames", pre_max=1, post_max=1
        ),
        sr=SR,
        hop_length=512,
    )
    placed = audio_svc.refine_onset_times(y, SR, coarse)

    assert placed.size == coarse.size
    assert np.all(np.diff(placed) > 0)
    halves = np.diff(coarse) / 2
    moves = np.abs(placed - coarse)
    assert np.all(moves[1:] <= halves + 1e-9) and np.all(moves[:-1] <= halves + 1e-9)


# ---------------------------------------------------------------------------
# The cutoff that cannot reach a log-spectral detector
# ---------------------------------------------------------------------------


def _bass_with_a_room_boom() -> tuple[np.ndarray, list[float], float]:
    """Bowed bass notes a beat apart, and between two of them a boom well
    under 80 Hz — a room mode, a foot on the floor — five times their peak."""
    beat = 60.0 / 72.0
    times = [0.8 + i * beat for i in range(8)]
    y = synth_bowed_take(times, sr=SR, freqs_hz=bass_scale(8), note_dur_s=0.5, noise=MIC_NOISE_FLOOR)
    boom_at = times[3] + beat / 2
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    envelope = np.minimum(1.0, t / 0.005) * np.exp(-t / 0.08)
    boom = (3.0 * envelope * np.sin(2 * np.pi * 50.0 * t)).astype(np.float32)
    start = int(boom_at * SR)
    y[start : start + n] += boom
    return y, times, boom_at


def test_a_room_boom_is_not_an_onset_even_unfiltered() -> None:
    """**The risk the bass's high-pass was written for does not arise here.**

    The flux is a mean over 128 mel bands, and a sound confined to the bottom
    two or three barely moves it. Read with the treble settings — no filter,
    no cutoff anywhere — the boom is still not reported, and every note is.
    """
    y, times, boom_at = _bass_with_a_room_boom()
    onsets = audio_svc.detect_onsets(
        audio_svc.pre_emphasis(y), SR, instrument="violin", min_gap_s=60.0 / 72.0 / 2
    )

    assert not np.any(np.abs(onsets - boom_at) < 0.1)
    assert all(np.any(np.abs(onsets - t) < 0.1) for t in times)


def test_a_filter_on_the_waveform_does_not_reach_a_log_spectral_detector() -> None:
    """Why `highpass_hz` changes no onset: a fixed filter is a constant number
    of decibels per band, and the flux differences it away. If this ever reads
    below 0.99, the cutoff has started to matter and `config.toml` is wrong."""
    y, _, _ = _bass_with_a_room_boom()
    plain = audio_svc.onset_envelope(audio_svc.pre_emphasis(y), SR)
    filtered = audio_svc.onset_envelope(
        audio_svc.pre_emphasis(audio_svc.high_pass(y, SR, 80.0)), SR
    )

    assert np.corrcoef(plain, filtered)[0, 1] > 0.99

