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

from app.services.score_schema import Measure, Note, ScoreJson, Slur, Tuplet

# MusicXML type names → ours. Anything longer than a whole note (breve, long)
# and anything shorter than a 32nd is absent from `Duration`, and a piece of
# string music that needs them is outside what this product reads.
_TYPE_TO_DURATION: Final[dict[str, str]] = {
    "whole": "whole",
    "half": "half",
    "quarter": "quarter",
    "eighth": "eighth",
    "16th": "sixteenth",
    "32nd": "thirty_second",
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
    # Double-dotted notes have no name in `Duration`. Returning the undotted
    # name would silently shorten the measure by three eighths of the value,
    # and the beat-sum check would then blame the wrong measure.
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


def score_json_from_musicxml(
    xml: str, *, clef_fallback: str = "treble", part: str | None = None
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
    dropped = 0

    for index, measure_el in enumerate(chosen.iterfind("measure"), start=1):
        attributes = measure_el.find("attributes")
        if attributes is not None:
            if clef is None:
                clef_el = attributes.find("clef")
                if clef_el is not None:
                    sign = _text(clef_el.find("sign")) or ""
                    line = _text(clef_el.find("line")) or ""
                    clef = _CLEF_BY_SIGN_LINE.get((sign, line))
            if time_signature is None:
                time_el = attributes.find("time")
                beats = _text(time_el.find("beats")) if time_el is not None else None
                beat_type = (
                    _text(time_el.find("beat-type")) if time_el is not None else None
                )
                if beats and beat_type:
                    time_signature = f"{beats}/{beat_type}"
            if key_signature is None:
                key_el = attributes.find("key")
                if key_el is not None:
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

        measures.append(
            Measure(
                measure_number=number if number >= 1 else index,
                notes=notes,
                slurs=slurs,
                tuplets=tuplets,
            )
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
