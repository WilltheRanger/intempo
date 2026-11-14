"""A note at the pitch of the note before it, bowed again: found by the bow change.

Its pitch does not change, so the legato look cannot hear it, and the bow
change makes only a small rise in the onset envelope, which the first pass
often lets through. On URMP's 72 real takes (2026-11-14) 113 of the 288 played
notes reported missing were such notes. What the bow change leaves is a dip in
the level as the bow stops and turns: a median 8.5 dB at the labelled onsets
of those notes, 11 dB at the repeated notes the first pass did hear, and 1.4 dB
in the middle of a held note. See `onset_recovery.recover_by_bow_change`,
`analysis._recover_bow_changes` and `[onset.recovery] bow_change_min_dip_db`;
`TUNING_LOG.md` has the measurements.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services import analysis
from app.services import audio as audio_module
from app.services.analysis import analyze
from app.services.onset_recovery import recover_by_bow_change
from app.services.score_schema import Measure, Note, ScoreJson
from app.tests.audio_helpers import synth_bowed_note

SR = 22050


def _tone(envelope, seconds: float = 2.0, freq: float = 440.0) -> np.ndarray:
    """A few partials of `freq` under `envelope(t)`."""
    t = np.arange(int(seconds * SR)) / SR
    y = sum(np.sin(2 * np.pi * freq * k * t) / k for k in range(1, 6))
    return (0.3 * envelope(t) * y).astype(np.float32)


def _dip(depth_db: float, at: float = 1.0):
    """Level steady, then down `depth_db` for 30 ms with 15 ms ramps, then back."""

    def envelope(t: np.ndarray) -> np.ndarray:
        low = 10 ** (-depth_db / 20)
        down = np.clip((t - (at - 0.03)) / 0.015, 0, 1)
        up = np.clip((t - (at + 0.015)) / 0.015, 0, 1)
        return 1 - (1 - low) * down * (1 - up)

    return envelope


def _found(y: np.ndarray, at: float = 1.0, *, min_dip_db: float = 8.0) -> float | None:
    (t,) = recover_by_bow_change(
        y, SR, predicted_s=np.array([at]), reach_s=np.array([0.1]), min_dip_db=min_dip_db
    )
    return t


def test_a_bow_change_is_found_where_the_sound_comes_back() -> None:
    t = _found(_tone(_dip(20.0)))

    assert t is not None
    assert 0.99 < t < 1.06, t


def test_a_held_note_swelling_with_its_vibrato_is_not_a_bow_change() -> None:
    """Two decibels either way, six times a second."""
    assert _found(_tone(lambda t: 10 ** (2.0 * np.sin(2 * np.pi * 6.0 * t) / 20))) is None


def test_a_dip_shallower_than_the_setting_is_not_a_bow_change() -> None:
    y = _tone(_dip(5.0))

    assert _found(y) is None
    assert _found(y, min_dip_db=4.0) is not None


def test_a_note_ending_is_not_a_bow_change() -> None:
    """The level falls 30 dB and stays down: nothing comes back after it."""
    assert _found(_tone(lambda t: np.where(t < 1.0, 1.0, 10 ** (-30 / 20)))) is None


# ---- end to end ---------------------------------------------------------------

BPM = 90.0
BEAT = 60.0 / BPM
#: Four bars of quarters, each pitch played twice: G4 G4 A4 A4 B4 B4 ...
_PAIRS = [67, 69, 71, 72, 74, 72, 71, 69]
_NAMES = {67: "G4", 69: "A4", 71: "B4", 72: "C5", 74: "D5"}
PITCHES = [p for p in _PAIRS for _ in range(2)]
TIMES = [0.6 + i * BEAT for i in range(len(PITCHES))]
#: The second note of two pairs, whose attack the first pass is made to miss.
REBOWED = (5, 9)


def _page() -> ScoreJson:
    return ScoreJson(
        clef="treble",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(
                measure_number=m + 1,
                notes=[Note(pitch=_NAMES[p], duration="quarter") for p in PITCHES[4 * m : 4 * m + 4]],
                slurs=[],
            )
            for m in range(len(PITCHES) // 4)
        ],
    )


def _take(left_out: tuple[int, ...] = ()) -> np.ndarray:
    """Each played note bowed to just before the next one played: a note left
    out is held through by the one before it. A second of room after."""
    played = [i for i in range(len(PITCHES)) if i not in left_out]
    y = np.zeros(int((TIMES[-1] + 2.0) * SR), dtype=np.float32)
    for k, i in enumerate(played):
        end = TIMES[played[k + 1]] if k + 1 < len(played) else TIMES[i] + BEAT
        note = synth_bowed_note(440.0 * 2 ** ((PITCHES[i] - 69) / 12), 0.9 * (end - TIMES[i]), sr=SR)
        start = int(TIMES[i] * SR)
        y[start : start + note.size] += note
    y = y / float(np.abs(y).max()) * 0.6
    return y + np.random.default_rng(3).normal(0, 3e-4, y.size).astype(np.float32)


def _first_pass_misses(monkeypatch: pytest.MonkeyPatch, notes: tuple[int, ...]) -> None:
    """The first pass hears every attack but these, and the attack look finds
    none: what is left to find them is the bow-change look."""
    detect = audio_module.detect_onsets

    def missing(*args, **kwargs):
        onsets = detect(*args, **kwargs)
        keep = [t for t in onsets if all(abs(t - TIMES[i]) > 0.1 for i in notes)]
        return np.asarray(keep, dtype=float)

    monkeypatch.setattr(analysis.audio_svc, "detect_onsets", missing)
    monkeypatch.setattr(analysis, "_recover_attacks", lambda *a, **k: np.array([], dtype=float))


def test_a_repeated_note_the_first_pass_missed_is_found_by_its_bow_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _first_pass_misses(monkeypatch, REBOWED)

    result = analyze((_take(), SR), _page(), BPM, instrument="violin")

    assert result.status == "ok"
    assert result.n_missed_notes == 0
    timed = {n.global_index: n for n in result.per_note}
    assert set(REBOWED) <= set(timed)
    deltas = np.array([n.delta_ms for n in result.per_note])
    for i in REBOWED:
        assert abs(timed[i].delta_ms - np.median(deltas)) < 40.0, (i, timed[i].delta_ms)


def test_without_the_bow_change_look_they_are_reported_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The defect, kept reproducible: if this passes, the take above no longer
    needs the look and is testing nothing."""
    _first_pass_misses(monkeypatch, REBOWED)
    monkeypatch.setattr(
        analysis, "_recover_bow_changes", lambda *a, **k: np.array([], dtype=float)
    )

    result = analyze((_take(), SR), _page(), BPM, instrument="violin")

    assert result.status == "ok"
    assert not set(REBOWED) & {n.global_index for n in result.per_note}


def test_a_repeated_note_left_out_and_held_through_is_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The note before held on through it: no bow change, nothing found."""
    _first_pass_misses(monkeypatch, ())

    result = analyze((_take(left_out=(5,)), SR), _page(), BPM, instrument="violin")

    assert result.status == "ok"
    assert 5 not in {n.global_index for n in result.per_note}
