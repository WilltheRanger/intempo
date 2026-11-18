"""Notes left out of a take, paired by timing alone.

`alignment.align_dtw` compared the interval into each detection with the
written interval into one note. After a note the musician did not play, the
true interval spans two written ones, so the correct pairing paid a whole
interval's mismatch at the note after the hole and sliding every later note one
place along was cheaper. A steady plucked bass take with two notes left out a
beat apart was paired one note off for five notes and refused at quality
0.000. Each interval may now also be read across one written note, at
`DROPPED_NOTE_CAPS` (TUNING_LOG.md, 2026-11-13).

Timing only, no audio: each take is its page's own onsets with a constant
latency and 3 ms of jitter, so what is tested is the pairing and nothing a
detector does.
"""

from __future__ import annotations

import itertools

import numpy as np
import pytest

from app.services import alignment
from app.services.alignment import align_take, apply_fuzzy_match, build_timeline
from app.services.audio_config import load_audio_config
from app.services.score_schema import ScoreJson

CFG = load_audio_config()
BPM = 60.0

#: The page of the accuracy benchmark's take that was refused
#: (`double_bass/pizz/60/missed/dynamics/1179`): eight bars of G major in the
#: bass clef, mixing halves, quarters, a dotted quarter and eighths.
PAGE = ScoreJson.model_validate(
    {
        "time_signature": "4/4",
        "clef": "bass",
        "repeats": [],
        "ocr_confidence": 1.0,
        "measures": [
            {"measure_number": k + 1, "notes": [{"pitch": p, "duration": d} for p, d in bar], "slurs": []}
            for k, bar in enumerate(
                [
                    [("D3", "quarter"), ("B2", "quarter"), ("C3", "quarter"), ("D3", "quarter")],
                    [("F#3", "half"), ("G3", "quarter"), ("E3", "quarter")],
                    [("F#3", "half"), ("D3", "quarter"), ("E3", "quarter")],
                    [
                        ("G3", "eighth"),
                        ("F#3", "eighth"),
                        ("D3", "eighth"),
                        ("F#3", "eighth"),
                        ("B3", "quarter"),
                        ("C4", "quarter"),
                    ],
                    [("G3", "half"), ("F#3", "quarter"), ("A3", "quarter")],
                    [("G3", "dotted_quarter"), ("A3", "eighth"), ("E3", "quarter"), ("D3", "quarter")],
                    [("F#3", "half"), ("G3", "quarter"), ("A3", "quarter")],
                    [("B3", "half"), ("D4", "half")],
                ]
            )
        ],
    }
)
EXPECTED = np.asarray(build_timeline(PAGE, BPM).onsets, dtype=float)


def _pair(left_out: tuple[int, ...]) -> tuple[float, int, list[int]]:
    """Quality, sounds paired with a note they were not, and notes missed."""
    rng = np.random.default_rng(4)
    played = [j for j in range(EXPECTED.size) if j not in left_out]
    onsets = np.array([0.44 + EXPECTED[j] + rng.normal(0, 0.003) for j in played])
    anchored = align_take(onsets, EXPECTED, target_bpm=BPM, config=CFG)
    cleaned = apply_fuzzy_match(anchored.alignment, anchored.onsets, EXPECTED)
    wrong = sum(played[d + anchored.trimmed_lead] != e for d, e in cleaned.matched)
    return anchored.alignment.quality, wrong, sorted(cleaned.missed_expected)


def test_two_notes_left_out_a_beat_apart_are_read_not_refused() -> None:
    """The take that was refused at 0.000. Both holes are found, and at most
    the one note beside a hole is given its place — see the xfail below."""
    quality, wrong, missed = _pair((17, 19))

    assert quality > CFG.alignment.warn_quality
    assert wrong <= 1
    assert len(missed) == 2 and 19 in missed


def test_without_the_dropped_interval_the_same_take_is_refused(monkeypatch) -> None:
    """The defect, kept reproducible: if this passes, the alternative is no
    longer what reads the take and the test above is measuring nothing."""
    monkeypatch.setattr(alignment, "DROPPED_NOTE_CAPS", float("inf"))
    quality, wrong, missed = _pair((17, 19))

    assert quality < CFG.alignment.broken_quality
    assert wrong > 1


@pytest.mark.parametrize("left_out", [(12,), (11, 13)])
def test_a_note_left_out_mid_bar_is_that_note(left_out: tuple[int, ...]) -> None:
    _, wrong, missed = _pair(left_out)
    assert wrong == 0
    assert missed == list(left_out)


@pytest.mark.xfail(
    strict=True,
    reason="the note after a hole can be given the hole's place; see the docstring",
)
@pytest.mark.parametrize("left_out", [(17, 19), (5,), (17,)])
def test_the_note_after_a_hole_keeps_its_own_place(left_out: tuple[int, ...]) -> None:
    """**The open half.** Leaving out the quarter after a half note (5, 17)
    leaves a three-beat interval the pairing can read two ways at near-equal
    cost: across the left-out note, which is the truth, or as the half note's
    two beats into the left-out note's place, a beat early. DTW pays for a
    skipped note the cell it skips with — the previous detection's interval,
    a number that says nothing about the note — and that cell decides it.
    Charging it nothing read all three of these right and broke seven
    attribution and wrong-piece tests, so it is held here as a defect rather
    than fixed; the note is reported missed in place of its neighbour."""
    _, wrong, missed = _pair(left_out)
    assert wrong == 0
    assert missed == list(left_out)


def test_no_pair_of_notes_left_out_is_refused() -> None:
    """Every pair of the page's inner notes left out in turn: 276 takes. The
    old pairing refused 11 of them, each a page played as written but for two
    notes, and gave 467 sounds the wrong note; none is refused now, and 313
    are. Pinned as no refusal and fewer than before, not as no mistake."""
    results = [_pair(pair) for pair in itertools.combinations(range(2, 26), 2)]

    assert [q for q, _, _ in results if q < CFG.alignment.broken_quality] == []
    assert sum(w for _, w, _ in results) < 467
