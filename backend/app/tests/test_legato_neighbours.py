"""Which missed notes the legato look asks about, beside a note at their pitch.

`analysis._recover_legato` finds a note no attack marked where its written
pitch takes over. A note whose note before has its pitch is never asked: that
pitch is sounding already. The note after used to rule a note out the same
way, and that holds only while the note after's attack is unknown. Where it is
paired, the window the look searches ends before that attack, so the pitch
taking over inside it is this note's. K515's first violin (URMP) has six such
notes, among them a D4 before a D4 after a rest and a long B-flat before
another, and each was reported missing.

No audio: the pitch track is given, one value per frame, so what is tested is
the rule and not the tracker.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services import analysis, pitch_evidence
from app.services.alignment import CleanedAlignment, build_timeline
from app.services.analysis import _recover_legato
from app.services.audio_config import load_audio_config
from app.services.score_schema import ScoreJson

SR = 22050
FRAME_S = pitch_evidence.HOP / SR
_MIDI = {"A4": 69, "B4": 71, "C5": 72, "D5": 74, "E5": 76, "F5": 77, "G5": 79, "A5": 81}


def _page(pitches: list[str]) -> ScoreJson:
    """Two bars of quarters."""
    return ScoreJson.model_validate(
        {
            "time_signature": "4/4",
            "clef": "treble",
            "repeats": [],
            "ocr_confidence": 1.0,
            "measures": [
                {
                    "measure_number": bar + 1,
                    "notes": [
                        {"pitch": p, "duration": "quarter"} for p in pitches[4 * bar : 4 * bar + 4]
                    ],
                    "slurs": [],
                }
                for bar in range(2)
            ],
        }
    )


class _Take:
    """Only its length is read; the level checks are given (`_loud`)."""

    sr = SR

    def __init__(self, seconds: float) -> None:
        self.y = np.zeros(int(seconds * SR), dtype=np.float32)


class _Pitch:
    transpose = 0
    sr = SR

    def __init__(self, track: np.ndarray) -> None:
        self.track = track


@pytest.fixture(autouse=True)
def _loud(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every time found sounds well above the room and is no release."""
    monkeypatch.setattr(
        analysis.audio_svc, "level_above_floor_db", lambda y, sr, t: np.full(np.size(t), 20.0)
    )
    monkeypatch.setattr(analysis.audio_svc, "level_change_db", lambda y, sr, t: np.zeros(np.size(t)))


def _found(pitches: list[str], missed: list[int]) -> np.ndarray:
    """Quarters at 60 BPM, every note sounding its written pitch from its
    place, so note `i` takes over at `i` s on the attack's clock. The notes
    in `missed` have no attack; every other note's attack is paired."""
    cfg = load_audio_config()
    lag = cfg.onset.recovery_pitch_lag_ms / 1000.0
    timeline = build_timeline(_page(pitches), 60.0)
    expected = np.asarray(timeline.onsets, dtype=float)
    frames = np.arange(int(9.0 / FRAME_S)) * FRAME_S
    # On the pitch's clock, which runs `lag` ahead of the attack's.
    sounding = np.clip(np.floor(frames + lag).astype(int), 0, len(pitches) - 1)
    track = np.array([float(_MIDI[pitches[i]]) for i in sounding])
    paired = [e for e in range(len(pitches)) if e not in missed]
    onsets = expected[paired]
    return _recover_legato(
        _Take(9.0),
        CleanedAlignment(matched=list(enumerate(paired)), missed_expected=missed),
        onsets,
        expected,
        missed,
        onsets,
        pitch=_Pitch(track),
        notes=timeline.notes,
        config=cfg,
    )


def test_a_note_before_its_own_pitch_is_found_when_that_notes_attack_is_paired() -> None:
    """D5 then D5, the first with no attack: the second's attack, at 4 s,
    closes the window, so the D5 taking over at 3 s is the first's."""
    found = _found(["A4", "B4", "C5", "D5", "D5", "F5", "G5", "A5"], missed=[3])

    assert found.size == 1
    assert abs(found[0] - 3.0) < FRAME_S


def test_with_the_next_attack_unknown_neither_is_asked() -> None:
    """Both D5s without an attack: a D5 taking over could be either, so
    neither is found by its pitch."""
    found = _found(["A4", "B4", "C5", "D5", "D5", "F5", "G5", "A5"], missed=[3, 4])

    assert found.size == 0


def test_a_note_after_its_own_pitch_is_never_asked() -> None:
    """D5 then D5, the second with no attack: the pitch is sounding already."""
    found = _found(["A4", "B4", "D5", "D5", "E5", "F5", "G5", "A5"], missed=[3])

    assert found.size == 0


def test_a_note_between_two_other_pitches_is_found() -> None:
    """The case the look was built for, unchanged."""
    found = _found(["A4", "B4", "C5", "D5", "E5", "F5", "G5", "A5"], missed=[3])

    assert found.size == 1
    assert abs(found[0] - 3.0) < FRAME_S
