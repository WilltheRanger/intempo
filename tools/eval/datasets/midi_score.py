"""Minimal Standard MIDI File reader — just enough to turn URMP's `Sco_*.mid`
scores into a `ScoreJson` the real pipeline can align against.

No `mido`/`pretty_midi` dependency: a format-1 SMF's header and track-chunk
layout, read with running status and the meta events this project's scores
need (tempo, time signature), is a couple hundred lines, and this is the only
caller. Nothing here writes a MIDI file — `synthetic_takes._write_midi`
already does that, for a different purpose (feeding `fluidsynth`), and reuses
none of this module's reading code.
"""

from __future__ import annotations

import struct
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_BACKEND = Path(__file__).resolve().parents[3] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services.score_schema import DURATION_BEATS

#: Sharps, not flats, for the black keys — the same choice
#: `synthetic_takes._pitch_to_midi` makes for the reverse direction. Middle C
#: (MIDI 60) is "C4", matching `score_schema`'s scientific-pitch convention.
_PITCH_CLASS_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi_to_pitch(note_number: int) -> str:
    """60 -> "C4", 61 -> "C#4", 69 -> "A4"."""
    octave = note_number // 12 - 1
    name = _PITCH_CLASS_NAMES[note_number % 12]
    return f"{name}{octave}"


@dataclass(frozen=True)
class MidiNote:
    start_beats: float
    end_beats: float
    pitch_midi: int

    @property
    def pitch(self) -> str:
        return midi_to_pitch(self.pitch_midi)


@dataclass(frozen=True)
class ParsedMidi:
    division: int  # ticks per quarter note
    tempo_bpm: float  # first Set Tempo meta event; 120 if the file has none
    time_signature: tuple[int, int]  # (numerator, denominator); (4, 4) if absent
    notes: list[MidiNote]  # one track's sounded notes, start-time order


def _read_varlen(data: bytes, i: int) -> tuple[int, int]:
    value = 0
    while True:
        byte = data[i]
        i += 1
        value = (value << 7) | (byte & 0x7F)
        if not (byte & 0x80):
            return value, i


def _read_chunks(data: bytes) -> tuple[int, int, list[bytes]]:
    """`(n_tracks, division, [one MTrk's raw bytes, ...])`, in file order."""
    if data[:4] != b"MThd":
        raise ValueError("not a Standard MIDI File (missing MThd)")
    header_len = struct.unpack(">I", data[4:8])[0]
    _fmt, n_tracks, division = struct.unpack(">HHH", data[8 : 8 + header_len])
    pos = 8 + header_len
    tracks = []
    for _ in range(n_tracks):
        if data[pos : pos + 4] != b"MTrk":
            raise ValueError(f"expected MTrk at byte {pos}, got {data[pos:pos + 4]!r}")
        track_len = struct.unpack(">I", data[pos + 4 : pos + 8])[0]
        tracks.append(data[pos + 8 : pos + 8 + track_len])
        pos += 8 + track_len
    return n_tracks, division, tracks


def _track_events(track: bytes) -> list[tuple[int, int, bytes]]:
    """`(absolute_tick, status_byte, data)` for every channel/meta event.

    Running status is honoured (a status byte is only re-sent when it
    changes); sysex (`0xF0`/`0xF7`) is skipped, since URMP's score files carry
    none. A meta event (`0xFF`) is returned with its type byte prepended to
    `data`, so the caller can tell `0x51` (tempo) from `0x58` (time
    signature) without a second read of the track.
    """
    events: list[tuple[int, int, bytes]] = []
    i = 0
    abs_tick = 0
    running_status: int | None = None
    while i < len(track):
        delta, i = _read_varlen(track, i)
        abs_tick += delta
        status = track[i]
        if status < 0x80:
            status = running_status
        else:
            i += 1
            running_status = status
        if status == 0xFF:
            meta_type = track[i]
            length, i = _read_varlen(track, i + 1)
            payload = track[i : i + length]
            i += length
            events.append((abs_tick, 0xFF, bytes([meta_type]) + payload))
        elif status in (0xF0, 0xF7):
            length, i = _read_varlen(track, i)
            i += length
        else:
            hi = status & 0xF0
            n_data = 1 if hi in (0xC0, 0xD0) else 2
            events.append((abs_tick, status, track[i : i + n_data]))
            i += n_data
    return events


def parse_midi(path: Path, *, note_track: int) -> ParsedMidi:
    """Read tempo/time signature from track 0 and notes from `note_track`.

    `note_track` is the 1-based `MTrk` index: a format-1 file conventionally
    keeps track 0 as tempo/meta-only, and URMP's instrument numbering
    (`AuSep_<n>_...`) matches the score MIDI's track `n` one-for-one.
    """
    data = path.read_bytes()
    n_tracks, division, tracks = _read_chunks(data)
    if not (0 <= note_track < n_tracks):
        raise ValueError(f"{path}: no track {note_track} (file has {n_tracks})")

    tempo_bpm = 120.0
    time_signature = (4, 4)
    for _tick, status, payload in _track_events(tracks[0]):
        if status != 0xFF:
            continue
        meta_type = payload[0]
        if meta_type == 0x51 and len(payload) >= 4:  # Set Tempo, µs per quarter
            us_per_quarter = int.from_bytes(payload[1:4], "big")
            if us_per_quarter > 0:
                tempo_bpm = 60_000_000 / us_per_quarter
        elif meta_type == 0x58 and len(payload) >= 3:  # Time Signature
            time_signature = (payload[1], 2 ** payload[2])

    notes: list[MidiNote] = []
    open_notes: dict[int, int] = {}  # pitch -> start tick, for the currently-sounding note
    for abs_tick, status, payload in _track_events(tracks[note_track]):
        hi = status & 0xF0
        if hi == 0x90 and payload[1] > 0:  # note on, velocity > 0
            open_notes[payload[0]] = abs_tick
        elif hi == 0x80 or (hi == 0x90 and payload[1] == 0):  # note off
            start = open_notes.pop(payload[0], None)
            if start is not None and abs_tick > start:
                notes.append(MidiNote(start / division, abs_tick / division, payload[0]))
    notes.sort(key=lambda n: n.start_beats)
    return ParsedMidi(
        division=division, tempo_bpm=tempo_bpm, time_signature=time_signature, notes=notes
    )


def _nearest_duration(beats: float) -> str:
    """The `Duration` name whose beat value is closest to `beats`.

    This is building a score for `analyze()` to align against, not a
    transcription for a musician to read — a performed duration never lands
    exactly on a notated value, and `build_timeline` only ever sums these
    back into beats, so the nearest bucket is all that's needed.
    """
    return min(DURATION_BEATS, key=lambda name: abs(DURATION_BEATS[name] - beats))


def to_score_json(parsed: ParsedMidi, *, clef: str = "treble") -> dict[str, Any]:
    """`parsed.notes`, plus the gaps between them as rests, as a `ScoreJson`.

    Measures are cut every `time_signature`'s worth of beats, counted from
    the first note rather than from the file's own (unrecovered, once
    reduced to note on/off) bar lines — `alignment.build_timeline`'s
    docstring on why bar placement never moves a note is exactly why that is
    safe here: the cut points need to sum correctly, not match what was
    engraved. A note that straddles a cut is split in two and tied, so it
    stays one onset rather than becoming a phantom re-attack at the barline.
    """
    numerator, denominator = parsed.time_signature
    beats_per_measure = numerator * (4.0 / denominator)

    events: list[tuple[float, str | None]] = []  # (duration_beats, pitch or None for rest)
    cursor = 0.0
    for note in parsed.notes:
        gap = note.start_beats - cursor
        if gap > 1e-6:
            events.append((gap, None))
        events.append((max(note.end_beats - note.start_beats, 1e-6), note.pitch))
        cursor = note.end_beats

    measures: list[dict[str, Any]] = []
    current_notes: list[dict[str, Any]] = []
    measure_beats = 0.0
    measure_number = 1
    for duration_beats, pitch in events:
        remaining = duration_beats
        while remaining > 1e-6:
            room = beats_per_measure - measure_beats
            take = min(remaining, room)
            remaining -= take
            current_notes.append(
                {
                    "pitch": pitch if pitch is not None else "rest",
                    "duration": _nearest_duration(take),
                    "articulation": None,
                    "tied_to_next": pitch is not None and remaining > 1e-6,
                    "dynamics": None,
                }
            )
            measure_beats += take
            if measure_beats >= beats_per_measure - 1e-6:
                measures.append({"measure_number": measure_number, "notes": current_notes})
                measure_number += 1
                current_notes = []
                measure_beats = 0.0
    if current_notes:
        measures.append({"measure_number": measure_number, "notes": current_notes})

    return {
        "clef": clef,
        "time_signature": f"{numerator}/{denominator}",
        "key_signature": None,
        "tempo_marking": None,
        "bpm_hint": max(20, min(300, round(parsed.tempo_bpm))),
        #: Not OCR — this score came straight from the MIDI's own note
        #: events — so the only honest value is "fully read".
        "ocr_confidence": 1.0,
        "measures": measures,
    }
