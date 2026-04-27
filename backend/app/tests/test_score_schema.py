"""Strict-validation coverage for `ScoreJson` and friends."""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from app.services.score_schema import (
    Measure,
    Note,
    Repeat,
    ScoreJson,
    Slur,
)


MINIMAL_PAYLOAD = {
    "time_signature": "4/4",
    "key_signature": "D major",
    "clef": "treble",
    "measures": [],
    "ocr_confidence": 0.95,
}


def test_minimal_payload_parses() -> None:
    score = ScoreJson.model_validate(MINIMAL_PAYLOAD)
    assert score.clef == "treble"
    assert score.measures == []
    assert score.ocr_confidence == 0.95
    assert score.notes_to_human == ""
    assert score.tempo_marking is None
    assert score.bpm_hint is None


def test_full_payload_round_trip() -> None:
    payload = {
        "time_signature": "3/4",
        "key_signature": "G major",
        "tempo_marking": "Allegro",
        "bpm_hint": 120,
        "clef": "bass",
        "measures": [
            {
                "measure_number": 1,
                "notes": [
                    {
                        "pitch": "D3",
                        "duration": "quarter",
                        "articulation": "staccato",
                        "tied_to_next": False,
                        "dynamics": "f",
                    },
                    {
                        "pitch": "rest",
                        "duration": "eighth",
                    },
                ],
                "slurs": [{"start_note_index": 0, "end_note_index": 1}],
            }
        ],
        "repeats": [{"start_measure": 1, "end_measure": 8, "type": "repeat"}],
        "ocr_confidence": 0.82,
        "notes_to_human": "measure 4 unclear",
    }
    score = ScoreJson.model_validate(payload)
    # Round-trip via JSON to make sure model_dump_json is also clean.
    again = ScoreJson.model_validate(json.loads(score.model_dump_json()))
    assert again == score


@pytest.mark.parametrize("conf", [0.0, 1.0, 0.5])
def test_ocr_confidence_boundaries_accepted(conf: float) -> None:
    payload = {**MINIMAL_PAYLOAD, "ocr_confidence": conf}
    assert ScoreJson.model_validate(payload).ocr_confidence == conf


@pytest.mark.parametrize("conf", [-0.01, 1.01, 2.0])
def test_ocr_confidence_outside_range_rejected(conf: float) -> None:
    with pytest.raises(ValidationError):
        ScoreJson.model_validate({**MINIMAL_PAYLOAD, "ocr_confidence": conf})


def test_extra_fields_rejected() -> None:
    payload = {**MINIMAL_PAYLOAD, "unexpected": "nope"}
    with pytest.raises(ValidationError):
        ScoreJson.model_validate(payload)


def test_measure_extra_field_rejected() -> None:
    payload = {
        **MINIMAL_PAYLOAD,
        "measures": [{"measure_number": 1, "notes": [], "extra": True}],
    }
    with pytest.raises(ValidationError):
        ScoreJson.model_validate(payload)


def test_invalid_time_signature_rejected() -> None:
    with pytest.raises(ValidationError):
        ScoreJson.model_validate({**MINIMAL_PAYLOAD, "time_signature": "common"})


@pytest.mark.parametrize("value", ["unknown", "UNKNOWN", "Unknown", None])
def test_unknown_or_null_time_signature_accepted(value) -> None:
    """When the metadata header is illegible (handwritten / cropped photo)
    the model must be able to say 'unknown' or null rather than guess."""
    payload = {**MINIMAL_PAYLOAD, "time_signature": value}
    if value is None:
        # Pydantic dropping default — confirm it parses with the field omitted.
        payload.pop("time_signature")
    parsed = ScoreJson.model_validate(payload)
    assert parsed.time_signature == value


@pytest.mark.parametrize("value", ["unknown", None])
def test_unknown_or_null_key_signature_accepted(value) -> None:
    payload = {**MINIMAL_PAYLOAD, "key_signature": value}
    if value is None:
        payload.pop("key_signature")
    parsed = ScoreJson.model_validate(payload)
    assert parsed.key_signature == value


def test_empty_string_key_signature_rejected() -> None:
    """Empty string is different from None / 'unknown' — it's a model glitch."""
    with pytest.raises(ValidationError):
        ScoreJson.model_validate({**MINIMAL_PAYLOAD, "key_signature": "   "})


def test_invalid_clef_rejected() -> None:
    with pytest.raises(ValidationError):
        ScoreJson.model_validate({**MINIMAL_PAYLOAD, "clef": "guitar"})


@pytest.mark.parametrize(
    "pitch", ["D3", "F#4", "Bb2", "C-1", "rest"]
)
def test_pitch_accepts_valid_forms(pitch: str) -> None:
    Note.model_validate({"pitch": pitch, "duration": "quarter"})


@pytest.mark.parametrize("pitch", ["", "H4", "D#bb4", "rest!", "Sharp", "  D3  "])
def test_pitch_rejects_invalid_forms(pitch: str) -> None:
    with pytest.raises(ValidationError):
        Note.model_validate({"pitch": pitch, "duration": "quarter"})


def test_invalid_duration_rejected() -> None:
    with pytest.raises(ValidationError):
        Note.model_validate({"pitch": "D3", "duration": "demisemiquaver"})


def test_slur_end_before_start_rejected() -> None:
    with pytest.raises(ValidationError):
        Slur.model_validate({"start_note_index": 3, "end_note_index": 1})


def test_repeat_invalid_type_rejected() -> None:
    with pytest.raises(ValidationError):
        Repeat.model_validate({"start_measure": 1, "end_measure": 2, "type": "fine"})


def test_bpm_hint_range() -> None:
    with pytest.raises(ValidationError):
        ScoreJson.model_validate({**MINIMAL_PAYLOAD, "bpm_hint": 5})
    with pytest.raises(ValidationError):
        ScoreJson.model_validate({**MINIMAL_PAYLOAD, "bpm_hint": 400})
    ScoreJson.model_validate({**MINIMAL_PAYLOAD, "bpm_hint": 120})


def test_measure_defaults() -> None:
    measure = Measure.model_validate({"measure_number": 1})
    assert measure.notes == []
    assert measure.slurs == []
