#!/usr/bin/env python3
"""How often the analysis hears a take right, and says the right thing about it.

    tools/eval/accuracy_bench.py              # the quick set, about a minute
    tools/eval/accuracy_bench.py --full       # every combination
    tools/eval/accuracy_bench.py --json out.json --failures 20

**What "right" means here, because a percentage means nothing without it.**
Every take is synthesised from a page, so the true time and pitch of every
note is known. The app's own scoring code — the pairing, `compute_deltas`,
`bar_pacing`, `generate_verdict`, `_summarize_measures` — is then run twice:
once on what `analyze()` heard in the audio, and once on the truth, as if the
app had heard every note perfectly (the *oracle*). Accuracy is how often the
two agree. That separates the question this benchmark can answer — *does the
app hear the take it was given?* — from the one it cannot, *are the app's
rules about rushing the right rules?*, which is a policy question for the
owner and not a detection one.

**What it scores, per take**

- *status*: the take was analysed at all (`ok`), not refused.
- *notes*: every note that was played is paired, timed, and its deviation is
  within `NOTE_TOL_MS` of the oracle's.
- *missed*: every note that was left out is reported missing, and no played
  note is.
- *bars*: each bar's average deviation is within the note tolerance of the
  oracle's, and its tempo within 2% (or 1.5 BPM). Its colour follows from
  the average, and a note's colour from its deviation, so neither is scored
  twice: a note within the tolerance that lands on the other side of a band
  edge is a boundary, not a mistake.
- *verdict*: the sentence's direction and the bars it names match.
- *wrong notes*: every note played at the wrong pitch is named, in its bar,
  and nothing else is.

**What it cannot tell you.** It is synthesis — the repository's own models of
a bowed and a plucked string (`app/tests/audio_helpers.py`), with vibrato,
uneven intonation, dynamics, a room, a microphone floor and the degradations
`test_degraded_audio.py` sweeps. `docs/subsystems.md` records twice how a
synthetic instrument gave a confidently wrong answer about a threshold; a
number here is evidence about the arithmetic and the models, not a promise
about a phone in a practice room. Real recordings are still the test that
matters (`TUNING_LOG.md`).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys

# One thread per worker, before numpy is imported: four processes each running
# a multi-threaded BLAS and numba pool held a 4-core machine at a load of 16
# and ran ten times slower than one process.
for _var in (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMBA_NUM_THREADS",
):
    os.environ.setdefault(_var, "1")
from collections import defaultdict
from dataclasses import asdict, dataclass, field, replace
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from backend_python import use_backend_python

use_backend_python()
sys.path.insert(0, str(ROOT / "backend"))

import numpy as np
from app.services.alignment import CleanedAlignment, build_timeline
from app.services.analysis import _summarize_measures, analyze, bar_pacing
from app.services.audio_config import load_audio_config
from app.services.classification import compute_deltas, generate_verdict
from app.services.score_schema import ScoreJson, tempo_change_spans
from app.tests.audio_helpers import (
    MIC_NOISE_FLOOR,
    add_noise_at_snr,
    add_room_reverb,
    apply_clipping,
)
from scipy.signal import lfilter

SR = 22050

#: A note's measured deviation is right if it is this close to the oracle's.
#: Half the narrowest band at the fastest tempo here (5% of a beat at 132 BPM
#: is 23 ms), so a note inside it cannot be in the wrong colour by more than
#: one band edge.
NOTE_TOL_MS = 12.0

_STEPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_G_MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]

#: Where each instrument's lines sit, written, and how it is written.
INSTRUMENTS = {
    "violin": {"low": 62, "high": 81, "clef": "treble", "sounding": 0},
    "viola": {"low": 55, "high": 74, "clef": "alto", "sounding": 0},
    "cello": {"low": 43, "high": 62, "clef": "bass", "sounding": 0},
    # A bass sounds an octave below its page.
    "double_bass": {"low": 43, "high": 62, "clef": "bass", "sounding": -12},
}

#: Bars of four beats, as (duration name, beats).
RHYTHMS = [
    [("quarter", 1)] * 4,
    [("half", 2), ("quarter", 1), ("quarter", 1)],
    [("quarter", 1), ("eighth", 0.5), ("eighth", 0.5), ("quarter", 1), ("quarter", 1)],
    [("eighth", 0.5)] * 4 + [("quarter", 1), ("quarter", 1)],
    [("dotted_quarter", 1.5), ("eighth", 0.5), ("quarter", 1), ("quarter", 1)],
    [("quarter", 1), ("quarter", 1), ("eighth", 0.5)] + [("eighth", 0.5)] * 3,
    [("half", 2), ("half", 2)],
    [("sixteenth", 0.25)] * 4 + [("quarter", 1)] * 3,
]

PERFORMANCES = ["steady", "rush", "drag", "fast", "wrong", "missed"]
ROOMS = ["clean", "noise", "reverb", "dynamics", "phone"]
TECHNIQUES = {
    "violin": ["bowed", "pizz"],
    "viola": ["bowed"],
    "cello": ["bowed"],
    "double_bass": ["bowed", "pizz"],
}
TEMPI = [60, 84, 108, 132]
BARS = 8


@dataclass
class Scenario:
    instrument: str
    technique: str
    bpm: int
    performance: str
    room: str
    seed: int

    @property
    def name(self) -> str:
        return f"{self.instrument}/{self.technique}/{self.bpm}/{self.performance}/{self.room}/{self.seed}"


@dataclass
class TruthNote:
    global_index: int
    measure_number: int
    written_midi: int
    played_midi: int
    beats_at: float
    played: bool
    onset_s: float = 0.0

    @property
    def wrong(self) -> bool:
        return self.played and self.played_midi != self.written_midi


@dataclass
class TakeScore:
    scenario: str
    status: str
    counts: dict = field(default_factory=dict)
    errors_ms: list = field(default_factory=list)
    problems: list = field(default_factory=list)
    #: Diagnostic, not scored: played notes with an attack heard near them,
    #: played notes, and attacks near no played note. Separates a note the
    #: detector never heard from one it heard and the pairing misplaced.
    attacks: dict = field(default_factory=dict)


#: Where an attack counts as one note's, from that note's true start. The
#: detector places attacks a few tens of milliseconds late — the flux peaks as
#: the note speaks — so the window leans that way.
HEARD_WINDOW_S = (-0.03, 0.11)


def attacks_against(notes: list[TruthNote], detected: np.ndarray) -> dict:
    """How many played notes have an attack in their window, and how many
    attacks fall in no played note's window."""
    played = np.array([n.onset_s for n in notes if n.played], dtype=float)
    lo, hi = HEARD_WINDOW_S
    heard = sum(bool(np.any((detected >= t + lo) & (detected <= t + hi))) for t in played)
    extra = sum(not bool(np.any((t >= played + lo) & (t <= played + hi))) for t in detected)
    return {"heard": int(heard), "played": int(played.size), "extra": int(extra)}


def _name(m: int) -> str:
    return f"{_STEPS[m % 12]}{m // 12 - 1}"


def _hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def _g_major(low: int, high: int) -> list[int]:
    return [m for m in range(low, high + 1) if (m - 7) % 12 in _G_MAJOR_STEPS]


# ---------------------------------------------------------------- the page


def make_page(
    rng: np.random.Generator, instrument: str
) -> tuple[ScoreJson, list[TruthNote]]:
    """Eight bars of 4/4 in G major: steps and small leaps, mixed note values."""
    spec = INSTRUMENTS[instrument]
    scale = _g_major(spec["low"], spec["high"])
    at = int(rng.integers(2, len(scale) - 2))
    measures, notes, beats_at, index = [], [], 0.0, 0
    for bar in range(BARS):
        rhythm = RHYTHMS[0] if bar == 0 else RHYTHMS[int(rng.integers(0, len(RHYTHMS)))]
        written = []
        for duration, beats in rhythm:
            at = int(
                np.clip(
                    at + rng.choice([-2, -1, -1, 1, 1, 2, 3, -3]), 0, len(scale) - 1
                )
            )
            midi = scale[at]
            written.append({"pitch": _name(midi), "duration": duration})
            notes.append(
                TruthNote(
                    global_index=index,
                    measure_number=bar + 1,
                    written_midi=midi,
                    played_midi=midi,
                    beats_at=beats_at,
                    played=True,
                )
            )
            index += 1
            beats_at += beats
        measures.append({"measure_number": bar + 1, "notes": written, "slurs": []})
    score = ScoreJson.model_validate(
        {
            "time_signature": "4/4",
            "clef": spec["clef"],
            "repeats": [],
            "ocr_confidence": 1.0,
            "measures": measures,
        }
    )
    return score, notes


# ---------------------------------------------------------- the performance


def tempo_factor(performance: str, bar: int) -> float:
    """How much longer than written each beat of a bar was played."""
    if performance == "rush" and bar in (3, 4):
        return 1 / 1.15
    if performance == "drag" and bar in (5, 6):
        return 1.15
    if performance == "fast":
        return 1 / 1.10
    return 1.0


def place_notes(
    notes: list[TruthNote], sc: Scenario, rng: np.random.Generator
) -> float:
    """Give every note its true time; returns the take's end in seconds."""
    beat_s = 60.0 / sc.bpm
    lead = float(rng.uniform(0.4, 1.1))
    # Time at the start of every beat, through the performance's tempo map.
    beat_times = [lead]
    for b in range(BARS * 4 + 4):
        bar = b // 4 + 1
        beat_times.append(beat_times[-1] + beat_s * tempo_factor(sc.performance, bar))
    jitter_s = 0.006 if sc.technique == "pizz" else 0.008
    for note in notes:
        whole = math.floor(note.beats_at)
        frac = note.beats_at - whole
        t = beat_times[whole] + frac * (beat_times[whole + 1] - beat_times[whole])
        note.onset_s = t + float(rng.normal(0, jitter_s)) * (
            0 if note.global_index == 0 else 1
        )
    # The first and last notes always sound, and so do the opening bar's.
    candidates = [
        n for n in notes if n.measure_number > 1 and n.global_index < len(notes) - 1
    ]
    if sc.performance == "wrong":
        for note in rng.choice(candidates, size=2, replace=False):
            note.played_midi = note.written_midi + int(rng.choice([-2, 2]))
    if sc.performance == "missed":
        for note in rng.choice(candidates, size=2, replace=False):
            note.played = False
    return beat_times[-1] + 1.0


def bowed_note(
    midi: float, dur_s: float, rng: np.random.Generator, *, sounding: float
) -> np.ndarray:
    """A bowed string: a band-limited sawtooth with vibrato, under a slow rise.

    `audio_helpers.synth_bowed_note`'s model — a Helmholtz sawtooth under a
    raised-cosine rise — with the two things a real player adds that it lacks:
    vibrato, which moves every partial and so makes flux inside a note, and a
    note that is not quite in tune.
    """
    freq = _hz(midi + sounding + float(rng.normal(0, 0.08)))
    n = max(1, int(dur_s * SR))
    t = np.arange(n) / SR
    cents = np.zeros(n)
    if dur_s > 0.25:
        depth = float(rng.uniform(10, 24))
        rate = float(rng.uniform(5.0, 6.3))
        grow = np.clip((t - 0.12) / 0.25, 0, 1)
        cents = (
            depth
            * grow
            * np.sin(2 * np.pi * rate * t + float(rng.uniform(0, 2 * np.pi)))
        )
    phase = 2 * np.pi * np.cumsum(freq * 2 ** (cents / 1200)) / SR
    y = np.zeros(n)
    k = 1
    while freq * k < 0.45 * SR and k <= 40:
        y += np.sin(k * phase) / k
        k += 1
    rise = min(int(float(rng.uniform(0.025, 0.05)) * SR), n)
    envelope = np.exp(-t * 0.5)
    if rise:
        envelope[:rise] *= 0.5 * (1 - np.cos(np.linspace(0, np.pi, rise)))
    release = min(int(0.04 * SR), n)
    if release:
        envelope[-release:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, release)))
    # Bow scratch: a little broadband noise on the attack, as a real stroke has.
    scratch = rng.normal(0, 1, n) * np.exp(-t / 0.03) * 0.04
    out = envelope * y / max(1e-9, float(np.abs(y).max())) + scratch
    return out.astype(np.float32)


def plucked_note(
    midi: float, ring_s: float, rng: np.random.Generator, *, sounding: float
) -> np.ndarray:
    """A plucked string: struck, then left to ring and die, higher partials first."""
    freq = _hz(midi + sounding + float(rng.normal(0, 0.06)))
    n = max(1, int(ring_s * SR))
    t = np.arange(n) / SR
    y = np.zeros(n)
    k = 1
    while freq * k < 0.45 * SR and k <= 30:
        y += np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (3.0 + 1.2 * k)) / k
        k += 1
    attack = min(int(0.003 * SR), n)
    if attack:
        y[:attack] *= np.linspace(0, 1, attack)
    release = min(int(0.03 * SR), n)
    if release:
        y[-release:] *= np.linspace(1, 0, release)
    return (y / max(1e-9, float(np.abs(y).max()))).astype(np.float32)


def render(
    notes: list[TruthNote], sc: Scenario, end_s: float, rng: np.random.Generator
) -> np.ndarray:
    spec = INSTRUMENTS[sc.instrument]
    y = np.zeros(int(end_s * SR) + SR, dtype=np.float32)
    played = [n for n in notes if n.played]
    dynamics = sc.room in ("dynamics", "phone")
    for i, note in enumerate(played):
        nxt = played[i + 1].onset_s if i + 1 < len(played) else note.onset_s + 1.2
        ioi = max(0.08, nxt - note.onset_s)
        if sc.technique == "pizz":
            sound = plucked_note(
                note.played_midi, min(1.6, ioi + 0.6), rng, sounding=spec["sounding"]
            )
        else:
            # Détaché: the bow stops a little before the next stroke.
            dur = max(0.06, ioi - min(0.05, 0.12 * ioi))
            sound = bowed_note(note.played_midi, dur, rng, sounding=spec["sounding"])
        gain_db = 0.0
        if dynamics:
            gain_db = float(rng.uniform(-9.0, 2.0)) + 6.0 * (
                i / max(1, len(played) - 1)
            )
        start = int(note.onset_s * SR)
        end = min(start + sound.size, y.size)
        y[start:end] += sound[: end - start] * (10 ** (gain_db / 20))
    # A small room's lowest mode, as `synth_bowed_take` has.
    omega = 2 * np.pi * 58.0 / SR
    ring = np.exp(-omega / (2 * 30.0))
    y = y + lfilter(
        [0.55 * (1 - ring)], [1.0, -2 * ring * np.cos(omega), ring * ring], y
    ).astype(np.float32)
    y = y / max(1e-9, float(np.abs(y).max())) * 0.6
    y = y + np.random.default_rng(sc.seed).normal(0, MIC_NOISE_FLOOR, y.size).astype(
        np.float32
    )
    if sc.room == "noise":
        y = add_noise_at_snr(y, 20.0, seed=sc.seed)
    elif sc.room == "reverb":
        y = add_room_reverb(y, SR, rt60_s=0.6, wet=0.35)
    elif sc.room == "phone":
        y = add_room_reverb(y, SR, rt60_s=0.45, wet=0.3)
        y = add_noise_at_snr(y, 25.0, seed=sc.seed)
        y = apply_clipping(y, 2.0)
    return np.clip(y, -1.0, 1.0).astype(np.float32)


# ------------------------------------------------------------ the settings

#: `--set` overrides, as `section.field` of `AudioConfig` (`onset.` when no
#: section is named). Set before the worker pool forks, so every worker — and
#: the oracle, which judges by the same rules — reads the same settings.
OVERRIDES: dict[str, float] = {}


def _split(name: str) -> tuple[str, str]:
    section, _, field_name = name.rpartition(".")
    return section or "onset", field_name


def config():
    """`config.toml`, with any `--set` overrides applied."""
    cfg = load_audio_config()
    by_section: dict[str, dict[str, float]] = defaultdict(dict)
    for name, value in OVERRIDES.items():
        section, field_name = _split(name)
        by_section[section][field_name] = value
    for section, fields in by_section.items():
        current = getattr(cfg, section)
        typed = {k: type(getattr(current, k))(v) for k, v in fields.items()}
        cfg = replace(cfg, **{section: replace(current, **typed)})
    return cfg


# ------------------------------------------------------------- the oracle


_BARS_NAMED = re.compile(r"\bbars? (\d+)(?:\s*[–-]\s*(\d+))?")


def bars_named(text: str) -> tuple[int, int] | None:
    match = _BARS_NAMED.search(text)
    if not match:
        return None
    start = int(match.group(1))
    return start, int(match.group(2) or start)


def oracle(score: ScoreJson, notes: list[TruthNote], bpm: float) -> dict:
    """What the app would say had it heard every note exactly."""
    cfg = config()
    timeline = build_timeline(score, bpm)
    played = [n for n in notes if n.played]
    onsets = np.array([n.onset_s for n in played], dtype=float)
    matched = [(i, n.global_index) for i, n in enumerate(played)]
    cleaned = CleanedAlignment(
        matched=matched,
        missed_expected=[n.global_index for n in notes if not n.played],
        extra_detected=[],
        quality=1.0,
    )
    deltas = compute_deltas(cleaned, onsets, timeline, bpm, config=cfg)
    pacing = bar_pacing(cleaned.matched, onsets, timeline, bpm)
    verdict = generate_verdict(
        deltas, bpm, config=cfg, tempo_spans=tempo_change_spans(score), tempi=pacing
    )
    measures = _summarize_measures(deltas, pacing.by_bar, {}, pacing.targets, bpm)
    return {
        "deltas": {d.global_index: d for d in deltas},
        "measures": {m.measure_number: m for m in measures},
        "direction": verdict.direction.value,
        "bars": bars_named(verdict.text),
        "text": verdict.text,
    }


# ---------------------------------------------------------------- scoring


def run_one(sc: Scenario) -> TakeScore:
    rng = np.random.default_rng(sc.seed)
    score, notes = make_page(rng, sc.instrument)
    end_s = place_notes(notes, sc, rng)
    y = render(notes, sc, end_s, rng)
    truth = oracle(score, notes, sc.bpm)
    trace: dict = {}
    result = analyze(
        (y, SR), score, float(sc.bpm), instrument=sc.instrument, trace=trace, config=config()
    )

    out = TakeScore(scenario=sc.name, status=result.status)
    out.attacks = attacks_against(notes, np.asarray(trace.get("detected_s") or [], dtype=float))
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])

    def tally(metric: str, ok: bool, problem: str = "") -> None:
        counts[metric][0] += int(ok)
        counts[metric][1] += 1
        if not ok and problem:
            out.problems.append(f"{metric}: {problem}")

    analysed = result.status == "ok"
    tally("status", analysed, f"status {result.status}")
    heard = {p.global_index: p for p in result.per_note}
    for note in notes:
        if note.played:
            mine = heard.get(note.global_index)
            want = truth["deltas"].get(note.global_index)
            if mine is None or want is None or not mine.timed:
                tally(
                    "notes",
                    False,
                    f"note {note.global_index} (bar {note.measure_number}) not timed",
                )
                tally(
                    "missed",
                    False,
                    f"note {note.global_index} played, reported missing",
                )
                continue
            tally("missed", True)
            error = abs(mine.delta_ms - want.delta_ms)
            out.errors_ms.append(error)
            tally(
                "notes",
                error <= NOTE_TOL_MS,
                f"note {note.global_index} (bar {note.measure_number}) off by {error:.0f} ms",
            )
        else:
            tally(
                "missed",
                analysed and note.global_index not in heard,
                f"note {note.global_index} left out, not reported",
            )
    # A bar is what its chart shows: its average deviation and its tempo. Each
    # is right within what the note tolerance allows; a bar's sign alone is
    # noise when its average is a fraction of a percent either side of zero.
    beat_ms = 60000.0 / sc.bpm
    tol_pct = 100.0 * NOTE_TOL_MS / beat_ms
    for number, want in truth["measures"].items():
        mine = next((m for m in result.per_measure if m.measure_number == number), None)
        if mine is None:
            tally("bars", False, f"bar {number} absent")
            continue
        off_pct = abs(mine.avg_delta_pct - want.avg_delta_pct)
        tempo_ok = (
            mine.played_bpm is None
            or want.played_bpm is None
            or abs(mine.played_bpm - want.played_bpm)
            <= max(1.5, 0.02 * want.played_bpm)
        )
        tally(
            "bars",
            off_pct <= tol_pct and tempo_ok,
            f"bar {number} avg {mine.avg_delta_pct:+.1f}% vs {want.avg_delta_pct:+.1f}%, "
            f"tempo {mine.played_bpm} vs {want.played_bpm}",
        )
    tally(
        "verdict",
        analysed
        and result.verdict_direction.value == truth["direction"]
        and bars_named(result.verdict) == truth["bars"],
        f"said {result.verdict!r}, oracle {truth['text']!r}",
    )
    wrong_bars = sorted({n.measure_number for n in notes if n.wrong})
    named_bars = sorted({w.measure_number for w in result.wrong_notes})
    for bar in wrong_bars:
        tally(
            "wrong notes",
            analysed and bar in named_bars,
            f"wrong note in bar {bar} not named",
        )
    for bar in named_bars:
        if bar not in wrong_bars:
            tally("wrong notes", False, f"bar {bar} named wrong, was right")
    out.counts = {k: v for k, v in counts.items()}
    return out


def debug_one(sc: Scenario) -> None:
    """One take, laid out: each note's true time, what was heard, how it was paired."""
    rng = np.random.default_rng(sc.seed)
    score, notes = make_page(rng, sc.instrument)
    end_s = place_notes(notes, sc, rng)
    y = render(notes, sc, end_s, rng)
    truth = oracle(score, notes, sc.bpm)
    trace: dict = {}
    result = analyze(
        (y, SR),
        score,
        float(sc.bpm),
        instrument=sc.instrument,
        trace=trace,
        config=config(),
    )
    print(sc.name, result.status, f"quality {result.quality}", result.verdict)
    print("oracle:", truth["text"], "| paired by", trace.get("paired_by"))
    heard = {p.global_index: p for p in result.per_note}
    detected = np.asarray(trace.get("detected_s") or [], dtype=float)
    played = np.array([n.onset_s for n in notes if n.played])
    for note in notes:
        mine = heard.get(note.global_index)
        want = truth["deltas"].get(note.global_index)
        nearest = (
            f"{1000 * float(detected[np.argmin(np.abs(detected - note.onset_s))] - note.onset_s):+6.1f}"
            if detected.size
            else "   ---"
        )
        print(
            f"  {note.global_index:>3} bar {note.measure_number} beat {note.beats_at:5.2f} "
            f"{'played' if note.played else 'LEFT OUT'} midi {note.played_midi}"
            f"{' (wrong)' if note.wrong else ''}  true {note.onset_s:7.3f}s  "
            f"oracle {want.delta_ms if want else float('nan'):7.1f}  "
            f"heard {mine.delta_ms if mine and mine.timed else float('nan'):7.1f}  "
            f"nearest attack {nearest} ms"
        )
    extra = [
        round(float(t), 3)
        for t in detected
        if not played.size or np.min(np.abs(played - t)) > 0.06
    ]
    print("attacks no note was played at:", extra)


def scenarios(full: bool) -> list[Scenario]:
    out: list[Scenario] = []
    seed = 1000
    for instrument, techniques in TECHNIQUES.items():
        for technique in techniques:
            for perf in PERFORMANCES:
                for room in ROOMS:
                    tempi = TEMPI if full else [TEMPI[(seed // 7) % len(TEMPI)]]
                    for bpm in tempi:
                        seed += 1
                        out.append(
                            Scenario(instrument, technique, bpm, perf, room, seed)
                        )
    return out


def summarise(results: list[TakeScore]) -> dict:
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_dimension: dict[str, dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0, 0])
    )
    for r in results:
        parts = r.scenario.split("/")
        keys = {
            "instrument": f"{parts[0]}/{parts[1]}",
            "tempo": parts[2],
            "performance": parts[3],
            "room": parts[4],
        }
        for metric, (ok, n) in r.counts.items():
            totals[metric][0] += ok
            totals[metric][1] += n
            for dim, key in keys.items():
                by_dimension[f"{dim}:{key}"][metric][0] += ok
                by_dimension[f"{dim}:{key}"][metric][1] += n
    errors = (
        np.array([e for r in results for e in r.errors_ms])
        if results
        else np.array([0.0])
    )
    attacks = {k: sum(r.attacks.get(k, 0) for r in results) for k in ("heard", "played", "extra")}
    return {
        "attacks": attacks,
        "totals": {
            k: {"ok": v[0], "n": v[1], "pct": 100.0 * v[0] / max(1, v[1])}
            for k, v in totals.items()
        },
        "overall_pct": 100.0
        * sum(v[0] for v in totals.values())
        / max(1, sum(v[1] for v in totals.values())),
        "timing_error_ms": {
            "median": float(np.median(errors)),
            "p95": float(np.percentile(errors, 95)),
            "max": float(errors.max()),
        },
        "by_dimension": {
            dim: {
                "pct": 100.0
                * sum(v[0] for v in m.values())
                / max(1, sum(v[1] for v in m.values())),
                "worst": min(
                    ((k, 100.0 * v[0] / max(1, v[1])) for k, v in m.items()),
                    key=lambda kv: kv[1],
                ),
            }
            for dim, m in by_dimension.items()
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--full", action="store_true", help="every tempo for every combination"
    )
    parser.add_argument("--json", type=Path, help="write every take's score here")
    parser.add_argument(
        "--failures", type=int, default=12, help="print this many failing takes"
    )
    parser.add_argument("--only", help="run only scenarios whose name contains this")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--debug", help="lay out one take, by its full name")
    parser.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="FIELD=VALUE",
        help="override one setting, as section.field of AudioConfig (onset. if no section); repeatable",
    )
    args = parser.parse_args()
    for item in args.set:
        name, _, value = item.partition("=")
        section, field_name = _split(name)
        if not hasattr(getattr(load_audio_config(), section, None), field_name):
            print(f"no setting named {name}")
            return 1
        OVERRIDES[name] = float(value)

    if args.debug:
        found = [s for s in scenarios(True) + scenarios(False) if s.name == args.debug]
        if not found:
            print(f"no scenario named {args.debug}")
            return 1
        debug_one(found[0])
        return 0

    todo = scenarios(args.full)
    if args.only:
        todo = [s for s in todo if args.only in s.name]
    with Pool(args.workers) as pool:
        results = pool.map(run_one, todo, chunksize=1)
    summary = summarise(results)

    print(f"{len(results)} takes\n")
    print(f"{'metric':<14}{'right':>8}{'of':>8}{'accuracy':>11}")
    for metric in ["status", "notes", "missed", "bars", "verdict", "wrong notes"]:
        t = summary["totals"].get(metric)
        if t:
            print(f"{metric:<14}{t['ok']:>8}{t['n']:>8}{t['pct']:>10.2f}%")
    print(f"{'overall':<30}{summary['overall_pct']:>10.2f}%")
    te = summary["timing_error_ms"]
    print(
        f"\ntiming error against the oracle: median {te['median']:.1f} ms, p95 {te['p95']:.1f} ms, max {te['max']:.0f} ms"
    )
    at = summary["attacks"]
    print(
        f"first pass, not scored: {at['heard']} of {at['played']} played notes heard "
        f"({100.0 * at['heard'] / max(1, at['played']):.2f}%), {at['extra']} attacks at no note\n"
    )
    print("by dimension (overall, and its weakest metric)")
    for dim in sorted(summary["by_dimension"]):
        d = summary["by_dimension"][dim]
        print(
            f"  {dim:<28}{d['pct']:>7.2f}%   weakest {d['worst'][0]} {d['worst'][1]:.1f}%"
        )
    failing = [r for r in results if r.problems]
    if failing and args.failures:
        print(
            f"\n{len(failing)} takes with a problem; the first {min(args.failures, len(failing))}:"
        )
        for r in failing[: args.failures]:
            print(f"  {r.scenario}  [{r.status}]")
            for p in r.problems[:4]:
                print(f"      {p}")
    if args.json:
        args.json.write_text(
            json.dumps(
                {"summary": summary, "takes": [asdict(r) for r in results]}, indent=1
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
