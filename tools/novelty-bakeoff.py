#!/usr/bin/env python3
"""Onset novelty bake-off: is there a better detector than spectral flux?

    cd backend && uv run python ../tools/novelty-bakeoff.py

Four novelty functions, peak-picked identically, over the tuning corpus and over
a sweep of attack softness. The question it exists to answer is the one from the
2026-08-29 audit: does complex-domain or phase-based novelty (FMP C6S1) beat
librosa's spectral flux on the soft attacks a bowed double bass produces?

**It is kept because the answer changes when the corpus does.** Run against the
six synthetic click tracks it cannot decide anything — flux already scores 100%
on them, and nothing beats 100%. Re-run it the day real recordings land; that is
when it becomes evidence rather than an exercise.

The novelty implementations below are the FMP C6S1 reference versions, written
out here rather than taking a dependency on `libfmp`, which is a teaching
library whose DTW would also be slower than the Cython one already in librosa.
"""

import sys
from pathlib import Path

# **Before `numpy` and `librosa`, not after.** The re-exec has to happen while
# the only imports done are ones the system interpreter certainly has —
# otherwise this dies on the very import the re-exec exists to satisfy, which
# is exactly what it did on the first attempt at this fix.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend_python import use_backend_python  # noqa: E402

use_backend_python()

import numpy as np  # noqa: E402
import librosa  # noqa: E402

# Run from anywhere; the backend package is the thing being measured.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

HOP, N_FFT = 512, 2048


def _principal(x):
    """Wrap to (-0.5, 0.5] turns."""
    return x - np.round(x)


def spectral_flux(y, sr):
    """What the pipeline uses today: mel-band flux via librosa."""
    return librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)


def energy_novelty(y, sr):
    """C6S1: local energy, differentiated, half-wave rectified."""
    rms = librosa.feature.rms(y=y, frame_length=N_FFT, hop_length=HOP)[0]
    log = np.log1p(10 * rms)
    return np.maximum(np.diff(log, prepend=log[:1]), 0.0)


def phase_novelty(y, sr):
    """C6S1: second difference of unwrapped phase.

    A steadily sounding partial advances its phase by a constant amount each
    frame, so the second difference is ~0. An attack disturbs it.
    """
    X = librosa.stft(y, n_fft=N_FFT, hop_length=HOP)
    phase = np.angle(X) / (2 * np.pi)
    d1 = _principal(np.diff(phase, axis=1, prepend=phase[:, :1]))
    d2 = _principal(np.diff(d1, axis=1, prepend=d1[:, :1]))
    return np.sum(np.abs(d2), axis=0)


def complex_novelty(y, sr):
    """C6S1: complex-domain — magnitude *and* phase prediction.

    Predicts each frame from the previous two (steady magnitude, steady phase
    advance) and measures the deviation. The one that is supposed to help on
    soft attacks, where magnitude alone barely moves but phase does.
    """
    X = librosa.stft(y, n_fft=N_FFT, hop_length=HOP)
    mag, phase = np.abs(X), np.angle(X) / (2 * np.pi)
    d1 = _principal(np.diff(phase, axis=1, prepend=phase[:, :1]))
    predicted_phase = phase + d1
    predicted = np.empty_like(X)
    predicted[:, 0] = X[:, 0]
    predicted[:, 1:] = mag[:, :-1] * np.exp(2j * np.pi * predicted_phase[:, :-1])
    deviation = np.abs(X - predicted)
    # Rectified: only a *growing* partial is an attack.
    growing = mag >= np.concatenate([mag[:, :1], mag[:, :-1]], axis=1)
    return np.sum(deviation * growing, axis=0)


METHODS = {
    "flux (current)": spectral_flux,
    "energy": energy_novelty,
    "phase": phase_novelty,
    "complex": complex_novelty,
}


# --- experiment 1: the tuning corpus ---------------------------------------

def against_the_corpus():
    from app.services import audio as audio_svc
    from app.services.audio_config import load_audio_config
    from tuning_dashboard.corpus import load_corpus

    cfg = load_audio_config()


    def pick(strength, sr, delta):
        """The pipeline's own peak-picking, on whatever novelty it is handed.

        Normalised first, because these four have wildly different scales and
        `delta` is an absolute threshold — comparing them at a fixed delta without
        normalising would be comparing loudness, not shape.
        """
        s = np.asarray(strength, dtype=float)
        if s.max() > 0:
            s = s / s.max()
        s = s.copy()
        s[: N_FFT // HOP] = 0.0
        wait = max(1, int(round(cfg.onset.wait_ms / 1000 * sr / HOP)))
        frames = librosa.onset.onset_detect(
            onset_envelope=s, sr=sr, units="frames", hop_length=HOP,
            delta=delta, pre_max=cfg.onset.pre_max, post_max=cfg.onset.post_max,
            wait=wait, backtrack=False,
        )
        return librosa.frames_to_time(frames, sr=sr, hop_length=HOP)


    def score_clip(detected, expected):
        """How many written onsets got a detection within 100ms, and how many
        detections answered to nothing."""
        hit = sum(1 for e in expected if np.any(np.abs(detected - e) < 0.1)) if len(detected) else 0
        spurious = sum(1 for d in detected if not np.any(np.abs(expected - d) < 0.1))
        return hit, spurious


    def true_onsets(clip):
        """Where the generator actually put the attacks.

        Reconstructed from `make_synthetic.py` rather than from the written
        timeline, because two of the six clips *drift on purpose* — scoring a
        rushing clip against a metronomic grid measures the drift, not the
        detector. Getting this wrong is what the first run of this experiment did.
        """
        import importlib.util
        import json
        spec = importlib.util.spec_from_file_location(
            "mk", Path(__file__).resolve().parents[1] / "fixtures" / "audio" / "make_synthetic.py"
        )
        mk = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mk)
        manifest = json.loads(
            (Path(__file__).resolve().parents[1] / "fixtures" / "audio" / "manifest.json").read_text()
        )
        entry = next(e for e in manifest["clips"] if e["id"] == clip.id)
        pairs = mk.expected_onsets(entry["score"], float(entry["target_bpm"]))
        drift = mk.DRIFT.get(clip.id, 0.0)
        suppress = clip.id in mk.SUPPRESS_INTERIOR
        return np.array([
            0.25 + onset + drift * i
            for i, (onset, interior) in enumerate(pairs)
            if not (suppress and interior)
        ])


    clips = [c for c in load_corpus() if c.available]
    # The current delta, and the normalised equivalent, swept so no method is
    # judged at a threshold that happens to suit another.
    DELTAS = [0.02, 0.05, 0.08, 0.12, 0.2]

    print(f"{'clip':<20} {'method':<15} " + "  ".join(f"d={d:<4}" for d in DELTAS))
    print(f"{'':<20} {'':<15} " + "  ".join("hit/spur" for _ in DELTAS))
    for c in clips:
        y, sr = audio_svc.load_audio(str(c.path))
        if c.double_bass:
            y = audio_svc.high_pass(y, sr, cfg.onset.double_bass_highpass_hz)
        y = audio_svc.pre_emphasis(y, config=cfg)
        expected = true_onsets(c)
        for name, fn in METHODS.items():
            cells = []
            for d in DELTAS:
                det = pick(fn(y, sr), sr, d)
                hit, spur = score_clip(det, expected)
                cells.append(f"{hit:>2}/{spur:<2}  ")
            print(f"{c.id:<20} {name:<15} " + "".join(cells) + f"  (of {len(expected)})")
        print()


# --- experiment 2: how soft an attack survives -----------------------------

def against_attack_softness():
    from app.services import audio as audio_svc
    from app.services.audio_config import load_audio_config

    cfg = load_audio_config()
    SR = 22050


    def take(attack_s, n=12, bpm=60, f0=41.2, floor=1.5e-3, seed=2):
        rng = np.random.default_rng(seed)
        spb = 60 / bpm
        onsets = np.array([1.0 + i * spb for i in range(n)])
        y = np.zeros(int(SR * (onsets[-1] + 2.0)))
        for o in onsets:
            m = int(SR * spb * 0.95)
            t = np.arange(m) / SR
            env = (1 - np.exp(-t / attack_s)) * np.exp(-t / (spb * 0.6))
            env *= np.minimum(1.0, (m - np.arange(m)) / (0.12 * SR))
            tone = sum(a * np.sin(2 * np.pi * f0 * k * t)
                       for k, a in [(1, 1.0), (2, .6), (3, .35), (4, .2), (5, .12)])
            y[int(o * SR):int(o * SR) + m] += env * tone * 0.3
        y += rng.normal(0, floor, y.shape)
        return (y / max(np.max(np.abs(y)), 1e-9) * 0.7).astype(np.float32), onsets


    def pick(strength, sr, delta=0.05):
        s = np.asarray(strength, float)
        if s.max() > 0:
            s = s / s.max()
        s = s.copy()
        s[: N_FFT // HOP] = 0.0
        wait = max(1, int(round(cfg.onset.wait_ms / 1000 * sr / HOP)))
        f = librosa.onset.onset_detect(
            onset_envelope=s, sr=sr, units="frames", hop_length=HOP, delta=delta,
            pre_max=cfg.onset.pre_max, post_max=cfg.onset.post_max, wait=wait, backtrack=False)
        return librosa.frames_to_time(f, sr=sr, hop_length=HOP)


    ATTACKS = [0.005, 0.010, 0.020, 0.040, 0.080, 0.150, 0.250]
    print("attack time constant -> hits of 12 / spurious, on a 41 Hz bass tone")
    print(f"{'method':<15}" + "".join(f"{a*1000:>7.0f}ms" for a in ATTACKS))
    for name, fn in METHODS.items():
        cells = []
        for a in ATTACKS:
            y, true = take(a)
            yy = audio_svc.pre_emphasis(
                audio_svc.high_pass(y, SR, cfg.onset.double_bass_highpass_hz), config=cfg)
            det = pick(fn(yy, SR), SR)
            hit = sum(1 for e in true if len(det) and np.any(np.abs(det - e) < 0.12))
            spur = sum(1 for d in det if not np.any(np.abs(true - d) < 0.12))
            cells.append(f"{hit:>4}/{spur:<3}")
        print(f"{name:<15}" + "".join(cells))


if __name__ == "__main__":
    against_the_corpus()
    print()
    against_attack_softness()
