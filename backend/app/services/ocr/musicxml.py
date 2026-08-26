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


def _duration_name(note: ET.Element) -> str | None:
    kind = _text(note.find("type"))
    if kind is None:
        return None
    base = _TYPE_TO_DURATION.get(kind)
    if base is None:
        return None
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



def _expand_multiple_rests(
    measures: list[Measure],
    pending: list[tuple[int, int, str | None]],
    header_metre: str | None,
) -> list[Measure]:
    """Turn each multi-bar rest into the bars of silence it stands for.

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
        return measures

    inferred = infer_beats_per_measure(
        [
            sum(DURATION_BEATS[note.duration] for note in measure.notes)
            for measure in measures
            if measure.notes
        ]
    )

    out: list[Measure] = []
    expanded = False
    by_index = {index: (count, metre) for index, count, metre in pending}
    for index, measure in enumerate(measures):
        entry = by_index.get(index)
        if entry is None:
            out.append(measure)
            continue
        count, metre = entry
        beats = _quarter_beats(metre or header_metre)
        if beats is None:
            beats = inferred
        rest = _BAR_REST_FOR.get(beats) if beats is not None else None
        if rest is None:
            out.append(measure)
            continue
        expanded = True
        for offset in range(count):
            out.append(
                measure.model_copy(
                    update={
                        "notes": [Note(pitch="rest", duration=rest)],
                        # The metre is stated once, on the first of the bars it
                        # governs. Repeating it would read as a metre change
                        # printed at every bar of the rest.
                        "time_signature": measure.time_signature if offset == 0 else None,
                        "measure_number": measure.measure_number + offset,
                    }
                )
            )

    if not expanded:
        return measures

    # **Renumbered, and only when something was actually expanded.**
    #
    # The file numbers a four-bar rest as one bar, so every measure after it is
    # now three too low — and `MeasureEditScreen` and every caveat line address
    # a bar by its number. Renumbering unconditionally would change the numbers
    # of every score already in the library, including the pickup a file
    # numbers 0, which the loop above handles deliberately.
    return [
        measure.model_copy(update={"measure_number": position})
        for position, measure in enumerate(out, start=1)
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

    measures: list[Measure] = []
    #: `(index in measures, how many bars it stands for, metre stated on it)`
    pending_rests: list[tuple[int, int, str | None]] = []
    dropped = 0

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
        first_voice = next((v for v in voices if v), None)
        multi_voice = rewound and len({v for v in voices if v}) > 1

        for note_el in measure_el.iterfind("note"):
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
            filtered_out = False
            this_voice = (note_el.findtext("voice") or "").strip()
            # An *untagged* note is not in a competing voice — it is a note.
            # Dropping those emptied a bar outright in the bundled Audiveris
            # fixture, which is a worse reading than the double-count this
            # filter exists to prevent.
            if multi_voice and this_voice and this_voice != first_voice:
                filtered_out = True

            pitch = _pitch_name(note_el)
            duration = _duration_name(note_el)
            if pitch is None or duration is None:
                dropped += 1
                continue

            tied = any(
                tie.get("type") == "start" for tie in note_el.iterfind("tie")
            ) or any(
                tie.get("type") == "start" for tie in note_el.iterfind("notations/tied")
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
        if standing_for and not notes:
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

    measures = _expand_multiple_rests(measures, pending_rests, time_signature)

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
        notes_to_human = (
            f"{dropped} note(s) in the MusicXML could not be represented "
            "(double accidental, double dot, or a duration outside this schema) "
            "and were dropped."
        )

    return ScoreJson(
        time_signature=time_signature,
        key_signature=key_signature,
        tempo_marking=tempo_marking,
        bpm_hint=bpm_hint,
        clef=clef or clef_fallback,  # type: ignore[arg-type]
        measures=measures,
        repeats=[],
        ocr_confidence=confidence,
        notes_to_human=notes_to_human,
    )
