"""The vision prompt must expose timing metadata the alignment engine consumes."""

from __future__ import annotations

from app.services.ocr.base import PROMPT
from app.services.score_schema import ScoreJson


def test_prompt_allows_fermata_and_grace_metadata_on_notes() -> None:
    """A schema field the prompt forbids is dead code for photographed music."""
    assert '"fermata": true' in PROMPT
    assert '"grace_notes": N' in PROMPT
    assert "Do not emit them as notes in the measure" in PROMPT
    assert "Do not lengthen its written duration" in PROMPT


def test_the_prompted_ornament_shape_validates() -> None:
    score = ScoreJson.model_validate(
        {
            "time_signature": "2/4",
            "key_signature": "C major",
            "tempo_marking": None,
            "tempo_beat_unit": None,
            "bpm_hint": None,
            "clef": "bass",
            "measures": [
                {
                    "measure_number": 1,
                    "notes": [
                        {
                            "pitch": "D3",
                            "duration": "quarter",
                            "fermata": True,
                        },
                        {
                            "pitch": "E3",
                            "duration": "quarter",
                            "grace_notes": 2,
                        },
                    ],
                }
            ],
            "ocr_confidence": 0.9,
        }
    )
    assert score.measures[0].notes[0].fermata is True
    assert score.measures[0].notes[1].grace_notes == 2
