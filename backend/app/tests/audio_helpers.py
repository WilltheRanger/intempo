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


# ---------------------------------------------------------------------------
# Bowed double bass
#
# `synth_click_track` is an 880 Hz decaying sine — five octaves above the
# instrument this app was written for, with an attack a hundred times sharper
# than a bow can produce. It is the right tool for testing alignment, where the
# audio only has to put an onset at a known time. It is the wrong one for
# testing *detection* on the instrument in the spec's title, and until this
# existed nothing tested that at all: `double_bass=True` had plumbing tests
# only, and the low-register path had never been shown a low register.
# ---------------------------------------------------------------------------

#: Open strings, four-string double bass, in hertz.
OPEN_E1 = 41.2
OPEN_A1 = 55.0
OPEN_D2 = 73.4
OPEN_G2 = 98.0

#: A quiet room and a decent microphone, as an amplitude.
#:
#: Not optional. A clip that starts from *digital* silence is a step from -inf
#: dB, and the mel-flux detector reads that as an onset an order of magnitude
#: larger than any note — after librosa's `normalize=True` divides the envelope
#: by it, every real note falls under `delta` and the take reads as empty. That
#: is an artifact of the generator, not a property of the pipeline, and it has
#: now bitten this project three times.
MIC_NOISE_FLOOR = 10 ** (-60 / 20)


def synth_bowed_note(
    freq_hz: float,
    seconds: float,
    *,
    sr: int = 22050,
    rise_s: float = 0.035,
    decay: float = 0.6,
) -> np.ndarray:
    """One bowed string: a Helmholtz sawtooth under a slow attack.

    Two properties matter and neither is decorative.

    **The harmonic series**, because it is the reason a high-pass at 80 Hz can
    work on an instrument whose lowest fundamental is 41 Hz at all — a bowed
    string is close to a sawtooth, so the partials at 82, 124, 165 Hz carry the
    attack after the fundamental is filtered away. A pure tone would test the
    filter rather than the detector.

    **The slow rise**, because a bow does not click. A real détaché attack
    takes tens of milliseconds to reach speed, which is precisely why the spec
    gives the low register its own, lower, detection threshold.
    """
    n = int(seconds * sr)
    t = np.arange(n) / sr
    y = np.zeros(n)
    partial = 1
    while freq_hz * partial < 0.45 * sr:
        y += np.sin(2 * np.pi * freq_hz * partial * t) / partial
        partial += 1

    envelope = np.exp(-t * decay)
    rise = min(int(rise_s * sr), n)
    if rise:
        # Raised cosine: zero slope at both ends, so the attack is a rise
        # rather than an edge.
        envelope[:rise] *= 0.5 * (1 - np.cos(np.linspace(0, np.pi, rise)))
    release = min(int(0.04 * sr), n)
    if release:
        envelope[-release:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, release)))

    return (envelope * y / max(1e-9, float(np.abs(y).max()))).astype(np.float32)


def synth_bowed_take(
    onset_times_s: Sequence[float],
    *,
    sr: int = 22050,
    freqs_hz: Sequence[float] | None = None,
    note_dur_s: float = 0.55,
    room_mode_hz: float = 58.0,
    noise: float = MIC_NOISE_FLOOR,
) -> np.ndarray:
    """A bowed passage in a small room, with a floor.

    The room is one resonant mode rather than a reverb model. A practice room's
    lowest modes sit in the same octave as a bass's fundamentals, and their ring
    is the stated reason the double-bass path high-passes before detecting —
    so a fixture without one cannot show whether that decision was right.
    """
    from scipy.signal import lfilter

    pitches = list(freqs_hz) if freqs_hz is not None else [OPEN_E1] * len(onset_times_s)
    total_s = (max(onset_times_s) if len(onset_times_s) else 0.0) + note_dur_s + 0.5
    y = np.zeros(int(total_s * sr), dtype=np.float32)
    for index, onset in enumerate(onset_times_s):
        note = synth_bowed_note(pitches[index % len(pitches)], note_dur_s, sr=sr)
        start = int(onset * sr)
        end = min(start + note.size, y.size)
        y[start:end] += note[: end - start]

    omega = 2 * np.pi * room_mode_hz / sr
    ring = np.exp(-omega / (2 * 30.0))
    y = y + lfilter(
        [0.55 * (1 - ring)], [1.0, -2 * ring * np.cos(omega), ring * ring], y
    ).astype(np.float32)

    y = y / max(1e-9, float(np.abs(y).max())) * 0.6
    if noise:
        rng = np.random.default_rng(11)
        y = y + rng.normal(0, noise, y.size).astype(np.float32)
    return np.clip(y, -1.0, 1.0).astype(np.float32)


def bass_scale(n: int, *, root_hz: float = OPEN_E1) -> list[float]:
    """`n` pitches walking up and down a major scale from `root_hz`.

    Repeated notes on one string are the *easy* case for a flux detector and
    the rare one in practice; a passage that changes pitch is what a musician
    actually plays and what the fixture should contain.
    """
    steps = [0, 2, 4, 5, 7, 9, 11, 12, 14, 12, 11, 9, 7, 5, 4, 2]
    return [root_hz * 2 ** (steps[i % len(steps)] / 12) for i in range(n)]


# ---------------------------------------------------------------------------
# Degradations — what a phone on a music stand actually records
# ---------------------------------------------------------------------------
#
# **Why these exist.** Every synthetic fixture above is a clean close-mic
# recording: one room mode, a -60 dBFS floor, no reflections, no clipping.
# That is not what the pipeline is given. A musician props a phone on a stand
# two metres away in a room with hard walls, an extractor fan running, and an
# input stage that limits the loudest attacks — and the detector has to find
# the same onsets in *that*.
#
# Nothing here modelled any of it, so "does this survive a worse recording"
# had no answer, and any threshold chosen against the clean fixtures was
# chosen against the easy case. `docs/subsystems.md` records what that costs:
# a change tuned on a pure sine read the *opposite* way on a bowed string.
# These three are the axes a phone recording actually moves along.


def add_noise_at_snr(y: np.ndarray, snr_db: float, *, seed: int = 7) -> np.ndarray:
    """Broadband noise at a stated signal-to-noise ratio.

    **An SNR, not an amplitude**, which is the difference between a knob that
    means something and one that does not. `synth_bowed_take`'s `noise` is an
    absolute floor, so its effect depends entirely on how loud the take
    happens to be — fine for "there is a floor at all", useless for "how much
    noise can this survive". Signal power is measured over the part that
    sounds rather than the whole buffer: a take is mostly decay and silence,
    and including those puts the reference power somewhere between the notes
    and the floor, which would make the ratio a function of the tempo.

    Gaussian rather than a recording of a room. What matters to a flux
    detector is that energy is spread across the mel bands at every frame,
    raising the floor the peak-picker normalises against; the exact spectrum
    of one extractor fan is not general.
    """
    sounding = y[np.abs(y) > 0.05 * max(1e-9, float(np.abs(y).max()))]
    if sounding.size == 0:
        sounding = y
    signal_power = float(np.mean(sounding.astype(np.float64) ** 2))
    noise_power = signal_power / (10 ** (snr_db / 10))
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, np.sqrt(noise_power), y.size)
    return (y + noise).astype(np.float32)


def add_room_reverb(
    y: np.ndarray,
    sr: int,
    *,
    rt60_s: float = 0.6,
    wet: float = 0.35,
    predelay_s: float = 0.012,
    seed: int = 13,
) -> np.ndarray:
    """A decaying reflection tail — the distance axis.

    **This is the degradation that should hurt an onset detector most**, and
    the one the fixtures had no model of. `synth_bowed_take`'s room is a
    single resonant mode: it rings at one frequency and says nothing about
    reflections. Reverb is different in the way that matters here — it lays a
    smeared copy of every previous note *under* the next attack, so the flux
    at an onset is measured against a floor the take itself raised. A note
    following a loud one is the hard case, and no clean fixture contains it.
    
    Exponentially-decaying Gaussian noise as the impulse response: the
    standard cheap model of a diffuse tail, and diffuseness is the property
    being tested. `rt60_s` is the time to -60 dB — 0.6 s is a small room with
    hard surfaces, 1.5 s is a hall.

    `wet` is the reflected proportion, which in a real room is what moving the
    microphone further away changes.
    """
    n = max(1, int(rt60_s * sr))
    rng = np.random.default_rng(seed)
    # -60 dB over the length of the response, which is what RT60 means.
    tail = rng.normal(0, 1, n) * 10 ** (-3 * np.arange(n) / n)
    tail /= max(1e-9, float(np.sqrt(np.sum(tail**2))))

    pre = int(predelay_s * sr)
    impulse = np.concatenate([np.zeros(pre), tail])
    wetted = np.convolve(y.astype(np.float64), impulse)[: y.size]

    # Matched in power before mixing, so `wet` is a mix ratio rather than a
    # number whose meaning changes with `rt60_s`.
    dry_power = float(np.mean(y.astype(np.float64) ** 2))
    wet_power = float(np.mean(wetted**2))
    if wet_power > 0:
        wetted *= np.sqrt(dry_power / wet_power)

    return ((1 - wet) * y + wet * wetted).astype(np.float32)


def apply_clipping(y: np.ndarray, headroom_db: float) -> np.ndarray:
    """Hard clipping at `headroom_db` below the take's peak.

    The input-stage axis. A phone's microphone path limits, and a détaché
    attack is the loudest thing in the take — so the part that gets flattened
    is precisely the transient the detector is looking for. Hard rather than
    soft because the question is what happens when the attack's *shape* is
    destroyed, and a soft knee is a gentler version of the same experiment.

    Expressed as headroom below peak rather than as an absolute level, so the
    number means the same thing whatever the take's gain is — which is the
    same reason `add_noise_at_snr` takes a ratio.
    """
    peak = max(1e-9, float(np.abs(y).max()))
    ceiling = peak * 10 ** (-abs(headroom_db) / 20)
    return np.clip(y, -ceiling, ceiling).astype(np.float32)


def detection_scores(
    detected_s: Sequence[float], truth_s: Sequence[float], *, tol_s: float = 0.05
) -> dict[str, float]:
    """Recall, precision and mean timing error against known onset times.

    **Greedy nearest-match within `tol_s`, each truth onset claimed once**, so
    a detector that fires twice on one note scores one hit and one false
    positive rather than two hits. That distinction is the whole difference
    between "finds the notes" and "finds the notes and nothing else", and a
    sweep that could not see it would call a detector that doubled every
    attack perfect.

    50 ms is the tolerance because the pipeline does not need better: a
    constant lag is fitted out before quality is measured (`_residuals`), and
    what survives is variation. Timing error is reported separately for that
    reason — it is the number that actually costs a take.
    """
    truth = list(truth_s)
    claimed = [False] * len(truth)
    errors: list[float] = []
    hits = 0

    for onset in detected_s:
        best, best_gap = -1, tol_s
        for index, t in enumerate(truth):
            if claimed[index]:
                continue
            gap = abs(onset - t)
            if gap <= best_gap:
                best, best_gap = index, gap
        if best >= 0:
            claimed[best] = True
            hits += 1
            errors.append(onset - truth[best])

    detected_n = len(list(detected_s))
    return {
        "recall": hits / len(truth) if truth else 0.0,
        "precision": hits / detected_n if detected_n else 0.0,
        "n_detected": float(detected_n),
        "mean_error_ms": float(np.mean(errors) * 1000) if errors else float("nan"),
        # The number that survives the offset fit, and therefore the one that
        # decides whether a take passes.
        "jitter_ms": float(np.std(errors) * 1000) if errors else float("nan"),
    }
