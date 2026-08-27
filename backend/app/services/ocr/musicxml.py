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

import xml.etree.ElementTree as ET
from typing import Final

from app.services.ocr.validate import infer_beats_per_measure
from app.services.score_schema import (
    DURATION_BEATS,
    Measure,
    Note,
    Repeat,
    ScoreJson,
    Slur,
    Tuplet,
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
}
#: Three in the time of two, by base value. A file states a tuplet in
#: `<time-modification>` — `actual-notes` over `normal-notes` — so a triplet is
#: read rather than inferred from the beam.
_TRIPLET: Final[dict[str, str]] = {
    "half": "triplet_half",
    "quarter": "triplet_quarter",
    "eighth": "triplet_eighth",
    "sixteenth": "triplet_sixteenth",
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

_ALTER_SUFFIX: Final[dict[int, str]] = {-1: "b", 0: "", 1: "#"}

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


def _duration_name(note: ET.Element, divisions: int | None = None) -> str | None:
    kind = _text(note.find("type"))
    if kind is None:
        return None
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
    # A tuplet before a dot: a dotted triplet has no name in `Duration` either,
    # and reporting the triplet is closer to the truth than reporting the dot.
    actual = _text(note.find("time-modification/actual-notes"))
    normal = _text(note.find("time-modification/normal-notes"))
    if actual == "3" and normal == "2":
        # Only the 3:2 case. A quintuplet or septuplet has no name here, and
        # guessing the nearest triplet would put notes at times nobody played.
        return _TRIPLET.get(base)
    if actual is not None and actual != "1":
        return None

    dots = len(note.findall("dot"))
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


def _quarter_beats(time_signature: str | None) -> float | None:
    """Quarter-note beats in one bar of this metre, or None.

    A local copy of the one line `validate.beats_per_measure` computes, kept
    here rather than imported so the importer does not depend on the validator
    — this module is what the validator reads, and the arrow has only ever
    pointed one way.
    """
    if not time_signature or time_signature == "unknown":
        return None
    try:
        upper, lower = time_signature.split("/")
        count, unit = int(upper), int(lower)
    except (ValueError, AttributeError):
        return None
    if count <= 0 or unit <= 0:
        return None
    return count * (4.0 / unit)


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


def _pitch_name(note: ET.Element) -> str | None:
    if note.find("rest") is not None:
        return "rest"
    pitch = note.find("pitch")
    if pitch is None:
        return None
    step = _text(pitch.find("step"))
    octave = _text(pitch.find("octave"))
    if step is None or octave is None:
        return None
    try:
        alter = int(float(_text(pitch.find("alter")) or "0"))
    except ValueError:
        alter = 0
    suffix = _ALTER_SUFFIX.get(alter)
    if suffix is None:
        # Double sharps and flats are not in the pitch grammar. Naming the
        # natural instead would be a wrong note, so drop it and let the note
        # count fall short, which the validator can see.
        return None
    return f"{step}{suffix}{octave}"


def _articulation(note: ET.Element) -> str | None:
    for articulations in note.iterfind("notations/articulations"):
        for child in articulations:
            mapped = _ARTICULATION_TAGS.get(child.tag)
            if mapped is not None:
                return mapped
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
    running = _quarter_beats(header_metre)
    out: list[float | None] = []
    for measure in measures:
        if measure.time_signature is not None:
            running = _quarter_beats(measure.time_signature)
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
    for measure, beats in zip(measures, lengths):
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
        beats = _quarter_beats(metre) or lengths[index]
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


def _repeats_in(part_el: ET.Element) -> list[tuple[int, int, str]]:
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
                            found.append((start, index, "first_ending"))
                        elif numbers == {2}:
                            found.append((start, index, "second_ending"))

            repeat = barline.find("repeat")
            if repeat is None:
                continue
            direction = repeat.get("direction")
            if direction == "forward":
                forwards.append(index)
            elif direction == "backward":
                start = forwards.pop() if forwards else after_last
                if start <= index:
                    found.append((start, index, "repeat"))
                after_last = index + 1

    # An ending opened and never closed runs to the end of what was read — a
    # page break lands in the middle of one constantly.
    last = index
    for number, start in open_endings.items():
        if number == 1:
            found.append((start, last, "first_ending"))
        elif number == 2:
            found.append((start, last, "second_ending"))
    return found


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
        root = ET.fromstring(xml)
    except ET.ParseError as exc:  # pragma: no cover - message varies by lib
        raise MusicXMLError(f"not parseable as XML: {exc}") from exc
    _strip_namespace(root)

    chosen = _choose_part(root, part)

    clef: str | None = None
    time_signature: str | None = None
    key_signature: str | None = None
    tempo_marking: str | None = None
    bpm_hint: int | None = None

    #: Ticks per quarter note, which holds until another `<divisions>` is
    #: stated. Needed only to notice a note whose `<type>` and `<duration>`
    #: contradict each other — see `_duration_name`.
    divisions: int | None = None
    measures: list[Measure] = []
    #: `(index in measures, how many bars it stands for, metre stated on it)`
    pending_rests: list[tuple[int, int, str | None]] = []
    dropped = 0
    #: `{index in measures: how many notes that bar lost}`.
    #:
    #: **Because "5 notes were dropped" does not say where to look.** The
    #: sentence is the only trace a dropped note leaves — the bar itself just
    #: comes out short, and if it is the *first* bar `validate_measures`
    #: forgives it as a pickup and flags nothing at all. Measured: the same
    #: damaged bar reads `short` in the middle of a page and `pickup` at the
    #: start of one, where no concern reaches the app and `MeasureEditScreen`
    #: cannot be opened for it.
    #:
    #: Naming the bars does not fix that forgiveness — that needs a field on a
    #: schema the app shares — but it does give a musician the one thing they
    #: need, which is which bar to go and look at.
    dropped_at: dict[int, int] = {}

    for index, measure_el in enumerate(chosen.iterfind("measure"), start=1):
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
        # A multi-bar rest is *this* many bars, and reading it as one is how a
        # bass part loses most of its music. Handled after the attributes loop,
        # because the metre it needs may be stated in this very measure.
        standing_for = _multiple_rest_count(measure_el)
        for attributes in measure_el.iterfind("attributes"):
            stated_divisions = _text(attributes.find("divisions"))
            if stated_divisions:
                try:
                    divisions = int(stated_divisions) or None
                except ValueError:
                    divisions = None
            clef_el = attributes.find("clef")
            if clef is None and clef_el is not None:
                sign = _text(clef_el.find("sign")) or ""
                line = _text(clef_el.find("line")) or ""
                clef = _CLEF_BY_SIGN_LINE.get((sign, line))

            time_el = attributes.find("time")
            beats = _text(time_el.find("beats")) if time_el is not None else None
            beat_type = (
                _text(time_el.find("beat-type")) if time_el is not None else None
            )
            if beats and beat_type:
                stated = f"{beats}/{beat_type}"
                if time_signature is None:
                    time_signature = stated
                elif stated != time_signature:
                    # A metre printed mid-piece is a change of metre, and it
                    # belongs on the measure — which is where `meters_in_force`
                    # reads changes from. Overwriting the header instead
                    # reports every bar before it as having the wrong number of
                    # beats, on a file that states both correctly.
                    measure_time = stated

            key_el = attributes.find("key")
            if key_signature is None and key_el is not None:
                raw = _text(key_el.find("fifths"))
                if raw is not None:
                    try:
                        key_signature = _key_name(int(raw), _text(key_el.find("mode")))
                    except ValueError:
                        key_signature = None

        for direction in measure_el.iterfind("direction"):
            words = _text(direction.find("direction-type/words"))
            if words and tempo_marking is None:
                tempo_marking = words
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
            for dynamics in direction.iterfind("direction-type/dynamics"):
                for child in dynamics:
                    if child.tag in _DYNAMIC_TAGS:
                        break

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
        voices = [
            (el.findtext("voice") or "").strip()
            for el in measure_el.iterfind("note")
        ]
        kept_voice = _voice_carrying_the_music(measure_el)
        multi_voice = rewound and len({v for v in voices if v}) > 1

        for child in measure_el:
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
            if note_el.find("chord") is not None:
                continue
            # Grace notes carry no duration and belong to the note they
            # decorate; including them has the same effect as a chord member.
            if note_el.find("grace") is not None:
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
                dropped += 1
                # Which bar lost it, by position — the numbers are still being
                # decided (a multi-bar rest shifts everything after it), so the
                # index is the only stable handle until the end.
                dropped_at[len(measures)] = dropped_at.get(len(measures), 0) + 1
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

            built = Note(
                pitch=pitch,
                duration=duration,  # type: ignore[arg-type]
                articulation=_articulation(note_el),  # type: ignore[arg-type]
                tied_to_next=tied,
            )
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
        # An engine that reads a pickup bar numbers it 0, and `Measure` requires
        # 1 or more. Position in the list is what everything downstream uses.
        # Never let the voice filter empty a bar. A measure with no notes is
        # not a reading, it is a hole — and `validate.py` reports one as a sign
        # that something which was not a measure was counted as one. If picking
        # a voice removed everything, the guess about voices was wrong.
        if not notes and not_filtered:
            notes = not_filtered

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
                notes=notes,
                slurs=slurs,
                tuplets=tuplets,
                time_signature=measure_time,
            )
        )

    # Both of these need the bar length in force, and neither can know it
    # during the loop above: the only `<time>` on a real photographed part is
    # often printed mid-page, after a double barline.
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
    for start_index, end_index, kind in _repeats_in(chosen):
        first = _first_bar(start_index)
        last_bar = _last_bar(end_index)
        if first is None or last_bar is None or last_bar < first:
            continue
        repeats.append(
            Repeat(start_measure=first, end_measure=last_bar, type=kind)  # type: ignore[arg-type]
        )

    total_notes = sum(len(m.notes) for m in measures)
    # Confidence an engine did not report, inferred from what had to be thrown
    # away. A run that dropped a fifth of its notes for want of a readable type
    # or pitch is not a 0.9 transcription however sure the engine sounded.
    if total_notes + dropped == 0:
        confidence = 0.0
    else:
        confidence = round(total_notes / (total_notes + dropped), 3)

    notes_to_human = ""
    if dropped:
        # The indices were recorded before the expansion inserted anything, so
        # map them through the measures that actually came out.
        numbers = sorted(
            measures[moved[index]].measure_number for index in dropped_at
        )
        where = ""
        if numbers:
            named = ", ".join(str(n) for n in numbers[:6])
            if len(numbers) > 6:
                named += f" and {len(numbers) - 6} more"
            where = f" in measure{'s' if len(numbers) > 1 else ''} {named}"
        notes_to_human = (
            f"{dropped} note(s) in the MusicXML could not be represented "
            "(double accidental, double dot, or a duration outside this schema) "
            f"and were dropped{where}."
        )

    return ScoreJson(
        time_signature=time_signature,
        key_signature=key_signature,
        tempo_marking=tempo_marking,
        bpm_hint=bpm_hint,
        clef=clef or clef_fallback,  # type: ignore[arg-type]
        measures=measures,
        repeats=repeats,
        ocr_confidence=confidence,
        notes_to_human=notes_to_human,
    )
