"""Tests for the synthetic ground-truth generator.

Covers the label/timing logic against `fixtures/eval/tiny_phrase.json` —
pure computation, no audio — plus a MIDI-bytes smoke test. The `fluidsynth`
render path is skipped when the binary isn't installed, which is the normal
state of a CI runner and this sandbox alike.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from synthetic_takes import (
    Accompaniment,
    Degradation,
    ExtraNote,
    IntonationOffset,
    MissedNote,
    Restart,
    TakeConfig,
    TempoDrift,
    TimingOffset,
    WrongNote,
    _pitch_to_midi,
    _varlen,
    build_ground_truth,
    render_take,
)

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "eval" / "tiny_phrase.json"


def test_clean_take_has_no_labels_and_matches_expected_timeline() -> None:
    gt = build_ground_truth(FIXTURE, TakeConfig(target_bpm=90))

    assert gt["schema_version"] == 1
    assert len(gt["notes"]) == 8  # two 4-note bars
    for note in gt["notes"]:
        assert note["error_labels"] == []
        assert note["played_onset_s"] == pytest.approx(note["expected_onset_s"])
        assert note["played_pitch"] == note["written_pitch"]
        assert note["cents_offset"] == 0.0
    assert gt["extra_notes"] == []


def test_missed_note_has_no_played_onset_or_pitch() -> None:
    cfg = TakeConfig(errors=[MissedNote(global_index=1)])
    gt = build_ground_truth(FIXTURE, cfg)
    missed = gt["notes"][1]
    assert missed["error_labels"] == ["missed_note"]
    assert missed["played_onset_s"] is None
    assert missed["played_pitch"] is None
    assert missed["cents_offset"] is None
    # the rest of the take is unaffected
    assert gt["notes"][0]["error_labels"] == []


def test_wrong_note_keeps_timing_but_changes_pitch() -> None:
    cfg = TakeConfig(errors=[WrongNote(global_index=5, heard="F4")])
    gt = build_ground_truth(FIXTURE, cfg)
    note = gt["notes"][5]
    assert note["error_labels"] == ["wrong_note"]
    assert note["written_pitch"] == "D5"
    assert note["played_pitch"] == "F4"
    assert note["played_onset_s"] == pytest.approx(note["expected_onset_s"])


def test_timing_and_intonation_offsets_stack_on_one_note() -> None:
    cfg = TakeConfig(
        errors=[
            TimingOffset(global_index=2, ms=80),
            IntonationOffset(global_index=2, cents=35),
        ]
    )
    gt = build_ground_truth(FIXTURE, cfg)
    note = gt["notes"][2]
    assert set(note["error_labels"]) == {"timing_offset", "intonation_offset"}
    assert note["played_onset_s"] == pytest.approx(note["expected_onset_s"] + 0.08)
    assert note["cents_offset"] == 35.0


def test_intonation_offset_by_measure_covers_every_note_in_the_bar() -> None:
    cfg = TakeConfig(errors=[IntonationOffset(measure_number=2, cents=-20)])
    gt = build_ground_truth(FIXTURE, cfg)
    bar_2 = [n for n in gt["notes"] if n["measure_number"] == 2]
    assert len(bar_2) == 4
    assert all(n["cents_offset"] == -20.0 for n in bar_2)
    bar_1 = [n for n in gt["notes"] if n["measure_number"] == 1]
    assert all(n["cents_offset"] == 0.0 for n in bar_1)


def test_tempo_drift_only_labels_notes_from_its_start_measure() -> None:
    cfg = TakeConfig(errors=[TempoDrift(from_measure=2, pct_per_bar=3.0)])
    gt = build_ground_truth(FIXTURE, cfg)
    bar_1 = [n for n in gt["notes"] if n["measure_number"] == 1]
    bar_2 = [n for n in gt["notes"] if n["measure_number"] == 2]
    assert all(n["error_labels"] == [] for n in bar_1)
    assert all("tempo_drift" in n["error_labels"] for n in bar_2)


def test_restart_labels_every_note_at_or_after_it() -> None:
    cfg = TakeConfig(errors=[Restart(at_global_index=4)])
    gt = build_ground_truth(FIXTURE, cfg)
    for note in gt["notes"]:
        if note["global_index"] >= 4:
            assert "restart" in note["error_labels"]
        else:
            assert "restart" not in note["error_labels"]


def test_extra_note_is_reported_outside_the_expected_notes_list() -> None:
    cfg = TakeConfig(errors=[ExtraNote(after_global_index=3, pitch="A4")])
    gt = build_ground_truth(FIXTURE, cfg)
    assert len(gt["notes"]) == 8  # unaffected
    assert len(gt["extra_notes"]) == 1
    extra = gt["extra_notes"][0]
    assert extra["after_global_index"] == 3
    assert extra["played_pitch"] == "A4"
    assert extra["error_labels"] == ["extra_note"]
    assert extra["played_onset_s"] > gt["notes"][3]["expected_onset_s"]


def test_accompaniment_and_degradation_are_recorded_at_take_level_only() -> None:
    cfg = TakeConfig(
        errors=[
            Accompaniment(track="piano", level_db=-12),
            Degradation(profile="phone_mic_room"),
        ]
    )
    gt = build_ground_truth(FIXTURE, cfg)
    kinds = {e["type"] for e in gt["injected_errors"]}
    assert kinds == {"accompaniment", "degradation"}
    # no per-note field carries them
    for note in gt["notes"]:
        assert "accompaniment" not in note and "degradation" not in note


def test_intonation_offset_rejects_both_or_neither_target() -> None:
    with pytest.raises(ValueError):
        IntonationOffset(cents=10, global_index=1, measure_number=1)
    with pytest.raises(ValueError):
        IntonationOffset(cents=10)


@pytest.mark.parametrize(
    ("pitch", "midi"),
    [("A4", 69), ("C4", 60), ("F#4", 66), ("Bb3", 58), ("C5", 72)],
)
def test_pitch_to_midi(pitch: str, midi: int) -> None:
    assert _pitch_to_midi(pitch) == midi


def test_varlen_matches_the_midi_spec_examples() -> None:
    assert _varlen(0x00) == bytes([0x00])
    assert _varlen(0x40) == bytes([0x40])
    assert _varlen(0x7F) == bytes([0x7F])
    assert _varlen(0x80) == bytes([0x81, 0x00])
    assert _varlen(0x3FFF) == bytes([0xFF, 0x7F])


def test_render_take_is_a_no_op_without_fluidsynth(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(shutil, "which", lambda _: None)
    out = tmp_path / "take.wav"
    assert render_take(FIXTURE, TakeConfig(), out) is False
    assert not out.exists()
    assert not out.with_suffix(".mid").exists()
