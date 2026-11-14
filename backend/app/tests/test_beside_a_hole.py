"""The note beside a hole, given its own attack by its pitch and its place.

Timing can read an interval across one note the player left out
(`alignment.DROPPED_NOTE_CAPS`) but not across two, so with two left out in a
row the sound after them was paired with the second, a beat early, and the
note it was reported missing. `analysis._beside_a_hole` moves such an attack
once the take is paired, where the pitch after it is the missing note's and a
line through the paired notes either side puts it nearer that note's place.

Where the page repeats a pitch nothing moves: the place alone was tried and
was a coin toss on real takes. The rule is tested with the pitch given, as
`test_second_look.py` does, and once end to end on a synthetic bowed take.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services import analysis
from app.services.alignment import CleanedAlignment, build_timeline
from app.services.analysis import _beside_a_hole, analyze
from app.services.score_schema import ScoreJson
from app.tests.audio_helpers import synth_bowed_take

PAGE = ["A4", "B4", "C5", "D5", "E5", "F5", "G5", "A5"]
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


class _Heard:
    """The pitch the track heard after each attack, by the attack's time."""

    transpose = 0
    track = np.zeros(1)

    def __init__(self, at: dict[float, float]) -> None:
        self._at = at

    def heights(self, attacks_s: np.ndarray) -> np.ndarray:
        return np.array([self._at[round(float(t), 3)] for t in attacks_s])


def _repaired(
    pitches: list[str],
    matched: list[tuple[int, int]],
    times: list[float],
    heard: list[float],
    bpm: float = 60.0,
) -> CleanedAlignment:
    """Quarters, at 60 BPM unless asked: a note's place is its index in beats."""
    timeline = build_timeline(_page(pitches), bpm)
    beat = 60.0 / bpm
    at = [round(t * beat, 3) for t in times]
    paired = {e for _, e in matched}
    return _beside_a_hole(
        CleanedAlignment(
            matched=matched,
            missed_expected=[e for e in range(len(pitches)) if e not in paired],
        ),
        np.array(at),
        timeline,
        _Heard(dict(zip(at, heard, strict=True))),
    )


def test_the_note_after_two_left_out_is_given_its_own_attack() -> None:
    """C5 and D5 left out. Timing paired E5's sound, at 4 s, with D5 and
    reported E5 missing; E5 is what sounded, and 4 s is where E5 belongs."""
    times = [0.0, 1.0, 4.0, 5.0, 6.0, 7.0]
    heard = [69.0, 71.0, 76.0, 77.0, 79.0, 81.0]
    out = _repaired(PAGE, [(0, 0), (1, 1), (2, 3), (3, 5), (4, 6), (5, 7)], times, heard)

    assert out.matched == [(0, 0), (1, 1), (2, 4), (3, 5), (4, 6), (5, 7)]
    assert out.missed_expected == [2, 3]


def test_between_notes_written_too_close_to_tell_apart_nothing_moves() -> None:
    """The same take as quarters at 800 BPM, 75 ms apart: closer than an
    attack and the pitch after it can be said to belong to one note
    (`analysis.HOLE_MIN_GAP_S`), as in a turn."""
    times = [0.0, 1.0, 4.0, 5.0, 6.0, 7.0]
    heard = [69.0, 71.0, 76.0, 77.0, 79.0, 81.0]
    matched = [(0, 0), (1, 1), (2, 3), (3, 5), (4, 6), (5, 7)]
    out = _repaired(PAGE, matched, times, heard, bpm=800.0)

    assert out.matched == matched


def test_a_wrong_note_at_the_holes_pitch_stays_where_it_was_played() -> None:
    """D5 left out, and C5 played as D5 at 2 s. The pitch is the missing
    note's but the place is C5's, so it stays C5's, a wrong note."""
    times = [0.0, 1.0, 2.0, 4.0, 5.0, 6.0, 7.0]
    heard = [69.0, 71.0, 74.0, 76.0, 77.0, 79.0, 81.0]
    out = _repaired(PAGE, [(0, 0), (1, 1), (2, 2), (3, 4), (4, 5), (5, 6), (6, 7)], times, heard)

    assert out.missed_expected == [3]


def test_a_hole_that_shifted_a_run_gives_each_note_back_in_turn() -> None:
    """C5 and E5 left out. Timing slid D5's sound onto C5 and F5's onto D5,
    and reported E5 and F5 missing. F5's sound goes back first, which frees
    D5's place for D5's."""
    times = [0.0, 1.0, 3.0, 5.0, 6.0, 7.0]
    heard = [69.0, 71.0, 74.0, 77.0, 79.0, 81.0]
    out = _repaired(PAGE, [(0, 0), (1, 1), (2, 2), (3, 3), (4, 6), (5, 7)], times, heard)

    assert out.matched == [(0, 0), (1, 1), (2, 3), (3, 5), (4, 6), (5, 7)]
    assert out.missed_expected == [2, 4]


def test_where_the_page_repeats_a_pitch_nothing_moves() -> None:
    """D5 then D5: the pitch cannot say which is sounding. The attack sits
    exactly where the second D5 belongs, and still stays: on real takes the
    place alone moved an attack further from its note as often as onto it."""
    pitches = ["A4", "B4", "C5", "D5", "D5", "F5", "G5", "A5"]
    times = [0.0, 1.0, 4.0, 5.0, 6.0, 7.0]
    heard = [69.0, 71.0, 74.0, 77.0, 79.0, 81.0]
    matched = [(0, 0), (1, 1), (2, 3), (3, 5), (4, 6), (5, 7)]
    out = _repaired(pitches, matched, times, heard)

    assert out.matched == matched


def test_with_no_paired_note_after_the_hole_nothing_moves() -> None:
    """At the end of a take there is no line to place the attack on."""
    times = [0.0, 1.0, 2.0, 3.0, 4.0, 7.0]
    heard = [69.0, 71.0, 72.0, 74.0, 76.0, 81.0]
    matched = [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4), (5, 6)]
    out = _repaired(PAGE, matched, times, heard)

    assert out.matched == matched


# ---- end to end -----------------------------------------------------------------

SR = 22050
BPM = 96.0
_NAMES = {62: "D4", 64: "E4", 66: "F#4", 67: "G4", 69: "A4", 71: "B4", 72: "C5", 74: "D5"}
_BEATS = {"quarter": 1.0, "half": 2.0, "eighth": 0.5}
#: Six bars of G major, quarters, halves and eighths.
_BARS = [
    [(67, "quarter"), (69, "quarter"), (71, "quarter"), (72, "quarter")],
    [(74, "half"), (71, "quarter"), (69, "quarter")],
    [(67, "quarter"), (64, "quarter"), (66, "half")],
    [(67, "quarter"), (69, "eighth"), (71, "eighth"), (72, "quarter"), (74, "quarter")],
    [(71, "half"), (69, "quarter"), (67, "quarter")],
    [(66, "quarter"), (64, "quarter"), (62, "half")],
]


def _take(left_out: tuple[int, ...]) -> tuple[list[int], int]:
    """A bowed take of the page with `left_out` not played: the notes not
    timed, and how many were reported missing."""
    score = ScoreJson.model_validate(
        {
            "time_signature": "4/4",
            "clef": "treble",
            "repeats": [],
            "ocr_confidence": 1.0,
            "measures": [
                {
                    "measure_number": k + 1,
                    "notes": [{"pitch": _NAMES[m], "duration": d} for m, d in bar],
                    "slurs": [],
                }
                for k, bar in enumerate(_BARS)
            ],
        }
    )
    notes = [note for bar in _BARS for note in bar]
    beat = 60.0 / BPM
    starts = 0.6 + beat * np.concatenate([[0.0], np.cumsum([_BEATS[d] for _, d in notes])[:-1]])
    kept = [i for i in range(len(notes)) if i not in left_out]
    y = synth_bowed_take(
        [float(starts[i]) for i in kept],
        freqs_hz=[440.0 * 2 ** ((notes[i][0] - 69) / 12) for i in kept],
        sr=SR,
        note_dur_s=0.9 * beat,
    )
    result = analyze((y, SR), score, BPM, instrument="violin")
    assert result.status == "ok", result.verdict
    timed = {p.global_index for p in result.per_note if p.timed}
    return sorted(set(range(len(notes))) - timed), result.n_missed_notes


@pytest.mark.parametrize("left_out", [(4, 5), (9, 10)])
def test_two_notes_left_out_in_a_row_are_the_two_reported(left_out: tuple[int, ...]) -> None:
    untimed, missed = _take(left_out)

    assert untimed == list(left_out)
    assert missed == 2


def test_without_the_rule_the_note_after_them_is_reported_instead(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The defect, kept reproducible: if this passes, the take above no longer
    needs the rule and is testing nothing."""
    monkeypatch.setattr(analysis, "_beside_a_hole", lambda cleaned, *a, **k: cleaned)
    untimed, _ = _take((4, 5))

    assert untimed == [4, 6]
