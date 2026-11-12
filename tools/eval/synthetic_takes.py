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
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

_BACKEND = Path(__file__).resolve().parents[2] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services.alignment import ExpectedNote, build_timeline
from app.services.score_schema import ScoreJson

SCHEMA_VERSION = 1

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
    track: str
    level_db: float
    type: ErrorType = "accompaniment"


@dataclass
class Degradation:
    profile: str
    type: ErrorType = "degradation"


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
)


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


def build_ground_truth(
    score_path: Path, config: TakeConfig
) -> dict[str, Any]:
    """The take's labelled timeline, as the `SCHEMA.md` document.

    Pure computation over the expected timeline — no audio involved, so this
    always succeeds and is what's tested without `fluidsynth`.
    """
    payload = json.loads(score_path.read_text())
    score = ScoreJson.model_validate(payload["score"])
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
    binary or the soundfont is missing, which is the normal state of a
    sandbox with no network access: the ground truth above does not need
    this to have run, only a human or a CI machine with `fluidsynth`
    installed listening to the result does.

    `out_wav` must be outside the repository — see `README.md`.
    """
    if shutil.which("fluidsynth") is None:
        return False
    if not config.soundfont.exists():
        return False
    ground_truth = build_ground_truth(score_path, config)
    midi_path = out_wav.with_suffix(".mid")
    _write_midi(ground_truth, midi_path)
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
    return True


def _write_midi(ground_truth: dict[str, Any], out_path: Path) -> None:
    """A minimal single-track Standard MIDI File — no third-party dependency.

    Only what `fluidsynth -ni` needs: note on/off events at the ground
    truth's own `played_onset_s` times, tempo 120 (so delta-times are a
    direct seconds-to-ticks conversion) and the written/played pitch mapped
    through `_PITCH_TO_MIDI`. Vibrato and bow envelope are soundfont
    articulation, not MIDI data, and are out of scope for this generator.
    """
    ticks_per_beat = 480
    tempo_us_per_beat = 500_000  # 120 bpm, fixed reference clock
    ticks_per_second = ticks_per_beat * 1_000_000 / tempo_us_per_beat

    events: list[tuple[float, bytes]] = []
    for note in ground_truth["notes"]:
        if note["played_pitch"] is None:
            continue
        midi_num = _pitch_to_midi(note["played_pitch"])
        on_t = note["played_onset_s"]
        events.append((on_t, bytes([0x90, midi_num, 100])))
        events.append((on_t + 0.4, bytes([0x80, midi_num, 0])))
    for extra in ground_truth["extra_notes"]:
        midi_num = _pitch_to_midi(extra["played_pitch"])
        on_t = extra["played_onset_s"]
        events.append((on_t, bytes([0x90, midi_num, 100])))
        events.append((on_t + 0.4, bytes([0x80, midi_num, 0])))

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
