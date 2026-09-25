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

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

log = logging.getLogger("intempo.score")

# Closed enums per spec §6.
Clef = Literal["treble", "bass", "alto", "tenor"]
Articulation = Literal["staccato", "tenuto", "accent"]
#: A hairpin, or its written-out word: the level moves from this note on.
Hairpin = Literal["crescendo", "diminuendo"]
Dynamics = Literal[
    "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff",
    "fp", "sfz", "sf", "fz",
]
RepeatType = Literal["repeat", "first_ending", "second_ending"]
#: `a_tempo` covers "a tempo", "Tempo I" and "tempo primo" — anything whose
#: job is to end a change rather than start one.
TempoChangeKind = Literal["ritardando", "accelerando", "a_tempo", "new_tempo"]

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
    "sixty_fourth", "dotted_sixty_fourth",
    # **One level finer than each family reached before**, which is the whole
    # rule. `tools/notation-coverage.py` prints every written value against dots
    # and the common ratios, and these were the gaps in it that real music
    # actually contains: a run of 128ths in a cadenza, a dotted 64th in an
    # ornamental figure, thirty-second triplets in fast passagework, and
    # whole-note triplets in a slow metre.
    #
    # A note with no name here is **dropped**, and a dropped note is a lost
    # onset that `alignment.py` accumulates into every bar after it — so the
    # cost of a gap is not the note, it is the rest of the page.
    #
    # **What is deliberately still missing**, and it is 31 more values: the
    # exotic corners of the same cross-product — `septuplet_dotted_breve`,
    # `quintuplet_dotted_sixteenth` and the like. They are not music. This is a
    # closed union shared with the app, so every name costs a widening on both
    # sides; adding them all would more than double it to describe figures no
    # part contains. The coverage tool prints them as missing on every run, so
    # the day one turns up it is one line and a measurement, not a discovery.
    "one_twenty_eighth",
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
    "triplet_breve", "triplet_whole", "triplet_half", "triplet_quarter",
    "triplet_eighth", "triplet_sixteenth", "triplet_thirty_second",
    "triplet_sixty_fourth", "triplet_one_twenty_eighth",
    # Quintuplets and septuplets, on exactly the argument that added the
    # triplets above — and they cost more than the triplets did, because of
    # what the importer does when it cannot name a group.
    #
    # A note with no name is not dropped any more: `_unnameable_tuplet_beats`
    # keeps the *group's* length and writes it as rests, so the bar still adds
    # up. That is the right trade when the alternative is moving every later
    # bar, and it means the failure is now completely silent to the beat check.
    # Measured on a 4/4 bar of a 5:4 quintuplet of sixteenths and three
    # quarters, read correctly off the page:
    #
    #     onsets in the transcription   3 of 8
    #     beat-sum verdict              ok, 4.0 of 4.0
    #     the only trace                unwritable_notes = 5
    #
    # Five attacks the musician plays are silence in the expected timeline, and
    # `alignment.py` matches detections against that timeline — so a passage
    # played correctly is scored against a bar that says nothing happens there.
    # The septuplet case is the same with seven.
    #
    # 5:4 and 7:4 are the ratios an engraver actually writes, and they are the
    # two the gate in `tuplet_ratio_is_writable` was documented to refuse. Each
    # name here is a *length*, exactly as `triplet_eighth` is: it is what the
    # base value becomes under the bracket, which is why 7:8 eighths need no
    # name of their own — they land on `septuplet_quarter`'s 4/7 and the
    # beats-to-name lookup finds them. What still has no name is a ratio landing
    # on none of these values at all (5:6 in compound metre, a triplet of
    # thirty-seconds), and those still keep their length as rests.
    #
    # Fifths and sevenths are not exactly representable in binary. Every
    # comparison downstream already carries `validate.TOLERANCE`, and the sums
    # are checked exhaustively rather than assumed — see
    # `test_duration_beats.py`.
    "quintuplet_half", "quintuplet_quarter",
    "quintuplet_breve", "quintuplet_whole",
    "quintuplet_eighth", "quintuplet_sixteenth", "quintuplet_thirty_second",
    "quintuplet_sixty_fourth", "quintuplet_one_twenty_eighth",
    "septuplet_half", "septuplet_quarter",
    "septuplet_breve", "septuplet_whole",
    "septuplet_eighth", "septuplet_sixteenth", "septuplet_thirty_second",
    "septuplet_sixty_fourth", "septuplet_one_twenty_eighth",
]

#: The names a bracket produces and a plain notehead never does.
#:
#: `_WRITTEN_BEATS` used to be spelled "every name that does not start with
#: `triplet_`", which was correct while triplets were the only tuplet in the
#: schema and silently wrong the moment they were not: a `quintuplet_eighth`
#: would have been filed as a value an engraver writes, and
#: `untuplets_cleanly` — which asks whether a stored duration is what the
#: bracket over it would produce — would have called a correctly-read
#: quintuplet a fault. Named here so that adding a tuplet is one edit.
TUPLET_PREFIXES: tuple[str, ...] = ("triplet_", "quintuplet_", "septuplet_")

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
    "dotted_sixty_fourth": 0.09375,
    "one_twenty_eighth": 0.03125,
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
    "triplet_breve": 16.0 / 3.0,
    "triplet_one_twenty_eighth": 1.0 / 48.0,
    "triplet_thirty_second": 1.0 / 12.0,
    "triplet_sixty_fourth": 1.0 / 24.0,
    # Three whole notes in the time of two: two bars of slow 4/4, and ordinary
    # in a Adagio. `triplet_half` was already here; this is its parent.
    "triplet_whole": 8.0 / 3.0,
    # Five in the time of four, and seven in the time of four: the written
    # value scaled by normal/actual, which is the same arithmetic the triplets
    # above are and the same arithmetic `musicxml._duration_name` does on the
    # way in. A half is 2 beats, so a quintuplet half is 2 × 4/5 = 8/5.
    #
    # Written as a single division of two exact integers, in this order, on
    # both sides. `test_client_enums` compares these against the app's table to
    # 1e-12 and evaluates the app's arithmetic literally, so `8 / 5` and
    # `2 * 4 / 5` agreeing is a fact about these particular numbers rather than
    # a rule — reduced fractions make the two files the same expression.
    "quintuplet_half": 8.0 / 5.0,
    "quintuplet_quarter": 4.0 / 5.0,
    "quintuplet_eighth": 2.0 / 5.0,
    "quintuplet_sixteenth": 1.0 / 5.0,
    "quintuplet_breve": 32.0 / 5.0,
    "quintuplet_whole": 16.0 / 5.0,
    "quintuplet_sixty_fourth": 1.0 / 20.0,
    "quintuplet_one_twenty_eighth": 1.0 / 40.0,
    "quintuplet_thirty_second": 1.0 / 10.0,
    "septuplet_half": 8.0 / 7.0,
    "septuplet_quarter": 4.0 / 7.0,
    "septuplet_eighth": 2.0 / 7.0,
    "septuplet_sixteenth": 1.0 / 7.0,
    "septuplet_breve": 32.0 / 7.0,
    "septuplet_whole": 16.0 / 7.0,
    "septuplet_sixty_fourth": 1.0 / 28.0,
    "septuplet_one_twenty_eighth": 1.0 / 56.0,
    "septuplet_thirty_second": 1.0 / 14.0,
}

# Pitch: "rest" or scientific-pitch like "C4", "F#3", "Bb2", "F##4", "Bbb3".
#: What `Note.pitch` accepts: `rest`, or a step A–G with an optional accidental
#: — single or **double** — and one octave digit.
#:
#: **Double accidentals were outside the grammar, and the note was dropped.**
#: `_pitch_name` said so in as many words: "Naming the natural instead would be
#: a wrong note, so drop it and let the note count fall short, which the
#: validator can see." Both halves of that were true and the choice was still
#: between two damaging options, because a dropped note is not a quiet loss —
#: it is a **lost onset**, and `alignment.py` accumulates durations, so every
#: bar after it is judged against music that is not there. A double sharp is
#: ordinary in the repertoire this app is for: any chromatic passage in a sharp
#: key writes them, and Kreutzer, Bach and Paganini are full of them.
#:
#: Widening the grammar removes the choice rather than picking a side.
#: `##` and `bb` are matched **before** `#` and `b` — a regex alternation takes
#: the first branch that matches, so the single-accidental branch first would
#: match `F#` out of `F##4` and leave `#4` unconsumed, failing the anchor and
#: dropping exactly the note this exists to keep.
#:
#: Exported so `musicxml.py` can ask the same question before it builds a note
#: rather than after. It used to hand over whatever the file said and let the
#: model reject it — which raised `ValidationError` out of the importer, past
#: the `MusicXMLError` the import route catches, and turned a file with one bad
#: notehead into a 500. See `_pitch_name`.
PITCH_PATTERN = re.compile(r"^(?:rest|[A-G](?:##|bb|#|b)?-?\d)$")
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


def hairpin_from_text(text: str) -> Hairpin | None:
    """`crescendo` or `diminuendo` for a hairpin's name or its printed word.

    "cresc.", "poco a poco cresc.", "crescendo" → crescendo; "dim.", "dimin.",
    "decresc.", "diminuendo", "decrescendo" → diminuendo; anything else, None.
    """
    words = _tidy(text).replace("_", " ").split()
    for word in words:
        if word.startswith("decresc") or word.startswith("dim"):
            return "diminuendo"
        if word.startswith("cresc"):
            return "crescendo"
    return None


#: The longest ornament whose notes are kept by name. A written-out run of
#: more than this is not a grace; see `Note.grace_pitches`.
_MAX_GRACE_PITCHES = 16
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
    #: The other noteheads struck together with this one, lowest first.
    #:
    #: **Additive, and deliberately not part of the timeline.** `pitch` stays
    #: the single pitch it always was and `duration` still governs when the next
    #: note starts, so `alignment.py` is untouched: a chord is one attack, which
    #: is why the importer counts only its first note and must keep doing so.
    #:
    #: What this adds is the part that was simply lost. A double stop is two
    #: noteheads on the page and the reading kept one, so any stave drawn from
    #: it shows a single note where the music has two, and `MeasureEditScreen`
    #: cannot express the fix because there is nowhere to put the second pitch.
    #: For a violin part that is a Bach chaconne rendered wrong; for a corrected
    #: reading kept as training data it is a wrong label.
    #:
    #: Empty for the overwhelming majority of notes and for every score written
    #: before the field existed, which is why it defaults rather than being
    #: required. A rest never has any.
    chord_pitches: list[str] = Field(default_factory=list)
    #: A crescendo or diminuendo — hairpin or the word — begins at this note.
    #:
    #: **Playback only, like `dynamics`.** The level ramps from the dynamic in
    #: force here to the next one written, reached at the note marked
    #: `hairpin_end` or, without one, at the next dynamic or hairpin. Nothing
    #: in the timing analysis reads it.
    hairpin: Hairpin | None = None
    #: The hairpin running into this note ends on it.
    hairpin_end: bool = False
    #: The grace notes' pitches, in the order they are played, one per attack.
    #:
    #: **Beside `grace_notes`, not instead of it.** The count is what the
    #: timeline uses, and a reader that knows how many ornaments there are but
    #: not which notes they are still gives the alignment everything it needs.
    #: The pitches are for playing them: Listen leaves an ornament out rather
    #: than guess its note, so without these it plays none.
    grace_pitches: list[str] = Field(default_factory=list)

    @field_validator("grace_pitches", mode="before")
    @classmethod
    def _keep_playable_grace_pitches(cls, values: Any) -> Any:
        # Dropped, not refused: an ornament's pitch is only ever played, and a
        # page must never be lost to one — the argument `_one_of` makes. That
        # includes a run longer than any ornament, which a hostile file can
        # write two thousand of: its count stands and its names go.
        if not isinstance(values, list) or len(values) > _MAX_GRACE_PITCHES:
            return []
        return [
            value
            for value in values
            if isinstance(value, str) and value != "rest" and _PITCH_PATTERN.match(value)
        ]

    @model_validator(mode="after")
    def _grace_count_covers_its_pitches(self) -> "Note":
        # Every named ornament is an attack, so the count is never below the
        # names. More attacks than names is allowed: some pitches unknown.
        if len(self.grace_pitches) > self.grace_notes:
            self.grace_notes = len(self.grace_pitches)
        return self

    @field_validator("chord_pitches")
    @classmethod
    def _validate_chord_pitches(cls, values: list[str]) -> list[str]:
        for value in values:
            # `rest` is a legal `pitch` and never a legal chord member: silence
            # does not sound with a note, and a "rest" here would draw a
            # notehead for nothing.
            if value == "rest" or not _PITCH_PATTERN.match(value):
                raise ValueError(
                    "chord_pitches must be scientific-pitch (e.g. 'D3', 'F#4'); "
                    f"got {value!r}"
                )
        return values

    _keep_known_articulation = field_validator("articulation", mode="before")(
        _one_of(_ARTICULATIONS, "articulation")
    )
    _keep_known_dynamics = field_validator("dynamics", mode="before")(
        _one_of(_DYNAMICS, "dynamics")
    )

    @field_validator("hairpin", mode="before")
    @classmethod
    def _read_hairpin(cls, value: Any) -> Any:
        # The words as printed, not only the names: "cresc.", "dim." and
        # "decresc." are how a page writes a hairpin it has no room to draw.
        # Anything else is dropped, never refused — see `_one_of`.
        return hairpin_from_text(value) if isinstance(value, str) else None

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
    #: Which staff system on the page this bar was printed on, from 0.
    #:
    #: **Where the bar is, so a re-read can be asked about the right piece of
    #: paper.** `OCR_CORRECTOR` sends the bars that do not add up back to a
    #: model, and sending the whole page with "look at bar 14" asks it to count
    #: to fourteen on a photograph — which it can get wrong in a way nothing
    #: downstream detects, because a wrong bar that happens to add up passes
    #: every guard there is. With this, the crop it is shown contains the bar
    #: and little else.
    #:
    #: Null whenever the file does not say, which is most of the time: it comes
    #: from `<print new-system="yes">`, and an engraver's export usually omits
    #: it. Null is not "system 0" and must never be defaulted to one — the whole
    #: point is knowing when the position is unknown, and a wrong crop is worse
    #: than no crop. Same rule as `ScoreJson.clef` and `users.instrument`.
    #:
    #: Additive, so an app that has never heard of it is unaffected.
    system: int | None = Field(default=None, ge=0)
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
    #: The clef, when it *changes* at this measure. Null everywhere else.
    #:
    #: Exactly the shape `time_signature` above has, for exactly the same
    #: reason. A single clef for a whole piece is a simplification the
    #: repertoire does not honour: a cello or bass part moving into tenor or
    #: treble for a high passage and back again is ordinary writing, not an edge
    #: case, and `ScoreJson.clef` has nowhere to put the second one.
    #:
    #: The cost of not having it is the same cost `ScoreJson.clef` being
    #: defaulted would have — every notehead after the change drawn at the wrong
    #: staff position, captioned with a clef the page stopped using. The onset
    #: timeline never cared, because `alignment.py` reads pitch only to ask
    #: whether a note is a rest.
    #:
    #: `_one_of` rather than a bare `Clef`, matching `ScoreJson.clef`: a clef
    #: this schema cannot place becomes null — "no change here" — rather than
    #: costing the page. Wrong in the direction that loses a caption, never in
    #: the direction that invents one.
    clef: Clef | None = None
    #: The key, when it *changes* at this measure. Null everywhere else.
    #:
    #: The third field of this shape, after `time_signature` and `clef`, and
    #: the same rule: a fact printed on one bar that holds until the next one
    #: is printed. `ScoreJson.key_signature` stays the key the page **opens**
    #: in.
    #:
    #: Until this existed the importer read the first `<key>` and discarded
    #: every later one — so a part that moves from B-flat to G at bar 7 (the
    #: real phone photograph in `fixtures/musicxml/audiveris_phone_photo`) was
    #: engraved with two flats on every system to the end, and every F sharp
    #: after the change printed as an inline sharp against a signature that no
    #: longer applied. The timeline never cared; the *page* was wrong, and it
    #: was wrong in the way that matters most — a musician reading from it
    #: plays the wrong notes.
    #:
    #: The name as printed, `G major` / `E minor`, the same grammar as the
    #: header. Compared by signature rather than by name wherever a change is
    #: detected: `Bb major` and `G minor` print the same two flats, and a mode
    #: that changes with the signature unchanged is not a change on the page.
    key_signature: str | None = Field(default=None, max_length=40)
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

    _keep_known_measure_clef = field_validator("clef", mode="before")(
        _one_of(_CLEFS, "clef")
    )

    @field_validator("key_signature")
    @classmethod
    def _validate_measure_key_signature(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.strip():
            raise ValueError("key_signature must be non-empty when provided")
        return value

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
    #: For `new_tempo` — "più mosso", "meno mosso", a new metronome mark — the
    #: tempo it sets, in quarter notes per minute, **in the terms of the
    #: piece's own marked tempo** (`bpm_hint`): a take practised at half the
    #: marked tempo plays the new section at half of this too
    #: (`targets_by_measure`). Absolute where the piece has no marked tempo.
    #:
    #: None where the page says "slower" without saying how much: those bars
    #: are then not judged at all, as a `rit.`'s are, because there is no
    #: number to be a distance from. Ignored for every other kind.
    bpm: float | None = Field(default=None, gt=0, le=400)


class Repeat(_Strict):
    start_measure: int = Field(ge=1)
    end_measure: int = Field(ge=1)
    type: RepeatType
    #: True when no forward sign was printed and the opening was inferred.
    #:
    #: **The page-break repeat, which used to be read from the wrong bar.**
    #: Most pieces that repeat their opening print no `|:` at all, so a
    #: backward sign with nothing to pair it with falls back to the start of
    #: what was read — right for a piece, wrong for a *page*. Read alone, page
    #: 3 of a part reports a repeat starting at page 3's first bar; the truth
    #: may be a `|:` printed on page 1.
    #:
    #: `join_pages` needs to tell those two apart, and only the importer knows
    #: which it was. False here means a forward sign was actually printed, and
    #: that repeat is correct as it stands even when it opens on a page's first
    #: bar — which is a real section boundary in a lot of music, and the reason
    #: dropping such repeats wholesale was the wrong fix.
    #:
    #: Defaults False, so every score written before this reads back as "the
    #: opening was printed" — the assumption that leaves them exactly as they
    #: were.
    start_inferred: bool = False


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
    #: Forward repeat signs still open where this page's music stopped.
    #:
    #: **A page is not a piece, and this is the half of that which used to be
    #: thrown away.** A `|:` printed on page 1 and closed on page 3 is invisible
    #: to an importer reading page 1 alone: the sign opens, nothing closes it,
    #: and the reader discarded it. `join_pages` can pair it with the closing
    #: sign on a later page, but only if the earlier page says it is there.
    #:
    #: A list rather than one value, because the importer already keeps a stack
    #: — nested `|:` is legal — and carrying only the innermost would lose the
    #: rest silently, which is the failure being fixed one level down.
    #:
    #: Measure numbers, like every other span here. Cleared by `join_pages` on
    #: its output: a sign still open at the end of the *last* page is genuinely
    #: unclosed and there is nothing left to pair it with.
    unclosed_repeat_starts: list[int] = Field(default_factory=list)
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


#: Ratios `Duration` can express: 3:2, 5:4 and 7:4, plus every ratio that maps a
#: written value onto another written value (2:3, 4:3, 6:4).
#:
#: What remains unnameable is a ratio that lands on none of those lengths — 5:6
#: in a compound metre, a triplet of thirty-seconds. A score claiming one is
#: telling us it holds notes we cannot place, which is worth reporting rather
#: than approximating: `TUPLET_NOTE` in `ocr/validate` is the sentence the model
#: is given about it.
#: Every length, in quarter-beats, that a plain notehead and its dots write —
#: no bracket involved.
#:
#: The tuplet names are exactly the complement: they are what a bracket
#: produces and nothing else, which is what makes them evidence.
_WRITTEN_BEATS: frozenset[float] = frozenset(
    round(beats, 6)
    for name, beats in DURATION_BEATS.items()
    if not name.startswith(TUPLET_PREFIXES)
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
    can only say that nothing at all fits.

    5:4 used to be the ordinary ratio that did not fit, and was the reason the
    gate was written. It fits now — `Duration` names quintuplets and septuplets
    — so what this refuses is narrower than it was: a ratio landing on no named
    length at all, such as 5:6 in a compound metre. The gate is still worth
    having for exactly the reason it always was, since a ratio that fits nothing
    would otherwise be approximated silently.
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
        # A step to a stated tempo is judged against that tempo
        # (`targets_by_measure`), not left unjudged; and `a_tempo` only ends.
        if change.kind == "a_tempo" or (change.kind == "new_tempo" and change.bpm):
            continue
        # The next marking in order ends this one, even one printed in the same
        # bar: that is how a passage take carries the markings before its entry
        # bar (`start_at`), all stamped on the entry bar in the order printed,
        # and a `rit.` the page had already ended must not run on from there.
        following = (
            changes[index + 1].measure_number if index + 1 < len(changes) else None
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


#: "Tempo I", "Tempo primo", "1o Tempo": back to the opening, not one step back.
_TEMPO_PRIMO = re.compile(r"\b(tempo\s*(i|1|primo|1o|1º)|1\s*[oº°]?\s*tempo|primo\s+tempo)\b", re.I)


def tempo_in_force(score: ScoreJson) -> dict[int, float | None]:
    """The stated tempo each measure is played at, in the piece's own terms.

    None is the piece's opening tempo — whatever the musician chose to take it
    at. A number is a `new_tempo`'s stated BPM (see `TempoChange.bpm`).

    **A change remembers what it changed from**, because that is what "a
    tempo" returns to: after a `rit.`, the tempo before the `rit.`; after a
    "meno mosso", the tempo before that; after a `rit.` inside a meno mosso,
    the meno mosso. So each marking pushes the tempo it leaves, and `a_tempo`
    pops one. "Tempo I" is the exception the name states, and goes back to
    the opening. A gradual change leaves the stated tempo where it was: the
    bars under it are not judged against a number at all
    (`measures_under_tempo_change`).
    """
    by_measure: dict[int, list[TempoChange]] = {}
    for change in score.tempo_changes:
        by_measure.setdefault(change.measure_number, []).append(change)

    current: float | None = None
    left: list[float | None] = []
    out: dict[int, float | None] = {}
    for measure in sorted({m.measure_number for m in score.measures}):
        for change in by_measure.get(measure, []):
            if change.kind == "a_tempo":
                if _TEMPO_PRIMO.search(change.text):
                    current, left = None, []
                else:
                    current = left.pop() if left else None
                continue
            left.append(current)
            if change.kind == "new_tempo" and change.bpm:
                current = float(change.bpm)
        out[measure] = current
    return out


def targets_by_measure(score: ScoreJson, target_bpm: float) -> dict[int, float]:
    """The tempo each measure is judged against, for a take at `target_bpm`.

    `target_bpm` is what the musician chose for the opening. A stated tempo
    change scales with it — a meno mosso marked 88 in a piece marked 104,
    practised at 52, is played at 44 — through the piece's marked tempo
    (`bpm_hint`); a piece with none takes the stated number as it stands.
    """
    reference = float(score.bpm_hint) if score.bpm_hint else target_bpm
    scale = target_bpm / reference if reference > 0 else 1.0
    return {
        measure: target_bpm if stated is None else stated * scale
        for measure, stated in tempo_in_force(score).items()
    }
