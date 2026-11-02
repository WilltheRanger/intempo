"""Tests for `midi_score.py` — built against a hand-written Standard MIDI
File, not real URMP data (never committed), so this runs with no network
and no `intempo-eval-data/` dependency.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))

from app.services.alignment import build_timeline
from app.services.score_schema import ScoreJson
from midi_score import midi_to_pitch, parse_midi, to_score_json


def _varlen(value: int) -> bytes:
    chunks = [value & 0x7F]
    value >>= 7
    while value:
        chunks.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(chunks))


def _write_two_track_midi(path: Path, *, division: int = 480) -> None:
    """Track 0: tempo 120bpm + 4/4. Track 1: four quarter notes (A4, B4,
    C5, D5), each a quarter-note apart, with a quarter rest before the
    third note — enough to exercise notes, rests and tempo/time-sig meta
    in one small fixture."""
    meta = bytearray()
    meta += _varlen(0) + bytes([0xFF, 0x58, 0x04, 4, 2, 24, 8])  # 4/4
    meta += _varlen(0) + bytes([0xFF, 0x51, 0x03]) + (500_000).to_bytes(3, "big")  # 120bpm
    meta += _varlen(0) + bytes([0xFF, 0x2F, 0x00])

    notes = [(69, 0), (71, division), (72, division * 3), (74, division * 4)]  # A4 B4 [rest] C5 D5
    events: list[tuple[int, bytes]] = []
    for pitch, start in notes:
        events.append((start, bytes([0x90, pitch, 100])))
        events.append((start + division, bytes([0x80, pitch, 0])))
    events.sort(key=lambda e: e[0])

    track1 = bytearray()
    last = 0
    for tick, msg in events:
        track1 += _varlen(tick - last) + msg
        last = tick
    track1 += _varlen(0) + bytes([0xFF, 0x2F, 0x00])

    header = (
        b"MThd"
        + (6).to_bytes(4, "big")
        + bytes([0, 1])
        + (2).to_bytes(2, "big")
        + division.to_bytes(2, "big")
    )
    chunk0 = b"MTrk" + len(meta).to_bytes(4, "big") + bytes(meta)
    chunk1 = b"MTrk" + len(track1).to_bytes(4, "big") + bytes(track1)
    path.write_bytes(header + chunk0 + chunk1)


def test_midi_to_pitch() -> None:
    assert midi_to_pitch(60) == "C4"
    assert midi_to_pitch(69) == "A4"
    assert midi_to_pitch(61) == "C#4"


def test_parse_midi_reads_tempo_and_time_signature(tmp_path: Path) -> None:
    path = tmp_path / "test.mid"
    _write_two_track_midi(path)
    parsed = parse_midi(path, note_track=1)
    assert parsed.tempo_bpm == 120.0
    assert parsed.time_signature == (4, 4)


def test_parse_midi_reads_notes_in_order(tmp_path: Path) -> None:
    path = tmp_path / "test.mid"
    _write_two_track_midi(path, division=480)
    parsed = parse_midi(path, note_track=1)
    assert [n.pitch for n in parsed.notes] == ["A4", "B4", "C5", "D5"]
    assert parsed.notes[0].start_beats == 0.0
    assert parsed.notes[1].start_beats == 1.0
    # a quarter-note rest sits between the B4 and the C5
    assert parsed.notes[2].start_beats == 3.0


def test_to_score_json_inserts_a_rest_and_validates(tmp_path: Path) -> None:
    path = tmp_path / "test.mid"
    _write_two_track_midi(path)
    parsed = parse_midi(path, note_track=1)
    payload = to_score_json(parsed)
    score = ScoreJson.model_validate(payload)

    flat_pitches = [n.pitch for m in score.measures for n in m.notes]
    assert "rest" in flat_pitches
    sounded = [p for p in flat_pitches if p != "rest"]
    assert sounded == ["A4", "B4", "C5", "D5"]


def test_to_score_json_timeline_matches_midi_onsets(tmp_path: Path) -> None:
    path = tmp_path / "test.mid"
    _write_two_track_midi(path)
    parsed = parse_midi(path, note_track=1)
    score = ScoreJson.model_validate(to_score_json(parsed))
    timeline = build_timeline(score, target_bpm=parsed.tempo_bpm)

    assert len(timeline.onsets) == len(parsed.notes)
    for onset_s, note in zip(timeline.onsets, parsed.notes, strict=True):
        expected_s = note.start_beats * 60.0 / parsed.tempo_bpm
        assert abs(onset_s - expected_s) < 0.01


def test_a_note_straddling_a_measure_boundary_stays_one_onset(tmp_path: Path) -> None:
    """A half note starting on beat 4 of a 4/4 bar (division ticks per
    beat) crosses into the next measure — `to_score_json` must tie the
    split pair, not re-attack at the barline."""
    division = 480
    meta = bytearray()
    meta += _varlen(0) + bytes([0xFF, 0x58, 0x04, 4, 2, 24, 8])
    meta += _varlen(0) + bytes([0xFF, 0x51, 0x03]) + (500_000).to_bytes(3, "big")
    meta += _varlen(0) + bytes([0xFF, 0x2F, 0x00])

    # one note, starting at beat 3 (0-indexed), lasting 2 beats — crosses
    # the barline at beat 4.
    start = division * 3
    length = division * 2
    track1 = bytearray()
    track1 += _varlen(start) + bytes([0x90, 69, 100])
    track1 += _varlen(length) + bytes([0x80, 69, 0])
    track1 += _varlen(0) + bytes([0xFF, 0x2F, 0x00])

    header = (
        b"MThd" + (6).to_bytes(4, "big") + bytes([0, 1]) + (2).to_bytes(2, "big") + division.to_bytes(2, "big")
    )
    path = tmp_path / "tie.mid"
    path.write_bytes(
        header
        + b"MTrk" + len(meta).to_bytes(4, "big") + bytes(meta)
        + b"MTrk" + len(track1).to_bytes(4, "big") + bytes(track1)
    )

    parsed = parse_midi(path, note_track=1)
    score = ScoreJson.model_validate(to_score_json(parsed))
    timeline = build_timeline(score, target_bpm=parsed.tempo_bpm)

    # One onset for the whole note, not two — the tie absorbed the
    # continuation across the barline.
    assert len(timeline.onsets) == 1
