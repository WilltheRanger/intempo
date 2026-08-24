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


def test_extra_fields_are_ignored_rather_than_losing_the_page() -> None:
    """`extra="forbid"` cost whole pages, and got worse with better models.

    One unexpected key anywhere failed validation for the entire score; the
    pipeline read that as the provider failing, asked the next one, and then
    told the musician their photograph was unreadable. A page that changes
    metre partway down invites exactly this — the model has nowhere in the
    schema to say so, and attaching it to the measure was fatal.
    """
    payload = {**MINIMAL_PAYLOAD, "unexpected": "nope"}
    score = ScoreJson.model_validate(payload)
    assert score.clef == MINIMAL_PAYLOAD["clef"]
    assert not hasattr(score, "unexpected")


def test_a_measure_carrying_something_extra_still_parses() -> None:
    """The realistic version: a page that changes metre, and a model that
    attaches the new one to the measure because there is nowhere else."""
    payload = {
        **MINIMAL_PAYLOAD,
        "measures": [
            {
                "measure_number": 1,
                "notes": [
                    {"pitch": "C3", "duration": "quarter", "beam": "start", "fingering": 2}
                ],
                "slurs": [],
                "time_signature": "3/4",
                "rehearsal_mark": "49",
            }
        ],
    }
    score = ScoreJson.model_validate(payload)
    assert score.measures[0].notes[0].pitch == "C3"
    assert score.measures[0].notes[0].duration == "quarter"


def test_ignoring_extras_does_not_loosen_what_is_declared() -> None:
    """The fields the app reads are validated exactly as strictly as before —
    an extra key cannot smuggle in an impossible duration or a bad pitch."""
    for bad in (
        {"pitch": "H9", "duration": "quarter"},
        {"pitch": "C3", "duration": "demisemiquaver"},
    ):
        with pytest.raises(ValidationError):
            ScoreJson.model_validate(
                {**MINIMAL_PAYLOAD,
                 "measures": [{"measure_number": 1, "notes": [bad], "slurs": []}]}
            )


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


def test_a_clef_this_schema_cannot_place_becomes_none_rather_than_losing_the_score() -> None:
    """It used to raise, which cost the whole page for one word.

    `None` is the answer this field is documented to prefer over a wrong one —
    "a bass part labelled 'Treble clef' is a worse answer than no label" — and
    the pipeline already treats a score with no clef as a reason to try the next
    provider rather than as an unreadable photograph.
    """
    assert ScoreJson.model_validate({**MINIMAL_PAYLOAD, "clef": "guitar"}).clef is None


@pytest.mark.parametrize(
    ("written", "expected"),
    [
        ("Bass", "bass"),
        ("BASS", "bass"),
        ("bass clef", "bass"),
        ("  Treble  ", "treble"),
        ("Alto.", "alto"),
    ],
)
def test_a_clef_spelled_a_models_way_is_still_the_clef(written: str, expected: str) -> None:
    """Case, a trailing full stop and the word "clef" are not disagreements
    about the music. Before this they were the difference between a page being
    read and a page being reported unreadable."""
    assert ScoreJson.model_validate({**MINIMAL_PAYLOAD, "clef": written}).clef == expected


@pytest.mark.parametrize("written", ["poco_dim", "dim", "marcato", "poco dim.", "cresc."])
def test_a_marking_this_schema_does_not_hold_never_costs_the_page(written: str) -> None:
    """The exact values that killed two of a musician's six scans, taken from
    the running service's logs:

        Input should be 'ppp', 'pp', 'p', ... [type=literal_error,
        input_value='poco_dim'] ... input_value='dim' ... input_value='marcato'

    `Dynamics` is a closed list of static marks with no room for a hairpin's
    name, and **nothing reads the field** — the prompt says so itself. A whole
    page of a correctly-read part was thrown away over a word with no consumer,
    and reported as a photograph that could not be read.
    """
    note = Note.model_validate(
        {"pitch": "C3", "duration": "quarter", "dynamics": written}
    )
    assert note.dynamics is None
    assert note.pitch == "C3" and note.duration == "quarter"


@pytest.mark.parametrize(("written", "expected"), [("MF", "mf"), ("ff ", "ff"), ("p.", "p")])
def test_a_dynamic_this_schema_does_hold_survives_a_models_spelling(
    written: str, expected: str
) -> None:
    """Dropping the unknown ones must not drop the known ones written oddly."""
    assert Note.model_validate(
        {"pitch": "C3", "duration": "quarter", "dynamics": written}
    ).dynamics == expected


def test_an_articulation_this_schema_does_not_hold_is_dropped_not_fatal() -> None:
    note = Note.model_validate(
        {"pitch": "C3", "duration": "quarter", "articulation": "marcato"}
    )
    assert note.articulation is None
    assert Note.model_validate(
        {"pitch": "C3", "duration": "quarter", "articulation": "Staccato"}
    ).articulation == "staccato"


@pytest.mark.parametrize("duration", ["sixty_fourth", "breve", "quintuplet_eighth", ""])
def test_a_duration_this_schema_cannot_express_is_still_fatal(duration: str) -> None:
    """The line this tolerance stops at, and it is not arbitrary.

    A dynamic nothing reads can be dropped for free. A *duration* cannot: it is
    the note's length, `alignment.py` accumulates durations to build the
    timeline it compares a recording against, and a note quietly given no length
    — or given the wrong one — moves every bar after it. Losing the page is the
    better failure, because it is the one the musician is told about.
    """
    with pytest.raises(ValidationError):
        Note.model_validate({"pitch": "C3", "duration": duration})


def test_a_note_with_no_duration_at_all_is_still_fatal() -> None:
    """Rejecting a *wrong* duration is not the same as requiring one, and only
    one of the two stops a note being given no length. A note with no length is
    a note `alignment.py` cannot place, and it would sit in the timeline
    contributing nothing while every bar around it moved."""
    with pytest.raises(ValidationError):
        Note.model_validate({"pitch": "C3"})
    with pytest.raises(ValidationError):
        Note.model_validate({"pitch": "C3", "duration": None})


def test_a_note_with_no_pitch_at_all_is_still_fatal() -> None:
    with pytest.raises(ValidationError):
        Note.model_validate({"duration": "quarter"})


def test_a_pitch_this_schema_cannot_read_is_still_fatal() -> None:
    """Same line. A tie is validated by two noteheads sharing a pitch, so a
    pitch silently dropped can delete an onset."""
    with pytest.raises(ValidationError):
        Note.model_validate({"pitch": "H4", "duration": "quarter"})


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
