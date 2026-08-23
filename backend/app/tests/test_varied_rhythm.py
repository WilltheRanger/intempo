"""Music with more than one note value in it, and a take with one bar wrong.

Every other audio test here plays a uniform stream of one duration. Real
writing mixes them, and the product's whole claim is that it says *which bar*
went wrong — so a single bad bar must not contaminate the rest.

The score is twenty bars cycling five shapes: four quarters; eight eighths; a
dotted quarter, an eighth and a half; four sixteenths, a quarter and a half;
and a bar containing a rest. Ninety-six sounded notes, gaps from 208 ms to
1667 ms.

Ground truth here is exact rather than inferred: the performer records which
written note each onset came from, so "did it attribute this sound to the right
bar" is a fact and not an estimate. That mattered — an earlier version of this
harness measured identity by the most common index offset, which is wrong the
moment a take has a genuine dropped note, and it hid the real result twice.
"""

from __future__ import annotations

import numpy as np

from app.services import audio as audio_svc
from app.services.alignment import (
    align_take,
    build_timeline,
    closest_expected_gap,
)
from app.services.analysis import analyze
from app.services.audio_config import load_audio_config
from app.services.score_schema import Measure, Note, ScoreJson
from app.tests.audio_helpers import (
    MIC_NOISE_FLOOR,
    bass_scale,
    synth_bowed_note,
)

SR = 22050
BPM = 72.0
SEC_PER_BEAT = 60.0 / BPM

_SHAPES = [
    ["quarter"] * 4,
    ["eighth"] * 8,
    ["dotted_quarter", "eighth", "half"],
    ["sixteenth"] * 4 + ["quarter", "half"],
    ["quarter", "rest_quarter", "quarter", "quarter"],
]
_BEATS = {"half": 2.0, "quarter": 1.0, "dotted_quarter": 1.5, "eighth": 0.5, "sixteenth": 0.25}


def _score(cycles: int = 4) -> ScoreJson:
    measures: list[Measure] = []
    for _ in range(cycles):
        for shape in _SHAPES:
            notes = [
                Note(pitch="rest", duration=d.removeprefix("rest_"))
                if d.startswith("rest_")
                else Note(pitch="E2", duration=d)
                for d in shape
            ]
            measures.append(Measure(measure_number=len(measures) + 1, notes=notes))
    return ScoreJson(
        clef="bass", time_signature="4/4", ocr_confidence=0.9, measures=measures
    )


def _perform(
    score: ScoreJson,
    *,
    stretched_measure: int | None = None,
    factor: float = 1.0,
    drop_from: int | None = None,
    add_to: int | None = None,
) -> list[tuple[float, float, int | None]]:
    """`(onset, duration, written note index)` for every sound actually made.

    A written index of None marks a note that is not in the score at all, so a
    test can tell "attributed to the wrong bar" apart from "there was nothing
    to attribute".
    """
    events: list[tuple[float, float, int | None]] = []
    clock = 1.0
    written = 0
    for measure in score.measures:
        stretch = factor if measure.measure_number == stretched_measure else 1.0
        for index, note in enumerate(measure.notes):
            beats = _BEATS[note.duration]
            held = beats * SEC_PER_BEAT * stretch
            if note.pitch != "rest":
                dropped = measure.measure_number == drop_from and index == 0
                if not dropped:
                    events.append((clock, held * 0.75, written))
                if measure.measure_number == add_to and index == 0:
                    events.append((clock + held * 0.45, held * 0.3, None))
                written += 1
            clock += held
    return events


def _render(events: list[tuple[float, float, int | None]]) -> np.ndarray:
    total = events[-1][0] + events[-1][1] + 1.0
    y = np.zeros(int(total * SR), dtype=np.float32)
    pitches = bass_scale(len(events))
    for index, (at, duration, _) in enumerate(events):
        note = synth_bowed_note(pitches[index], duration, rise_s=0.035)
        start = int(at * SR)
        end = min(start + note.size, y.size)
        y[start:end] += note[: end - start]
    y = y / max(1e-9, float(np.abs(y).max())) * 0.6
    rng = np.random.default_rng(11)
    return np.clip(
        y + rng.normal(0, MIC_NOISE_FLOOR, y.size).astype(np.float32), -1.0, 1.0
    ).astype(np.float32)


def _attribution(score: ScoreJson, **how) -> tuple[int, int]:
    """`(right, wrong)` — sounds attributed to the note that made them, or not."""
    events = _perform(score, **how)
    y = _render(events)
    expected = build_timeline(score, BPM).onsets
    cfg = load_audio_config()
    onsets = audio_svc.detect_onsets(
        audio_svc.pre_emphasis(
            audio_svc.high_pass(y, SR, cfg.onset.double_bass_highpass_hz), config=cfg
        ),
        SR,
        double_bass=True,
        config=cfg,
        min_gap_s=closest_expected_gap(expected),
    )
    anchored = align_take(onsets, expected, target_bpm=BPM, config=cfg)
    kept = onsets[anchored.trimmed_lead : onsets.size - anchored.trimmed_tail]
    played = np.array([e[0] for e in events])
    origin = [e[2] for e in events]

    right = wrong = 0
    for detected_index, expected_index in anchored.alignment.mapping:
        if detected_index >= kept.size:
            continue
        source = origin[int(np.argmin(np.abs(played - kept[detected_index])))]
        if source is None:
            continue  # a sound with no written note behind it
        right += source == expected_index
        wrong += source != expected_index
    return right, wrong


def test_a_varied_page_played_well_is_read_correctly() -> None:
    """The baseline, and it was not obviously going to hold.

    Gaps in this score span 208 ms to 1667 ms — an eight-fold range — and the
    peak-picking window, the tempo estimate and the warp band are all derived
    from a single notion of "the gap between notes".
    """
    score = _score()
    y = _render(_perform(score))

    result = analyze((y, SR), score, target_bpm=BPM, double_bass=True)

    assert result.status == "ok"
    assert result.quality > 0.95
    assert len(result.per_note) == 96
    assert result.n_missed_notes == 0 and result.n_extra_notes == 0
    assert [m for m in result.per_measure if m.worst_band != "on"] == [], (
        "a clean take was told it drifted"
    )


def test_every_sound_is_attributed_to_the_note_that_made_it() -> None:
    right, wrong = _attribution(_score())
    assert (right, wrong) == (96, 0)


def test_a_dropped_note_is_reported_as_missing_and_nothing_else() -> None:
    """A note not played must not shift the reading of the ones that were."""
    score = _score()
    y = _render(_perform(score, drop_from=11))

    result = analyze((y, SR), score, target_bpm=BPM, double_bass=True)

    assert result.n_missed_notes == 1
    assert result.n_extra_notes == 0
    assert result.quality > 0.95
    assert [m for m in result.per_measure if m.worst_band != "on"] == []

    right, wrong = _attribution(score, drop_from=11)
    assert wrong == 0 and right == 95


def test_an_extra_note_is_reported_as_extra_and_nothing_else() -> None:
    score = _score()
    y = _render(_perform(score, add_to=6))

    result = analyze((y, SR), score, target_bpm=BPM, double_bass=True)

    assert result.n_extra_notes == 1
    assert result.n_missed_notes == 0
    assert result.quality > 0.95
    assert [m for m in result.per_measure if m.worst_band != "on"] == []

    right, wrong = _attribution(score, add_to=6)
    assert wrong == 0 and right == 96


def test_holding_one_bar_too_long_does_not_move_every_later_note() -> None:
    """This was a strict xfail for exactly one commit, and the reason is the
    most useful thing in this file.

    Holding a bar leaves the take offset from the written grid for everything
    after it. DTW's cost was the distance between absolute times, so explaining
    the remainder as "they skipped two notes" cost two steps while the truth
    cost 0.83 s on each of 88 pairs — the shift was not a failure of the
    search, it was the cheaper answer to the question being asked. Half the
    take was attributed to the wrong written note and the app named eight bars
    as off-tempo in a performance where one bar was long and the rest was
    perfect.

    Matching on intervals is what fixed it; see `_cost_matrix`.
    """
    right, wrong = _attribution(_score(), stretched_measure=8, factor=1.25)
    assert wrong == 0, f"{wrong} of {right + wrong} sounds attributed to the wrong note"


def test_hurrying_one_bar_does_not_move_every_later_note() -> None:
    right, wrong = _attribution(_score(), stretched_measure=13, factor=0.75)
    assert wrong == 0, f"{wrong} of {right + wrong} sounds attributed to the wrong note"
