"""Pydantic v2 models for the score JSON shape.

The shape is defined verbatim in spec §6 ("The OCR prompt"). Strict
validation: unknown fields are rejected so a Claude response that
hallucinates extra keys fails fast and triggers the retry path.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, field_validator

log = logging.getLogger("intempo.score")

# Closed enums per spec §6.
Clef = Literal["treble", "bass", "alto", "tenor"]
Articulation = Literal["staccato", "tenuto", "accent"]
Dynamics = Literal[
    "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff",
    "fp", "sfz", "sf", "fz",
]
RepeatType = Literal["repeat", "first_ending", "second_ending"]
#: `a_tempo` covers "a tempo", "Tempo I" and "tempo primo" — anything whose
#: job is to end a change rather than start one.
TempoChangeKind = Literal["ritardando", "accelerando", "a_tempo"]

# Duration: spec lists "quarter | eighth | half | sixteenth | dotted_quarter | ..."
# The "..." means "and the obvious extensions." Closed list of the
# durations a string-instrument MVP plausibly encounters.
Duration = Literal[
    "whole", "dotted_whole",
    "half", "dotted_half",
    "quarter", "dotted_quarter",
    "eighth", "dotted_eighth",
    "sixteenth", "dotted_sixteenth",
    "thirty_second", "dotted_thirty_second",
    "sixty_fourth",
    # A breve, and the double dots.
    #
    # **Both were named as known gaps in `musicxml.py` and both cost notes.**
    # Its comment said anything longer than a whole note "is outside what this
    # product reads", and that a double-dotted note has no name here so
    # returning the undotted one "would silently shorten the measure" — so it
    # returns nothing, and the note is *dropped*. A dropped note shortens the
    # measure too, and `alignment.py` accumulates durations, so it also moves
    # every bar after it. Avoiding a wrong length by producing a missing note
    # is not avoiding anything.
    #
    # On the OCR side the same gap costs the whole page rather than one note:
    # `Duration` is closed and load-bearing, so a model reading a march
    # correctly and writing `double_dotted_quarter` failed validation for the
    # entire score.
    #
    # These are ordinary notation. A double dot adds three quarters of the base
    # value and is how a march is written; the first real page this project has
    # seen is headed *Alla marcia*. Every value here is exactly representable
    # in binary, unlike the triplets below.
    "double_whole",
    "double_dotted_half", "double_dotted_quarter", "double_dotted_eighth",
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
    "dotted_thirty_second": 0.1875,
    "sixty_fourth": 0.0625,
    "double_whole": 8.0,
    # A double dot adds half the dot again: base × 1.75.
    "double_dotted_half": 3.5,
    "double_dotted_quarter": 1.75,
    "double_dotted_eighth": 0.875,
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
#: What `Note.pitch` accepts: `rest`, or a step A–G with an optional single
#: accidental and **one** octave digit.
#:
#: Exported so `musicxml.py` can ask the same question before it builds a note
#: rather than after. It used to hand over whatever the file said and let the
#: model reject it — which raised `ValidationError` out of the importer, past
#: the `MusicXMLError` the import route catches, and turned a file with one bad
#: notehead into a 500. See `_pitch_name`.
PITCH_PATTERN = re.compile(r"^(?:rest|[A-G](?:#|b)?-?\d)$")
_PITCH_PATTERN = PITCH_PATTERN


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


def _tidy(value: str) -> str:
    """A marking as a model wrote it, in the form this schema spells it.

    Models answer `"Bass"`, `"MF"`, `"dim."` and `"bass clef"` for values this
    schema spells `bass`, `mf` and (deliberately) not at all. Case, a trailing
    full stop and a space instead of an underscore are not disagreements about
    the music.
    """
    tidied = value.strip().rstrip(".").strip().lower().replace(" ", "_")
    return tidied[: -len("_clef")] if tidied.endswith("_clef") else tidied


def _one_of(allowed: frozenset[str], field: str):
    """Keep a marking this schema knows; drop one it does not. Never reject.

    **This is `extra="ignore"` finished.** That stopped an unexpected *key*
    costing the page and left an unexpected *value* in a declared field doing
    exactly the same thing — the identical failure, one level down, and the
    argument above applies to it word for word.

    Taken from the running service's own logs. Two of a musician's six scans
    died here, and this is the whole reason:

        Input should be 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'fp',
        'sfz', 'sf' or 'fz' [type=literal_error, input_value='poco_dim']
        ... input_value='dim' ... input_value='marcato'

    `dim.`, `poco dim.` and `marcato` are ordinary markings, printed on the
    page, correctly read. `Dynamics` is a closed list of *static* marks with no
    room for a hairpin's name, and **nothing reads the field** — the prompt
    itself says "Do NOT report articulation or dynamics. Nothing reads them."
    So a musician's page was thrown away, twice, over a word in a field with no
    consumer, and the pipeline reported it as a photograph it could not read.

    Only for fields the app does not act on. `duration` and `pitch` stay strict:
    a duration this schema cannot express is not a detail to drop, it is a hole
    in the timeline, and `alignment.py` accumulates durations so a wrong one
    moves every bar after it.
    """

    def check(value):
        if value is None or not isinstance(value, str):
            return value
        tidied = _tidy(value)
        if tidied in allowed:
            return tidied
        log.info(
            "%s=%r is not a %s this schema holds; dropping it rather than "
            "losing the page",
            field, value, field,
        )
        return None

    return check


_DYNAMICS = frozenset(get_args(Dynamics))
_ARTICULATIONS = frozenset(get_args(Articulation))
_CLEFS = frozenset(get_args(Clef))


class Note(_Strict):
    pitch: str = Field(min_length=1, max_length=8)
    duration: Duration
    articulation: Articulation | None = None
    tied_to_next: bool = False
    dynamics: Dynamics | None = None
    #: A fermata is printed over this note.
    #:
    #: **It is the one duration a page deliberately does not state.** The
    #: written value says how long the note would be without the mark; the mark
    #: says the length is the player's. So the interval after it is stretched
    #: by however long they held, and `pulse_anchors` — which cannot tell a
    #: hold from a hesitation — keeps that drift and reports the next note as
    #: dragging. A musician who held a fermata is told off for holding it.
    #:
    #: Additive rather than a closed union, so an app that has never heard of
    #: it is unaffected: the field simply is not read.
    fermata: bool = False
    #: How many grace notes are printed **before** this note.
    #:
    #: A count on the note they decorate rather than notes of their own,
    #: because a grace note has no duration — that is what the little slashed
    #: stem means — and a bar of four quarters with an ornament still adds up
    #: to four. Giving them their own entries would make `validate.py` call a
    #: correctly-read bar long, and would need porting to both sandbox copies
    #: of the checker for a fact that is not about beats at all.
    #:
    #: **They are onsets, though, and dropping them broke takes that were
    #: played perfectly.** The importer used to discard `<grace>` outright, on
    #: the reasoning that it "carries no duration and belongs to the note it
    #: decorates" — true about duration, and the timeline is a list of
    #: *attacks*. Measured on sixteen quarters played exactly on the grid:
    #:
    #:     ornaments   alignment quality   what the musician is told
    #:      4 (appog.)       0.416         a caution, barely above re-record
    #:      6 (appog.)       0.000         15 of 16 notes `severe`
    #:      8 (acciac.)      0.000         alignment failed
    #:
    #: `_initial_ratio` reads the pace off the gaps between detections, so
    #: enough unexplained onsets halve the estimate and the band-constrained
    #: search can no longer contain the true path. The page said the ornaments
    #: were there; only the importer did not.
    #:
    #: Chorded graces count once — a rolled grace chord is one attack — and a
    #: grace before a rest or a cue is dropped, because neither is played.
    grace_notes: int = Field(default=0, ge=0)

    _keep_known_articulation = field_validator("articulation", mode="before")(
        _one_of(_ARTICULATIONS, "articulation")
    )
    _keep_known_dynamics = field_validator("dynamics", mode="before")(
        _one_of(_DYNAMICS, "dynamics")
    )

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


class Tuplet(_Strict):
    """A bracketed group, and the ratio printed over it.

    Modelled per measure over an index range, exactly like `Slur`, rather than
    as a key on every note. Two reasons, and the first is what decided it:

    1. **A per-note key is ambiguous about grouping.** Six consecutive
       `triplet_eighth`s are two groups of three, or one group of six, and a
       flat marking on each note cannot tell them apart. A range can.
    2. Output cost. The prompt is written the way it is because a real page was
       refused for running past the token limit; a key on every note is paid on
       every note, and a range is paid once per bracket.

    `actual_notes` over `normal_notes` is MusicXML's own vocabulary
    (`<time-modification>`), so the file path and the vision path describe a
    tuplet the same way.

    This is a **check**, not a source of durations. The beats still come from
    `duration`. What the ratio adds is the fault the beat sum cannot see: three
    `triplet_eighth`s written where the page brackets a 5:4 quintuplet sum to
    exactly 1.0, the bar adds up, and the reading is silently wrong.
    """

    start_note_index: int = Field(ge=0)
    end_note_index: int = Field(ge=0)
    #: "3" in "3 in the time of 2".
    actual_notes: int = Field(ge=2)
    #: "2" in "3 in the time of 2".
    normal_notes: int = Field(ge=1)

    @field_validator("end_note_index")
    @classmethod
    def _end_after_start(cls, end: int, info) -> int:
        start = info.data.get("start_note_index")
        if start is not None and end < start:
            raise ValueError("tuplet end_note_index must be >= start_note_index")
        return end


class Measure(_Strict):
    measure_number: int = Field(ge=1)
    notes: list[Note] = Field(default_factory=list)
    slurs: list[Slur] = Field(default_factory=list)
    #: Empty for the overwhelming majority of measures, and for every score
    #: written before the field existed — which is why it defaults rather than
    #: being required.
    tuplets: list[Tuplet] = Field(default_factory=list)
    #: The meter, when it *changes* at this measure. Null everywhere else.
    #:
    #: A single time signature for a whole piece is a simplification the
    #: repertoire does not honour, and the cost of it was not a missed check —
    #: it was a false one. Four bars of 3/4 after four of 4/4 had every one of
    #: the 3/4 bars reported as "short", on a page that was written correctly
    #: and read correctly, with a "Fix bar 5" control offered for each. Nothing
    #: teaches a musician to ignore a caveat faster than four wrong ones.
    #:
    #: The onset timeline never cared: it accumulates durations, so where the
    #: barlines fall does not move a note. This exists for the beat check.
    time_signature: str | None = Field(default=None, max_length=20)
    #: How many notes in this measure the reading saw and could not write.
    #:
    #: **Because the bar can now come out looking perfect.** A double accidental,
    #: a triple dot, a quintuplet — the page had a note, this schema has no name
    #: for it, and it is dropped rather than mis-named. Until recently the bar
    #: was then short and the beat check said so. Now an unwritable *tuplet*
    #: keeps its length as rests, so the arithmetic is clean and nothing reaches
    #: the app at all: no concern, no way to open `MeasureEditScreen` on the one
    #: bar that is missing notes.
    #:
    #: `notes_to_human` names the bar, and it is one sentence for the whole
    #: page which no screen can point at a measure. This is the same fact on the
    #: schema the app shares, which is what a per-measure concern needs.
    #:
    #: Defaults to 0, so every score written before it existed reads as a page
    #: with nothing missing — which is the only honest answer for a row that
    #: never recorded it.
    unwritable_notes: int = Field(default=0, ge=0)

    @field_validator("time_signature")
    @classmethod
    def _validate_measure_time_signature(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value == "unknown" or _TIME_SIG_PATTERN.match(value):
            return value
        raise ValueError(
            f"time_signature must be 'N/N' (e.g. '3/4'), 'unknown', or null; got {value!r}"
        )


class TempoChange(_Strict):
    """A marking that says the tempo itself changes: rit., accel., a tempo.

    Not the same thing as `tempo_marking`, which is what the piece is headed
    with. This is the thing that makes a *correct* performance stop matching a
    steady grid — and until it existed the app told a musician who slowed down
    exactly as marked that they had dragged. Measured on eight bars slowing
    60 → 45 BPM over the last four, played as written: *"You dragged across
    measures 5–6 by an average of 24 BPM."*

    **The extent is deliberately not stated.** A `rit.` carries no amount and
    usually no printed end — it runs until "a tempo", or until the phrase does,
    and engravers leave that to the player. Guessing an end in the transcription
    would be inventing something the page does not say. What ends a change is
    the next change, an `a_tempo`, or the music; see `tempo_change_spans`.
    """

    #: Where the marking is printed. A change applies from this measure on.
    measure_number: int = Field(ge=1)
    kind: TempoChangeKind
    #: What is actually printed — "rit.", "poco rall.", "a tempo", "Tempo I".
    #: Carried so a screen can quote the page rather than paraphrase it.
    text: str = Field(min_length=1, max_length=40)


class Repeat(_Strict):
    start_measure: int = Field(ge=1)
    end_measure: int = Field(ge=1)
    type: RepeatType


#: What a stated time signature has to look like: `N/N`.
#:
#: Exported for the same reason `PITCH_PATTERN` is — `musicxml.py` builds one
#: out of two text nodes it did not write, and handing over `four/four`
#: raised `ValidationError` out of the importer, past the `MusicXMLError` the
#: import route catches, and became a 500.
TIME_SIG_PATTERN = re.compile(r"^\d+/\d+$")
_TIME_SIG_PATTERN = TIME_SIG_PATTERN


class ScoreJson(_Strict):
    # `time_signature` and `key_signature` accept the literal string
    # "unknown" (or null) when the score's metadata header is illegible
    # — handwritten manuscripts and tightly-cropped phone photos often
    # cut off the time/key marking. The OCR prompt explicitly authorizes
    # the model to use "unknown" rather than guess.
    time_signature: str | None = Field(default=None, max_length=20)
    key_signature: str | None = Field(default=None, max_length=40)
    tempo_marking: str | None = None
    #: The note value the printed metronome mark counts. `bpm_hint` itself is
    #: always quarter notes per minute because alignment uses quarter-beats;
    #: keeping this lets the interface show the musician the number written on
    #: the page without changing that internal clock. Absent on older scores.
    tempo_beat_unit: Duration | None = None
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

    #: `Bass`, `bass clef` and `BASS` are this schema's `bass`, not
    #: disagreements about the music. A clef it still cannot place becomes
    #: `None` rather than rejecting the score — which is the answer this field
    #: is documented to prefer, and which the pipeline already handles by
    #: trying the next provider instead of losing the page.
    _keep_known_clef = field_validator("clef", mode="before")(_one_of(_CLEFS, "clef"))
    repeats: list[Repeat] = Field(default_factory=list)
    #: Empty for most music and for every score written before the field
    #: existed, which is why it defaults rather than being required.
    tempo_changes: list[TempoChange] = Field(default_factory=list)
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


# --- tuplets ----------------------------------------------------------------
#
# The durations already carry the beats; the ratio is what lets arithmetic
# catch a misread the beat sum cannot see. Three `triplet_eighth`s written where
# the page brackets a 5:4 quintuplet sum to exactly 1.0 — the bar adds up and
# the reading is silently wrong. Stating the ratio makes that answerable.


#: Ratios `Duration` can express. Three in the time of two, and nothing else.
#:
#: A quintuplet, a septuplet or a dotted triplet has no name in `Duration`, so a
#: score claiming one is telling us it holds notes we cannot place. That is
#: worth reporting rather than approximating: `TUPLET_NOTE` in `ocr/validate`
#: is the sentence the model is given about it.
#: Every length, in quarter-beats, that a plain notehead and its dots write —
#: no bracket involved.
#:
#: The triplet names are exactly the complement: they are what a bracket
#: produces and nothing else, which is what makes them evidence.
_WRITTEN_BEATS: frozenset[float] = frozenset(
    round(beats, 6)
    for name, beats in DURATION_BEATS.items()
    if not name.startswith("triplet_")
)

#: The lengths only a bracket can produce.
_TUPLET_ONLY_BEATS: frozenset[float] = (
    frozenset(round(b, 6) for b in DURATION_BEATS.values()) - _WRITTEN_BEATS
)


def untuplets_cleanly(duration: str, actual: int, normal: int) -> bool:
    """Whether this stored duration is what the bracket over it would produce.

    The exact inverse of the arithmetic `musicxml.py` does on the way in: a
    bracket of `actual` in the time of `normal` scales each written value by
    `normal / actual`, so multiplying back by `actual / normal` must land on
    something a notehead writes.

    This replaces a membership test against the four triplet names, which was
    right while three-in-the-time-of-two was the only ratio the importer could
    read. It no longer is — a duplet reads back as a dotted value — and the old
    test called every one of them a fault on a bar just read correctly.
    """
    beats = DURATION_BEATS.get(duration)
    if beats is None or actual <= 0 or normal <= 0:
        return False
    if round(beats * actual / normal, 6) not in _WRITTEN_BEATS:
        return False
    # **A visible ratio must have left a mark, and this one has not.**
    #
    # 3:2 turns written values into lengths no notehead writes, so a note
    # inside a 3:2 bracket that still carries a plain `eighth` is the bracket
    # having been read and its arithmetic not applied — the bar then runs long
    # and this says why. That check is worth keeping and it does not generalise
    # to every ratio: 2:3 and 4:3 scale by a dot, so they map written values
    # onto written values and there is nothing left in the duration to see. For
    # those the bracket and the duration agree in *both* readings, and flagging
    # the ambiguity would flag every correctly-read duplet on the page.
    return not (
        _ratio_leaves_a_mark(actual, normal) and round(beats, 6) in _WRITTEN_BEATS
    )


def _ratio_leaves_a_mark(actual: int, normal: int) -> bool:
    """Whether this ratio can turn a written value into one only it produces."""
    return any(
        round(beats * normal / actual, 6) in _TUPLET_ONLY_BEATS
        for beats in _WRITTEN_BEATS
    )


def tuplet_ratio_is_writable(actual: int, normal: int) -> bool:
    """Whether *any* written value survives this ratio with a name.

    A coarse gate in front of the per-note check, and it has to stay coarse:
    what a bracket is worth depends on the value under it, so the ratio alone
    can only say that nothing at all fits. 5:4 is the ordinary ratio that does
    not — a fifth of a beat has no notehead — and it is why the gate exists.
    """
    nameable = _WRITTEN_BEATS | _TUPLET_ONLY_BEATS
    return any(
        round(beats * normal / actual, 6) in nameable for beats in _WRITTEN_BEATS
    )


@dataclass(frozen=True)
class TupletFault:
    """A bracketed group whose contents contradict the ratio printed over it."""

    measure_number: int
    start_note_index: int
    actual_notes: int
    normal_notes: int
    reason: Literal["count", "unwritable", "range", "durations"]
    detail: str

    def describe(self) -> str:
        return (
            f"measure {self.measure_number}: the {self.actual_notes}:"
            f"{self.normal_notes} group starting at note "
            f"{self.start_note_index} {self.detail}"
        )


def tuplet_faults(measures: Sequence[Measure]) -> list[TupletFault]:
    """Every bracketed group that does not match what it says it is."""
    out: list[TupletFault] = []

    for measure in measures:
        for tuplet in measure.tuplets:
            ratio = (tuplet.actual_notes, tuplet.normal_notes)
            common = dict(
                measure_number=measure.measure_number,
                start_note_index=tuplet.start_note_index,
                actual_notes=tuplet.actual_notes,
                normal_notes=tuplet.normal_notes,
            )

            if tuplet.end_note_index >= len(measure.notes):
                out.append(
                    TupletFault(
                        **common,
                        reason="range",
                        detail=(
                            f"runs to note {tuplet.end_note_index}, but the measure "
                            f"has {len(measure.notes)}"
                        ),
                    )
                )
                continue

            counted = tuplet.end_note_index - tuplet.start_note_index + 1
            if counted != tuplet.actual_notes:
                out.append(
                    TupletFault(
                        **common,
                        reason="count",
                        detail=(
                            f"holds {counted} note{'' if counted == 1 else 's'}, "
                            f"not {tuplet.actual_notes}"
                        ),
                    )
                )
                continue

            if not tuplet_ratio_is_writable(*ratio):
                out.append(
                    TupletFault(
                        **common,
                        reason="unwritable",
                        detail=(
                            "is a ratio these durations cannot express — no "
                            "written value survives it with a name"
                        ),
                    )
                )
                continue

            wrong = [
                note.duration
                for note in measure.notes[
                    tuplet.start_note_index : tuplet.end_note_index + 1
                ]
                if not untuplets_cleanly(note.duration, *ratio)
            ]
            if wrong:
                out.append(
                    TupletFault(
                        **common,
                        reason="durations",
                        detail=(
                            "contains "
                            + ", ".join(sorted(set(wrong)))
                            + f", which are not {ratio[0]}:{ratio[1]} values"
                        ),
                    )
                )

    return out


def clear_unwritable_where_rewritten(
    incoming: "ScoreJson", stored: Mapping[str, Any] | None
) -> "ScoreJson":
    """Drop `unwritable_notes` from every measure a person has just rewritten.

    **Because a caveat nobody can clear is worse than no caveat.** The count
    records what the *reading* lost, and the app shows it as a concern with a
    control that opens the bar for editing. `MeasureEditScreen` spreads the
    measure it saves — deliberately, so fields it does not know about survive —
    so the count came straight back, and the bar a musician had just repaired
    kept telling them it was broken. Nothing teaches someone to ignore a caveat
    faster than one that will not go away.

    A measure counts as rewritten when its notes differ from the stored ones,
    by pitch and duration in order — which is exactly what adding a missing
    note changes, and what renaming a piece or fixing a slur does not. A
    measure number with no stored counterpart is new, and a bar that did not
    exist when the page was read cannot carry what the reading lost.

    Stored measures are matched by `measure_number` rather than position: a bar
    inserted in the middle shifts every index after it, and clearing the wrong
    bar's count is the same class of mistake as naming the wrong bar in
    `notes_to_human`, which this project has already made once.
    """
    if not any(m.unwritable_notes for m in incoming.measures):
        return incoming
    was: dict[int, tuple] = {}
    for raw in (stored or {}).get("measures") or []:
        try:
            number = int(raw["measure_number"])
        except (KeyError, TypeError, ValueError):
            continue
        was[number] = tuple(
            (note.get("pitch"), note.get("duration"))
            for note in raw.get("notes") or []
            if isinstance(note, Mapping)
        )
    measures = [
        measure
        if not measure.unwritable_notes
        or was.get(measure.measure_number)
        == tuple((n.pitch, n.duration) for n in measure.notes)
        else measure.model_copy(update={"unwritable_notes": 0})
        for measure in incoming.measures
    ]
    return incoming.model_copy(update={"measures": measures})


@dataclass(frozen=True)
class TempoSpan:
    """Measures over which a written tempo change is in force."""

    start_measure: int
    #: Inclusive. The last measure the change covers.
    end_measure: int
    kind: TempoChangeKind
    text: str


def tempo_change_spans(score: ScoreJson) -> list[TempoSpan]:
    """Where each written tempo change starts and stops applying.

    A `rit.` has no printed end. What stops it is the next marking — an
    `a_tempo`, or another change — and failing that, the music. So the extent
    is derived here rather than transcribed, and an `a_tempo` produces no span
    of its own: its whole job is to end the one before it.

    Ordered by measure and tolerant of markings that arrive out of order, since
    a model reading a page column by column can emit them that way.
    """
    changes = sorted(score.tempo_changes, key=lambda c: c.measure_number)
    last_measure = max(
        (m.measure_number for m in score.measures), default=0
    )
    spans: list[TempoSpan] = []
    for index, change in enumerate(changes):
        if change.kind == "a_tempo":
            continue
        following = next(
            (c.measure_number for c in changes[index + 1 :]
             if c.measure_number > change.measure_number),
            None,
        )
        # Up to the measure before the next marking, or to the end of the page.
        end = (following - 1) if following is not None else last_measure
        if end >= change.measure_number:
            spans.append(
                TempoSpan(
                    start_measure=change.measure_number,
                    end_measure=end,
                    kind=change.kind,
                    text=change.text,
                )
            )
    return spans


def measures_under_tempo_change(score: ScoreJson) -> set[int]:
    """Every measure a written tempo change covers, as measure numbers."""
    covered: set[int] = set()
    for span in tempo_change_spans(score):
        covered.update(range(span.start_measure, span.end_measure + 1))
    return covered
