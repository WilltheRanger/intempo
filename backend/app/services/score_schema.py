"""Pydantic v2 models for the score JSON shape.

The shape is defined verbatim in spec §6 ("The OCR prompt"). Strict
validation: unknown fields are rejected so a Claude response that
hallucinates extra keys fails fast and triggers the retry path.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Closed enums per spec §6.
Clef = Literal["treble", "bass", "alto", "tenor"]
Articulation = Literal["staccato", "tenuto", "accent"]
Dynamics = Literal[
    "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff",
    "fp", "sfz", "sf", "fz",
]
RepeatType = Literal["repeat", "first_ending", "second_ending"]

# Duration: spec lists "quarter | eighth | half | sixteenth | dotted_quarter | ..."
# The "..." means "and the obvious extensions." Closed list of the
# durations a string-instrument MVP plausibly encounters.
Duration = Literal[
    "whole", "dotted_whole",
    "half", "dotted_half",
    "quarter", "dotted_quarter",
    "eighth", "dotted_eighth",
    "sixteenth", "dotted_sixteenth",
    "thirty_second",
]

# Pitch: "rest" or scientific-pitch like "C4", "F#3", "Bb2".
_PITCH_PATTERN = re.compile(r"^(?:rest|[A-G](?:#|b)?-?\d)$")


class _Strict(BaseModel):
    """The shape of a transcription, tolerant of a model saying more than this.

    **`extra="forbid"` cost whole pages.** One unexpected key anywhere — a
    per-measure time signature on a page that changes metre, a beaming hint, a
    rehearsal mark, a fingering — failed validation for the *entire score*.
    The pipeline counts a validation error as the provider failing, asks the
    next provider, which is a model with the same helpful instinct, and then
    reports that the photograph could not be read.

    The page a cellist sent in changes metre partway down. A model trying to
    express that has nowhere in this schema to put it, and the most natural
    thing it can do — attach it to the measure — was the one thing guaranteed
    to lose the page.

    It also gets *worse* with a better model, since a more capable one is more
    likely to notice something this schema cannot hold.

    So extras are ignored. The trade is lopsided in a way that is not close:
    dropping a field the app has no use for costs nothing, and rejecting the
    page costs the page. Every field this app actually reads is declared below
    and is still validated exactly as strictly as before — an extra key cannot
    make a wrong pitch or an impossible duration pass.
    """

    model_config = ConfigDict(extra="ignore")


class Note(_Strict):
    pitch: str = Field(min_length=1, max_length=8)
    duration: Duration
    articulation: Articulation | None = None
    tied_to_next: bool = False
    dynamics: Dynamics | None = None

    @field_validator("pitch")
    @classmethod
    def _validate_pitch(cls, value: str) -> str:
        if not _PITCH_PATTERN.match(value):
            raise ValueError(
                f"pitch must be 'rest' or scientific-pitch (e.g. 'D3', 'F#4', 'Bb2'); got {value!r}"
            )
        return value


class Slur(_Strict):
    start_note_index: int = Field(ge=0)
    end_note_index: int = Field(ge=0)

    @field_validator("end_note_index")
    @classmethod
    def _end_after_start(cls, end: int, info) -> int:
        start = info.data.get("start_note_index")
        if start is not None and end < start:
            raise ValueError("slur end_note_index must be >= start_note_index")
        return end


class Measure(_Strict):
    measure_number: int = Field(ge=1)
    notes: list[Note] = Field(default_factory=list)
    slurs: list[Slur] = Field(default_factory=list)


class Repeat(_Strict):
    start_measure: int = Field(ge=1)
    end_measure: int = Field(ge=1)
    type: RepeatType


_TIME_SIG_PATTERN = re.compile(r"^\d+/\d+$")


class ScoreJson(_Strict):
    # `time_signature` and `key_signature` accept the literal string
    # "unknown" (or null) when the score's metadata header is illegible
    # — handwritten manuscripts and tightly-cropped phone photos often
    # cut off the time/key marking. The OCR prompt explicitly authorizes
    # the model to use "unknown" rather than guess.
    time_signature: str | None = Field(default=None, max_length=20)
    key_signature: str | None = Field(default=None, max_length=40)
    tempo_marking: str | None = None
    bpm_hint: int | None = Field(default=None, ge=20, le=300)
    #: Which clef the staff is in, or None when nothing has read the page yet.
    #:
    #: Optional for the same reason `time_signature` and `key_signature` are:
    #: it is a fact printed on the page, and a score can exist before anyone
    #: has looked. A piece created from a photograph holds an empty
    #: transcription for the minute or so its worker takes, and a clef guessed
    #: to fill the gap would be shown to a musician as though it had been read
    #: — a bass part labelled "Treble clef" is a worse answer than no label.
    #:
    #: A *transcription* still has to name one: `pipeline.py` treats a provider
    #: that returns no clef as a failed read and tries the next provider, so
    #: this never loosens what OCR is held to.
    clef: Clef | None = None
    measures: list[Measure] = Field(default_factory=list)
    repeats: list[Repeat] = Field(default_factory=list)
    ocr_confidence: float = Field(ge=0.0, le=1.0)
    notes_to_human: str = ""

    @field_validator("time_signature")
    @classmethod
    def _validate_time_signature(cls, value: str | None) -> str | None:
        if value is None or value.strip().lower() == "unknown":
            return value
        if not _TIME_SIG_PATTERN.match(value):
            raise ValueError(
                f"time_signature must be 'N/N' (e.g. '4/4'), 'unknown', or null; got {value!r}"
            )
        return value

    @field_validator("key_signature")
    @classmethod
    def _validate_key_signature(cls, value: str | None) -> str | None:
        if value is None:
            return value
        stripped = value.strip()
        if not stripped:
            raise ValueError("key_signature must be non-empty when provided")
        return value
