"""Generate synthetic violin takes with known-answer ground truth.

Turns a score JSON fixture (the same shape `fixtures/scores/*.json` and the
OCR pipeline use — see `backend/app/services/score_schema.py`) into:

- a labelled timeline of what was "played", with errors injected on purpose
  (tempo drift, timing offsets, intonation offsets, wrong/missed/extra
  notes, a mid-piece restart);
- a ground-truth JSON document describing every one of those errors
  per note, in the shape `SCHEMA.md` defines — keyed by the same
  `global_index` the backend's own `alignment.build_timeline` and
  `AnalysisResult.per_note` use, so a real analysis run can be zipped
  against this ground truth directly.

Rendering that timeline to actual audio (a soundfont, vibrato, an
accompaniment mix, phone-mic degradation) is a separate, best-effort step —
`render_take` — gated on tools this sandbox does not always have
(`fluidsynth`). The ground truth never depends on whether rendering
succeeded: it is derived from the event list, not from the audio.

No audio is ever written inside this repository. See `README.md`.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, sosfiltfilt

_BACKEND = Path(__file__).resolve().parents[2] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services.alignment import ExpectedNote, build_timeline
from app.services.ocr.musicxml import score_json_from_musicxml
from app.services.score_schema import ScoreJson

SCHEMA_VERSION = 1

#: Fixed note sustain used by `_write_midi`'s note on/off pairs and, so the
#: audio-domain effects below (bow envelope, vibrato) shape exactly the
#: window fluidsynth actually sounds, by every other function that needs to
#: know where one note's audio ends and the next begins.
NOTE_LEN_S = 0.4

ErrorType = Literal[
    "tempo_drift",
    "timing_offset",
    "intonation_offset",
    "wrong_note",
    "missed_note",
    "extra_note",
    "restart",
    "accompaniment",
    "degradation",
    "vibrato",
    "bow_envelope",
]


@dataclass
class TempoDrift:
    from_measure: int
    pct_per_bar: float
    type: ErrorType = "tempo_drift"


@dataclass
class TimingOffset:
    global_index: int
    ms: float
    type: ErrorType = "timing_offset"


@dataclass
class IntonationOffset:
    cents: float
    global_index: int | None = None
    measure_number: int | None = None
    type: ErrorType = "intonation_offset"

    def __post_init__(self) -> None:
        if (self.global_index is None) == (self.measure_number is None):
            raise ValueError(
                "IntonationOffset needs exactly one of global_index or measure_number"
            )


@dataclass
class WrongNote:
    global_index: int
    heard: str
    type: ErrorType = "wrong_note"


@dataclass
class MissedNote:
    global_index: int
    type: ErrorType = "missed_note"


@dataclass
class ExtraNote:
    after_global_index: int
    pitch: str
    type: ErrorType = "extra_note"


@dataclass
class Restart:
    at_global_index: int
    type: ErrorType = "restart"


@dataclass
class Accompaniment:
    """A backing track mixed under the melody, synthesised (not sampled).

    `track` picks the shape: `"drone"` is a sustained tone at the piece's
    lowest written pitch, held for the whole take; `"piano"` is a struck note
    at each measure's first onset, an octave below that measure's own first
    written pitch, with a fast attack and a slow decay. Neither reaches for
    an extra soundfont — see `_synth_accompaniment` for why.
    """

    track: str
    level_db: float
    type: ErrorType = "accompaniment"


@dataclass
class Degradation:
    """Phone-mic-and-room signal chain, applied to the final mixed signal.

    Every number a listener would need to reproduce the take by ear is a
    field here, not folded into `profile` as a label — `profile` is only a
    human-readable name for the combination.
    """

    profile: str = "phone_mic_room"
    band_low_hz: float = 300.0
    band_high_hz: float = 3400.0
    noise_snr_db: float = 20.0
    reverb_wet: float = 0.15
    reverb_decay_s: float = 0.25
    compression_ratio: float = 4.0
    compression_threshold_db: float = -18.0
    #: Noise and reverb are randomised; fixed so the same config always
    #: renders byte-identical audio.
    seed: int = 0
    type: ErrorType = "degradation"


@dataclass
class Vibrato:
    """Sinusoidal pitch modulation, applied to every sounded note's render.

    Implemented as MIDI pitch-bend events around each note's own on/off pair
    (see `_vibrato_bend_events`), not a DSP effect on the finished audio —
    that way fluidsynth's own soundfont does the resynthesis, the way a
    pitch-bend-aware synth is meant to be driven, and the bend is reset to
    centre at each note's end so it never bleeds into the next note.
    """

    rate_hz: float
    depth_cents: float
    type: ErrorType = "vibrato"


@dataclass
class BowEnvelope:
    """Attack/decay shaping applied to every note's rendered samples.

    A struck-note soundfont's default envelope does not sound bowed; this
    re-shapes the amplitude of each `NOTE_LEN_S` window after rendering so
    every note ramps up over `attack_ms` and eases off over `decay_ms`
    rather than starting and stopping like a plucked instrument.
    """

    attack_ms: float
    decay_ms: float
    type: ErrorType = "bow_envelope"


InjectedError = (
    TempoDrift
    | TimingOffset
    | IntonationOffset
    | WrongNote
    | MissedNote
    | ExtraNote
    | Restart
    | Accompaniment
    | Degradation
    | Vibrato
    | BowEnvelope
)


def _first(config: TakeConfig, cls: type) -> Any:
    return next((e for e in config.errors if isinstance(e, cls)), None)


@dataclass
class TakeConfig:
    """What to do to one score to produce one labelled take."""

    instrument: str = "violin"
    target_bpm: float = 90.0
    errors: list[InjectedError] = field(default_factory=list)

    @property
    def soundfont(self) -> Path:
        return (
            Path(__file__).resolve().parents[2]
            / "mobile"
            / "assets"
            / "soundfonts"
            / f"{self.instrument}.sf2"
        )


def _written_pitches(score: ScoreJson) -> dict[int, str]:
    """`global_index` -> written pitch, for every *sounded* note.

    Mirrors `build_timeline`'s own walk closely enough for this purpose: it
    counts the same notes `build_timeline` turns into onsets (skipping rests
    and tied-over notes), in the same order, so the index lines up with
    `ExpectedNote.global_index` without re-deriving the beat/rest logic.
    """
    pitches: dict[int, str] = {}
    index = 0
    for measure in score.measures:
        for note in measure.notes:
            if note.pitch.lower() == "rest":
                continue
            if note.tied_to_next and index in pitches:
                # tied-FROM notes are handled by build_timeline, not here
                pass
            pitches[index] = note.pitch
            index += 1
    return pitches


def _apply_tempo_drift(
    onsets: list[float], notes: list[ExpectedNote], drift: TempoDrift
) -> list[float]:
    """Scale onsets after `from_measure` by a compounding per-bar drift.

    `pct_per_bar > 0` rushes (each bar a little faster than the one before);
    negative drags. Applied as a multiplicative stretch of the *gap* since
    the previous onset, so earlier onsets are untouched and the drift
    compounds bar over bar the way a player actually speeding up does.
    """
    out = list(onsets)
    factor = 1.0
    last_measure = None
    for i, note in enumerate(notes):
        if note.measure_number < drift.from_measure:
            continue
        if note.measure_number != last_measure:
            if last_measure is not None:
                factor *= 1.0 - (drift.pct_per_bar / 100.0)
            last_measure = note.measure_number
        if i == 0:
            continue
        gap = out[i] - out[i - 1]
        out[i] = out[i - 1] + gap * factor
    return out


def _load_score(score_path: Path) -> ScoreJson:
    """Score JSON fixture or a real MusicXML file -> `ScoreJson`.

    Suffix-dispatched so every caller passes the same kind of `Path` either
    way: `.json` is the `{"score": ...}` fixture shape every other fixture
    in this repo uses; `.musicxml`/`.xml` goes through the OCR pipeline's
    own parser — the same one a camera upload hits — so a real downloaded
    piece (e.g. JERA-568's reference scores in `intempo-eval-data/`) gets
    exactly the score shape that parser produces, not a hand-written
    approximation of it. Raises if the file names more than one part and
    none is picked — same as the OCR pipeline does.
    """
    if score_path.suffix in {".musicxml", ".xml"}:
        return score_json_from_musicxml(score_path.read_text())
    payload = json.loads(score_path.read_text())
    return ScoreJson.model_validate(payload["score"])


def build_ground_truth(
    score_path: Path, config: TakeConfig
) -> dict[str, Any]:
    """The take's labelled timeline, as the `SCHEMA.md` document.

    Pure computation over the expected timeline — no audio involved, so this
    always succeeds and is what's tested without `fluidsynth`.
    """
    score = _load_score(score_path)
    timeline = build_timeline(score, config.target_bpm)
    written = _written_pitches(score)

    onsets = list(timeline.onsets)
    for err in config.errors:
        if isinstance(err, TempoDrift):
            onsets = _apply_tempo_drift(onsets, timeline.notes, err)

    missed = {e.global_index for e in config.errors if isinstance(e, MissedNote)}
    wrong = {e.global_index: e.heard for e in config.errors if isinstance(e, WrongNote)}
    timing = {e.global_index: e.ms for e in config.errors if isinstance(e, TimingOffset)}
    cents_by_note = {
        e.global_index: e.cents
        for e in config.errors
        if isinstance(e, IntonationOffset) and e.global_index is not None
    }
    cents_by_measure = {
        e.measure_number: e.cents
        for e in config.errors
        if isinstance(e, IntonationOffset) and e.measure_number is not None
    }
    restarts = sorted(e.at_global_index for e in config.errors if isinstance(e, Restart))

    notes_out: list[dict[str, Any]] = []
    for expected, onset in zip(timeline.notes, onsets, strict=True):
        gi = expected.global_index
        labels: list[str] = []

        played_onset: float | None = onset
        played_pitch: str | None = written.get(gi)

        if gi in missed:
            labels.append("missed_note")
            played_onset = None
            played_pitch = None
        else:
            if gi in timing:
                played_onset = onset + timing[gi] / 1000.0
                labels.append("timing_offset")
            if any(m <= gi for m in restarts):
                labels.append("restart")
            if gi in wrong:
                played_pitch = wrong[gi]
                labels.append("wrong_note")

        cents = cents_by_note.get(gi, cents_by_measure.get(expected.measure_number, 0.0))
        if cents and gi not in missed:
            labels.append("intonation_offset")
        if gi not in missed and any(
            isinstance(e, TempoDrift) and expected.measure_number >= e.from_measure
            for e in config.errors
        ):
            labels.append("tempo_drift")

        notes_out.append(
            {
                "global_index": gi,
                "measure_number": expected.measure_number,
                "written_pitch": written.get(gi),
                "expected_onset_s": float(timeline.onsets[gi]),
                "played_onset_s": played_onset,
                "played_pitch": played_pitch,
                "cents_offset": float(cents) if gi not in missed else None,
                "error_labels": labels,
            }
        )

    extra_out: list[dict[str, Any]] = []
    for err in config.errors:
        if not isinstance(err, ExtraNote):
            continue
        anchor = next(
            (n for n in notes_out if n["global_index"] == err.after_global_index), None
        )
        anchor_time = anchor["expected_onset_s"] if anchor else 0.0
        extra_out.append(
            {
                "after_global_index": err.after_global_index,
                "played_onset_s": anchor_time + 0.25,
                "played_pitch": err.pitch,
                "error_labels": ["extra_note"],
            }
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "source_score": str(score_path),
        "instrument": config.instrument,
        "target_bpm": config.target_bpm,
        "soundfont": str(config.soundfont),
        "injected_errors": [_error_as_dict(e) for e in config.errors],
        "notes": notes_out,
        "extra_notes": extra_out,
    }


def _error_as_dict(err: InjectedError) -> dict[str, Any]:
    return {k: v for k, v in vars(err).items()}


def render_take(
    score_path: Path, config: TakeConfig, out_wav: Path
) -> bool:
    """Best-effort audio render via `fluidsynth` + the bundled soundfont.

    Returns False (and writes nothing) rather than raising when either the
    binary or the soundfont is missing — the normal state of a sandbox with
    no network access, though this one now has `fluidsynth` installed (see
    `README.md`): the ground truth above does not need this to have run,
    only a human or a CI machine listening to the result does.

    Vibrato is driven into the render as MIDI pitch bend (`_write_midi`);
    bow envelope, accompaniment and phone-mic degradation are applied to the
    rendered samples afterwards, in that order, by
    `_apply_bow_envelope` / `_mix_accompaniment` / `_apply_degradation` —
    each a no-op when its `InjectedError` isn't in `config.errors`.

    `out_wav` must be outside the repository — see `README.md`.
    """
    if shutil.which("fluidsynth") is None:
        return False
    if not config.soundfont.exists():
        return False
    ground_truth = build_ground_truth(score_path, config)
    vibrato = _first(config, Vibrato)
    bow = _first(config, BowEnvelope)
    accompaniment = _first(config, Accompaniment)
    degradation = _first(config, Degradation)

    midi_path = out_wav.with_suffix(".mid")
    _write_midi(ground_truth, midi_path, vibrato=vibrato)
    subprocess.run(
        [
            "fluidsynth",
            "-ni",
            str(config.soundfont),
            str(midi_path),
            "-F",
            str(out_wav),
            "-r",
            "44100",
        ],
        check=True,
        capture_output=True,
    )

    if bow is None and accompaniment is None and degradation is None:
        return True

    samples, sr = sf.read(out_wav)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    if bow is not None:
        samples = _apply_bow_envelope(samples, sr, ground_truth, bow)
    if accompaniment is not None:
        samples = _mix_accompaniment(samples, sr, ground_truth, accompaniment)
    if degradation is not None:
        samples = _apply_degradation(samples, sr, degradation)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > 0.98:
        samples = samples * (0.98 / peak)
    sf.write(out_wav, samples, sr)
    return True


def _vibrato_bend_events(
    onset_s: float, duration_s: float, vibrato: Vibrato, step_s: float = 0.015
) -> list[tuple[float, bytes]]:
    """Pitch-bend (`0xE0`) events tracing a sine from `onset_s` for `duration_s`.

    Fluidsynth's (and GM's) default pitch-bend range is ±2 semitones, i.e.
    ±200 cents, mapped onto the signed 14-bit bend value centred at 8192 —
    comfortably wider than any realistic `depth_cents`, so no RPN range
    change is sent. One event every `step_s` is a coarse sine, not a
    continuous one, but short of that step a bend event changes nothing a
    44.1kHz render can hear.
    """
    events: list[tuple[float, bytes]] = []
    t = 0.0
    while t < duration_s:
        frac = max(
            -1.0,
            min(1.0, (vibrato.depth_cents / 200.0) * math.sin(2 * math.pi * vibrato.rate_hz * t)),
        )
        value = max(0, min(16383, int(round(8192 + frac * 8192))))
        events.append((onset_s + t, bytes([0xE0, value & 0x7F, (value >> 7) & 0x7F])))
        t += step_s
    return events


#: GM program numbers (0-indexed, matching `fluidsynth`'s own `inst 1`
#: listing) for the instruments the bundled soundfonts actually carry a
#: preset for. **Without a Program Change, channel 0 defaults to program 0
#: (Grand Piano), which none of these soundfonts has a preset for at all —
#: `fluidsynth` logs "No preset found on channel 0" and renders silence.**
#: That is exactly the gap this issue opened against: nobody had rendered a
#: take through `fluidsynth` for real before, so the missing Program Change
#: went unnoticed — the MIDI file "worked" in the sense that it parsed and
#: produced a WAV, and that WAV was 90 dB below the noise floor.
_GM_PROGRAM = {
    "violin": 40,
    "viola": 41,
    "cello": 42,
    "double_bass": 43,
    "alto_sax": 65,
    "tenor_sax": 66,
}


def _write_midi(
    ground_truth: dict[str, Any], out_path: Path, vibrato: Vibrato | None = None
) -> None:
    """A minimal single-track Standard MIDI File — no third-party dependency.

    A Program Change to the instrument's own GM number (`_GM_PROGRAM`) opens
    the track, then note on/off events at the ground truth's own
    `played_onset_s` times, tempo 120 (so delta-times are a direct
    seconds-to-ticks conversion) and the written/played pitch mapped
    through `_pitch_to_midi`. When `vibrato` is given, every sounded note
    also gets a run of pitch-bend events over its `NOTE_LEN_S` window
    (`_vibrato_bend_events`), reset to centre (`0xE0 0x00 0x40`) right at
    note-off so the bend never carries into the next note — bow envelope
    stays a post-render amplitude effect (`_apply_bow_envelope`), since a
    soundfont's note-on velocity doesn't shape a sustain's envelope the way
    a bow's attack/decay does.
    """
    ticks_per_beat = 480
    tempo_us_per_beat = 500_000  # 120 bpm, fixed reference clock
    ticks_per_second = ticks_per_beat * 1_000_000 / tempo_us_per_beat

    program = _GM_PROGRAM.get(ground_truth["instrument"], 40)
    events: list[tuple[float, bytes]] = [(0.0, bytes([0xC0, program]))]

    def _add_note(on_t: float, midi_num: int) -> None:
        events.append((on_t, bytes([0x90, midi_num, 100])))
        off_t = on_t + NOTE_LEN_S
        if vibrato is not None:
            events.extend(_vibrato_bend_events(on_t, NOTE_LEN_S, vibrato))
            events.append((off_t, bytes([0xE0, 0x00, 0x40])))
        events.append((off_t, bytes([0x80, midi_num, 0])))

    for note in ground_truth["notes"]:
        if note["played_pitch"] is None:
            continue
        _add_note(note["played_onset_s"], _pitch_to_midi(note["played_pitch"]))
    for extra in ground_truth["extra_notes"]:
        _add_note(extra["played_onset_s"], _pitch_to_midi(extra["played_pitch"]))

    events.sort(key=lambda e: e[0])

    track = bytearray()
    last_tick = 0
    for t, msg in events:
        tick = round(t * ticks_per_second)
        delta = max(0, tick - last_tick)
        track += _varlen(delta)
        track += msg
        last_tick = tick
    track += _varlen(0) + bytes([0xFF, 0x2F, 0x00])  # end of track

    header = b"MThd" + (6).to_bytes(4, "big") + bytes([0, 1]) + (1).to_bytes(
        2, "big"
    ) + ticks_per_beat.to_bytes(2, "big")
    track_chunk = b"MTrk" + len(track).to_bytes(4, "big") + bytes(track)
    out_path.write_bytes(header + track_chunk)


def _sounded_notes(ground_truth: dict[str, Any]) -> list[dict[str, Any]]:
    """Every rendered onset — expected notes plus extra ones — in time order."""
    notes = [n for n in ground_truth["notes"] if n["played_onset_s"] is not None]
    notes = notes + ground_truth["extra_notes"]
    return sorted(notes, key=lambda n: n["played_onset_s"])


def _apply_bow_envelope(
    samples: np.ndarray, sr: int, ground_truth: dict[str, Any], bow: BowEnvelope
) -> np.ndarray:
    """Ramp each note's `NOTE_LEN_S` window up over `attack_ms`, down over `decay_ms`.

    A struck-note soundfont's own envelope starts loud and decays
    exponentially from the first sample — nothing like a bow's gradual
    attack. This re-shapes the amplitude in place at each note's known
    sample range (from the ground truth's own onsets, the same window
    `_write_midi` gave the note in the MIDI file) rather than attempting
    pitch-independent onset detection on the finished render.
    """
    out = samples.astype(np.float64, copy=True)
    attack_n = max(1, round(bow.attack_ms / 1000 * sr))
    decay_n = max(1, round(bow.decay_ms / 1000 * sr))
    for note in _sounded_notes(ground_truth):
        start = int(round(note["played_onset_s"] * sr))
        end = min(len(out), start + round(NOTE_LEN_S * sr))
        if start >= end:
            continue
        n = end - start
        env = np.ones(n, dtype=np.float64)
        a = min(attack_n, n)
        env[:a] = np.linspace(0.0, 1.0, a, endpoint=False)
        d = min(decay_n, n - a)
        if d > 0:
            env[n - d :] = np.minimum(env[n - d :], np.linspace(1.0, 0.3, d))
        out[start:end] *= env
    return out


def _synth_tone(freqs_and_times: list[tuple[float, float, float]], sr: int, n_samples: int) -> np.ndarray:
    """Additive sine+harmonics synth: `[(freq_hz, start_s, duration_s), ...] -> samples`.

    Used only for the accompaniment track, which exists to be mixed well
    under the melody at a stated `level_db` — not to be a convincing
    instrument on its own, so three harmonics and a fixed decay are enough.
    """
    out = np.zeros(n_samples, dtype=np.float64)
    t_axis = np.arange(n_samples) / sr
    for freq, start, duration in freqs_and_times:
        start_i = int(round(start * sr))
        end_i = min(n_samples, start_i + int(round(duration * sr)))
        if start_i >= end_i:
            continue
        t = t_axis[start_i:end_i] - start
        envelope = np.exp(-t / max(duration / 3, 1e-3))
        tone = sum(np.sin(2 * math.pi * freq * (h + 1) * t) / (h + 1) for h in range(3))
        out[start_i:end_i] += envelope * tone
    return out


def _mix_accompaniment(
    samples: np.ndarray, sr: int, ground_truth: dict[str, Any], accompaniment: Accompaniment
) -> np.ndarray:
    """Add a synthesised backing track, scaled by RMS to sit at `level_db`.

    `"drone"` sustains the piece's lowest written pitch for the whole take;
    anything else (`"piano"`) strikes, once per measure, an octave below
    that measure's own first written note. Scaling by the RMS ratio (not a
    flat gain) means `level_db` means the same thing regardless of how loud
    the melody render happens to be.
    """
    n = len(samples)
    notes = _sounded_notes(ground_truth)
    if not notes:
        return samples
    midi_nums = [_pitch_to_midi(n_["written_pitch"] or n_["played_pitch"]) for n_ in ground_truth["notes"]]
    if accompaniment.track == "drone":
        root_midi = min(midi_nums) if midi_nums else 57
        freq = 440.0 * 2 ** ((root_midi - 12 - 69) / 12)
        duration = n / sr
        backing = _synth_tone([(freq, 0.0, duration)], sr, n)
    else:
        by_measure: dict[int, dict[str, Any]] = {}
        for note in ground_truth["notes"]:
            if note["played_onset_s"] is None:
                continue
            by_measure.setdefault(note["measure_number"], note)
        events = []
        for note in by_measure.values():
            midi_num = _pitch_to_midi(note["written_pitch"]) - 12
            freq = 440.0 * 2 ** ((midi_num - 69) / 12)
            events.append((freq, note["played_onset_s"], NOTE_LEN_S * 3))
        backing = _synth_tone(events, sr, n)

    melody_rms = float(np.sqrt(np.mean(samples**2))) if n else 0.0
    backing_rms = float(np.sqrt(np.mean(backing**2))) if np.any(backing) else 0.0
    if melody_rms <= 0 or backing_rms <= 0:
        return samples
    target_rms = melody_rms * (10 ** (accompaniment.level_db / 20))
    backing *= target_rms / backing_rms
    return samples + backing


def _apply_degradation(samples: np.ndarray, sr: int, degradation: Degradation) -> np.ndarray:
    """Band-limit, add noise at a stated SNR, light room reverb, then compress.

    In that order, because it is the order a phone mic's own signal actually
    sees it: the capsule and preamp are band-limited and noisy before any
    room reflection reaches it, and the device's AGC/compressor is the last
    thing in the chain before the recorded file.
    """
    rng = np.random.default_rng(degradation.seed)
    out = samples.astype(np.float64, copy=True)

    nyquist = sr / 2
    low = max(1.0, degradation.band_low_hz) / nyquist
    high = min(degradation.band_high_hz, nyquist - 1) / nyquist
    sos = butter(4, [low, high], btype="band", output="sos")
    out = sosfiltfilt(sos, out)

    signal_rms = float(np.sqrt(np.mean(out**2)))
    if signal_rms > 0:
        noise_rms = signal_rms / (10 ** (degradation.noise_snr_db / 20))
        out = out + rng.normal(0.0, noise_rms, size=out.shape)

    if degradation.reverb_wet > 0:
        ir_len = max(1, int(degradation.reverb_decay_s * sr))
        t = np.arange(ir_len) / sr
        ir = rng.normal(0.0, 1.0, ir_len) * np.exp(-t / max(degradation.reverb_decay_s / 4, 1e-3))
        ir[0] = 1.0  # direct sound, so wet isn't pure reflections
        ir = ir / np.sqrt(np.sum(ir**2))
        wet = fftconvolve(out, ir)[: len(out)]
        out = (1 - degradation.reverb_wet) * out + degradation.reverb_wet * wet

    threshold = 10 ** (degradation.compression_threshold_db / 20)
    envelope = np.abs(out)
    over = envelope > threshold
    if np.any(over):
        with np.errstate(divide="ignore"):
            compressed_db = degradation.compression_threshold_db + (
                20 * np.log10(np.maximum(envelope, 1e-12)) - degradation.compression_threshold_db
            ) / degradation.compression_ratio
        target = np.where(over, 10 ** (compressed_db / 20), envelope)
        gain = np.where(envelope > 0, target / np.maximum(envelope, 1e-12), 1.0)
        out = out * gain

    return out


def _varlen(value: int) -> bytes:
    chunks = [value & 0x7F]
    value >>= 7
    while value:
        chunks.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(chunks))


_PITCH_CLASS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _pitch_to_midi(pitch: str) -> int:
    """"A4" -> 69, "F#4" -> 66, "Bb3" -> 58."""
    letter = pitch[0].upper()
    rest = pitch[1:]
    accidental = 0
    while rest and rest[0] in "#b":
        accidental += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    octave = int(rest)
    return 12 * (octave + 1) + _PITCH_CLASS[letter] + accidental
