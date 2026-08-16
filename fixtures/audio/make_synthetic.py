"""Synthetic stand-ins for the six tuning clips, so the dashboard runs today.

**These are not the corpus.** They are click tracks with known onset times,
generated to exercise the dashboard and prove it agrees with the pipeline. They
cannot tell you whether a threshold is right, because the thing a threshold has
to survive — bow noise, room reflection, a bass's slow attack, string ring — is
exactly what a synthesized click doesn't have.

Read `README.md`, record the six, delete these. Until then the dashboard says
`synthetic` beside every clip that came from here.

    python fixtures/audio/make_synthetic.py

Writes `<id>.synthetic.wav` beside the manifest. The real recordings take the
un-suffixed name, so recording one clip replaces one stand-in and the dashboard
picks it up on the next reload.
"""

from __future__ import annotations

import json
import math
import pathlib
import sys

import numpy as np
import soundfile as sf

HERE = pathlib.Path(__file__).resolve().parent
SR = 22050

# How each stand-in departs from a perfect grid. The point is that the
# dashboard should *show* these departures — a rushing clip whose bars look
# level on the deviation chart means the chart is wrong.
DRIFT = {
    "01_detache_clean": 0.0,
    # Seconds per beat, accumulating. 8 ms a beat is about 13% of a beat by the
    # end of 32 notes — the scale of drift a student actually produces without
    # noticing. The first version used 35 ms, which reaches a whole beat of
    # error and is less "rushing" than "playing a different piece".
    "02_detache_rushing": -0.008,
    "03_detache_dragging": +0.008,
    "04_slurred": 0.0,
    "05_open_e_long": 0.0,
    "06_pizzicato": 0.0,
}

# Clips where a note is deliberately not given an attack, to stand in for the
# real failure: an onset detector cannot see into the middle of a slur.
SUPPRESS_INTERIOR = {"04_slurred"}


def note(freq_hz: float, seconds: float, *, decay: float, sr: int = SR) -> np.ndarray:
    """A struck note: instant attack, exponential decay, a little second harmonic.

    The release matters as much as the attack. An exponential cut off at a
    non-zero value is a step discontinuity, and a step is a transient — the
    detector fires on it exactly as it fires on the attack, which is how the
    first version of this file produced two onsets per note and one phantom at
    the end of every clip. The last 40 ms are faded to silence so the note
    stops the way a real one does.
    """
    samples = int(seconds * sr)
    t = np.arange(samples) / sr
    envelope = np.exp(-t * decay)

    fade = min(int(0.04 * sr), samples)
    if fade:
        # Raised cosine: starts and ends with zero slope, so neither end of the
        # fade is itself an edge.
        envelope[-fade:] *= 0.5 * (1 + np.cos(np.linspace(0, math.pi, fade)))

    tone = np.sin(2 * math.pi * freq_hz * t) + 0.3 * np.sin(2 * math.pi * 2 * freq_hz * t)
    return (0.7 * envelope * tone).astype(np.float32)


def expected_onsets(score: dict, bpm: float) -> list[tuple[float, bool]]:
    """(onset seconds, is_slur_interior) for every sounded note in the score."""
    beats = {
        "whole": 4.0, "dotted_whole": 6.0, "half": 2.0, "dotted_half": 3.0,
        "quarter": 1.0, "dotted_quarter": 1.5, "eighth": 0.5, "dotted_eighth": 0.75,
        "sixteenth": 0.25, "dotted_sixteenth": 0.375, "thirty_second": 0.125,
    }
    sec_per_beat = 60.0 / bpm
    out: list[tuple[float, bool]] = []
    clock = 0.0
    for measure in score["measures"]:
        interior = set()
        for slur in measure.get("slurs", []):
            interior.update(range(slur["start_note_index"] + 1, slur["end_note_index"] + 1))
        for index, n in enumerate(measure["notes"]):
            if n["pitch"] != "rest":
                out.append((clock, index in interior))
            clock += beats.get(n["duration"], 1.0) * sec_per_beat
    return out


def build(clip: dict) -> np.ndarray:
    bpm = float(clip["target_bpm"])
    onsets = expected_onsets(clip["score"], bpm)
    drift_per_beat = DRIFT.get(clip["id"], 0.0)
    suppress = clip["id"] in SUPPRESS_INTERIOR

    # Low E on a double bass is ~41 Hz. The pipeline high-passes at 80 Hz for
    # double bass, so the fundamental alone would be filtered away — real bass
    # notes carry strong harmonics, and these have to as well or the stand-in
    # tests the filter rather than the detector.
    is_long = clip["id"] == "05_open_e_long"
    seconds = 2.0 if is_long else 0.55
    decay = 2.0 if is_long else 9.0

    lead_in = 0.25
    placed: list[tuple[float, bool]] = []
    for beat_index, (onset, interior) in enumerate(onsets):
        placed.append((lead_in + onset + drift_per_beat * beat_index, interior))

    total = (max(t for t, _ in placed) if placed else 0.0) + seconds + 0.4
    y = np.zeros(int(total * SR), dtype=np.float32)

    for at, interior in placed:
        if suppress and interior:
            # A slurred interior note: pitch continues, no new attack. Modelled
            # as simply nothing, which is the honest worst case.
            continue
        sample = note(82.4, seconds, decay=decay)  # E2, an octave above low E
        start = int(at * SR)
        end = min(start + sample.size, y.size)
        y[start:end] += sample[: end - start]

    peak = float(np.abs(y).max()) or 1.0
    return (y / peak * 0.9).astype(np.float32)


def main() -> int:
    manifest = json.loads((HERE / "manifest.json").read_text())
    for clip in manifest["clips"]:
        out = HERE / f"{clip['id']}.synthetic.wav"
        y = build(clip)
        sf.write(str(out), y, SR)
        print(f"{out.name:34} {y.size / SR:5.1f}s")
    print("\nStand-ins only — see README.md. Record the six and these stop being used.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
