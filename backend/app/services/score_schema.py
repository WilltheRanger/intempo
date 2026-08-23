"""Pydantic v2 models for the score JSON shape.

The shape is defined verbatim in spec §6 ("The OCR prompt"). Strict
validation: unknown fields are rejected so a Claude response that
hallucinates extra keys fails fast and triggers the retry path.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
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
    # Triplets. Added rather than modelled, deliberately.
    #
    # The correct model is a value plus a ratio — `{"eighth", 3:2}` — and it is
    # a breaking change across this schema, `alignment.py`, three files in
    # `mobile/src/lib/`, `types.ts` and every prompt. These four names cover
    # essentially every tuplet a string player meets, and they extend a closed
    # Literal without invalidating a single stored score.
    #
    # Their beats do not divide evenly: a triplet eighth is 1/3 of a quarter,
    # so three of them sum to 1.0 only within floating-point tolerance. Every
    # beat-sum comparison in this codebase already carries that tolerance —
    # `validate.py` and `reading.ts` both compare with an epsilon — which is
    # what makes adding them safe rather than a source of false "does not add
    # up" reports.
    "triplet_half", "triplet_quarter", "triplet_eighth", "triplet_sixteenth",
]

#: Quarter-note beats per duration — the single table.
#:
#: `alignment.py` and `ocr/validate.py` each held their own copy, with a
#: comment in one saying "deliberately the same table as" the other. They
#: drifted the moment triplets were added: the validator scored every triplet
#: as **zero beats** via a `.get(..., 0.0)` default and reported a correct bar
#: as short, silently. A comment is not an invariant.
#:
#: It lives here because the beat value of a duration is a property of the
#: duration, and `Duration` is defined above.
DURATION_BEATS: dict[str, float] = {
    "whole": 4.0,
    "dotted_whole": 6.0,
    "half": 2.0,
    "dotted_half": 3.0,
    "quarter": 1.0,
    "dotted_quarter": 1.5,
    "eighth": 0.5,
    "dotted_eighth": 0.75,
    "sixteenth": 0.25,
    "dotted_sixteenth": 0.375,
    "thirty_second": 0.125,
    # Three in the time of two. Thirds are not exactly representable in binary;
    # these particular groupings happen to sum back to their bar length exactly
    # anyway, but that is luck in the rounding rather than a guarantee, which is
    # why every comparison downstream carries a tolerance. See `validate.TOLERANCE`.
    "triplet_half": 4.0 / 3.0,
    "triplet_quarter": 2.0 / 3.0,
    "triplet_eighth": 1.0 / 3.0,
    "triplet_sixteenth": 1.0 / 6.0,
}

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


# --- ties -------------------------------------------------------------------
#
# `tied_to_next` was a bare bool that nothing validated and one thing consumed:
# `alignment.build_timeline` absorbed the next note into the previous onset, so
# a tie *deletes an onset* from the expected timeline. A tie the model invented
# therefore removed a note the musician actually attacked, and every onset after
# it lined up against the wrong note — the same damage a wrong duration does,
# with no arithmetic guard anywhere.
#
# A tie is a single sustained sound written across two noteheads, so the two
# noteheads are the *same pitch* by definition. A curve joining two different
# pitches is a slur — different mark, same shape on the page, and telling them
# apart is exactly the kind of thing a vision model gets wrong. Pitch is the
# discriminator, and it was sitting unused in the data.
#
# Decided here, once, so `alignment` and `ocr/validate` cannot disagree about
# which ties are real — the same reason `DURATION_BEATS` lives in this module.


@dataclass(frozen=True)
class BrokenTie:
    """A tie that was written but cannot be honoured."""

    measure_number: int
    #: Index of the note carrying `tied_to_next`, within its measure.
    note_index: int
    pitch: str
    #: The pitch it was tied into, or None when nothing follows it at all.
    next_pitch: str | None

    def describe(self) -> str:
        if self.next_pitch is None:
            return (
                f"measure {self.measure_number}: the last note is tied to a note "
                "that isn't there"
            )
        return (
            f"measure {self.measure_number}: {self.pitch} is tied to "
            f"{self.next_pitch} — a tie joins one pitch to itself, so this is a "
            "slur or a misread"
        )


@dataclass(frozen=True)
class TieReading:
    """How every note's incoming tie was read, across a run of measures.

    Indexed by position in the flattened note sequence, because **ties cross
    barlines** — joining a note to the first note of the next measure is the
    commonest use of one — so this cannot be decided a measure at a time.
    """

    #: Absorbed into the previous note's onset: a real tie, no new attack.
    absorbed: tuple[bool, ...]
    #: A tie was written into this note and could not be honoured.
    broken: tuple[bool, ...]


def read_ties(measures: Sequence[Measure]) -> TieReading:
    """Which ties are real, walking the notes as a player reads them.

    A rest ends any tie: `tied_to_next` on a rest is meaningless, and so is a
    tie into one.
    """
    flat = [note for measure in measures for note in measure.notes]
    absorbed = [False] * len(flat)
    broken = [False] * len(flat)

    for index, note in enumerate(flat):
        if not note.tied_to_next or note.pitch == "rest":
            continue
        following = flat[index + 1] if index + 1 < len(flat) else None
        if following is not None and following.pitch == note.pitch:
            absorbed[index + 1] = True
        elif following is not None:
            broken[index + 1] = True
        # A tie on the very last note has nothing to absorb and nothing to
        # mark; `broken_ties` still reports it, because it is evidence the page
        # was misread even though it changes no onset.

    return TieReading(absorbed=tuple(absorbed), broken=tuple(broken))


def broken_ties(measures: Sequence[Measure]) -> list[BrokenTie]:
    """Every written tie whose two notes do not share a pitch, for reporting."""
    flat = [
        (measure.measure_number, index, note)
        for measure in measures
        for index, note in enumerate(measure.notes)
    ]
    out: list[BrokenTie] = []

    for position, (measure_number, note_index, note) in enumerate(flat):
        if not note.tied_to_next or note.pitch == "rest":
            continue
        following = flat[position + 1][2] if position + 1 < len(flat) else None
        if following is not None and following.pitch == note.pitch:
            continue
        out.append(
            BrokenTie(
                measure_number=measure_number,
                note_index=note_index,
                pitch=note.pitch,
                next_pitch=None if following is None else following.pitch,
            )
        )
    return out
