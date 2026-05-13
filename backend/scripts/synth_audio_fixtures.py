"""Synthesize 6 audio fixtures for initial Batch 3 tuning.

Numpy-only — additive synthesis with ADSR envelopes + 6 harmonic partials per
note. Realistic enough for librosa onset detection to behave like it will on
real recordings; real bass clips replace these in a follow-up tuning round.

Run from `backend/`:
    uv run python scripts/synth_audio_fixtures.py

Regenerates files in fixtures/audio/ + fixtures/audio_scores/ — overwrites
existing ones. Replace these with real recordings when available; the
filenames + score JSONs stay the same.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Make `app` importable when run as `python scripts/synth_audio_fixtures.py`
# from the `backend/` working directory.
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import numpy as np
import soundfile as sf

from app.services.analysis import analyze
from app.services.score_schema import ScoreJson

REPO_ROOT = Path(__file__).resolve().parents[2]
AUDIO_DIR = REPO_ROOT / "fixtures" / "audio"
SCORE_DIR = REPO_ROOT / "fixtures" / "audio_scores"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
SCORE_DIR.mkdir(parents=True, exist_ok=True)

SR = 22050

# Standard-tuned double-bass pitches (sounding pitch — bass clef is written
# an octave higher but the pipeline doesn't care).
PITCH_HZ = {
    "E1": 41.20, "F1": 43.65, "G1": 49.00, "A1": 55.00, "B1": 61.74,
    "C2": 65.41, "D2": 73.42, "E2": 82.41, "F#2": 92.50, "G2": 98.00,
    "A2": 110.00, "B2": 123.47,
}


def adsr_envelope(
    n_samples: int,
    sr: int,
    *,
    attack_ms: float = 100.0,
    decay_ms: float = 50.0,
    sustain_level: float = 0.6,
    release_ms: float = 100.0,
) -> np.ndarray:
    """Standard ADSR. Total = n_samples; release is carved from the end of sustain."""
    n_attack = int(attack_ms / 1000 * sr)
    n_decay = int(decay_ms / 1000 * sr)
    n_release = int(release_ms / 1000 * sr)
    n_sustain = max(0, n_samples - n_attack - n_decay - n_release)
    env = np.zeros(n_samples, dtype=np.float32)
    # Attack: linear 0→1
    if n_attack:
        env[:n_attack] = np.linspace(0, 1, n_attack, endpoint=False)
    # Decay: linear 1→sustain
    if n_decay:
        env[n_attack:n_attack + n_decay] = np.linspace(1.0, sustain_level, n_decay, endpoint=False)
    # Sustain
    if n_sustain:
        env[n_attack + n_decay:n_attack + n_decay + n_sustain] = sustain_level
    # Release: linear sustain→0
    if n_release:
        start = n_attack + n_decay + n_sustain
        env[start:start + n_release] = np.linspace(sustain_level, 0.0, n_release, endpoint=False)
    return env


def pluck_envelope(n_samples: int, sr: int, *, attack_ms: float = 5.0, decay_ms: float = 300.0) -> np.ndarray:
    """Pizz / pluck: sharp attack, exponential decay to near zero, no sustain."""
    n_attack = int(attack_ms / 1000 * sr)
    n_decay = int(decay_ms / 1000 * sr)
    env = np.zeros(n_samples, dtype=np.float32)
    if n_attack:
        env[:n_attack] = np.linspace(0, 1, n_attack, endpoint=False)
    tail_n = min(n_samples - n_attack, max(0, n_samples - n_attack))
    if tail_n > 0:
        # Exponential decay over n_decay; everything past that is the tail of the exp.
        t = np.arange(tail_n) / sr
        decay_const = decay_ms / 1000 / 4  # at 4·tau we're at e^-4 ≈ 0.018
        env[n_attack:n_attack + tail_n] = np.exp(-t / decay_const)
    return env


def harmonic_tone(
    freq_hz: float,
    duration_s: float,
    sr: int,
    *,
    n_partials: int = 6,
    partial_rolloff: float = 0.6,
) -> np.ndarray:
    """Sum of `n_partials` harmonics (fundamental + integer multiples). Each
    partial amplitude is `partial_rolloff ** (i-1)` so high partials are
    quieter. Gives spectral richness librosa's onset detector responds to."""
    n_samples = int(duration_s * sr)
    t = np.arange(n_samples) / sr
    out = np.zeros(n_samples, dtype=np.float32)
    for i in range(1, n_partials + 1):
        amp = partial_rolloff ** (i - 1)
        # Stop adding partials above Nyquist.
        if freq_hz * i >= sr / 2:
            break
        # Slight detuning per partial (real instruments are slightly inharmonic).
        detune = 1.0 + 0.001 * (i - 1)
        out += amp * np.sin(2 * np.pi * freq_hz * i * detune * t).astype(np.float32)
    # Normalize so peak is ~0.8 (leaving headroom).
    peak = np.max(np.abs(out))
    if peak > 0:
        out = (out / peak * 0.8).astype(np.float32)
    return out


def synth_note(
    freq_hz: float,
    duration_s: float,
    sr: int,
    *,
    envelope: str = "adsr",
    attack_ms: float = 100.0,
    decay_ms: float = 50.0,
    sustain_level: float = 0.6,
    release_ms: float = 100.0,
    n_partials: int = 6,
) -> np.ndarray:
    n_samples = int(duration_s * sr)
    tone = harmonic_tone(freq_hz, duration_s, sr, n_partials=n_partials)
    if envelope == "adsr":
        env = adsr_envelope(
            n_samples, sr,
            attack_ms=attack_ms, decay_ms=decay_ms,
            sustain_level=sustain_level, release_ms=release_ms,
        )
    elif envelope == "pluck":
        env = pluck_envelope(n_samples, sr, attack_ms=attack_ms, decay_ms=decay_ms)
    else:
        raise ValueError(f"unknown envelope {envelope!r}")
    return (tone * env).astype(np.float32)


def place_notes(
    onsets_s: list[float],
    pitches_hz: list[float],
    note_duration_s: float,
    *,
    envelope: str = "adsr",
    total_duration_s: float | None = None,
    **note_kwargs,
) -> np.ndarray:
    if total_duration_s is None:
        total_duration_s = onsets_s[-1] + note_duration_s + 0.5
    n_total = int(total_duration_s * SR)
    audio = np.zeros(n_total, dtype=np.float32)
    for onset_s, freq_hz in zip(onsets_s, pitches_hz):
        note = synth_note(freq_hz, note_duration_s, SR, envelope=envelope, **note_kwargs)
        start = int(onset_s * SR)
        end = min(start + note.size, n_total)
        audio[start:end] += note[: end - start]
    # Add a small noise floor so silence isn't dead-zero (real room ambience).
    audio += np.random.RandomState(42).normal(0, 5e-4, n_total).astype(np.float32)
    # Final peak-normalize to ~0.7 so wav int16 doesn't clip.
    peak = np.max(np.abs(audio))
    if peak > 0:
        audio = (audio / peak * 0.7).astype(np.float32)
    return audio


def save_wav(audio: np.ndarray, path: Path) -> None:
    sf.write(str(path), audio, SR, subtype="PCM_16")


# ===========================================================================
# Six clip recipes
# ===========================================================================

PITCH_SEQ_LOW = ["E2", "F#2", "G2", "A2", "B2", "A2", "G2", "E2"]


def synth_01_clean() -> tuple[np.ndarray, ScoreJson]:
    onsets = [i * 1.0 for i in range(8)]
    pitches = [PITCH_HZ[p] for p in PITCH_SEQ_LOW]
    audio = place_notes(onsets, pitches, note_duration_s=1.0, envelope="adsr")
    score = build_score_quarters(PITCH_SEQ_LOW, "Synthetic clean détaché, 8 quarters at 60 BPM")
    return audio, score


def synth_02_rushing() -> tuple[np.ndarray, ScoreJson]:
    onsets = [0.000, 0.985, 1.955, 2.910, 3.850, 4.775, 5.685, 6.580]
    pitches = [PITCH_HZ[p] for p in PITCH_SEQ_LOW]
    audio = place_notes(onsets, pitches, note_duration_s=0.9, envelope="adsr")
    score = build_score_quarters(PITCH_SEQ_LOW, "Synthetic détaché drifting rushing — score is straight 60 BPM")
    return audio, score


def synth_03_dragging() -> tuple[np.ndarray, ScoreJson]:
    onsets = [0.000, 1.020, 2.060, 3.120, 4.200, 5.300, 6.420, 7.560]
    pitches = [PITCH_HZ[p] for p in PITCH_SEQ_LOW]
    audio = place_notes(onsets, pitches, note_duration_s=1.05, envelope="adsr")
    score = build_score_quarters(PITCH_SEQ_LOW, "Synthetic détaché drifting dragging — score is straight 60 BPM")
    return audio, score


def synth_04_slurred() -> tuple[np.ndarray, ScoreJson]:
    """4 slur groups × 4 sixteenth notes inside each. Inside each slur:
    notes are stitched together with shared sustain (no decay between them);
    between slurs, full ADSR release/attack."""
    # At 60 BPM, beat=1.0s, sixteenth=0.25s. Slur groups start at 0, 1, 2, 3 sec.
    # Inside each group: 4 notes at 0, 0.25, 0.5, 0.75 sec offset.
    pitches_per_group = ["E2", "F#2", "G2", "F#2"]
    n_total = int(4.5 * SR)
    audio = np.zeros(n_total, dtype=np.float32)
    for group_idx in range(4):
        group_start_s = group_idx * 1.0
        for note_idx, p in enumerate(pitches_per_group):
            onset_s = group_start_s + note_idx * 0.25
            # First note of each slur: full attack; subsequent notes: short attack
            # and no decay (continuous sustain feel).
            if note_idx == 0:
                note = synth_note(PITCH_HZ[p], 0.25, SR,
                                  envelope="adsr",
                                  attack_ms=80.0, decay_ms=20.0,
                                  sustain_level=0.7, release_ms=10.0)
            else:
                note = synth_note(PITCH_HZ[p], 0.25, SR,
                                  envelope="adsr",
                                  attack_ms=20.0, decay_ms=10.0,
                                  sustain_level=0.7, release_ms=10.0)
            start = int(onset_s * SR)
            end = min(start + note.size, n_total)
            audio[start:end] += note[: end - start]
    audio += np.random.RandomState(42).normal(0, 5e-4, n_total).astype(np.float32)
    peak = np.max(np.abs(audio))
    if peak > 0:
        audio = (audio / peak * 0.7).astype(np.float32)

    # Score: 4 measures, each with 4 sixteenths slurred 0→3.
    measures = []
    for m_idx in range(4):
        measures.append({
            "measure_number": m_idx + 1,
            "notes": [
                {"pitch": p, "duration": "sixteenth",
                 "articulation": None, "tied_to_next": False, "dynamics": None}
                for p in pitches_per_group
            ],
            "slurs": [{"start_note_index": 0, "end_note_index": 3}],
        })
    score = ScoreJson.model_validate({
        "time_signature": "4/4",
        "key_signature": "E minor",
        "tempo_marking": None,
        "bpm_hint": 60,
        "clef": "bass",
        "measures": measures,
        "repeats": [],
        "ocr_confidence": 1.0,
        "notes_to_human": "Synthetic slurred — 4 sixteenths per slur, 4 slurs total",
    })
    return audio, score


def synth_05_open_e_long() -> tuple[np.ndarray, ScoreJson]:
    """One long E1 (41 Hz, below most phone mic response), held 2s + 1.5s silence."""
    audio = place_notes(
        onsets_s=[0.0],
        pitches_hz=[PITCH_HZ["E1"]],
        note_duration_s=2.0,
        envelope="adsr",
        total_duration_s=3.5,
        attack_ms=150.0, decay_ms=100.0, sustain_level=0.65, release_ms=300.0,
        n_partials=8,  # E1 fundamental is low; relying on partials anyway
    )
    score = ScoreJson.model_validate({
        "time_signature": "4/4",
        "key_signature": "E minor",
        "tempo_marking": None,
        "bpm_hint": 60,
        "clef": "bass",
        "measures": [{
            "measure_number": 1,
            "notes": [
                {"pitch": "E1", "duration": "half", "articulation": None, "tied_to_next": False, "dynamics": None},
                {"pitch": "rest", "duration": "half", "articulation": None, "tied_to_next": False, "dynamics": None},
            ],
            "slurs": [],
        }],
        "repeats": [],
        "ocr_confidence": 1.0,
        "notes_to_human": "Synthetic open-E low note — tests low-register detection (below 80Hz mic rolloff)",
    })
    return audio, score


def synth_06_pizzicato() -> tuple[np.ndarray, ScoreJson]:
    """Pluck envelope: 5ms attack, 300ms exponential decay, no sustain."""
    onsets = [i * 1.0 for i in range(8)]
    pitches = [PITCH_HZ[p] for p in PITCH_SEQ_LOW]
    audio = place_notes(
        onsets, pitches, note_duration_s=0.35, envelope="pluck",
        attack_ms=5.0, decay_ms=300.0,
        n_partials=8,
    )
    # Score: 8 quarters with staccato articulation (pizz isn't a separate
    # field in our schema, but staccato signals "short, separated" which is
    # the closest analogue).
    measures = [{
        "measure_number": 1,
        "notes": [
            {"pitch": p, "duration": "quarter", "articulation": "staccato",
             "tied_to_next": False, "dynamics": None}
            for p in PITCH_SEQ_LOW[:4]
        ],
        "slurs": [],
    }, {
        "measure_number": 2,
        "notes": [
            {"pitch": p, "duration": "quarter", "articulation": "staccato",
             "tied_to_next": False, "dynamics": None}
            for p in PITCH_SEQ_LOW[4:]
        ],
        "slurs": [],
    }]
    score = ScoreJson.model_validate({
        "time_signature": "4/4",
        "key_signature": "E minor",
        "tempo_marking": None,
        "bpm_hint": 60,
        "clef": "bass",
        "measures": measures,
        "repeats": [],
        "ocr_confidence": 1.0,
        "notes_to_human": "Synthetic pizzicato — sharp transients, fast decay, no sustain",
    })
    return audio, score


def build_score_quarters(pitch_sequence: list[str], note: str) -> ScoreJson:
    """8-quarter-note score in 4/4, 2 measures."""
    measures = []
    for m_idx in range(2):
        measures.append({
            "measure_number": m_idx + 1,
            "notes": [
                {"pitch": p, "duration": "quarter",
                 "articulation": None, "tied_to_next": False, "dynamics": None}
                for p in pitch_sequence[m_idx * 4:(m_idx + 1) * 4]
            ],
            "slurs": [],
        })
    return ScoreJson.model_validate({
        "time_signature": "4/4",
        "key_signature": "E minor",
        "tempo_marking": None,
        "bpm_hint": 60,
        "clef": "bass",
        "measures": measures,
        "repeats": [],
        "ocr_confidence": 1.0,
        "notes_to_human": note,
    })


CLIPS = [
    ("01_detache_clean", synth_01_clean),
    ("02_detache_rushing", synth_02_rushing),
    ("03_detache_dragging", synth_03_dragging),
    ("04_slurred", synth_04_slurred),
    ("05_open_e_long", synth_05_open_e_long),
    ("06_pizzicato", synth_06_pizzicato),
]


def main() -> int:
    print("=== SYNTHESIZING ===")
    summary: list[dict] = []
    for stem, fn in CLIPS:
        audio, score = fn()
        wav_path = AUDIO_DIR / f"{stem}.wav"
        json_path = SCORE_DIR / f"{stem}.json"
        save_wav(audio, wav_path)
        json_path.write_text(score.model_dump_json(indent=2), encoding="utf-8")
        duration_s = audio.size / SR
        size_kb = wav_path.stat().st_size / 1024
        print(f"  {stem}: {duration_s:.2f}s, {size_kb:.1f} KB → {wav_path.name}")
        summary.append({"stem": stem, "wav": wav_path, "json": json_path, "duration_s": duration_s})

    print("\n=== SANITY PASS (analyze) ===")
    for s in summary:
        score = ScoreJson.model_validate_json(s["json"].read_text(encoding="utf-8"))
        # apply_highpass=True for the open-E clip (low register).
        is_low_e = s["stem"] == "05_open_e_long"
        result = analyze(s["wav"], score, target_bpm=60.0, apply_highpass=is_low_e)
        expected_notes = sum(
            1 for m in score.measures for n in m.notes if n.pitch != "rest"
        )
        verdict_text = result.verdict.headline if result.verdict else "(no verdict)"
        print(
            f"  {s['stem']}: status={result.status} "
            f"q={result.quality:.2f} "
            f"matched={len(result.per_note)}/{expected_notes} "
            f"missed={len(result.missed_notes)} extra={len(result.extra_notes)}"
        )
        print(f"      verdict: {verdict_text[:110]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
