"""The backend's half of `fixtures/practice/tempo_map.json`.

The app walks the same markings in `tempoMap.parity.test.ts`. If the two drift,
Listen plays a meno mosso at one tempo and the analysis judges it at another.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.score_schema import Measure, Note, ScoreJson, TempoChange, tempo_in_force

CONTRACT = json.loads(
    (Path(__file__).resolve().parents[3] / "fixtures/practice/tempo_map.json").read_text()
)


def _score(case: dict) -> ScoreJson:
    return ScoreJson(
        time_signature="4/4",
        clef="treble",
        ocr_confidence=1.0,
        measures=[
            Measure(measure_number=n, notes=[Note(pitch="D4", duration="whole")])
            for n in range(1, case["bars"] + 1)
        ],
        tempo_changes=[
            TempoChange(measure_number=m, kind=kind, text=text, bpm=bpm)
            for m, kind, text, bpm in case["tempo_changes"]
        ],
    )


@pytest.mark.parametrize("case", CONTRACT["cases"], ids=lambda c: c["name"])
def test_the_shared_contract(case: dict) -> None:
    stated = tempo_in_force(_score(case))

    assert [stated[n] for n in range(1, case["bars"] + 1)] == case["stated"]
