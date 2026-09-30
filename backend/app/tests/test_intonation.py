"""How in tune a take was — `services/intonation.py`, and the analysis's use of it.

The owner asked for pitch on Insights and on each take (2026-09-25), measured
against their own tuning. These hold the three things that make that honest:
the octave never counts, the take's own tuning is taken out before a bar is
read, and a note far from its written pitch is not read as that note.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.analysis import analyze
from app.services.audio_config import IntonationConfig
from app.services.intonation import fold_cents, intonation_of, note_cents
from app.services.pitch_evidence import HOP, midi
from app.services.score_schema import Measure, Note, ScoreJson
from app.tests.audio_helpers import synth_bowed_take

SR = 22050
CONFIG = IntonationConfig()


def _track(notes: list[tuple[float, float, float]], total_s: float) -> np.ndarray:
    """A pitch track: each (start_s, end_s, midi) held, NaN between."""
    track = np.full(int(total_s * SR / HOP) + 1, np.nan)
    for start, end, value in notes:
        track[int(start * SR / HOP) : int(end * SR / HOP)] = value
    return track


class TestFold:
    def test_an_octave_is_not_intonation(self):
        assert fold_cents(np.array([-1200.0, 1200.0, 2400.0])) == pytest.approx([0, 0, 0])

    def test_a_little_either_side_survives_the_fold(self):
        # A double bass, an octave under the page and 20 cents sharp.
        assert fold_cents(np.array([-1180.0, -1220.0])) == pytest.approx([20.0, -20.0])


class TestNoteCents:
    def test_each_note_is_read_between_its_attack_and_the_next(self):
        attacks = np.array([0.0, 0.5, 1.0])
        track = _track([(0.0, 0.5, 69.2), (0.5, 1.0, 71.0), (1.0, 1.6, 72.9)], 2.0)

        cents = note_cents(track, SR, attacks, np.array([69, 71, 73]))

        assert cents == pytest.approx([20.0, 0.0, -10.0], abs=0.5)

    def test_the_attack_itself_is_not_listened_to(self):
        # A scrape a semitone off for the first 40 ms, then the note in tune.
        attacks = np.array([0.0, 0.5])
        track = _track([(0.0, 0.04, 70.0), (0.04, 0.5, 69.0), (0.5, 1.1, 69.0)], 1.5)

        assert note_cents(track, SR, attacks, np.array([69, 69])) == pytest.approx(
            [0.0, 0.0], abs=0.5
        )

    def test_a_note_too_short_to_hear_is_not_measured(self):
        attacks = np.array([0.0, 0.08, 0.6])
        track = _track([(0.0, 1.2, 69.0)], 1.5)

        cents = note_cents(track, SR, attacks, np.array([69, 69, 69]))

        assert np.isnan(cents[0])
        assert np.isfinite(cents[1]) and np.isfinite(cents[2])

    def test_attacks_out_of_order_are_read_in_time(self):
        attacks = np.array([0.5, 0.0])
        track = _track([(0.0, 0.5, 60.0), (0.5, 1.1, 62.1)], 1.5)

        assert note_cents(track, SR, attacks, np.array([62, 60])) == pytest.approx(
            [10.0, 0.0], abs=0.5
        )

    def test_a_note_with_no_written_pitch_is_skipped(self):
        track = _track([(0.0, 1.2, 69.0)], 1.5)

        assert np.isnan(note_cents(track, SR, np.array([0.0]), np.array([np.nan]))[0])


class TestIntonationOf:
    def test_the_take_is_read_against_its_own_tuning(self):
        """Tuned 25 sharp, every note in tune with that: no bar is off."""
        cents = np.full(12, 25.0)
        bars = [1] * 4 + [2] * 4 + [3] * 4

        out = intonation_of(cents, bars, CONFIG)

        assert out.tuning_cents == pytest.approx(25.0)
        assert out.spread_cents == pytest.approx(0.0)
        assert out.by_bar == {1: 0.0, 2: 0.0, 3: 0.0}

    def test_a_flat_bar_shows_against_that_tuning(self):
        cents = np.array([25.0] * 8 + [-15.0] * 4)
        bars = [1] * 4 + [2] * 4 + [3] * 4

        out = intonation_of(cents, bars, CONFIG)

        assert out.by_bar[3] == pytest.approx(-40.0)
        assert out.by_bar[1] == pytest.approx(0.0)

    def test_a_note_a_semitone_away_is_not_read_as_that_note(self):
        """The previous note still ringing: dropped, not averaged in."""
        cents = np.array([0.0, 2.0, -3.0, 1.0, 0.0, 2.0, -1.0, 1.0, -180.0])
        bars = [1] * 4 + [2] * 5

        out = intonation_of(cents, bars, CONFIG)

        assert out.notes == 8
        assert out.by_bar[2] == pytest.approx(0.5, abs=1.0)

    def test_too_few_notes_say_nothing(self):
        out = intonation_of(np.array([10.0, 12.0, 8.0]), [1, 1, 1], CONFIG)

        assert out.tuning_cents is None
        assert out.by_bar == {}


class TestByNote:
    """Which written notes run sharp or flat — the owner's E-flats (2026-09-30)."""

    def test_a_sharp_note_stands_out_against_the_take_tuning(self):
        """Tuned 25 sharp; the E-flats a further 20 above that, the rest on it."""
        pitches = ["D3", "Eb3", "F3"] * 5
        cents = np.array([25.0, 45.0, 25.0] * 5)

        out = intonation_of(cents, [1, 1, 2] * 5, CONFIG, pitches=pitches)

        by = {n.pitch: n for n in out.by_note}
        assert by["Eb3"].cents == pytest.approx(20.0)
        assert by["D3"].cents == pytest.approx(0.0)
        assert by["Eb3"].notes == 5
        assert by["Eb3"].bars == (1,)
        assert by["F3"].bars == (2,)

    def test_an_octave_apart_is_two_notes(self):
        """An open string and the same letter stopped an octave up: two fingers."""
        pitches = ["G2", "G3"] * 5
        cents = np.array([-20.0, 20.0] * 5)

        out = intonation_of(cents, [1] * 10, CONFIG, pitches=pitches)

        assert [n.pitch for n in out.by_note] == ["G2", "G3"]
        assert out.by_note[0].cents == pytest.approx(-20.0)
        assert out.by_note[1].cents == pytest.approx(20.0)

    def test_low_to_high(self):
        pitches = ["F3", "C3", "A3", "D3"] * 4
        out = intonation_of(np.zeros(16), [1] * 16, CONFIG, pitches=pitches)

        assert [n.midi for n in out.by_note] == [48, 50, 53, 57]

    def test_enharmonics_are_one_note_named_as_the_page_mostly_writes_it(self):
        pitches = ["Eb3"] * 3 + ["D#3"] * 2 + ["C3"] * 5
        out = intonation_of(np.zeros(10), [1] * 10, CONFIG, pitches=pitches)

        eb = next(n for n in out.by_note if n.midi == 51)
        assert eb.pitch == "Eb3"
        assert eb.notes == 5

    def test_a_note_read_too_few_times_is_left_out(self):
        pitches = ["C3"] * 9 + ["Eb3"] * (CONFIG.by_note_min_notes - 1)
        cents = np.array([0.0] * 9 + [30.0] * (CONFIG.by_note_min_notes - 1))

        out = intonation_of(cents, [1] * cents.size, CONFIG, pitches=pitches)

        assert [n.pitch for n in out.by_note] == ["C3"]

    def test_a_reading_nearer_another_note_does_not_count_toward_it(self):
        """The owner's 0313 E-flats: the -98 was the D before them ringing on.

        The bars keep a reading that far off, which one bar's median absorbs;
        four readings of one note cannot, and it would read them in tune.
        """
        pitches = ["C3"] * 8 + ["Eb3"] * 5
        cents = np.array([0.0] * 8 + [20.0, 29.0, -20.0, -98.0, 24.0])

        out = intonation_of(cents, [1] * 13, CONFIG, pitches=pitches)

        eb = next(n for n in out.by_note if n.pitch == "Eb3")
        assert eb.notes == 4
        assert eb.cents == pytest.approx(22.0)
        assert out.notes == 13

    def test_without_pitches_there_is_nothing_by_note(self):
        out = intonation_of(np.zeros(10), [1] * 10, CONFIG)

        assert out.by_note == ()


def _page(pitches: list[list[str]]) -> ScoreJson:
    return ScoreJson(
        clef="treble",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(
                measure_number=i + 1,
                notes=[Note(pitch=p, duration="quarter") for p in bar],
            )
            for i, bar in enumerate(pitches)
        ],
    )


def test_end_to_end_a_detuned_take_reads_its_tuning_and_its_flat_bar():
    """A violin line tuned 20 cents sharp, with bar 3 a further 40 flat.

    Through `analyze`: the tuning is read as the take's, not as every note
    being sharp, and bar 3 — only bar 3 — sits flat against it.
    """
    bars = [
        ["A4", "B4", "C#5", "D5"],
        ["E5", "D5", "C#5", "B4"],
        ["A4", "B4", "C#5", "D5"],
        ["E5", "D5", "C#5", "B4"],
    ]
    page = _page(bars)
    bpm = 90.0
    beat = 60.0 / bpm
    written = [p for bar in bars for p in bar]
    detune = [20.0] * 8 + [-20.0] * 4 + [20.0] * 4
    freqs = [
        440.0 * 2 ** ((midi(p) - 69 + d / 100.0) / 12) for p, d in zip(written, detune, strict=True)
    ]
    onsets = [0.3 + i * beat for i in range(len(written))]
    y = synth_bowed_take(onsets, sr=SR, freqs_hz=freqs, note_dur_s=beat * 0.95)

    result = analyze((y, SR), page, bpm, instrument="violin")

    assert result.status == "ok"
    assert result.intonation is not None
    assert result.intonation.tuning_cents == pytest.approx(20.0, abs=6.0)
    by_bar = {m.measure_number: m.pitch_cents for m in result.per_measure}
    assert by_bar[3] == pytest.approx(-40.0, abs=10.0)
    for bar in (1, 2, 4):
        assert by_bar[bar] == pytest.approx(0.0, abs=10.0)


def test_end_to_end_a_sharp_note_is_named_by_note():
    """Every C-sharp 30 cents above an otherwise in-tune violin line.

    Through `analyze` to the payload: the C-sharp is the one written note that
    reads sharp against the take's tuning, and it names the bars it is in.
    """
    bars = [
        ["A4", "B4", "C#5", "D5"],
        ["E5", "D5", "C#5", "B4"],
        ["A4", "B4", "C#5", "D5"],
        ["E5", "D5", "C#5", "B4"],
    ]
    page = _page(bars)
    bpm = 90.0
    beat = 60.0 / bpm
    written = [p for bar in bars for p in bar]
    freqs = [
        440.0 * 2 ** ((midi(p) - 69 + (30.0 if p == "C#5" else 0.0) / 100.0) / 12)
        for p in written
    ]
    onsets = [0.3 + i * beat for i in range(len(written))]
    y = synth_bowed_take(onsets, sr=SR, freqs_hz=freqs, note_dur_s=beat * 0.95)

    result = analyze((y, SR), page, bpm, instrument="violin")

    assert result.intonation is not None
    by = {n.pitch: n for n in result.intonation.by_note}
    assert by["C#5"].cents == pytest.approx(30.0, abs=8.0)
    assert by["C#5"].bars == [1, 2, 3, 4]
    for other in ("B4", "D5"):
        assert by[other].cents == pytest.approx(0.0, abs=8.0)
