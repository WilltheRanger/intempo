"""Notes changed under one bow, on a page that does not mark them slurred.

A player slurs what the page leaves unmarked all the time, and an OCR pass can
drop a slur that was printed. Either way every note is one the page requires,
and one changed with the fingers alone has no attack for the detector to hear.
On URMP's 61 real string tracks (2026-11-13) 5.3% of the notes played were
reported missing, three in four with no attack within 110 ms of the labelled
onset, five in six a different pitch from the note before. The legato look
(`analysis._recover_legato`, `onset_recovery.recover_by_pitch`) finds them
where their written pitch takes over; `TUNING_LOG.md` has the measurements.

The take is `synth_legato_line`, the repository's model of a slurred line,
with the slower finger change of a real one: its pitch glides over 50 ms, and
the detector hears 26 of the 32 changes.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services import analysis
from app.services.analysis import analyze
from app.services.score_schema import Measure, Note, ScoreJson
from app.tests.audio_helpers import synth_legato_line

SR = 22050
BPM = 80.0
EIGHTH = 60.0 / BPM / 2
_SCALE = [62, 64, 66, 67, 69, 71, 73, 74, 73, 71, 69, 67, 66, 64, 62, 64]
_NAMES = {62: "D4", 64: "E4", 66: "F#4", 67: "G4", 69: "A4", 71: "B4", 73: "C#5", 74: "D5"}
TIMES = [0.6 + i * EIGHTH for i in range(32)]


def _page() -> ScoreJson:
    """Four bars of eighths up and down a D major scale, with no slurs."""
    return ScoreJson(
        clef="treble",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(
                measure_number=m + 1,
                notes=[
                    Note(pitch=_NAMES[_SCALE[(m * 8 + i) % 16]], duration="eighth")
                    for i in range(8)
                ],
                slurs=[],
            )
            for m in range(4)
        ],
    )


def _hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def _take(pitches: list[int], *, glide_s: float = 0.05) -> np.ndarray:
    """The line slurred four notes to a bow, then a second of room tone: a
    take with no silence in it has no floor to judge a note's level by."""
    y = synth_legato_line(
        TIMES, [_hz(p) for p in pitches], TIMES[::4], glide_s=glide_s, tail_s=0.4
    )
    room = np.random.default_rng(0).normal(0, 3e-4, SR)
    return np.concatenate([y, room]).astype(np.float32)


def _scale() -> list[int]:
    return [_SCALE[i % 16] for i in range(32)]


def test_slurred_notes_the_detector_did_not_hear_are_found_by_their_pitch() -> None:
    trace: dict = {}
    result = analyze((_take(_scale()), SR), _page(), BPM, instrument="violin", trace=trace)

    detected = np.asarray(trace["detected_s"])
    heard = sum(bool(np.any(np.abs(detected - t) < 0.06)) for t in TIMES)
    assert heard < 32, "the first pass hears every change: this tests nothing"
    assert trace["recovered"] > 0
    assert result.status == "ok"
    assert result.n_missed_notes == 0
    assert len(result.per_note) == 32
    assert result.verdict.startswith("Steady"), result.verdict


def test_a_note_found_by_its_pitch_is_timed_like_its_neighbours() -> None:
    """On the attack's clock: a played-on-time line reads on time, note by
    note, whichever look found each note."""
    result = analyze((_take(_scale()), SR), _page(), BPM, instrument="violin")

    deltas = np.array([n.delta_ms for n in result.per_note])
    assert np.max(np.abs(deltas - np.median(deltas))) < 40.0, deltas


@pytest.mark.parametrize(("above_floor_db", "missed"), [(5.0, 0), (2.0, 4)])
def test_a_note_found_by_its_pitch_need_only_sound_above_the_room(
    monkeypatch: pytest.MonkeyPatch, above_floor_db: float, missed: int
) -> None:
    """**Not the attack look's 10 dB** (`[onset.recovery] pitch_min_level_db`).
    The floor is the take's quietest 5%, which in a piece played without rests
    lies inside the music: on a real Vivaldi violin part 14 of 35 notes found
    by their pitch sat under 10 dB above it. A held pitch is already the
    evidence of playing, so 3 dB is asked — and below that, nothing is kept.
    Here every time is made to read the same level, so the attack look, which
    asks 10, keeps nothing either way."""
    from app.services import audio as audio_module

    monkeypatch.setattr(
        audio_module,
        "level_above_floor_db",
        lambda y, sr, times: np.full(np.size(times), above_floor_db),
    )

    result = analyze((_take(_scale()), SR), _page(), BPM, instrument="violin")

    assert result.n_missed_notes == missed


def _without_the_attack_look(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hold the attack look off, so what is tested is the legato look alone."""
    monkeypatch.setattr(
        analysis, "_recover_attacks", lambda *a, **k: np.array([], dtype=float)
    )


def test_the_legato_look_does_not_find_a_note_left_out_of_a_slurred_line(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The note before held on through it: the left-out note's pitch never
    sounds, so the legato look finds nothing there."""
    _without_the_attack_look(monkeypatch)
    pitches = _scale()
    pitches[5] = pitches[4]  # B4 not played: A4 held on into C#5

    result = analyze((_take(pitches), SR), _page(), BPM, instrument="violin")

    assert result.status == "ok"
    assert 5 not in {n.global_index for n in result.per_note}


@pytest.mark.parametrize("left_out", [9, 21])
def test_a_note_left_out_between_two_others_is_not_heard_in_the_shift(
    monkeypatch: pytest.MonkeyPatch, left_out: int
) -> None:
    """Between a note and the one after the hole, the shift passes the
    left-out note's pitch on its way — for a few milliseconds, not a note."""
    _without_the_attack_look(monkeypatch)
    pitches = _scale()
    pitches[left_out] = pitches[left_out - 1]

    result = analyze((_take(pitches, glide_s=0.03), SR), _page(), BPM, instrument="violin")

    assert result.status == "ok"
    assert left_out not in {n.global_index for n in result.per_note}


def test_a_note_left_out_of_a_slurred_line_is_reported_missing() -> None:
    """**Not because of the legato look.** The attack look takes any local
    maximum of the envelope near where a missed note belongs, above 1.5% of
    the take's peak, and the held note's vibrato makes one: the left-out B4
    was "recovered" at 2.48 s inside the A4 held through it.

    Held as a strict xfail from 2026-11-13 to 2026-11-14. A guard that
    dropped an attack whose pitch was the same either side of it fixed this
    take, and was withdrawn the same day. In a live room a quiet note under a
    loud note's tail has the tail's pitch on both sides, as the pitch track
    hears it, so `test_degraded_audio`'s room-swallowed take was refused
    again. `analysis._not_the_note_before` listens only after the attack:
    just after it, and again halfway to the next attack. A quiet note under a
    tail takes over within its own gap as the tail dies, and a note held on
    does not. `TUNING_LOG.md` (2026-11-14, held notes) has the measurements.
    """
    pitches = _scale()
    pitches[5] = pitches[4]

    result = analyze((_take(pitches), SR), _page(), BPM, instrument="violin")

    assert result.n_missed_notes == 1
