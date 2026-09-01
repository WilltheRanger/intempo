"""The backend's half of `fixtures/practice/start_at.json`.

The app runs the same cases in `startFrom.parity.test.ts`. Two implementations
of one rule, in two languages, and a drift between them means the take is
judged against a different score than the one it was played to — which is the
exact failure trimming exists to avoid.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.score_schema import Measure, Note, Repeat, ScoreJson, TempoChange
from app.services.start_at import start_from_measure

CONTRACT = json.loads(
    (Path(__file__).resolve().parents[3] / "fixtures/practice/start_at.json").read_text()
)


def _score(case: dict) -> ScoreJson:
    return ScoreJson(
        time_signature="4/4",
        clef="treble",
        ocr_confidence=1.0,
        measures=[
            Measure(measure_number=n, notes=[Note(pitch="D4", duration="quarter")])
            for n in case["bars"]
        ],
        repeats=[
            Repeat(start_measure=a, end_measure=b, type="repeat")
            for a, b in case["repeats"]
        ],
        tempo_changes=[
            TempoChange(measure_number=n, kind=kind, text=kind)
            for n, kind in case["tempo_changes"]
        ],
    )


@pytest.mark.parametrize("case", CONTRACT["cases"], ids=lambda c: c["name"])
def test_the_shared_contract(case: dict) -> None:
    out = start_from_measure(_score(case), case["from_measure"])

    assert [m.measure_number for m in out.measures] == case["out_bars"]
    assert [[r.start_measure, r.end_measure] for r in out.repeats] == case["out_repeats"]
    assert [[c.measure_number, c.kind] for c in out.tempo_changes] == case[
        "out_tempo_changes"
    ]
