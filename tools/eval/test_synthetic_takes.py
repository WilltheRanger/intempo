"""Tests for the synthetic ground-truth generator.

Covers the label/timing logic against `fixtures/eval/tiny_phrase.json` —
pure computation, no audio — plus a MIDI-bytes smoke test, and (when
`fluidsynth` is on `PATH`, which it now is — see `README.md`) the actual
render: onset fidelity against real MusicXML, and that each audio effect
(vibrato, bow envelope, accompaniment, degradation) measurably changes the
rendered signal the way its ground-truth parameters say it should.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from synthetic_takes import (
    Accompaniment,
    BowEnvelope,
    Degradation,
    ExtraNote,
    IntonationOffset,
    MissedNote,
    NOTE_LEN_S,
    Restart,
    TakeConfig,
    TempoDrift,
    TimingOffset,
    Vibrato,
    WrongNote,
    _pitch_to_midi,
    _sounded_notes,
    _varlen,
    build_ground_truth,
    render_take,
)

MUSICXML_FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "musicxml" / "orchestral_part.musicxml"

# JERA-568's reference scores for real pieces — outside the repo, per the
# program's data-rights rule (see CLAUDE.md and the eval harness's own
# README). A session without `intempo-eval-data/` checked out next to this
# repo still runs every other test; this one test is skipped, not failed.
REAL_REFERENCE_MUSICXML = (
    Path(__file__).resolve().parents[3]
    / "intempo-eval-data"
    / "scores"
    / "CivvhZ0FN4c"
    / "reference.musicxml"
)

_HAS_FLUIDSYNTH = shutil.which("fluidsynth") is not None


def _detected_onset_s(samples: np.ndarray, sr: int, expected_onset_s: float, search_s: float = 0.05) -> float | None:
    """First sample past 2% of the local peak, searched near `expected_onset_s`.

    A plain amplitude threshold rather than spectral onset detection: this
    generator knows exactly when fluidsynth was told each note starts, so
    the fidelity question is "how much render latency did that note pick up",
    not "can a general-purpose onset detector find it at all". Returns
    `None` if the window is silent (nothing to detect).
    """
    start = max(0, int(round((expected_onset_s - 0.005) * sr)))
    end = min(len(samples), int(round((expected_onset_s + search_s) * sr)))
    window = samples[start:end]
    if window.size == 0:
        return None
    peak = float(np.max(np.abs(window)))
    if peak <= 0:
        return None
    idx = int(np.argmax(np.abs(window) > 0.02 * peak))
    return (start + idx) / sr

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


@pytest.mark.skipif(not _HAS_FLUIDSYNTH, reason="fluidsynth not on PATH")
def test_render_take_actually_renders_audible_sound(tmp_path: Path) -> None:
    """The gap this issue opened against: nobody had checked the WAV had sound in it.

    Channel 0 defaults to GM program 0 (Grand Piano); none of the bundled
    soundfonts has a preset there, so a MIDI file with no Program Change
    rendered silently and every earlier test only checked `render_take`
    returned `True` and a file existed — not that it had audio in it.
    """
    out = tmp_path / "take.wav"
    assert render_take(FIXTURE, TakeConfig(), out) is True
    samples, _ = sf.read(out)
    assert np.max(np.abs(samples)) > 0.01  # well above 16-bit quantization noise


@pytest.mark.skipif(not _HAS_FLUIDSYNTH, reason="fluidsynth not on PATH")
def test_render_take_onsets_match_ground_truth_within_a_few_ms(tmp_path: Path) -> None:
    """Real MusicXML in, real audio out, onsets land where the ground truth says.

    `_detected_onset_s` finds, for each note, the first sample past the
    render's own local attack threshold near its expected time. A soundfont
    render always carries a little fixed latency (observed here: ~4-5 ms for
    this soundfont, in `fixtures/eval/`'s tiny clean take too) — the
    assertion is that every note lands within one onset-matching tolerance
    band of its label, not that the latency is zero.
    """
    out = tmp_path / "orchestral.wav"
    config = TakeConfig(target_bpm=90)
    assert render_take(MUSICXML_FIXTURE, config, out) is True
    ground_truth = build_ground_truth(MUSICXML_FIXTURE, config)
    samples, sr = sf.read(out)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)

    checked = 0
    for note in _sounded_notes(ground_truth):
        expected = note["played_onset_s"]
        detected = _detected_onset_s(samples, sr, expected)
        if detected is None:
            continue
        assert abs(detected - expected) * 1000 < 15.0, (
            f"note at {expected}s detected at {detected}s "
            f"({(detected - expected) * 1000:.2f} ms off)"
        )
        checked += 1
    assert checked >= len(ground_truth["notes"]) - 2  # allow a couple of inaudible/short notes


@pytest.mark.skipif(
    not _HAS_FLUIDSYNTH or not REAL_REFERENCE_MUSICXML.exists(),
    reason="fluidsynth not on PATH, or intempo-eval-data/ isn't checked out next to this repo",
)
def test_render_take_matches_a_real_jera_568_reference_score(tmp_path: Path) -> None:
    """Same fidelity check, against one of the JERA-568 reference scores.

    Confirms the MusicXML path isn't only exercised by this repo's own OCR
    test fixtures — a real public-domain piece (Paganini Caprice Op. 1 No.
    23, CC-BY-SA MusicXML per `intempo-eval-data/scores/INDEX.csv`) renders
    and lines up too. Audio is never written inside this repo; `tmp_path`
    only, same as every other render test here.
    """
    out = tmp_path / "caprice.wav"
    config = TakeConfig(target_bpm=72)
    assert render_take(REAL_REFERENCE_MUSICXML, config, out) is True
    ground_truth = build_ground_truth(REAL_REFERENCE_MUSICXML, config)
    samples, sr = sf.read(out)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)

    within_tolerance = 0
    total = 0
    for note in _sounded_notes(ground_truth)[:40]:  # a fast-moving caprice; sample the opening
        expected = note["played_onset_s"]
        detected = _detected_onset_s(samples, sr, expected)
        if detected is None:
            continue
        total += 1
        if abs(detected - expected) * 1000 < 15.0:
            within_tolerance += 1
    assert total > 0
    assert within_tolerance / total > 0.9


@pytest.mark.skipif(not _HAS_FLUIDSYNTH, reason="fluidsynth not on PATH")
def test_vibrato_changes_the_rendered_signal_without_moving_onsets(tmp_path: Path) -> None:
    plain = tmp_path / "plain.wav"
    vib = tmp_path / "vib.wav"
    config = TakeConfig()
    vib_config = TakeConfig(errors=[Vibrato(rate_hz=6.0, depth_cents=40.0)])
    render_take(FIXTURE, config, plain)
    render_take(FIXTURE, vib_config, vib)

    plain_samples, sr = sf.read(plain)
    vib_samples, _ = sf.read(vib)
    n = min(len(plain_samples), len(vib_samples))
    assert not np.allclose(plain_samples[:n], vib_samples[:n], atol=1e-6)

    ground_truth = build_ground_truth(FIXTURE, vib_config)
    vib_mono = vib_samples.mean(axis=1) if vib_samples.ndim > 1 else vib_samples
    for note in _sounded_notes(ground_truth):
        detected = _detected_onset_s(vib_mono, sr, note["played_onset_s"])
        assert detected is not None
        assert abs(detected - note["played_onset_s"]) * 1000 < 15.0


@pytest.mark.skipif(not _HAS_FLUIDSYNTH, reason="fluidsynth not on PATH")
def test_bow_envelope_ramps_each_note_up_from_near_silence(tmp_path: Path) -> None:
    out = tmp_path / "bow.wav"
    bow = BowEnvelope(attack_ms=40.0, decay_ms=80.0)
    config = TakeConfig(errors=[bow])
    render_take(FIXTURE, config, out)
    samples, sr = sf.read(out)
    mono = samples.mean(axis=1) if samples.ndim > 1 else samples
    ground_truth = build_ground_truth(FIXTURE, config)

    for note in _sounded_notes(ground_truth):
        start = int(round(note["played_onset_s"] * sr))
        end = min(len(mono), start + int(round(NOTE_LEN_S * sr)))
        window = mono[start:end]
        if window.size < 10:
            continue
        first_ms = window[: int(0.005 * sr)]
        mid = window[len(window) // 2 - 5 : len(window) // 2 + 5]
        assert np.max(np.abs(first_ms)) < np.max(np.abs(mid)) + 1e-9


@pytest.mark.skipif(not _HAS_FLUIDSYNTH, reason="fluidsynth not on PATH")
@pytest.mark.parametrize("track", ["drone", "piano"])
def test_accompaniment_raises_level_toward_the_stated_db(tmp_path: Path, track: str) -> None:
    clean = tmp_path / "clean.wav"
    mixed = tmp_path / "mixed.wav"
    render_take(FIXTURE, TakeConfig(), clean)
    render_take(FIXTURE, TakeConfig(errors=[Accompaniment(track=track, level_db=-10.0)]), mixed)

    clean_samples, sr = sf.read(clean)
    mixed_samples, _ = sf.read(mixed)
    clean_mono = clean_samples.mean(axis=1) if clean_samples.ndim > 1 else clean_samples
    mixed_mono = mixed_samples.mean(axis=1) if mixed_samples.ndim > 1 else mixed_samples
    n = min(len(clean_mono), len(mixed_mono))
    clean_rms = np.sqrt(np.mean(clean_mono[:n].astype(np.float64) ** 2))
    mixed_rms = np.sqrt(np.mean(mixed_mono[:n].astype(np.float64) ** 2))
    assert mixed_rms > clean_rms


@pytest.mark.skipif(not _HAS_FLUIDSYNTH, reason="fluidsynth not on PATH")
def test_degradation_raises_the_noise_floor_and_removes_out_of_band_energy(tmp_path: Path) -> None:
    clean = tmp_path / "clean.wav"
    degraded = tmp_path / "degraded.wav"
    render_take(FIXTURE, TakeConfig(), clean)
    degradation = Degradation(band_low_hz=300.0, band_high_hz=3400.0, noise_snr_db=15.0, seed=7)
    render_take(FIXTURE, TakeConfig(errors=[degradation]), degraded)

    clean_samples, sr = sf.read(clean)
    degraded_samples, _ = sf.read(degraded)
    clean_mono = clean_samples.mean(axis=1) if clean_samples.ndim > 1 else clean_samples
    degraded_mono = degraded_samples.mean(axis=1) if degraded_samples.ndim > 1 else degraded_samples

    # the gap after the last note is silent in the clean render; degradation
    # should leave an audible noise floor there.
    tail_clean = clean_mono[-500:].astype(np.float64)
    tail_degraded = degraded_mono[-500:].astype(np.float64)
    assert np.sqrt(np.mean(tail_degraded**2)) > np.sqrt(np.mean(tail_clean**2)) * 5

    # energy well above the band's top edge should be reduced by the filter —
    # isolated from the noise stage, whose own white-noise energy spans the
    # whole spectrum and would otherwise swamp this comparison.
    from synthetic_takes import _apply_degradation

    band_only = Degradation(band_low_hz=300.0, band_high_hz=3400.0, noise_snr_db=120.0, reverb_wet=0.0)
    filtered = _apply_degradation(clean_mono.astype(np.float64), sr, band_only)
    n = len(clean_mono)
    spectrum_clean = np.abs(np.fft.rfft(clean_mono.astype(np.float64)))
    spectrum_filtered = np.abs(np.fft.rfft(filtered))
    freqs = np.fft.rfftfreq(n, d=1 / sr)
    high_band = freqs > 8000
    assert np.sum(spectrum_clean[high_band]) > 0
    assert np.sum(spectrum_filtered[high_band]) < np.sum(spectrum_clean[high_band])
