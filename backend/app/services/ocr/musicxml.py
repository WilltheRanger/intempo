"""MusicXML → `ScoreJson`.

Every real OMR engine — Audiveris, oemer, homr — emits MusicXML. Nothing here
knows or cares which one produced it, which is the point: the engine is a
subprocess that can be swapped, and this is the only place that has to
understand its output.

**Lossy on purpose.** MusicXML describes far more than `ScoreJson` holds, and
the excess is not needed: `alignment.py` reads `note.pitch` in exactly one place,
to ask whether a note is a rest, and builds its whole timeline from durations.
So beams, stem directions, voices, lyrics, layout and page geometry are dropped
without ceremony. What is kept is what the product consumes.

Read `<type>` for durations, not `<duration>`. The latter is in divisions —
an arbitrary per-file tick unit — so a half note is "24" in one file and "480"
in the next, and reconstructing a name from it means dividing by a quarter-note
count that a damaged file may not carry. `<type>` says "half".
"""

from __future__ import annotations

from itertools import pairwise

import re
import xml.etree.ElementTree as ET

from defusedxml.ElementTree import fromstring as defused_fromstring
from defusedxml.common import DefusedXmlException
from collections.abc import Callable
from typing import Final

from app.services.ocr.meter import quarter_beats
from app.services.ocr.validate import infer_beats_per_measure
from app.services.tempo_words import tempo_word
from app.services.score_schema import (
    DURATION_BEATS,
    PITCH_PATTERN,
    TIME_SIG_PATTERN,
    Measure,
    Note,
    Repeat,
    ScoreJson,
    Slur,
    TempoChange,
    Tuplet,
    hairpin_from_text,
)

# MusicXML type names → ours. `long` and `maxima` are still absent, and a piece
# of string music that needs them is outside what this product reads; `breve`
# and `64th` are not, and used to be dropped along with them.
_TYPE_TO_DURATION: Final[dict[str, str]] = {
    "breve": "double_whole",
    "whole": "whole",
    "half": "half",
    "quarter": "quarter",
    "eighth": "eighth",
    "16th": "sixteenth",
    "32nd": "thirty_second",
    "64th": "sixty_fourth",
    # **A 128th is the finest value a part actually prints**, and it was not
    # here, so every one of them was dropped — a lost onset, which
    # `alignment.py` accumulates into every bar that follows. Cadenzas and
    # ornamental runs write them.
    #
    # `256th` and finer are deliberately absent: they exist in the MusicXML
    # vocabulary and not in the repertoire this reads. `tools/notation-coverage.py`
    # prints them as missing on every run, so the day one turns up it is a line
    # here and a name in `DURATION_BEATS`, not a discovery.
    "128th": "one_twenty_eighth",
}
#: Three in the time of two, by base value. A file states a tuplet in
#: `<time-modification>` — `actual-notes` over `normal-notes` — so a triplet is
#: read rather than inferred from the beam.
#: What each number of dots multiplies a written value by.
#:
#: A dot adds half, a second dot half of that again. Indexed rather than
#: computed so that "how many dots have a meaning here" is one readable fact:
#: a triple dot is genuinely rare and has no name in `Duration` on its own.
_DOT_FACTOR: Final[tuple[float, ...]] = (1.0, 1.5, 1.75)

#: Every written value by its length in quarter-beats, triplets included.
#:
#: Deliberately **not** `_DURATION_BY_BEATS`, which excludes the triplet names
#: because it answers a different question: there, a note contradicts itself and
#: nothing on the page mentions a bracket, so resolving to a triplet would be a
#: claim about a mark the file never drew. Here the file has drawn exactly that
#: mark, and the triplet names are the answer rather than a guess.
_DURATION_BY_TUPLET_BEATS: Final[dict[float, str]] = {
    round(beats, 6): name for name, beats in DURATION_BEATS.items()
}
_DOTTED: Final[dict[str, str]] = {
    "whole": "dotted_whole",
    "half": "dotted_half",
    "quarter": "dotted_quarter",
    "eighth": "dotted_eighth",
    "sixteenth": "dotted_sixteenth",
    "thirty_second": "dotted_thirty_second",
}
#: A second dot adds half the first again: base × 1.75.
_DOUBLE_DOTTED: Final[dict[str, str]] = {
    "half": "double_dotted_half",
    "quarter": "double_dotted_quarter",
    "eighth": "double_dotted_eighth",
}

# `<clef>` gives a sign and the staff line it sits on. Sign alone is ambiguous:
# a C clef on line 3 is alto and on line 4 is tenor, and a cellist reads both.
_CLEF_BY_SIGN_LINE: Final[dict[tuple[str, str], str]] = {
    ("G", "2"): "treble",
    ("F", "4"): "bass",
    ("F", "3"): "bass",      # baritone F clef; nothing downstream distinguishes it
    ("C", "3"): "alto",
    ("C", "4"): "tenor",
}

_SHARP_KEYS: Final[list[str]] = [
    "C major", "G major", "D major", "A major",
    "E major", "B major", "F# major", "C# major",
]
_FLAT_KEYS: Final[list[str]] = [
    "C major", "F major", "Bb major", "Eb major",
    "Ab major", "Db major", "Gb major", "Cb major",
]

#: How a `<alter>` value is spelled in a pitch name.
#:
#: ±2 are double accidentals. They were absent, so `_pitch_name` returned
#: None for them and the note was dropped — see `PITCH_PATTERN`, which now
#: admits them. Anything beyond ±2 (a triple accidental, or a quarter-tone
#: written as `alter="0.5"`) is still None: those have no spelling here and
#: inventing one would be the wrong-note outcome this avoids.
_ALTER_SUFFIX: Final[dict[int, str]] = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}

_ARTICULATION_TAGS: Final[dict[str, str]] = {
    "staccato": "staccato",
    "tenuto": "tenuto",
    "accent": "accent",
}

_DYNAMIC_TAGS: Final[frozenset[str]] = frozenset(
    {"ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "fp", "sfz", "sf", "fz"}
)


class MusicXMLError(ValueError):
    """The document is not MusicXML this can read."""


def _text(node: ET.Element | None) -> str | None:
    if node is None or node.text is None:
        return None
    stripped = node.text.strip()
    return stripped or None


def _strip_namespace(root: ET.Element) -> None:
    """Drop namespaces in place.

    MusicXML is usually served bare, but a compressed .mxl unpacked by some
    tools carries one, and every `find()` below would silently return None —
    producing an empty score rather than an error, which is the worst possible
    failure for a transcription.
    """
    for element in root.iter():
        if "}" in element.tag:
            element.tag = element.tag.split("}", 1)[1]


def _tuplet_ratio(note: ET.Element) -> tuple[int, int] | None:
    """The ratio printed over the bracket, as `<time-modification>` states it.

    Read separately from `_duration_name`, which consumes the same element and
    throws the ratio away once it has picked a duration. The ratio is what lets
    the beat sum be checked against what the page *says*: three triplet eighths
    written for a bracketed 5 sum to exactly one beat, and only the stated
    ratio can tell anyone the approximation happened.
    """
    actual = _text(note.find("time-modification/actual-notes"))
    normal = _text(note.find("time-modification/normal-notes"))
    if actual is None or normal is None:
        return None
    try:
        pair = (int(actual), int(normal))
    except ValueError:
        return None
    return pair if pair[0] > 1 else None


#: A written duration, by its length in quarter-beats.
#:
#: Only the plain and dotted values — a contradiction is resolved to something
#: an engraver would print, never to a triplet, which would be a claim about a
#: bracket the file did not draw.
_DURATION_BY_BEATS: Final[dict[float, str]] = {
    8.0: "double_whole",
    6.0: "dotted_whole",
    4.0: "whole",
    3.0: "dotted_half",
    2.0: "half",
    1.5: "dotted_quarter",
    1.0: "quarter",
    0.75: "dotted_eighth",
    0.5: "eighth",
    0.375: "dotted_sixteenth",
    0.25: "sixteenth",
    0.125: "thirty_second",
    0.0625: "sixty_fourth",
}


def _rests_for_gap(beats: float) -> list[str]:
    """The rest values that fill `beats`, longest first.

    **For `<forward>`, which advances the clock without writing a note.** It is
    how an engraver leaves a gap — most often the start of a voice that enters
    partway through the bar — and it was ignored entirely, so the gap simply
    vanished. Measured: a 4/4 bar written as quarter, two-beat `<forward>`,
    quarter came back two beats long instead of four; and because it was
    measure 1, `validate_measures` forgave it as a pickup and nothing was
    reported at all. `alignment.py` accumulates, so every bar after it on the
    page was expected two beats early.

    Greedy over the named values because that is what an engraver writes: two
    and a half beats is a half and an eighth, not a value with no name. A
    remainder that no rest can express returns nothing rather than a wrong
    total — being visibly short is a failure this can afford, and silently
    misplacing every later bar is not.
    """
    values = sorted(_DURATION_BY_BEATS.items(), reverse=True)
    out: list[str] = []
    left = round(beats, 6)
    for size, name in values:
        while left >= size - 1e-9:
            out.append(name)
            left = round(left - size, 6)
            if len(out) > 16:
                return []
    return out if abs(left) < 1e-9 else []


def _is_a_bars_rest(note: ET.Element) -> bool:
    """`<rest measure="yes"/>` — the rest that fills whatever bar it is in.

    MusicXML's own way of writing a bar of rest, and the shape an orchestral
    part is mostly made of. It carries no `<type>`, because the glyph it draws
    depends on the metre rather than on a note value.
    """
    rest = note.find("rest")
    return rest is not None and (rest.get("measure") or "").strip().lower() == "yes"


def _duration_name(note: ET.Element, divisions: int | None = None) -> str | None:
    kind = _text(note.find("type"))
    if kind is None:
        # **A bar of rest, and the third spelling of one.**
        #
        # `_expand_multiple_rests` handles `<multiple-rest>`, several bars at
        # once. `_whole_rests_that_mean_a_bar` handles the whole-rest *glyph*,
        # `<type>whole</type>`. This is the one in between and the most
        # canonical of the three — a single bar of rest, written as MusicXML
        # says to write it: `<rest measure="yes"/>` and no `<type>` at all,
        # because which glyph it draws depends on the metre.
        #
        # It was dropped, and dropping it is expensive three times over. The
        # bar comes through **empty**, so: `validate.py` calls it a hole rather
        # than a bar of rest and the reading's confidence falls; `alignment.py`
        # accumulates durations, so a musician who counts the rest correctly is
        # judged a bar early for the whole of the rest of the page — the exact
        # damage `_expand_multiple_rests` exists to prevent; and
        # `_refuse_if_it_is_not_a_reading` counts empty bars against the page,
        # so a part with more rest than music — which a bass part frequently
        # is — could be **refused outright** as bars that "came out empty".
        #
        # Measured on a three-bar part, play/rest/play: 0.67 confidence with
        # bar 2 `empty`, against 1.00 with this. Found in
        # `audiveris_phone_photo.musicxml`, which carries one.
        #
        # **Named `whole`, deliberately, rather than measured from
        # `<duration>`.** Two reasons, and the second is the load-bearing one:
        # `<duration>` on these is not trustworthy — the one in that fixture
        # says 57 ticks at 6 divisions, which is 9.5 beats in a bar of 4 — and
        # `_whole_rests_that_mean_a_bar` already owns the question of what a
        # bar of rest is worth in this metre, including inferring the metre
        # when the page never states one. Handing this to that rule reuses it
        # rather than writing a fourth thing that has to agree with it.
        return "whole" if _is_a_bars_rest(note) else None
    base = _TYPE_TO_DURATION.get(kind)
    if base is None:
        return None

    # **When the note contradicts itself, believe its timing.**
    #
    # This module reads `<type>` and not `<duration>`, for the reason at the
    # top of the file: divisions are an arbitrary per-file tick unit and a
    # damaged file may not carry them. That stands. What it did not consider is
    # a note where *both* are present and they disagree — which is not a choice
    # between two conventions, it is a malformed note, and one of the two
    # numbers is wrong.
    #
    # Measured on `page-upright.jpg`: four notes typed `breve` — eight
    # quarter-beats — carrying `<duration>2</duration>` at four divisions per
    # quarter, which is **half a beat**. A sixteenfold error, in a value
    # `alignment.py` accumulates, so one of them moves every onset after it by
    # seven and a half beats.
    #
    # `<duration>` is what MusicXML says drives time, so it is the half to
    # believe — but only when it maps exactly to something an engraver would
    # write. An inexact remainder is not evidence about anything, and `<type>`
    # stays the answer.
    #
    # **Dotted notes are out of scope, and that is not redundancy.** For a
    # self-consistent file the timing of a dotted note maps to exactly the name
    # its dots produce — that is what a dot means — so the exclusion changes
    # nothing there, and a mutation removing it survives. What it does do is
    # keep this rule out of the *tuplet-before-dot* decision immediately below,
    # which was made deliberately and for its own reasons. A rule written for a
    # malformed breve should not quietly relitigate that.
    stated = _text(note.find("duration"))
    if divisions and stated and not note.findall("dot") and base in DURATION_BEATS:
        try:
            beats = int(stated) / divisions
        except ValueError:
            beats = None
        if beats is not None and abs(beats - DURATION_BEATS[base]) > 1e-6:
            corrected = _DURATION_BY_BEATS.get(round(beats, 6))
            if corrected is not None:
                return corrected
    dots = len(note.findall("dot"))

    # **A bracket says what the note is worth; the arithmetic says what to call
    # it.** This read only 3:2, returned a fixed triplet name for it, and
    # dropped every other ratio — on the reasoning that "a quintuplet or
    # septuplet has no name here, and guessing the nearest triplet would put
    # notes at times nobody played". The second half stands. The first was
    # never about names: it was about *this* table, and most of the ratios an
    # engraver writes land on a value it already holds exactly.
    #
    # Measured before this, each on a bar whose notes were otherwise fine:
    #
    #     2:3 duplet eighths (6/8)      every note dropped, bar read `empty`
    #     2:3 duplet quarters (6/8)     every note dropped, bar read `empty`
    #     4:3 quadruplet eighths        every note dropped, bar read `empty`
    #     6:4 sextuplet eighths         every note dropped, bar read `empty`
    #     dotted 3:2 triplet eighths    named `triplet_eighth` — **a third short**
    #
    # A duplet is ordinary in any compound metre and a dotted triplet is
    # ordinary anywhere, so this was not an exotic corner. The dotted case is
    # the worse of the two kinds: a dropped note leaves the bar visibly short,
    # and the beat-sum check can say so, while a note named a third short is a
    # confident wrong answer in a value `alignment.py` accumulates.
    #
    # The exclusion of dots from the tuplet branch went with it. It existed
    # because a dotted triplet had no name — it has one whenever the product
    # lands on a written value, and a dotted triplet eighth lands exactly on an
    # eighth.
    #
    # 5:4 and 7:4 were on that list until `Duration` learned to name them, and
    # they were the expensive two: `_unnameable_tuplet_beats` keeps a group's
    # *length* as rests, so a quintuplet read correctly off the page produced a
    # bar that summed perfectly with five of its onsets replaced by silence —
    # invisible to every check here. Measured before naming them, on a 4/4 bar
    # of a 5:4 quintuplet of sixteenths and three quarters: 3 onsets of 8, and
    # the beat check said `ok`.
    #
    # What is still dropped is what genuinely has no name: a ratio landing on
    # none of the values in `DURATION_BEATS` — 5:6 in a compound metre, a
    # triplet of thirty-seconds. Naming those needs new members in a `Duration`
    # the app shares, and the honest alternative — replacing the whole group
    # with rests that sum to it — is what `_unnameable_tuplet_beats` already
    # does, at the cost above.
    stated_actual = _text(note.find("time-modification/actual-notes"))
    ratio = _tuplet_ratio(note)
    if ratio is not None:
        actual, normal = ratio
        written = DURATION_BEATS.get(base)
        if written is None:
            return None
        named = _DURATION_BY_TUPLET_BEATS.get(
            round(written * _DOT_FACTOR[dots] * normal / actual, 6)
            if dots < len(_DOT_FACTOR)
            else -1.0
        )
        return named
    if stated_actual is not None and stated_actual not in ("", "1"):
        # A bracket whose ratio cannot be read at all. Believing the written
        # value would be reading straight past the one mark that says not to.
        return None

    if dots == 0:
        return base
    if dots == 1:
        return _DOTTED.get(base)
    if dots == 2:
        # These used to have no name in `Duration`, and the note was dropped
        # rather than shortened — on the reasoning that reporting the undotted
        # value "would silently shorten the measure". A dropped note shortens
        # it by the whole value instead, and `alignment.py` accumulates
        # durations, so it moves every bar after it as well. Now they have
        # names. A triple dot still does not, and is genuinely rare.
        return _DOUBLE_DOTTED.get(base)
    return None



#: The rest that fills exactly one bar, by the bar's length in quarter-beats.
#:
#: Named rather than searched out of `DURATION_BEATS` so that the answer for a
#: bar is a **notated** value and not whichever key happened to match first —
#: 4.0 beats is a whole rest, never a triplet-half plus arithmetic. Metres whose
#: bar is not one of these (5/4, 7/8) are absent on purpose: there is no single
#: rest that fills them, so `_expand_multiple_rest` declines rather than
#: inventing one.
_BAR_REST_FOR: Final[dict[float, str]] = {
    8.0: "double_whole",
    6.0: "dotted_whole",
    4.0: "whole",
    3.0: "dotted_half",
    2.0: "half",
    1.5: "dotted_quarter",
    1.0: "quarter",
}


def _multiple_rest_count(measure_el: ET.Element) -> int | None:
    """How many bars this measure stands for, if it is a multi-bar rest.

    **A four-bar rest is written as one empty `<measure>`** carrying
    `<measure-style><multiple-rest>4</multiple-rest></measure-style>`, which is
    how a real orchestral part writes the thing a bass player spends most of a
    symphony doing. Read literally it is a bar with nothing in it.
    """
    for attributes in measure_el.iterfind("attributes"):
        for style in attributes.iterfind("measure-style"):
            raw = _text(style.find("multiple-rest"))
            if raw is None:
                continue
            try:
                count = int(raw)
            except ValueError:
                return None
            return count if count > 1 else None
    return None


def _measure_repeat_mark(measure_el: ET.Element) -> tuple[str, int] | None:
    """`("start", bars)` or `("stop", 0)` for the bar-repeat sign, else None.

    **The `%` sign, and it read as an empty bar.** After a bar of music an
    orchestral part writes `%` rather than engraving the same bar again, and
    for two-bar patterns a doubled one — it is on nearly every tutti page a
    bass player owns. In MusicXML it is
    `<measure-style><measure-repeat type="start">1</measure-repeat></measure-style>`
    in the first repeated bar, nothing at all in the bars that continue the
    run, and `type="stop"` in the first bar that does not.

    Read literally the bar has no notes in it. Measured: one `%` between two
    bars of eight eighths gave a timeline of **16 onsets where a musician
    sounds 24**, and because the empty bar carries no duration either,
    `alignment.py` — which accumulates — expected every note after it a **whole
    bar early**. The same damage a dropped multi-bar rest does, from the same
    cause: a notation that means "more music" written as an absence.

    `validate_measures` does say `empty` about it, so unlike the multi-rest
    this was never silent. It was wrong, and the concern named the wrong thing:
    the bar is not a hole in the reading, it is a bar the reader did not know
    how to fill.
    """
    for attributes in measure_el.iterfind("attributes"):
        for style in attributes.iterfind("measure-style"):
            mark = style.find("measure-repeat")
            if mark is None:
                continue
            kind = (mark.get("type") or "").strip()
            if kind == "stop":
                return "stop", 0
            if kind != "start":
                continue
            try:
                bars = int((mark.text or "1").strip())
            except ValueError:
                bars = 1
            return "start", bars if bars > 0 else 1
    return None


def _beat_repeat_mark(measure_el: ET.Element) -> tuple[str, float] | None:
    """`("start", beats)` or `("stop", 0.0)` for the `/` sign, else None.

    **The within-bar sibling of `%`, and it emptied a bar the same way.**
    Measured: a bar of eight eighths, a beat-repeat bar, another of eight
    eighths gave **16 onsets where a musician sounds 24**, and the empty bar
    carried no duration either, so every note after it was expected a whole bar
    early.

    The pattern length comes from the markup rather than from the metre. The
    element's text is how many beats repeat; `slashes` says what a beat is
    here — one slash is a quarter, two eighths, three sixteenths — so the
    length is `beats x 1/2**(slashes-1)` quarter-beats and no denominator is
    involved. That matters: the previous entry declined this fix on the
    grounds that a beat's length needs the metre and so could only be known
    after `_bar_lengths`, which runs after the fill. It does not.
    """
    for attributes in measure_el.iterfind("attributes"):
        for style in attributes.iterfind("measure-style"):
            mark = style.find("beat-repeat")
            if mark is None:
                continue
            kind = (mark.get("type") or "").strip()
            if kind == "stop":
                return "stop", 0.0
            if kind != "start":
                continue
            try:
                beats = int((mark.text or "1").strip())
            except ValueError:
                beats = 1
            try:
                slashes = int(mark.get("slashes") or "1")
            except ValueError:
                slashes = 1
            beats = max(1, beats)
            slashes = min(max(1, slashes), 8)
            return "start", beats * (1.0 / 2 ** (slashes - 1))
    return None


def _stated_bar_lengths(
    measures: list[Measure], header_metre: str | None
) -> list[float | None]:
    """Bar lengths from metres actually printed, with **no inference**.

    `_bar_lengths` asks the music when nothing is printed, which cannot be done
    before the repeat signs are filled — the bars they stand for are empty, and
    they are some of the bars that would be voting. This is the half that needs
    nothing but the page: a metre holds until another is printed.

    None where no metre has been printed yet, and a beat-repeat there is left
    alone rather than guessed at. On the route this reaches — a file, not a
    photograph — an engraver always writes `<time>`.
    """
    running = quarter_beats(header_metre)
    out: list[float | None] = []
    for measure in measures:
        if measure.time_signature is not None:
            running = quarter_beats(measure.time_signature)
        out.append(running)
    return out


def _tail_of(measure: Measure, beats: float) -> list[Note] | None:
    """The last `beats` quarter-beats of a bar, or None if it does not split.

    A pattern that would cut a note in half is not a pattern this can repeat,
    and half a note is exactly the kind of invention that must not reach a
    musician. Refusing leaves the bar visibly empty, which is where it started.
    """
    taken: list[Note] = []
    total = 0.0
    for note in reversed(measure.notes):
        length = DURATION_BEATS.get(note.duration)
        if length is None:
            return None
        taken.insert(0, note)
        total = round(total + length, 6)
        if total >= beats - 1e-6:
            break
    return taken if abs(total - beats) < 1e-6 else None


def _fill_beat_repeats(
    measures: list[Measure],
    marks: dict[int, tuple[str, float]],
    lengths: list[float | None],
) -> list[Measure]:
    """Tile the repeated beat across each bar carrying the `/` sign.

    Every step refuses rather than approximates: no printed metre, a pattern
    that does not land on a note boundary, or a bar that is not a whole number
    of patterns long, and the bar stays empty. Empty is what it already was,
    and `validate_measures` calls it out; a bar filled with a guess is the one
    failure this reader must not have.
    """
    if not marks:
        return measures

    out = list(measures)
    pattern = 0.0
    for index, measure in enumerate(measures):
        mark = marks.get(index)
        if mark is not None:
            pattern = mark[1] if mark[0] == "start" else 0.0
        if not pattern or measure.notes or index == 0:
            continue
        bar = lengths[index]
        if bar is None or pattern <= 0:
            continue
        copies = bar / pattern
        if abs(copies - round(copies)) > 1e-6 or round(copies) < 1:
            continue
        figure = _tail_of(out[index - 1], pattern)
        if not figure:
            continue
        out[index] = measure.model_copy(
            update={"notes": [note.model_copy() for note in figure] * round(copies)}
        )
    return out


def _fill_measure_repeats(
    measures: list[Measure],
    marks: dict[int, tuple[str, int]],
    standing_for_rests: set[int] = frozenset(),  # type: ignore[assignment]
) -> list[Measure]:
    """Copy the bars a `%` stands for into the bars that carry it.

    The run continues until a `stop`, so a `%` written once covers however many
    bars follow it empty — which is how a page writes four bars of the same
    figure with one symbol and three blanks.

    Copying from the **output** rather than the input, so a second `%` inside
    the run repeats what the first one produced. For a two-bar pattern that is
    the whole point: bar *i* takes from *i-2*, bar *i+1* from *i-1*, and bar
    *i+2* takes from *i* — which by then holds what *i-2* held.

    **Only a bar with nothing in it is filled.** If the engine put notes there
    as well, those are what it actually read off the page, and the same rule
    the multi-rest expansion had to learn applies: a marking is not licence to
    overwrite a reading. Copying nothing is visibly wrong; copying over
    something is invisibly wrong.

    **And never a bar that is a multi-bar rest**, which is also empty at this
    point and also means something. It happened to survive without this —
    `_expand_multiple_rests` runs later and overwrites whatever went in — but
    working by the order two functions happen to be called in is not the same
    as working, and the order is exactly what the caller's comment is about.
    """
    if not marks:
        return measures

    out = list(measures)
    span = 0
    for index, measure in enumerate(measures):
        mark = marks.get(index)
        if mark is not None:
            span = mark[1] if mark[0] == "start" else 0
        if not span or measure.notes or index in standing_for_rests:
            continue
        source = index - span
        if source < 0:
            # A `%` in the first bars of the page, repeating something printed
            # before it — on an earlier page, or before a crop. Nothing to copy
            # and nothing to invent, so it stays visibly empty.
            continue
        out[index] = measure.model_copy(
            update={
                "notes": list(out[source].notes),
                "slurs": list(out[source].slurs),
                "tuplets": list(out[source].tuplets),
            }
        )
    return out


def _unnameable_tuplet_beats(note: ET.Element) -> float | None:
    """What this note is worth, when its bracket leaves it with no name.

    `_duration_name` returns `None` for 5:4 and 7:8 because a fifth of a beat
    has no notehead, and a dropped note shortens its bar — which `alignment.py`
    accumulates, so **every bar after it on the page is judged early**. Measured
    on a 4/4 bar of a quintuplet of sixteenths and three quarters: the five
    notes vanished, the bar read three beats, and being bar 1 it was forgiven
    as a pickup, so nothing was reported at all.

    The group's *total* is a different matter. Five in the time of four
    sixteenths is one quarter however it is subdivided, and a quarter has a
    rest. So the length is recoverable even when none of its parts is, and
    keeping it is what stops the page after it from moving.

    Returns None whenever the note is not that case — a duration that *does*
    have a name, no bracket, a bracket whose ratio cannot be read, a type with
    no beat value — so the caller can tell "this note has a length nobody can
    write" from "this note is gone".

    The first of those is the one that matters: this is the only place that
    decides what "unnameable" means. Its one caller sits inside a branch that
    already implies it, so a mutation removing that first line survives — kept
    because the alternative is a second copy of the test at the call site, and
    because a helper whose name is a claim should check the claim.
    """
    if _duration_name(note) is not None:
        return None
    ratio = _tuplet_ratio(note)
    if ratio is None:
        return None
    base = _TYPE_TO_DURATION.get(_text(note.find("type")) or "")
    written = DURATION_BEATS.get(base) if base else None
    if written is None:
        return None
    dots = len(note.findall("dot"))
    if dots >= len(_DOT_FACTOR):
        return None
    actual, normal = ratio
    return written * _DOT_FACTOR[dots] * normal / actual


def _pitch_name(note: ET.Element) -> str | None:
    if note.find("rest") is not None:
        return "rest"
    pitch = note.find("pitch")
    if pitch is None:
        # **`<unpitched>` is a note, at a place on the staff rather than a
        # frequency.** It is how percussion is written, and how a string part
        # writes a body tap or col legno battuto — a notehead with a real
        # attack, printed on a line the player reads.
        #
        # It was dropped for having no `<pitch>`, which costs the onset, and
        # `alignment.py` accumulates, so every later bar is judged against music
        # that is not there. On a part written entirely this way — a percussion
        # part — *every* note dropped and the page was refused as empty bars.
        #
        # `display-step` and `display-octave` are exactly the staff position the
        # engraver drew, so the note keeps the place it was printed in. Nothing
        # downstream asks a pitch to be a frequency: the verdict reads it only
        # as `== "rest"`, and a tie compares two of them for equality.
        pitch = note.find("unpitched")
        if pitch is None:
            return None
        step = _text(pitch.find("display-step"))
        octave = _text(pitch.find("display-octave"))
        if step is None or octave is None:
            return None
        name = f"{step}{octave}"
        return name if PITCH_PATTERN.match(name) else None
    step = _text(pitch.find("step"))
    octave = _text(pitch.find("octave"))
    if step is None or octave is None:
        return None
    # **Truncating a fractional alter turns a microtone into a natural.**
    #
    # `<alter>` is a semitone count and MusicXML allows fractions for
    # microtones: 0.5 is a quarter-sharp, 1.5 a three-quarter-sharp, -0.5 a
    # quarter-flat. `int(float(...))` rounded 0.5 down to 0, so a quarter-sharp
    # was written out as a plain natural — a wrong note printed exactly like the
    # right ones around it, which is the one outcome this function's own comment
    # says it exists to avoid, arrived at by arithmetic rather than by choice.
    #
    # There is no spelling for a microtone here, so it drops, like a triple
    # accidental. A short bar is visible to the beat check and to the musician;
    # a natural where a quarter-sharp was printed is visible to nobody.
    raw = _text(pitch.find("alter"))
    try:
        exact = float(raw) if raw else 0.0
    except ValueError:
        exact = 0.0
    alter = int(exact) if exact.is_integer() else None
    suffix = _ALTER_SUFFIX.get(alter) if alter is not None else None
    if suffix is None:
        # Past a double accidental, or a microtone. Naming the natural instead
        # would be a wrong note, so drop it and let the note count fall short,
        # which the validator can see. Doubles used to land here too and no
        # longer do; microtones used to skip this entirely and be *rounded*.
        return None
    name = f"{step}{suffix}{octave}"
    # **Asked here, not left to the model to reject.**
    #
    # A double accidental was the only unrepresentable pitch this function
    # knew about, so everything else was handed over and `Note` raised
    # `ValidationError` — which is not `MusicXMLError`, so it went straight
    # past the `except` in `POST /v1/scores/import` and became a **500**. Two
    # inputs found it in about a minute of fuzzing: `<octave>99</octave>`, and
    # a `<step>` outside A–G, which German-language software writes as **H**
    # for B natural.
    #
    # One bad notehead should cost one note, which is what every other
    # unreadable value here costs. The grammar is imported rather than
    # re-typed: two copies of a pattern are two chances to disagree about what
    # a pitch is, and the disagreement would land as a 500 again.
    return name if PITCH_PATTERN.match(name) else None


def _articulation(note: ET.Element) -> str | None:
    for articulations in note.iterfind("notations/articulations"):
        for child in articulations:
            mapped = _ARTICULATION_TAGS.get(child.tag)
            if mapped is not None:
                return mapped
    return None


def key_fifths(name: str | None) -> int | None:
    """Sharps (positive) or flats (negative) a key name prints, or None.

    The inverse of `_key_name`, and the thing to compare two keys by: `Bb major`
    and `G minor` are different names for the same two flats, so a page that
    names the mode differently mid-piece has not changed its signature.
    Tolerant of case and of a bare tonic, because names come off photographs;
    `None` for `unknown`, for absent, and for anything unrecognised — which is
    an answer ("this states no signature"), not a failure.
    """
    if not name:
        return None
    wanted = name.strip().lower()
    if not wanted or wanted == "unknown":
        return None
    for table, sign in ((_SHARP_KEYS, 1), (_FLAT_KEYS, -1)):
        for count, major in enumerate(table):
            for spelled in (major, _key_name(sign * count, "minor") or ""):
                if spelled and wanted in (spelled.lower(), spelled.split(" ")[0].lower()):
                    return sign * count
    return None


def _key_name(fifths: int, mode: str | None) -> str | None:
    if not -7 <= fifths <= 7:
        return None
    table = _SHARP_KEYS if fifths >= 0 else _FLAT_KEYS
    name = table[abs(fifths)]
    if mode and mode.lower() == "minor":
        # Relative minor: three steps down the same signature.
        relative = {
            "C": "A", "G": "E", "D": "B", "A": "F#", "E": "C#", "B": "G#",
            "F# ": "D#", "F#": "D#", "C#": "A#", "F": "D", "Bb": "G",
            "Eb": "C", "Ab": "F", "Db": "Bb", "Gb": "Eb", "Cb": "Ab",
        }
        tonic = name.split(" ")[0]
        minor = relative.get(tonic)
        if minor is not None:
            return f"{minor} minor"
    return name



def _part_names(root: ET.Element) -> dict[str, str]:
    """Part id → the name printed in `<part-list>`, e.g. `P3` → "Violoncello"."""
    names: dict[str, str] = {}
    for entry in root.iterfind("part-list/score-part"):
        pid = entry.get("id")
        if not pid:
            continue
        for tag in ("part-name", "part-abbreviation"):
            text = (entry.findtext(tag) or "").strip()
            if text:
                names[pid] = text
                break
    return names


def _choose_part(root: ET.Element, wanted: str | None) -> ET.Element:
    """The part to read, refusing to guess when a file holds several.

    An OMR engine reading one photographed staff emits one part, so taking the
    first was always right. A file from a publisher is a different animal: a
    downloaded orchestral score's first part is usually the piccolo, and a
    cellist who imports it and silently gets the piccolo line has a
    transcription that is timed, verdicted, and wrong in a way that looks
    right. That is worse than an error message.
    """
    parts = root.findall("part")
    if not parts:
        raise MusicXMLError("no <part> element — this is not a MusicXML score")

    names = _part_names(root)
    if wanted:
        needle = wanted.strip().lower()
        for element in parts:
            pid = element.get("id") or ""
            label = names.get(pid, "")
            if pid.lower() == needle or needle in label.lower():
                return element
        available = ", ".join(
            f"{e.get('id')} ({names.get(e.get('id') or '', 'unnamed')})" for e in parts
        )
        raise MusicXMLError(f"no part matching {wanted!r}; this file has: {available}")

    if len(parts) == 1:
        return parts[0]

    available = ", ".join(
        f"{e.get('id')} ({names.get(e.get('id') or '', 'unnamed')})" for e in parts
    )
    raise MusicXMLError(
        f"this file has {len(parts)} parts and none was chosen: {available}. "
        "Pick the one you play."
    )




#: The first number in a `<per-minute>`, which may be text an engraver typed.
_LEADING_NUMBER: Final[re.Pattern[str]] = re.compile(r"\d+(?:\.\d+)?")


def _metronome_tempo(direction: ET.Element) -> tuple[int, str] | None:
    """A printed mark as quarter-note BPM plus the note value it counts.

    Alignment stays on a quarter-note clock. The second value preserves what
    the musician actually sees — for example, dotted-quarter = 60 becomes
    `(90, "dotted_quarter")` — so the app can display 60 while timing 90
    quarter notes per minute. A range takes its lower number. Metric
    modulations and beat values this score schema cannot name are skipped.
    """
    for metronome in direction.iterfind("direction-type/metronome"):
        units = metronome.findall("beat-unit")
        if len(units) != 1:
            continue
        base = _TYPE_TO_DURATION.get((_text(units[0]) or "").strip())
        beats = DURATION_BEATS.get(base) if base else None
        if beats is None:
            continue
        dots = len(metronome.findall("beat-unit-dot"))
        if dots >= len(_DOT_FACTOR):
            continue
        if dots == 0:
            unit = base
        elif dots == 1:
            unit = _DOTTED.get(base)
        else:
            unit = _DOUBLE_DOTTED.get(base)
        if unit is None:
            continue
        raw = _text(metronome.find("per-minute"))
        found = _LEADING_NUMBER.search(raw or "")
        if found is None:
            continue
        quarter_bpm = int(round(float(found.group()) * beats * _DOT_FACTOR[dots]))
        if 20 <= quarter_bpm <= 300:
            return quarter_bpm, unit
    return None


def _metronome_bpm(direction: ET.Element) -> int | None:
    """Compatibility helper returning the internal quarter-note rate only."""
    tempo = _metronome_tempo(direction)
    return tempo[0] if tempo is not None else None

def _staff_carrying_the_music(part_el: ET.Element) -> str | None:
    """Which staff of a multi-staff part is the line to read, or None.

    **A second axis of the same problem the voice filter solves, and the voice
    filter cannot see it.** A grand-staff part writes both hands inside one
    `<part>`, separated by `<backup>`, with `<staff>1</staff>` and
    `<staff>2</staff>` on the notes. Where the exporter also numbers the
    voices, the voice filter happens to pick one hand and the bar comes out
    right. Where it does not — and plenty do not, since `<voice>` is optional —
    every note of both staves is read as one line.

    Measured on a 4/4 bar of four quarters over two halves: eight quarter-beats
    in a four-beat bar, `long`, and since `alignment.py` accumulates, every bar
    after it expected four beats late. The voice filter is explicitly right not
    to help: *"an untagged note is not in a competing voice — it is a note"*,
    which is true, and it is a note **on another staff**.

    Chosen once for the whole part rather than per measure. A staff is a stable
    property of a line, unlike a voice number, which may be reused freely from
    bar to bar; picking per measure would let the reading jump between hands
    where one of them happens to rest.

    Neither hand of a keyboard part is "the piece", and this app analyses one
    melodic line, so one staff is the only thing it can return. The most
    *pitched* notes, ties to the lowest-numbered staff — the same rule and the
    same tiebreak as the voice filter, for the same reasons.

    Returns None when the part uses one staff or none, which is every
    single-line instrument's part and so almost every page this app sees.
    """
    counts: dict[str, int] = {}
    for note_el in part_el.iterfind("measure/note"):
        staff = (note_el.findtext("staff") or "").strip()
        # **MusicXML says an omitted `<staff>` is staff 1**, so absence is a
        # claim here and not the shrug it is for `<voice>`. Exporters leave the
        # tag off the upper staff often enough that treating those notes as
        # "belongs to whichever staff wins" would hand the reading both hands
        # again wherever the lower one was chosen — the double count this
        # filter exists to prevent, arriving by another door.
        counts.setdefault(staff or "1", 0)
        if note_el.find("rest") is None and note_el.find("cue") is None:
            counts[staff or "1"] += 1
    # One staff, or none named at all — a single-line part, and every note of
    # it is the music. The default above cannot manufacture a second entry:
    # untagged notes all land on the same "1", so a page that never mentions a
    # staff counts exactly one and leaves here.
    if len(counts) < 2:
        return None
    best = max(counts.values())
    return min(staff for staff, n in counts.items() if n == best)


def _only(notes: list[ET.Element]) -> ET.Element:
    """A stand-in measure holding just these notes.

    So `_voice_carrying_the_music` can be asked about one staff without
    growing a parameter it would ignore on every single-staff page. Built
    rather than filtered in place: the real element is iterated again below.
    """
    stub = ET.Element("measure")
    stub.extend(notes)
    return stub


def _voice_carrying_the_music(measure_el: ET.Element) -> str | None:
    """Which voice of a polyphonic bar is the line the musician plays.

    **The voice that holds the most *pitched* notes, not the one written
    first** — and the difference is four notes of real music on the one real
    photograph in this repository.

    homr writes a whole-bar rest in voice 2 *before* the music in voice 1, so
    "the first voice in document order" picked the rests and threw the bar
    away. Measured on `page-upright.jpg`: four `<backup>` measures, and one of
    them held a whole rest in voice 2 and four eighth notes in voice 1 — the
    file has 75 pitched notes and the reading had 71.

    A voice of nothing but rests is never the music, and **neither is a voice
    of nothing but cues** — a rule that was right alone and wrong beside its
    neighbour. Cue notes are pitched, so they counted, and a bar holding two
    played half notes in voice 1 against four cue quarters in voice 2 elected
    the cues and threw the music away. Measured: the bar came back as four
    rests, summing to exactly four beats, so `validate_measures` said `ok`.
    Both real notes gone and nothing anywhere reporting it.

    Ties go to the voice written first, which is the old behaviour and the
    right tiebreak for two genuine lines: nothing else here can tell a divisi
    apart, and the upper part is written first by convention.
    """
    counts: dict[str, int] = {}
    order: list[str] = []
    for note_el in measure_el.iterfind("note"):
        voice = (note_el.findtext("voice") or "").strip()
        if not voice:
            continue
        if voice not in counts:
            counts[voice] = 0
            order.append(voice)
        if note_el.find("rest") is None and note_el.find("cue") is None:
            counts[voice] += 1
    if not order:
        return None
    # `max` returns the first maximal element and `order` is document order, so
    # a tie already goes to the voice written first. An explicit index term
    # here was redundant — the mutation that removed it changed nothing, which
    # is what redundant means.
    return max(order, key=lambda voice: counts[voice])


def _bar_lengths(
    measures: list[Measure], header_metre: str | None
) -> list[float | None]:
    """The bar length in quarter-beats in force at each measure.

    A metre holds until another is printed, which is how the page works and
    what `meters_in_force` reads. When no metre is printed anywhere — the
    ordinary state of a photographed inner page — the music is asked instead,
    through `infer_beats_per_measure`.

    **A bar holding nothing but a whole rest does not get a vote.** Its length
    is precisely the question being asked (see `_whole_rests_that_mean_a_bar`),
    and on a 2/4 page those bars each sum to 4.0 — so letting them vote is
    letting the wrong reading argue for itself.
    """
    inferred = infer_beats_per_measure(
        [
            sum(DURATION_BEATS[note.duration] for note in measure.notes)
            for measure in measures
            if measure.notes and not _is_lone_whole_rest(measure)
        ]
    )
    running = quarter_beats(header_metre)
    out: list[float | None] = []
    for measure in measures:
        if measure.time_signature is not None:
            running = quarter_beats(measure.time_signature)
        out.append(running if running is not None else inferred)
    return out


def _is_lone_whole_rest(measure: Measure) -> bool:
    return (
        len(measure.notes) == 1
        and measure.notes[0].pitch == "rest"
        and measure.notes[0].duration == "whole"
    )


def _whole_rests_that_mean_a_bar(
    measures: list[Measure], lengths: list[float | None]
) -> list[Measure]:
    """A whole rest alone in a bar is a bar of rest, whatever the metre says.

    **The convention is universal and the notation is not literal.** An
    engraver writes the whole-rest glyph for a full bar of rest in any metre —
    a bar of 2/4 rest is a whole rest, never a half rest. homr reads the glyph
    correctly and writes `<type>whole</type>` with four quarter-beats of
    duration, which is what the symbol means *by itself* and not what it means
    in that bar.

    Read literally, a 2/4 bar of rest is two beats too long. `alignment.py`
    accumulates durations, so the musician who rests one bar and comes back in
    on time is judged two beats late for the whole of the rest of the page —
    the same damage a dropped multi-bar rest does, from the opposite direction.

    Measured on `page-upright.jpg`, a 2/4 part: **six bars**, each a lone whole
    rest scored 4.0 against 2.0, and every one of them correct on the page.

    Applied only where the bar is *shorter* than a whole note. In 4/4 the whole
    rest already is the bar, and in 4/2 or 3/2 the glyph genuinely means four
    beats — reinterpreting there would break a reading that is right.
    """
    out = []
    # `strict`: `lengths` is `_bar_lengths(measures, …)` from the line above
    # its caller, so it is one per measure by construction. Without this a
    # short `lengths` would end the loop early and **drop the remaining bars
    # from the score** — `out` is only appended to inside it — which is a
    # page losing its ending with nothing raised and nothing logged.
    for measure, beats in zip(measures, lengths, strict=True):
        rest = _BAR_REST_FOR.get(beats) if beats is not None and beats < 4.0 else None
        if rest is None or not _is_lone_whole_rest(measure):
            out.append(measure)
            continue
        out.append(
            measure.model_copy(
                update={"notes": [Note(pitch="rest", duration=rest)]}  # type: ignore[arg-type]
            )
        )
    return out


def _expand_multiple_rests(
    measures: list[Measure],
    pending: list[tuple[int, int, str | None]],
    lengths: list[float | None],
) -> tuple[list[Measure], list[int]]:
    """Turn each multi-bar rest into the bars of silence it stands for.

    Returns the measures and, for each measure that went in, where it came
    out — because an expansion moves everything after it, and a caller holding
    an index into the old list (which bar dropped a note, say) would otherwise
    read it against the new one and name the wrong bar. Measured while adding
    exactly that: a page whose third measure lost notes, with a four-bar rest
    above it, named measure 3 where the bar is 6.

    A list rather than a dict, so that "every measure has a destination" is
    structural instead of a lookup a caller has to guard.

    **This is most of what a bass player does, and it was being dropped.**
    `<measure-style><multiple-rest>4</multiple-rest></measure-style>` is how the
    notation writes four bars of rest, and it arrives as a *single* `<measure>`
    with nothing in it. Read literally, three bars of time vanish — and
    `alignment.py` accumulates durations, so **every bar after the rest is
    compared against the recording eight beats early**. The musician counts the
    rest correctly, comes in exactly on time, and is told they rushed the whole
    rest of the page.

    Measured on the one real page in this repository: a four-bar rest at bar 3,
    a 77-bar part read as 74, and every verdict from bar 4 onwards computed
    against the wrong moment.

    **Done in a second pass because the bar length is often not knowable yet.**
    On that page the only `<time>` printed is mid-page, after a double barline —
    which is the ordinary shape of an inner page, not an oddity. So the length
    comes from, in order: a metre stated on the rest itself, the part's header
    metre, and failing both `infer_beats_per_measure` over the bars that do
    have notes — the same evidence `validate.py` already trusts to check a
    headerless page, asked here rather than copied.

    When none of those yields a bar this schema has a single rest for — no
    metre at all, or 5/4, or 7/8 — the rest is left as it was: one empty
    measure, which `validate.py` reports as a hole. Being visibly short is the
    failure this can afford; being silently short is not.
    """
    if not pending:
        return measures, list(range(len(measures)))

    out: list[Measure] = []
    expanded = False
    #: How many bars the expansions so far have inserted. Everything after a
    #: rest moves down the page by that much.
    #:
    #: **Shifted, not renumbered 1..N — and the difference is a signal.** The
    #: file numbers a four-bar rest as one bar, so the measures after it are
    #: three too low, and `MeasureEditScreen` and every caveat line address a
    #: bar by its number. But numbering them positionally **erases the file's
    #: own numbering anomalies**, and one of those is what `renumber` calls the
    #: single most common failure this pipeline has: a boxed rehearsal mark
    #: reading 49 came back as measure 409.
    #:
    #: Measured (2026-08-26): a page numbered 1, 2, 3, 409 reports the gap. The
    #: same page with a multi-bar rest reported **nothing**, because this had
    #: already renumbered it 1..7 — erased on exactly the pages that carry
    #: rehearsal marks, since those are the pages with multi-bar rests.
    #:
    #: `pipeline.renumber` still normalises positionally and still names the
    #: gap in `notes_to_human` first, which is the documented order and the
    #: whole point: *"The anomaly is reported before it is normalised, not
    #: hidden by it."* The shift keeps that signal intact for it to find.
    shift = 0
    moved: list[int] = []
    by_index = {index: (count, metre) for index, count, metre in pending}
    for index, measure in enumerate(measures):
        moved.append(len(out))
        entry = by_index.get(index)
        if entry is None:
            out.append(
                measure.model_copy(
                    update={"measure_number": measure.measure_number + shift}
                )
                if shift
                else measure
            )
            continue
        count, metre = entry
        beats = quarter_beats(metre) or lengths[index]
        rest = _BAR_REST_FOR.get(beats) if beats is not None else None
        if rest is None:
            out.append(
                measure.model_copy(
                    update={"measure_number": measure.measure_number + shift}
                )
                if shift
                else measure
            )
            continue
        expanded = True
        for step in range(count):
            out.append(
                measure.model_copy(
                    update={
                        "notes": [Note(pitch="rest", duration=rest)],
                        # The metre is stated once, on the first of the bars it
                        # governs. Repeating it would read as a metre change
                        # printed at every bar of the rest.
                        "time_signature": measure.time_signature if step == 0 else None,
                        "measure_number": measure.measure_number + shift + step,
                    }
                )
            )
        # Everything after this rest is that many bars further down the page.
        shift += count - 1

    if not expanded:
        return measures, list(range(len(measures)))
    return out, moved


def _ending_numbers(el: ET.Element) -> set[int]:
    """The passes an `<ending>` belongs to.

    `number` is a comma-separated list in the spec — `"1"`, `"2"`, `"1,2"`,
    `"1, 2"` are all legal — and an engraver writes `1,2` for bars that serve
    both passes. Anything unparseable yields nothing rather than a guess.
    """
    out: set[int] = set()
    for part in (el.get("number") or "").split(","):
        part = part.strip()
        if part.isdigit():
            out.add(int(part))
    return out


def _repeats_in(
    part_el: ET.Element,
) -> tuple[list[tuple[int, int, str, bool]], list[int]]:
    """Repeat signs and endings, as `(first index, last index, type)`.

    **Nothing produced these, and everything downstream was waiting for them.**
    `alignment.expand_repeats` reads `score.repeats` and writes a repeated
    section out twice; `validate.py` checks endings for sense; `pages.py` and
    `pipeline.py` both carry the list across a page break. All of it built,
    all of it tested — and `score_json_from_musicxml` returned `repeats=[]`
    unconditionally, so on every score this pipeline has ever read, the whole
    feature was a no-op.

    What that costs is in `expand_repeats`' own docstring: a musician who
    takes an eight-bar repeat plays sixteen bars and produces roughly twice
    the onsets, against a timeline holding eight, so DTW matches a doubled
    performance to a single pass and every delta after the repeat sign is
    meaningless. *"Silent, because the alignment still produced a number."*

    Indices, not measure numbers, because the numbers are still being decided
    when this runs — a multi-bar rest expands and moves everything after it.

    Three readings here are conventions rather than markup, and each is what a
    player does with the page:

    - **A backward repeat with no forward sign goes back to the beginning** of
      the piece, or to just after the previous repeat if there was one. Most
      pieces that repeat their opening print no forward sign at all, so
      requiring one would find nothing on exactly the commonest case.
      **Right for a piece and wrong for a page** — the same shape as
      `pickup_complement` — and a repeat opening on one page and closing on
      another therefore reads from the wrong bar. Measured on ten-bar pages: a
      forward on page 1 bar 5 closing on page 3 bar 4 reads **4** bars repeated
      where the truth is 20. Fixing it needs a way to say "a forward sign here,
      still open", which `Repeat` has not got, so it is pinned as a strict
      `xfail` in `test_page_join.py` rather than guessed at. **This is live.**
      `011` has been applied on the active project since 2026-08-29
      (verified against `supabase_migrations`), the app's scan flow
      uploads every page, and `join_pages` runs in the shipping worker —
      so a musician photographing a multi-page part whose repeat spans a
      page break gets the wrong bars. This note used to say *"nothing
      reads it today: multi-page is inert behind the unapplied `011`"*,
      which stopped being true four days before anybody checked.
    - **An ending marked `1,2`** serves both passes, so it is part of the body
      and not an ending at all — no `Repeat` is emitted for it.
    - **A `<repeat times="3">` is still played twice.** `RepeatType` has no way
      to say otherwise; twice is closer than once, and this is recorded rather
      than silently rounded.

    A third or later ending is skipped for the same reason: `RepeatType` is
    `repeat | first_ending | second_ending`, and inventing a fourth value here
    would break the closed union the app types against.
    """
    found: list[tuple[int, int, str]] = []
    forwards: list[int] = []
    #: Where the previous repeat ended, so a second backward sign with no
    #: forward sign of its own starts after it rather than back at bar 1.
    after_last: int = 0
    open_endings: dict[int, int] = {}

    index = -1
    for index, measure_el in enumerate(part_el.iterfind("measure")):
        for barline in measure_el.iterfind("barline"):
            for ending in barline.iterfind("ending"):
                numbers = _ending_numbers(ending)
                kind = ending.get("type")
                if kind == "start":
                    for number in numbers:
                        open_endings.setdefault(number, index)
                elif kind in {"stop", "discontinue"}:
                    for number in numbers:
                        start = open_endings.pop(number, index)
                        if numbers == {1}:
                            found.append((start, index, "first_ending", False))
                        elif numbers == {2}:
                            found.append((start, index, "second_ending", False))

            repeat = barline.find("repeat")
            if repeat is None:
                continue
            direction = repeat.get("direction")
            if direction == "forward":
                forwards.append(index)
            elif direction == "backward":
                # **Whether a `|:` was printed is the fact `join_pages` needs**,
                # and only this loop knows it. Falling back to `after_last` is
                # right for a piece read whole and wrong for page 3 of one — see
                # `Repeat.start_inferred`.
                printed = bool(forwards)
                start = forwards.pop() if printed else after_last
                if start <= index:
                    found.append((start, index, "repeat", not printed))
                after_last = index + 1

    # An ending opened and never closed runs to the end of what was read — a
    # page break lands in the middle of one constantly.
    last = index
    for number, start in open_endings.items():
        if number == 1:
            found.append((start, last, "first_ending", False))
        elif number == 2:
            found.append((start, last, "second_ending", False))
    # **The forward signs still open, which used to be dropped on the floor.**
    # A `|:` on page 1 closed on page 3 is invisible to a reader given page 1
    # alone, and discarding it is what made the closing sign fall back to the
    # start of its own page. `join_pages` pairs them; this is the only place
    # that can say they exist.
    return found, forwards


def _navigation_in(part_el: ET.Element) -> list[tuple[int, int, str]]:
    """`D.C.`, `D.S.`, `Fine` and `To Coda`, as spans in the same vocabulary.

    **A da capo is a repeat, and this schema can already say so.** The mapping
    is exact rather than approximate, which is why it is worth doing inside a
    closed union of three values:

    - *D.C. al Fine* — play to the D.C., go back to bar 1, stop at Fine. That
      is the span `(1, D.C.)` played twice, with the bars **after Fine** marked
      as a first ending: played the first time through, skipped the second.
    - *D.S. al Fine* — the same from the segno instead of bar 1.
    - *D.C./D.S. al Coda* — play to the D.C., go back, play to "To Coda", jump
      to the coda. The bars between "To Coda" and the D.C. are again a first
      ending, and the coda section is simply the music that follows, which
      `expand_repeats` plays once after the span. No extra machinery.
    - A plain *D.C.* with no Fine and no coda is the span played twice.

    Without this, a musician who takes a da capo plays half the piece again
    against a timeline holding one pass — the identical silent failure the
    repeat barline had, and da capo form is most of the short repertoire a
    student practises.

    **Read from `<sound>` attributes, never from the words.** `<sound
    dacapo="yes">` is unambiguous and every engraver writes it; matching the
    text "D.C. al Fine" is guesswork, and a false positive here does not
    mis-read a bar, it plays half the piece twice. homr writes no `<sound>` at
    all, so scanned pages are unaffected — stated rather than implied, because
    "the importer understands da capo" would otherwise read as a claim about
    photographs.

    **Known limit: an inner `|: :|` inside a da capo section is lost.**
    `expand_repeats` consumes a span's bars, so the outer span swallows the
    inner one. Both were lost before, so this is strictly better, but it is not
    complete and should not be described as if it were.
    """
    segno: int | None = None
    coda_from: int | None = None
    fine: int | None = None
    jump: int | None = None
    from_segno = False

    for index, measure_el in enumerate(part_el.iterfind("measure")):
        for direction in measure_el.iterfind("direction"):
            if direction.find("direction-type/segno") is not None and segno is None:
                segno = index
            for sound in direction.iterfind("sound"):
                if sound.get("segno") is not None and segno is None:
                    segno = index
                # First, not last — the same rule as the segno above and as
                # `min(fine, coda_from)` below, and it was not applied here.
                # A page carries one Fine; two is a misreading, and the one a
                # player reaches first on the second pass is the one they act
                # on. Taking the last meant a spurious mark *after* the real
                # one silently extended the piece.
                if sound.get("fine") is not None and fine is None:
                    fine = index
                if sound.get("tocoda") is not None and coda_from is None:
                    coda_from = index
                if sound.get("dacapo") is not None and jump is None:
                    jump, from_segno = index, False
                elif sound.get("dalsegno") is not None and jump is None:
                    jump, from_segno = index, True

    if jump is None:
        return []
    # A D.S. whose segno was never read goes back to the beginning, which is
    # what a D.C. does — wrong about *where*, right about *that the music
    # repeats*, and the second is worth far more to the timeline than the
    # first. Silently dropping the jump loses both.
    start = segno if (from_segno and segno is not None) else 0
    # A segno printed *after* the D.S. that points at it is a misreading, not a
    # piece. There is no guard for it here: the caller already refuses a span
    # whose end precedes its start, and a mutation removing a check of the same
    # thing here changed nothing — which is what redundant means. The rule is
    # still asserted, one layer down.

    found: list[tuple[int, int, str]] = [(start, jump, "repeat")]
    #: Whichever comes first ends the second pass: `Fine` stops the piece,
    #: `To Coda` sends it elsewhere. Everything after it, up to the jump, is
    #: played once.
    ends = [x for x in (fine, coda_from) if x is not None]
    stop = min(ends) if ends else None
    if stop is not None and start <= stop < jump:
        found.append((stop + 1, jump, "first_ending"))
    return found


def _tempo_mark_in(
    direction: ET.Element,
    words: str | None,
    printed_tempo: tuple[int, str] | None,
    tempo_before: int | None,
    heading: bool,
) -> tuple[str, str, float | None] | None:
    """The tempo change one `<direction>` prints, as (kind, text, bpm), or None.

    **The owner's question, 2026-09-25**: "how am I supposed to account for
    tempo variations or where it says poco". A file states them — `<words>`
    for "poco rit." and "a tempo", a `<metronome>` or `<sound tempo>` for a
    new tempo part-way through — and every one was read and thrown away.

    A metronome mark or `<sound tempo>` is a change only once the piece has a
    tempo: the first one *is* its tempo (`bpm_hint`). Words go through
    `tempo_words.tempo_word`, which reads only what a part prints for tempo.
    """
    stated: float | None = None
    if tempo_before is not None:
        if printed_tempo is not None:
            stated = float(printed_tempo[0])
        else:
            sound = direction.find("sound")
            raw = sound.get("tempo") if sound is not None else None
            try:
                value = float(raw) if raw else None
            except ValueError:
                value = None
            if value is not None and 20 <= value <= 300:
                stated = round(value, 1)
    word = tempo_word(words or "", heading=heading) if words else None
    if stated is not None:
        # A number states a new tempo whatever the words beside it say.
        return ("new_tempo", word.text if word else (words or "new tempo")[:40], stated)
    if word is not None:
        return (word.kind, word.text, None)
    return None


def _tempo_changes(
    marks: list[tuple[int, str, str, float | None]],
    bar_at: Callable[[int], int | None],
) -> list[TempoChange]:
    """The tempo changes, in the finished page's bar numbers, one per bar.

    A bar often prints its words and its metronome mark as two directions —
    "meno mosso" and "♩ = 88" — which are one change: the words, with the
    number.
    """
    by_bar: dict[int, tuple[str, str, float | None]] = {}
    for index, kind, text, bpm in marks:
        bar = bar_at(index)
        if bar is None:
            continue
        held = by_bar.get(bar)
        if held is None:
            by_bar[bar] = (kind, text, bpm)
        elif kind == "new_tempo" and held[0] == "new_tempo":
            by_bar[bar] = (
                "new_tempo",
                held[1] if held[2] is None else text,
                bpm if bpm is not None else held[2],
            )
    return [
        TempoChange(measure_number=bar, kind=kind, text=text, bpm=bpm)  # type: ignore[arg-type]
        for bar, (kind, text, bpm) in sorted(by_bar.items())
    ]


def score_json_from_musicxml(
    xml: str, *, clef_fallback: str | None = None, part: str | None = None
) -> ScoreJson:
    """Convert one MusicXML part into a `ScoreJson`.

    **One part.** A camera photo of a single player's line is one part; a full
    score is a different product problem, and quietly concatenating the parts
    would interleave two instruments into one measure list.

    Which part matters now that files arrive from a publisher rather than from
    an OMR engine reading one staff. A downloaded orchestral score's first part
    is usually the piccolo, and a cellist importing it and getting the piccolo
    line — timed, verdicted, and wrong in a way that looks right — is worse
    than a refusal. `part` names one by id (`P3`) or by the name printed in
    `<part-list>` ("Violoncello"), case-insensitively and by prefix. With more
    than one part and no choice made, this raises rather than guesses.
    """
    try:
        # **`defusedxml`, not `ET.fromstring`.** This function is reached from
        # `POST /v1/scores` with the document taken straight out of a request
        # body, so the XML is whatever somebody sent. Python's ElementTree
        # expands internal entities — measured: four levels of ten turned a
        # 200-byte document into 100,000 characters — which makes a ~1 KB
        # upload into a gigabyte of allocation and an OOM on the API host. It
        # refuses *external* entities, so there is no file read here and never
        # was; the exposure is expansion, and expansion alone is enough to take
        # the API down for everyone from one account.
        #
        # A DOCTYPE is still allowed, and that is the whole reason for the
        # library rather than a blanket refusal: real MusicXML declares one
        # (`<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML …">`),
        # so rejecting DOCTYPEs would reject the format this parser exists for.
        # `defusedxml` forbids the entity *definitions* and leaves the
        # declaration alone.
        root = defused_fromstring(xml)
    except DefusedXmlException as exc:
        raise MusicXMLError(
            "this file defines XML entities, which InTempo does not accept — "
            "re-export it from your notation software"
        ) from exc
    except ET.ParseError as exc:  # pragma: no cover - message varies by lib
        raise MusicXMLError(f"not parseable as XML: {exc}") from exc
    _strip_namespace(root)

    chosen = _choose_part(root, part)

    clef: str | None = None
    #: The clef in force as the measures are walked, which is not the header
    #: once the part changes clef. See where `measure_clef` is set.
    running_clef: str | None = None
    time_signature: str | None = None
    #: The metre in force as the measures are walked — the last one printed
    #: anywhere, not the header. See where `measure_time` is set.
    running_time: str | None = None
    key_signature: str | None = None
    #: The signature in force, as a count of sharps or flats, so a return to
    #: the opening key is seen as the change it is. See `measure_key`.
    running_fifths: int | None = None
    tempo_marking: str | None = None
    bpm_hint: int | None = None
    tempo_beat_unit: str | None = None

    #: Ticks per quarter note, which holds until another `<divisions>` is
    #: stated. Needed only to notice a note whose `<type>` and `<duration>`
    #: contradict each other — see `_duration_name`.
    divisions: int | None = None
    measures: list[Measure] = []
    #: `(index in measures, how many bars it stands for, metre stated on it)`
    pending_rests: list[tuple[int, int, str | None]] = []
    #: Tempo changes printed part-way through — "poco rit.", "a tempo", a new
    #: metronome mark — by source measure index, mapped to the finished page's
    #: bar numbers at the end exactly as the repeats are.
    tempo_marks: list[tuple[int, str, str, float | None]] = []
    #: 1 once an opening anacrusis has taken number 1, so every printed
    #: number after it moves up to stay distinct. See the loop below.
    pickup_shift = 0
    #: `{index in measures: ("start", bars) | ("stop", 0)}` for the `%` sign.
    repeat_marks: dict[int, tuple[str, int]] = {}
    #: The same for the `/` sign, whose pattern is measured in quarter-beats.
    beat_marks: dict[int, tuple[str, float]] = {}
    dropped = 0
    #: Grace notes seen but not yet attached to the note they decorate.
    #:
    #: Kept across the measure loop for the same reason `fermata_pending` is in
    #: `build_timeline`: an engraver may print the ornament before the barline
    #: and the note it decorates after it. Nothing enters `measures` from here
    #: — the count rides on the next real note — so carrying it costs nothing
    #: when the bar ends without one.
    pending_graces = 0
    #: Their pitches, in playing order; an empty string for one that could not
    #: be named, which withholds the whole group's names (see below).
    pending_grace_pitches: list[str] = []
    #: Dynamics and hairpins waiting for the note they stand over, carried
    #: across the barline the same way. A `<direction>` is written before the
    #: note it applies to, and a hairpin's `stop` after the last note under it
    #: — so each lands on the next note or rest in the line being read, which
    #: is where the level it describes takes effect.
    pending_dynamic: str | None = None
    pending_hairpin: str | None = None
    pending_hairpin_end = False
    #: Whether any bracketed group's length was kept as rests, so the sentence
    #: shown to a musician can say so rather than sending them to a short bar
    #: that is no longer short.
    rests_for_unwritable = False
    #: The one staff to read, on a part that writes more than one. None for
    #: every single-line instrument's part — see `_staff_carrying_the_music`.
    kept_staff = _staff_carrying_the_music(chosen)

    def on_kept_staff(el: ET.Element) -> bool:
        """Whether this note or gap belongs to the staff being read.

        An element with no `<staff>` is staff 1, which is what MusicXML says it
        is — not "keep it either way", which would put both hands back into one
        line wherever the lower staff was the one chosen.
        """
        if kept_staff is None:
            return True
        return ((el.findtext("staff") or "").strip() or "1") == kept_staff

    #: Which staff system the bars are on, counted from the page's first.
    #:
    #: `<print new-system="yes">` is the only thing that says, and most files
    #: never write it — an engraver's export usually carries no layout at all.
    #: When none appears, every bar keeps `system=None`, which is honestly "not
    #: known" rather than "all on the first line". `Measure.system` says why the
    #: difference matters.
    #:
    #: The first measure opens system 0 whether or not it is marked; a file that
    #: marks it as well must not be read as starting on system 1.
    #: **Decided before the loop, because "no markers" is not "one system".**
    #: Counting from 0 as bars go by gives every bar on a file with no layout
    #: the answer `0` — a confident claim that the whole part is printed on one
    #: line, which for a page of music is never true and would send a re-read a
    #: crop of the wrong staff. Measured on `orchestral_part.musicxml`, which
    #: carries no `<print>` at all: 19 bars all reporting system 0.
    states_its_layout = chosen.find('.//print[@new-system="yes"]') is not None
    system: int | None = 0 if states_its_layout else None
    opened_a_system = False

    for index, measure_el in enumerate(chosen.iterfind("measure"), start=1):
        if states_its_layout and measure_el.find('print[@new-system="yes"]') is not None:
            # The first bar opens system 0 whether or not it is marked. A file
            # that marks it too must not be read as starting on system 1.
            if opened_a_system or index > 1:
                assert system is not None
                system += 1
            opened_a_system = True

        # **Every** `<attributes>` block in the measure, not the first.
        #
        # A measure may carry more than one, and the first is often only
        # `<divisions>`. homr writes exactly that: measure 1 holds
        # `<attributes><divisions>2</divisions></attributes>` and then a second
        # block with the clef and the key. Reading `find("attributes")` saw the
        # divisions, found no clef, and fell through to `clef_fallback` — which
        # defaulted to *treble*, on a bass part, which is the one thing
        # `ScoreJson.clef` is documented never to do.
        #
        # The metre and key were wrong in a subtler way: the loop kept looking
        # until it found one, so it picked up the **change** at measure 23 and
        # presented 2/2 and F major as the page's header, on a page that starts
        # in cut-common somewhere else entirely.
        measure_time: str | None = None
        measure_clef: str | None = None
        measure_key: str | None = None
        # A multi-bar rest is *this* many bars, and reading it as one is how a
        # bass part loses most of its music. Handled after the attributes loop,
        # because the metre it needs may be stated in this very measure.
        standing_for = _multiple_rest_count(measure_el)
        if (mark := _measure_repeat_mark(measure_el)) is not None:
            repeat_marks[len(measures)] = mark
        if (beat_mark := _beat_repeat_mark(measure_el)) is not None:
            beat_marks[len(measures)] = beat_mark
        for attributes in measure_el.iterfind("attributes"):
            stated_divisions = _text(attributes.find("divisions"))
            if stated_divisions:
                try:
                    divisions = int(stated_divisions) or None
                except ValueError:
                    divisions = None
            # **The clef of the staff being read, not the first one printed.**
            #
            # A grand staff prints two, `<clef number="1">` and
            # `<clef number="2">`, and `find("clef")` takes the top one. On a
            # part whose lower staff carries the music that labels a bass line
            # "Treble clef" — worse than no label at all, by the same rule that
            # keeps `ScoreJson.clef` nullable, and it places every notehead a
            # seventh off on any screen that draws from it.
            clef_el = next(
                (
                    el
                    for el in attributes.iterfind("clef")
                    if kept_staff is None or el.get("number") in (None, kept_staff)
                ),
                None,
            )
            if clef_el is not None:
                sign = _text(clef_el.find("sign")) or ""
                line = _text(clef_el.find("line")) or ""
                stated_clef = _CLEF_BY_SIGN_LINE.get((sign, line))
                if clef is None:
                    clef = stated_clef
                if stated_clef is not None and stated_clef != running_clef:
                    # **A clef printed mid-piece is a change of clef**, exactly
                    # as a metre printed mid-piece is a change of metre, and it
                    # belongs on the measure for the same reason. A cello part
                    # moving into tenor for a high passage is ordinary writing;
                    # overwriting the header with it would caption the whole
                    # page — including everything before the change — with a
                    # clef it does not use, which is the failure
                    # `ScoreJson.clef` is nullable to avoid.
                    #
                    # **Compared against the running clef, not the header.** A
                    # part that moves into tenor at bar 20 and back to bass at
                    # bar 40 states bass at 40, which equals the header — so
                    # comparing against the header would record the departure
                    # and silently drop the return, leaving every bar after 40
                    # captioned tenor. `clef` stays the clef the page opens in,
                    # which is what a reader wants when nothing says otherwise.
                    if running_clef is not None:
                        measure_clef = stated_clef
                    running_clef = stated_clef

            time_el = attributes.find("time")
            beats = _text(time_el.find("beats")) if time_el is not None else None
            beat_type = (
                _text(time_el.find("beat-type")) if time_el is not None else None
            )
            # Checked against the grammar the schema enforces rather than
            # trusted: these are two text nodes out of a file nobody here
            # wrote, and `<beats>four</beats>` built `four/four`, which `Note`
            # and `ScoreJson` reject by raising — past the `MusicXMLError` the
            # import route catches, and out as a 500. An unreadable metre is
            # what `unknown` and `None` are already for.
            if beats and beat_type and TIME_SIG_PATTERN.match(f"{beats}/{beat_type}"):
                stated = f"{beats}/{beat_type}"
                if time_signature is None:
                    time_signature = stated
                if stated != running_time:
                    # A metre printed mid-piece is a change of metre, and it
                    # belongs on the measure — which is where `meters_in_force`
                    # reads changes from. Overwriting the header instead
                    # reports every bar before it as having the wrong number of
                    # beats, on a file that states both correctly.
                    #
                    # **Compared against the running metre, not the header**,
                    # the rule the clef below already follows. This compared
                    # against `time_signature`, so a piece in 4/4 that turns
                    # 2/4 at bar 5 and back at bar 9 recorded the departure and
                    # dropped the return — bar 9 states 4/4, which *equals* the
                    # header — and `meters_in_force` then held 2/4 to the end,
                    # calling every correctly-read bar after 9 long.
                    if running_time is not None:
                        measure_time = stated
                    running_time = stated

            key_el = attributes.find("key")
            if key_el is not None:
                raw = _text(key_el.find("fifths"))
                try:
                    fifths = int(raw) if raw is not None else None
                except ValueError:
                    fifths = None
                stated_key = (
                    _key_name(fifths, _text(key_el.find("mode")))
                    if fifths is not None
                    else None
                )
                if stated_key is not None:
                    if key_signature is None:
                        key_signature = stated_key
                    # **A key printed mid-piece is a change of key**, the same
                    # shape as the metre and the clef above, and compared the
                    # same way — against what is in force, by *signature*: a
                    # file that restates the header in every bar changes
                    # nothing, and one that returns to the opening key at bar
                    # 20 changes back. `key_signature` stays the key the page
                    # opens in. Before this, every `<key>` after the first was
                    # read and thrown away.
                    if fifths != running_fifths:
                        if running_fifths is not None:
                            measure_key = stated_key
                        running_fifths = fifths

        for direction in measure_el.iterfind("direction"):
            words = _text(direction.find("direction-type/words"))
            # A tempo is already established when this direction is read: a
            # metronome mark after that is a change, before it the piece's own.
            tempo_before = bpm_hint
            # "cresc." is often the first word a part prints, and it is not a
            # tempo; it became this piece's tempo marking until it was read as
            # the hairpin it is, in the loop over the bar's notes below.
            if words and tempo_marking is None and hairpin_from_text(words) is None:
                tempo_marking = words
            printed_tempo = _metronome_tempo(direction)
            marked = _tempo_mark_in(direction, words, printed_tempo, tempo_before, index == 1)
            if marked is not None:
                tempo_marks.append((len(measures), *marked))
            if printed_tempo is not None and tempo_beat_unit is None:
                tempo_beat_unit = printed_tempo[1]
            sound = direction.find("sound")
            if sound is not None and bpm_hint is None:
                raw_tempo = sound.get("tempo")
                if raw_tempo:
                    try:
                        candidate = int(round(float(raw_tempo)))
                    except ValueError:
                        candidate = 0
                    if 20 <= candidate <= 300:
                        bpm_hint = candidate
            # `<sound>` is quarter-note BPM by definition and outranks the
            # converted mark. The mark's unit is still kept for display.
            if bpm_hint is None and printed_tempo is not None:
                bpm_hint = printed_tempo[0]

        notes: list[Note] = []
        #: Every note the measure holds, before the voice filter — the fallback
        #: if filtering leaves nothing.
        not_filtered: list[Note] = []
        slur_starts: dict[str, int] = {}
        #: The printed ratio for each note in `notes`, positionally.
        ratios: list[tuple[int, int] | None] = []
        slurs: list[Slur] = []

        # `<backup>` rewinds the clock so a second voice can be written over
        # the same bar — normal in any divisi or piano part. Reading straight
        # through it counts both voices as consecutive notes, so a 4/4 bar
        # comes out as 8 beats and the beat-sum check calls a correct file
        # broken. Only the first voice is kept: the timeline is one line of
        # music, and a cellist recording themselves plays one of the two.
        # Gated on `<backup>`, not on voice numbers. Audiveris assigns voice
        # numbers freely within a single line — filtering on them alone dropped
        # real consecutive notes and made bars that added up stop adding up.
        # `<backup>` is the actual signal that the clock was rewound to write
        # something over the same bar.
        rewound = measure_el.find("backup") is not None
        # The staff filter runs first, and the voice filter must be decided on
        # what survives it. A grand staff writes each hand in its own voice, so
        # asking the whole bar would see two voices where the line being read
        # has one — and then drop half of it a second time.
        on_staff = [el for el in measure_el.iterfind("note") if on_kept_staff(el)]
        voices = [(el.findtext("voice") or "").strip() for el in on_staff]
        kept_voice = _voice_carrying_the_music(
            _only(on_staff) if kept_staff is not None else measure_el
        )
        multi_voice = rewound and len({v for v in voices if v}) > 1

        #: How many notes this bar lost to a value the schema cannot write.
        dropped_here = 0

        #: Beats belonging to bracketed groups whose parts have no name.
        #:
        #: Accumulated rather than emitted note by note, and flushed as rests
        #: at the next note the bar keeps — which is where the group sat. See
        #: `_unnameable_tuplet_beats`.
        unnamed_beats = 0.0

        def flush_unnamed() -> None:
            """Turn a measured but unwritable run into the silence it lasted.

            **Not an approximation of the notes.** Nothing here knows where the
            five attacks of a quintuplet fell, and inventing five onsets would
            put notes at times nobody played — the same reason
            `_duration_name` refuses to round a quintuplet to the nearest
            triplet. What is known is how long the group took, and a rest is
            how this schema says "time passes here and no attack is claimed".

            The musician does play those notes, so they arrive as attacks the
            timeline did not expect. That was already true when the notes were
            dropped; what was *also* true then, and is not now, is that every
            bar after them was expected early.

            A run whose total no combination of rests can express — an
            incomplete group the reader only half saw — flushes nothing and
            leaves the bar visibly short, which the beat check can see.
            """
            nonlocal unnamed_beats, rests_for_unwritable
            if unnamed_beats <= 0:
                return
            for name in _rests_for_gap(unnamed_beats):
                rests_for_unwritable = True
                silence = Note(pitch="rest", duration=name)  # type: ignore[arg-type]
                not_filtered.append(silence)
                notes.append(silence)
                ratios.append(None)
            unnamed_beats = 0.0

        for child in measure_el:
            if child.tag in ("note", "forward", "direction") and not on_kept_staff(child):
                continue
            if child.tag == "direction":
                # Read here, in the order the bar is written, and not in the
                # loop over `<direction>` above: that loop knows a bar has a
                # dynamic but not which note it stands over, and for years it
                # found each one and discarded it.
                for mark in child.iterfind("direction-type/dynamics/*"):
                    if mark.tag in _DYNAMIC_TAGS:
                        pending_dynamic = mark.tag
                for wedge in child.iterfind("direction-type/wedge"):
                    kind = wedge.get("type")
                    if kind == "stop":
                        pending_hairpin_end = True
                    elif kind in ("crescendo", "diminuendo"):
                        pending_hairpin = kind
                # "cresc." and "dim." are hairpins with no room to draw one.
                for words in child.iterfind("direction-type/words"):
                    written = hairpin_from_text(_text(words) or "")
                    if written is not None:
                        pending_hairpin = written
                continue
            if child.tag == "forward":
                # Only the kept voice's gaps: a `<forward>` belonging to a
                # voice that was filtered out would pad this bar with silence
                # that is not in the line being read.
                gap_voice = (child.findtext("voice") or "").strip()
                if multi_voice and gap_voice and gap_voice != kept_voice:
                    continue
                raw = _text(child.find("duration"))
                if raw is None or divisions in (None, 0):
                    continue
                try:
                    gap = float(raw) / float(divisions)  # type: ignore[arg-type]
                except ValueError:
                    continue
                for name in _rests_for_gap(gap):
                    silence = Note(pitch="rest", duration=name)  # type: ignore[arg-type]
                    not_filtered.append(silence)
                    notes.append(silence)
                    ratios.append(None)
                continue
            if child.tag != "note":
                continue
            note_el = child
            # A chord member shares its predecessor's onset. The timeline is
            # built from durations, so counting the second note of a chord
            # would make the measure overrun and the beat-sum check would call
            # a correctly-read measure long.
            #
            # **Not counted, and no longer thrown away.** Skipping it outright
            # was right about the timeline and lost the music: a double stop is
            # two noteheads and the reading kept one, so a stave drawn from it
            # shows a single note where the page has two and the edit screen has
            # nowhere to put the other. `chord_pitches` is additive — it changes
            # no duration and adds no onset — so the count stays exactly as it
            # was. See `Note.chord_pitches`.
            if note_el.find("chord") is not None:
                # A grace chord's second note is part of the ornament, not of
                # the note before it: stacking it there sounded an ornament's
                # pitch for the whole length of the previous note.
                if note_el.find("grace") is not None:
                    continue
                member = _pitch_name(note_el)
                # `not_filtered` rather than `notes`: it holds every note built
                # in this measure including ones the voice filter dropped, so
                # its last entry is always the notehead this one is stacked on.
                # A chord member of a dropped note lands on a dropped note,
                # which is where it belongs.
                if member and member != "rest" and not_filtered:
                    principal = not_filtered[-1]
                    if principal.pitch != "rest" and member not in principal.chord_pitches:
                        principal.chord_pitches.append(member)
                continue
            # **A grace note has no duration and is still an attack.**
            #
            # It is not counted as a note — it has no `<duration>`, and giving
            # it one would make the beat sum of a correctly-read bar wrong.
            # But it *is* played, and this used to end there, which left the
            # timeline missing an onset the page prints. Measured on sixteen
            # quarters played exactly on the grid, four appoggiaturas scored
            # 0.416 and six scored **0.000** — `alignment_failed` on a perfect
            # take, because `_initial_ratio` reads the pace off the gaps
            # between detections and unexplained onsets halve it.
            #
            # So it is counted on the note it decorates instead. Same voice
            # rule as everything else here, and a chord member does not count
            # again: a rolled grace chord is one attack, exactly as a chord is.
            if note_el.find("grace") is not None:
                grace_voice = (note_el.findtext("voice") or "").strip()
                if not (multi_voice and grace_voice and grace_voice != kept_voice):
                    pending_graces += 1
                    named = _pitch_name(note_el)
                    pending_grace_pitches.append(named if named and named != "rest" else "")
                continue
            # **A cue note is time you do not play.**
            #
            # It is how an orchestral part tells you where to come in: the
            # small notes printed after a long rest showing what somebody else
            # is playing. The musician rests through them. Unlike a grace note
            # it carries a `<duration>` and occupies its place in the bar, so
            # it is neither a note nor droppable — dropping it leaves the bar
            # short and `alignment.py` accumulates, and keeping it puts an
            # onset in the timeline that nobody will ever play.
            #
            # Measured before this line existed: a bar of four cue quarters
            # read back as four played notes at A4, `validate_measures` said
            # `ok`, `notes_to_human` was empty and confidence was 1.00 —
            # every mechanism for doubt silent on a bar that is wrong. The
            # musician who rests correctly through it is then told they missed
            # four notes, on the bar before a difficult entry, which is the one
            # bar they most need the app to be right about.
            #
            # Rewritten to a rest rather than filtered, which keeps the time.
            cue = note_el.find("cue") is not None
            filtered_out = False
            this_voice = (note_el.findtext("voice") or "").strip()
            # An *untagged* note is not in a competing voice — it is a note.
            # Dropping those emptied a bar outright in the bundled Audiveris
            # fixture, which is a worse reading than the double-count this
            # filter exists to prevent.
            if multi_voice and this_voice and this_voice != kept_voice:
                filtered_out = True

            # A cue's own pitch is discarded rather than read, so a cue
            # carrying a double accidental keeps its time instead of being
            # dropped for a pitch that was never going to be played.
            pitch = "rest" if cue else _pitch_name(note_el)
            duration = _duration_name(note_el, divisions)
            if pitch is None or duration is None:
                # A bracket with no name still has a length. Held rather than
                # emitted here so the whole group is measured together: one
                # note of a quintuplet is a fifth of a beat and no rest writes
                # that, while five of them are a quarter and one does.
                #
                # Asked without re-testing `duration is None`: the branch it
                # sits in already implies it, and the helper makes the same
                # test itself. Two copies of one condition is how they come to
                # disagree, so the helper is the single place that says what
                # "unnameable" means — which does make its own guard
                # unreachable from here, and a mutation removing it survives.
                unnameable = _unnameable_tuplet_beats(note_el)
                if unnameable is not None:
                    unnamed_beats += unnameable
                dropped += 1
                # Which bar lost it, by position — the numbers are still being
                # decided (a multi-bar rest shifts everything after it), so the
                # index is the only stable handle until the end.
                # Counted on the measure itself rather than in a map keyed by
                # position. The map had to be read back through `moved`,
                # because expanding a multi-bar rest shifts every index after
                # it — a mapping that was got wrong once already, and that the
                # measure object simply carries through the expansion instead.
                dropped_here += 1
                # `pending_graces` is deliberately **not** cleared. The note
                # this ornament decorated is gone, but the attack was still
                # made, and the same rule that governs the dropped note governs
                # its grace: an onset lost outright is worse than one placed a
                # little late. It rides on to the next real note, which is the
                # nearest true thing left to attach it to.
                continue

            # A tie out of a cue would be a tie out of a rest, and the tie
            # check reads a tie as two noteheads sharing a pitch — so keeping
            # it would raise a broken-tie concern about a bar that is right.
            tied = not cue and (
                any(tie.get("type") == "start" for tie in note_el.iterfind("tie"))
                or any(
                    tie.get("type") == "start"
                    for tie in note_el.iterfind("notations/tied")
                )
            )

            # A grace before something nobody plays decorates nothing. A rest
            # has no attack to ornament, and a cue is somebody else's line —
            # keeping the count there would put invented onsets in a bar the
            # musician sits through, which is the bar before an entry and the
            # one they most need to be right.
            graces = 0 if pitch == "rest" else pending_graces
            # Every ornament named, or none: a group with one unreadable pitch
            # keeps its count for the timeline and loses its names, because a
            # run played with a note missing is a different ornament.
            grace_pitches = (
                pending_grace_pitches
                if graces and all(pending_grace_pitches)
                else []
            )
            pending_graces = 0
            pending_grace_pitches = []
            # Markings go to the line being read, never to a note from a voice
            # the filter dropped — the level would change on nothing heard.
            # A rest takes them: the level is in force from where it is written.
            marked = not filtered_out
            # A dynamic written on the note itself outranks one in a direction.
            own_dynamic = next(
                (
                    mark.tag
                    for mark in note_el.iterfind("notations/dynamics/*")
                    if mark.tag in _DYNAMIC_TAGS
                ),
                None,
            )
            # The rests stand where the group stood, so this runs before the
            # note that ended the run is appended and not after it.
            flush_unnamed()

            built = Note(
                pitch=pitch,
                duration=duration,  # type: ignore[arg-type]
                articulation=_articulation(note_el),  # type: ignore[arg-type]
                tied_to_next=tied,
                grace_notes=graces,
                grace_pitches=grace_pitches,
                # Anywhere in `<notations>`; the spec allows several and their
                # shape and placement are engraving, not duration.
                fermata=note_el.find("notations/fermata") is not None,
                dynamics=(own_dynamic or pending_dynamic) if marked else None,
                hairpin=pending_hairpin if marked else None,
                hairpin_end=pending_hairpin_end if marked else False,
            )
            if marked:
                pending_dynamic = None
                pending_hairpin = None
                pending_hairpin_end = False
            not_filtered.append(built)
            if filtered_out:
                continue
            notes.append(built)
            ratios.append(_tuplet_ratio(note_el))

            for slur in note_el.iterfind("notations/slur"):
                number = slur.get("number", "1")
                if slur.get("type") == "start":
                    slur_starts[number] = len(notes) - 1
                elif slur.get("type") == "stop":
                    start = slur_starts.pop(number, None)
                    if start is not None:
                        slurs.append(
                            Slur(start_note_index=start, end_note_index=len(notes) - 1)
                        )

        raw_number = measure_el.get("number")
        try:
            number = int(raw_number) if raw_number is not None else index
        except ValueError:
            number = index
        # **An anacrusis has no number on the page, and giving it one used to
        # collide with the bar after it.**
        #
        # An upbeat is written `<measure number="0" implicit="yes">`, and
        # `Measure` requires 1 or more — so it fell back to its position, which
        # is 1, and the printed bar 1 that follows is also 1. Two measures with
        # the same number, on a very large share of real files.
        #
        # Measured, on a part with an upbeat and a repeat: `expand_repeats`
        # builds `{number: measure}`, so the one-note pickup was **replaced by
        # a copy of the four-note bar 1** and every played copy of it too — the
        # timeline gained three beats nobody plays and lost the upbeat.
        # `numbering_gaps` reported `1→1`, so the musician was also told a
        # rehearsal mark had probably been counted as a bar, about a page read
        # perfectly.
        #
        # The pickup takes 1 and everything printed after it shifts up by one.
        # That is one more than the page says, which is a real cost and the only
        # option the schema leaves: the alternative is a duplicate that deletes
        # music. `pipeline.renumber` already did exactly this shift on the
        # provider path — the import route never called it, which is why the
        # duplicate survived there.
        #
        # Only the *first* measure, and only when it is numbered below 1.
        #
        # `implicit="yes"` marks it too, and keying on that as well was wrong —
        # a mutation removing it survived, and looking at why showed the clause
        # doing harm. Some engravers number the upbeat **1** and the first full
        # bar **2**; those numbers already collide with nothing, and shifting
        # turns them into 1 and 3 — a gap `numbering_gaps` then reports on a
        # page that is perfectly read. A mid-piece `implicit="yes"` is a bar
        # split across a system break, which is a third thing again.
        #
        # Below 1 is the collision and the only collision: `Measure` refuses it,
        # so it falls back to its position, which is the number the next bar
        # already has.
        if index == 1 and number < 1:
            pickup_shift = 1
            number = 1
        elif number >= 1:
            number += pickup_shift
        # Position in the list is what everything downstream uses.
        # Never let the voice filter empty a bar. A measure with no notes is
        # not a reading, it is a hole — and `validate.py` reports one as a sign
        # that something which was not a measure was counted as one. If picking
        # a voice removed everything, the guess about voices was wrong.
        if not notes and not_filtered:
            # **A copy, and the copy is the fix.** This was `notes =
            # not_filtered`, which aliases: `flush_unnamed` below appends each
            # rest to `not_filtered` *and* to `notes`, so once they were one
            # list every flushed rest went in twice.
            #
            # It needed a bar the voice filter emptied and an unnameable tuplet
            # running to the barline with no note after it to flush it early —
            # narrow, and silent when it hit. Measured on such a bar: 1 quarter
            # of real music and a 1.5-beat group came back as a quarter and
            # **two** dotted-quarter rests, which sums to exactly 4.0 in 4/4.
            # So the bar looked *correct* to the beat check while carrying 1.5
            # beats of silence nobody played, and every note after it on the
            # page was expected late.
            notes = list(not_filtered)

        # A group that ran to the barline has no following note to flush it.
        flush_unnamed()

        # Consecutive notes carrying the same ratio are one bracket. MusicXML
        # also marks brackets with `<notations><tuplet type="start"/>`, but not
        # every exporter writes them, whereas `<time-modification>` is what
        # actually changes the arithmetic and is therefore always present.
        tuplets: list[Tuplet] = []
        run_start = 0
        for position in range(len(ratios) + 1):
            ending = position == len(ratios) or ratios[position] != ratios[run_start]
            if not ending:
                continue
            ratio = ratios[run_start] if run_start < len(ratios) else None
            if ratio is not None and run_start < len(notes):
                tuplets.append(
                    Tuplet(
                        start_note_index=run_start,
                        end_note_index=min(position, len(notes)) - 1,
                        actual_notes=ratio[0],
                        normal_notes=ratio[1],
                    )
                )
            run_start = position

        # A multi-bar rest is recorded here and expanded after the loop —
        # the bar length it needs may not be knowable until the whole part has
        # been read. See `_expand_multiple_rests`.
        # **Rests do not count against it, and that is not a loosening.**
        #
        # This read `not notes`, on the reasoning that a bar carrying both a
        # multi-rest marking and notes is a contradiction and the notes are the
        # half definitely read off the page. That reasoning holds for *pitched*
        # notes and is wrong for rests, because homr writes the multi-rest
        # marking **together with** the rest symbols that draw it — measured on
        # `page-upright.jpg`, a bar marked `<multiple-rest>8</multiple-rest>`
        # carrying a whole rest and a breve rest. Under `not notes` it stayed
        # one bar, and **seven bars of rest were lost** — the same failure this
        # expansion was written to fix, blocked by its own guard.
        if standing_for and not any(note.pitch != "rest" for note in notes):
            pending_rests.append((len(measures), standing_for, measure_time))

        measures.append(
            Measure(
                measure_number=number if number >= 1 else index,
                system=system,
                notes=notes,
                slurs=slurs,
                tuplets=tuplets,
                time_signature=measure_time,
                clef=measure_clef,  # type: ignore[arg-type]
                key_signature=measure_key,
                unwritable_notes=dropped_here,
            )
        )

    # Both of these need the bar length in force, and neither can know it
    # during the loop above: the only `<time>` on a real photographed part is
    # often printed mid-page, after a double barline.
    # Before the bar lengths are taken, so a bar the `%` sign filled votes on
    # the metre with the music it actually holds.
    measures = _fill_measure_repeats(
        measures, repeat_marks, {index for index, _, _ in pending_rests}
    )
    # After the whole-bar sign, so a `/` bar can repeat a beat of a bar a `%`
    # has just filled. Both run before `_bar_lengths`, which is what lets a
    # filled bar vote on a metre nobody printed.
    measures = _fill_beat_repeats(
        measures, beat_marks, _stated_bar_lengths(measures, time_signature)
    )

    lengths = _bar_lengths(measures, time_signature)
    measures = _whole_rests_that_mean_a_bar(measures, lengths)
    measures, moved = _expand_multiple_rests(measures, pending_rests, lengths)

    #: The repeats, in the numbers the finished page uses.
    #:
    #: An index maps to the *first* bar that measure produced; the end of a
    #: span maps to the *last*, which is the bar before the next source
    #: measure began. They differ only where a multi-bar rest expanded — and a
    #: repeat whose last bar is a four-bar rest is otherwise three bars short,
    #: which is a whole phrase of silence the musician plays and the timeline
    #: does not.
    def _first_bar(index: int) -> int | None:
        if not 0 <= index < len(moved):
            return None
        return measures[moved[index]].measure_number

    def _last_bar(index: int) -> int | None:
        if not 0 <= index < len(moved):
            return None
        stop = moved[index + 1] - 1 if index + 1 < len(moved) else len(measures) - 1
        return measures[stop].measure_number if 0 <= stop < len(measures) else None

    repeats: list[Repeat] = []
    barline_spans, unclosed_forwards = _repeats_in(chosen)
    # Navigation spans are never inferred openings: a D.C. names bar 1 of the
    # piece because that is what "da capo" means, not because a sign was
    # missing. Pairing one with a `|:` from an earlier page would be nonsense.
    spans = barline_spans + [(s, e, k, False) for s, e, k in _navigation_in(chosen)]
    for start_index, end_index, kind, start_inferred in spans:
        first = _first_bar(start_index)
        last_bar = _last_bar(end_index)
        if first is None or last_bar is None or last_bar < first:
            continue
        repeats.append(
            Repeat(  # type: ignore[arg-type]
                start_measure=first,
                end_measure=last_bar,
                type=kind,
                start_inferred=start_inferred,
            )
        )

    # In measure numbers, like every span above, and dropping any index that
    # names no bar — the same guard the spans get.
    unclosed_repeat_starts = [
        bar for bar in (_first_bar(i) for i in unclosed_forwards) if bar is not None
    ]

    # **A number that repeats identifies no bar at all.**
    #
    # Everything downstream keys off `measure_number`: `validate_measures`
    # groups broken ties and tuplet faults by it, `MeasureConcern` is how a
    # screen points at a bar, `MeasureEditScreen` is opened by it, and the
    # verdict groups per-note deltas by it. Measured on three bars all numbered
    # 3, one of them carrying a tie between two pitches: **three identical
    # concerns**, on three different bars, two of which were correct — and each
    # offering to open bar 3 for repair.
    #
    # Real, and not hypothetical: `oemer_phone_photo` reads back as
    # `[1, 2, 3, 3, 3]`. `pipeline.renumber` already fixes this for a *scanned*
    # page, positionally and always, and it is right to — a page read by a
    # model has no numbering worth keeping. But it does not run on
    # `POST /v1/scores/import`, where the numbering usually *is* the printed
    # part's and a bar labelled 47 should stay 47.
    #
    # So the rule here is the narrow one that serves both: keep the file's
    # numbering unless it cannot identify a bar. Strictly increasing is the
    # test, which leaves **gaps alone** on purpose — 1, 2, 3, 409 is a boxed
    # rehearsal mark counted as a bar, and `numbering_gaps` is what catches it.
    # Renumbering that away is exactly the signal `_expand_multiple_rests`
    # shifts rather than renumbers to protect.
    numbers = [m.measure_number for m in measures]
    renumbered = any(b <= a for a, b in pairwise(numbers))
    if renumbered:
        measures = [
            measure.model_copy(update={"measure_number": position})
            for position, measure in enumerate(measures, start=1)
        ]

    tempo_changes = _tempo_changes(
        tempo_marks,
        lambda index: measures[moved[index]].measure_number if 0 <= index < len(moved) else None,
    )

    total_notes = sum(len(m.notes) for m in measures)
    # Confidence an engine did not report, inferred from what had to be thrown
    # away. A run that dropped a fifth of its notes for want of a readable type
    # or pitch is not a 0.9 transcription however sure the engine sounded.
    if total_notes + dropped == 0:
        confidence = 0.0
    else:
        confidence = round(total_notes / (total_notes + dropped), 3)

    sentences: list[str] = []
    if renumbered:
        sentences.append(
            "The bar numbers in this file do not run in order, so the bars "
            "have been numbered from 1 as they appear."
        )

    notes_to_human = ""
    if dropped:
        # Read off the measures themselves, so the expansion cannot move them
        # out from under the count. This mapped indices through `moved` and got
        # it wrong once: a page whose third measure lost notes, with a four-bar
        # rest above it, named measure 3 where the bar is number 6.
        numbers = sorted(
            measure.measure_number
            for measure in measures
            if measure.unwritable_notes
        )
        where = ""
        if numbers:
            named = ", ".join(str(n) for n in numbers[:6])
            if len(numbers) > 6:
                named += f" and {len(numbers) - 6} more"
            where = f" in measure{'s' if len(numbers) > 1 else ''} {named}"
        # **"Dropped" stopped being the whole truth.** A bracketed group with no
        # writable parts now keeps its length as rests, so the bar adds up and
        # the page after it stays in place — and a musician sent to look for a
        # short bar would find nothing wrong with it. The count is still the
        # count of notes this schema could not write; what changed is what
        # happened to their time.
        kept = " Where a whole tuplet was unwritable its length was kept as a rest."
        notes_to_human = (
            f"{dropped} note(s) in the MusicXML could not be represented "
            "(double accidental, double dot, or a duration outside this schema) "
            f"and were dropped{where}."
        ) + (kept if rests_for_unwritable else "")
    if notes_to_human:
        sentences.append(notes_to_human)
    notes_to_human = " ".join(sentences)

    return ScoreJson(
        time_signature=time_signature,
        key_signature=key_signature,
        tempo_marking=tempo_marking,
        tempo_beat_unit=tempo_beat_unit or ("quarter" if bpm_hint is not None else None),
        bpm_hint=bpm_hint,
        clef=clef or clef_fallback,  # type: ignore[arg-type]
        measures=measures,
        repeats=repeats,
        unclosed_repeat_starts=unclosed_repeat_starts,
        tempo_changes=tempo_changes,
        ocr_confidence=confidence,
        notes_to_human=notes_to_human,
    )
