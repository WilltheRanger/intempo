"""Render a ground-truth take's timeline straight to an in-memory waveform.

`synthetic_takes.render_take()` is best-effort via `fluidsynth`, which this
sandbox (and possibly CI) does not have — see its docstring. The harness
cannot wait for that: it needs *some* waveform to hand `analyze()` on every
run, not only on machines with a soundfont synth installed.

This is a second, independent rendering path: plain additive sine-wave
synthesis straight to a NumPy array, with a short attack/decay envelope so
`librosa`'s onset detector has something to catch. It is deliberately not a
replacement for `render_take()` — no soundfont, no vibrato, no bow noise —
only enough signal for the pipeline under test to detect onsets and read
pitch at the labelled times. Never written to disk or to this repository;
`analyze()` accepts an `(ndarray, sample_rate)` tuple directly.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import tomllib

_CONFIG_PATH = Path(__file__).resolve().parent / "eval_config.toml"


def _load_synth_config() -> dict:
    return tomllib.loads(_CONFIG_PATH.read_text())["synth"]


_PITCH_CLASS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def pitch_to_hz(pitch: str, cents_offset: float = 0.0) -> float:
    """"A4" -> 440.0; `cents_offset` shifts it (100 cents = one semitone)."""
    letter = pitch[0].upper()
    rest = pitch[1:]
    accidental = 0
    while rest and rest[0] in "#b":
        accidental += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    octave = int(rest)
    midi = 12 * (octave + 1) + _PITCH_CLASS[letter] + accidental
    semitones_from_a4 = (midi - 69) + cents_offset / 100.0
    return 440.0 * (2.0 ** (semitones_from_a4 / 12.0))


def render_take_to_array(
    ground_truth: dict,
    *,
    sr: int = 44100,
    config: dict | None = None,
) -> tuple[np.ndarray, int]:
    """The ground truth's notes + extra notes, as a synthesized waveform.

    Every played note (`played_pitch` not None) gets a short tone at its
    `played_onset_s`, pitched by `played_pitch` bent by `cents_offset`.
    Missed notes contribute nothing, which is the point: a note the ground
    truth marks missing must not sound in the "recording" either, or the
    harness would be grading the pipeline against audio it could not have
    produced.

    Degradation / accompaniment `injected_errors` are recorded as intent
    (same limitation `synthetic_takes.render_take` documents) and not
    applied to the signal here either — see `tools/eval/README.md`.
    """
    cfg = config or _load_synth_config()
    note_s = float(cfg["note_duration_s"])
    attack_s = float(cfg["attack_s"])
    release_s = float(cfg["release_s"])
    amplitude = float(cfg["amplitude"])
    n_harmonics = int(cfg["harmonics"])

    events: list[tuple[float, float]] = []  # (onset_s, hz)
    for note in ground_truth["notes"]:
        if note["played_pitch"] is None:
            continue
        hz = pitch_to_hz(note["played_pitch"], note.get("cents_offset") or 0.0)
        events.append((float(note["played_onset_s"]), hz))
    for extra in ground_truth.get("extra_notes", []):
        hz = pitch_to_hz(extra["played_pitch"])
        events.append((float(extra["played_onset_s"]), hz))

    if not events:
        return np.zeros(sr, dtype=np.float32), sr

    total_s = max(onset for onset, _ in events) + note_s + release_s + 0.25
    n_samples = int(total_s * sr)
    y = np.zeros(n_samples, dtype=np.float64)

    attack_n = max(1, int(attack_s * sr))
    release_n = max(1, int(release_s * sr))
    sustain_n = max(1, int(note_s * sr))
    tone_n = attack_n + sustain_n + release_n
    envelope = np.concatenate(
        [
            np.linspace(0.0, 1.0, attack_n, endpoint=False),
            np.ones(sustain_n),
            np.linspace(1.0, 0.0, release_n),
        ]
    )
    t = np.arange(tone_n) / sr

    for onset_s, hz in events:
        start = round(onset_s * sr)
        if start < 0:
            continue
        tone = np.zeros(tone_n)
        for h in range(1, n_harmonics + 1):
            tone += (1.0 / h) * np.sin(2 * np.pi * hz * h * t)
        tone *= envelope * amplitude / n_harmonics
        end = min(start + tone_n, n_samples)
        y[start:end] += tone[: end - start]

    peak = np.max(np.abs(y)) or 1.0
    y = (y / peak * amplitude).astype(np.float32)
    return y, sr
