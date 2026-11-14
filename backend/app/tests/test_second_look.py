"""The second look's attack search, and the note before that goes on.

`analysis._recover_missed_onsets` looks again, wherever the page writes a note
and none was heard, for the onset envelope's nearest rise. Inside a note still
being held, a vibrato swell or a change of bow pressure is a rise too. On the
synthetic set (2026-11-14), eight notes the player left out were "recovered"
that way, each inside the note before and at its pitch
(`analysis._not_the_note_before`, TUNING_LOG.md).

No audio: the pitch heard after each attack is given, so what is tested is
the rule and not the detector.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.alignment import CleanedAlignment, build_timeline
from app.services.analysis import _not_the_note_before
from app.services.score_schema import ScoreJson


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


class _Heard:
    """What the pitch track heard: each written note at its own pitch, except
    at the attack under test (2 s) and later in the gap after it."""

    transpose = 0

    def __init__(self, early: float, late: float) -> None:
        self._early, self._late = early, late

    def heights(self, attacks_s: np.ndarray) -> np.ndarray:
        return np.array([self._at(float(t)) for t in attacks_s])

    def _at(self, t: float) -> float:
        if abs(t - 2.0) < 1e-9:
            return self._early
        if 2.0 < t < 3.0:
            return self._late
        return {0: 69.0, 1: 71.0, 3: 74.0}.get(int(t), 76.0)


def _second_look(pitches: list[str], early: float, late: float) -> np.ndarray:
    """Quarters at 60 BPM, the third left out, and the attack look's
    candidate where it belongs, at 2 s."""
    timeline = build_timeline(_page(pitches), 60.0)
    return _not_the_note_before(
        np.array([2.0]),
        CleanedAlignment(matched=[(0, 0), (1, 1), (2, 3), (3, 4)], missed_expected=[2]),
        np.array([0.0, 1.0, 3.0, 4.0]),
        np.asarray(timeline.onsets, dtype=float),
        [2],
        _Heard(early, late),
        timeline.notes,
    )


PAGE = ["A4", "B4", "C5", "D5", "E5", "F5", "G5", "A5"]


def test_a_note_left_out_is_not_found_inside_the_note_before_it() -> None:
    """B4 is still sounding where C5 was written, and still sounding halfway
    to the next note: the player held B4 on."""
    assert _second_look(PAGE, 71.0, 71.0).size == 0


@pytest.mark.parametrize(
    ("heard", "why"),
    [(72.0, "the missed note sounded"), (76.0, "a wrong note, which is not the note before")],
)
def test_an_attack_heard_at_another_pitch_is_kept(heard: float, why: str) -> None:
    assert _second_look(PAGE, heard, heard).tolist() == [2.0], why


def test_a_note_that_begins_under_the_ring_of_the_one_before_is_kept() -> None:
    """B4 just after the attack and C5 by halfway: the note began while the one
    before still rang, as a plucked bass's does. A synthetic pizzicato take
    lost two played notes before the rule listened a second time."""
    assert _second_look(PAGE, 71.0, 72.0).tolist() == [2.0]


def test_where_the_page_repeats_a_pitch_nothing_is_dropped() -> None:
    """B4 then B4: the note before going on and this note bowed again sound the
    same, and the rule cannot tell them apart, so it leaves the attack."""
    assert _second_look(["A4", "B4", "B4", "D5", "E5", "F5", "G5", "A5"], 71.0, 71.0).tolist() == [
        2.0
    ]


def test_the_second_look_asks_the_rule(monkeypatch: pytest.MonkeyPatch) -> None:
    """Wired in, not only written: the attack look's candidate inside the note
    before is gone from what the second look returns."""
    from app.services import analysis
    from app.services.audio_config import load_audio_config

    timeline = build_timeline(_page(PAGE), 60.0)
    monkeypatch.setattr(analysis, "_recover_attacks", lambda *a, **k: np.array([2.0]))
    monkeypatch.setattr(analysis, "_recover_legato", lambda *a, **k: np.array([], dtype=float))
    found = analysis._recover_missed_onsets(
        None,
        CleanedAlignment(matched=[(0, 0), (1, 1), (2, 3), (3, 4)], missed_expected=[2]),
        np.array([0.0, 1.0, 3.0, 4.0]),
        np.asarray(timeline.onsets, dtype=float),
        min_gap_s=1.0,
        config=load_audio_config(),
        pitch=_Heard(71.0, 71.0),
        notes=timeline.notes,
    )
    assert found.size == 0
