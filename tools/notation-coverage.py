#!/usr/bin/env python3
"""What the importer makes of the notation a page can actually contain.

    tools/notation-coverage.py              # both tables
    tools/notation-coverage.py --values     # just the note-value matrix

**Why this exists.** Asked whether the program "accounts for all the edge cases
in music", the only honest answer is no — Western notation is open-ended and a
program that claimed otherwise would be lying. What can be done is make the
coverage *legible*: enumerate the constructs that change a verdict, run each
one through the real importer, and print what survives. A gap you can see is a
decision; a gap you cannot is a bug waiting for a musician to find.

Everything here runs locally in a second. No homr, no Modal, no network.

Two tables:

**Constructs** — one small MusicXML file per notation feature, through
`score_json_from_musicxml` and `validate_measures`. `!!` means the bars did not
add up, which for most of these means something was dropped.

**Note values** — every `<type>` against dots and the common tuplet ratios.
The importer has no table of these: it computes a length and looks for a name
with that length, so a combination is covered exactly when its arithmetic lands
on one. That makes the coverage genuinely hard to predict by reading the code,
and this prints it instead.

Three findings from the first run of this, all now fixed and all of the same
shape — something wrong shown as though it were right:

  * a double accidental had no spelling, so the note was **dropped**, and a
    dropped note is a lost onset that shifts every bar after it;
  * a microtone (`<alter>0.5</alter>`) was truncated to a **natural**;
  * a pitch the engraver could not place was drawn on the **middle line**.

What it still reports as missing is real and is listed at the bottom.
"""

from __future__ import annotations

import sys
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services.ocr.musicxml import score_json_from_musicxml  # noqa: E402
from app.services.ocr.validate import validate_measures  # noqa: E402
from app.services.score_schema import DURATION_BEATS  # noqa: E402

HEAD = (
    '<?xml version="1.0"?><score-partwise version="4.0"><part-list>'
    '<score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">'
)
TAIL = "</part></score-partwise>"


def attrs(div: int = 4, beats: int = 4, bt: int = 4, extra: str = "") -> str:
    return (
        f"<attributes><divisions>{div}</divisions>"
        f"<time><beats>{beats}</beats><beat-type>{bt}</beat-type></time>"
        f"<clef><sign>G</sign><line>2</line></clef>{extra}</attributes>"
    )


def note(step: str = "C", octave: int = 4, ticks: int = 4, kind: str = "quarter", extra: str = "") -> str:
    return (
        f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch>"
        f"<duration>{ticks}</duration><type>{kind}</type>{extra}</note>"
    )


def bar(inner: str, number: int = 1, opening: str = "") -> str:
    return f'<measure number="{number}">{opening}{inner}</measure>'


def one_bar(inner: str, **kw) -> str:
    return HEAD + bar(attrs(**kw) + inner) + TAIL


def _ornament(tag: str) -> str:
    return f"<notations><ornaments><{tag}/></ornaments></notations>"


CONSTRUCTS: dict[str, str] = {
    "pickup bar (implicit)": HEAD
    + '<measure number="0" implicit="yes">' + attrs() + note() + "</measure>"
    + bar(note() * 4, 1) + TAIL,
    "cut time": one_bar(note(ticks=8, kind="half") * 2, beats=2, bt=2),
    "compound 6/8": one_bar(note(ticks=2, kind="eighth") * 6, beats=6, bt=8),
    "irregular 7/8": one_bar(note(ticks=2, kind="eighth") * 7, beats=7, bt=8),
    "metre change mid-piece": HEAD + bar(attrs() + note() * 4)
    + bar("<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>" + note() * 3, 2)
    + TAIL,
    "senza misura (no metre)": HEAD
    + bar("<attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>" + note() * 4)
    + TAIL,
    "repeat barlines": HEAD
    + bar(
        attrs() + note() * 4
        + '<barline location="right"><repeat direction="backward"/></barline>',
        opening='<barline location="left"><repeat direction="forward"/></barline>',
    )
    + TAIL,
    "first / second endings": HEAD
    + bar(attrs() + note() * 4, opening='<barline location="left"><repeat direction="forward"/></barline>')
    + bar(
        note() * 4 + '<barline location="right"><ending number="1" type="stop"/>'
        '<repeat direction="backward"/></barline>',
        2,
        '<barline location="left"><ending number="1" type="start"/></barline>',
    )
    + bar(note() * 4, 3, '<barline location="left"><ending number="2" type="start"/></barline>')
    + TAIL,
    "da capo / fine": HEAD + bar(attrs() + note() * 4)
    + bar('<direction><direction-type><words>Fine</words></direction-type><sound fine="yes"/></direction>' + note() * 4, 2)
    + bar('<direction><direction-type><words>D.C. al Fine</words></direction-type><sound dacapo="yes"/></direction>' + note() * 4, 3)
    + TAIL,
    "dal segno": HEAD
    + bar(attrs() + '<direction><direction-type><segno/></direction-type><sound segno="segno"/></direction>' + note() * 4)
    + bar('<direction><direction-type><words>D.S.</words></direction-type><sound dalsegno="segno"/></direction>' + note() * 4, 2)
    + TAIL,
    "fermata": one_bar(note() * 3 + note(extra='<notations><fermata type="upright"/></notations>')),
    "ritardando": one_bar('<direction><direction-type><words>rit.</words></direction-type></direction>' + note() * 4),
    "a tempo": one_bar('<direction><direction-type><words>a tempo</words></direction-type></direction>' + note() * 4),
    "metronome mark": one_bar(
        "<direction><direction-type><metronome><beat-unit>quarter</beat-unit>"
        "<per-minute>92</per-minute></metronome></direction-type></direction>" + note() * 4
    ),
    "tremolo": one_bar(
        note(ticks=8, kind="half", extra='<notations><ornaments><tremolo type="single">2</tremolo></ornaments></notations>')
        + note(ticks=8, kind="half")
    ),
    "trill": one_bar(note(extra=_ornament("trill-mark")) + note() * 3),
    "turn": one_bar(note(extra=_ornament("turn")) + note() * 3),
    "mordent": one_bar(note(extra=_ornament("mordent")) + note() * 3),
    "arpeggiated chord": one_bar(
        note(extra="<notations><arpeggiate/></notations>")
        + '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>'
        + note() * 3
    ),
    "glissando": one_bar(
        note(extra='<notations><glissando type="start" number="1"/></notations>')
        + note(step="G", extra='<notations><glissando type="stop" number="1"/></notations>')
        + note() * 2
    ),
    "breath mark": one_bar(note(extra="<notations><articulations><breath-mark/></articulations></notations>") + note() * 3),
    "double sharp / double flat": one_bar(
        '<note><pitch><step>F</step><alter>2</alter><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>'
        '<note><pitch><step>B</step><alter>-2</alter><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>'
        + note() * 2
    ),
    "microtone (quarter-sharp)": one_bar(
        '<note><pitch><step>F</step><alter>0.5</alter><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>'
        + note() * 3
    ),
    "transposing instrument": one_bar(
        note() * 4
    ).replace("</attributes>", "<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>"),
    "key change": HEAD + bar(attrs(extra="<key><fifths>0</fifths></key>") + note() * 4)
    + bar("<attributes><key><fifths>3</fifths></key></attributes>" + note() * 4, 2) + TAIL,
    "octave shift (8va)": one_bar(
        '<direction><direction-type><octave-shift type="down" size="8"/></direction-type></direction>' + note() * 4
    ),
    "multi-voice with backup": one_bar(
        "".join(note(extra="<voice>1</voice>") for _ in range(4))
        + "<backup><duration>16</duration></backup>"
        + "".join(note(step="E", extra="<voice>2</voice>") for _ in range(4))
    ),
    "forward (gap in a voice)": one_bar(note() + "<forward><duration>4</duration></forward>" + note() * 2),
    "grace note": one_bar(
        '<note><grace slash="yes"/><pitch><step>B</step><octave>3</octave></pitch><type>eighth</type></note>' + note() * 4
    ),
    "tie across a barline": HEAD
    + bar(attrs() + note() * 3 + note(extra='<tie type="start"/><notations><tied type="start"/></notations>'))
    + bar(note(extra='<tie type="stop"/><notations><tied type="stop"/></notations>') + note() * 3, 2)
    + TAIL,
    "chord": one_bar(
        note()
        + '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>'
        + note() * 3
    ),
    "bar rest (measure=yes)": HEAD + bar(attrs() + note() * 4)
    + bar('<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>', 2) + TAIL,
    "multi-bar rest": HEAD + bar(attrs() + note() * 4)
    + bar('<attributes><measure-style><multiple-rest>3</multiple-rest></measure-style></attributes>'
          '<note><rest measure="yes"/><duration>16</duration></note>', 2) + TAIL,
    "unpitched (percussive)": one_bar(
        "<note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched>"
        "<duration>4</duration><type>quarter</type></note>" + note() * 3
    ),
    "128th notes": one_bar(
        "".join(
            '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>128th</type></note>'
            for _ in range(8)
        )
        + note(ticks=32) * 3,
        div=32,
    ),
}

TYPES = ["breve", "whole", "half", "quarter", "eighth", "16th", "32nd", "64th", "128th", "256th"]
RATIOS: list[tuple[int, int] | None] = [None, (3, 2), (5, 4), (6, 4), (7, 4), (9, 8)]


#: Ticks per quarter for the value matrix.
#:
#: **The stated `<duration>` has to agree with the `<type>`, or this measures
#: the wrong thing entirely.** The first version of this wrote
#: `<duration>8</duration>` for every combination and `<divisions>64</divisions>`
#: — a flat eighth of a beat, whatever note value the `<type>` claimed. The
#: importer believes a stated duration over a `<type>` that contradicts it (see
#: `_duration_name`, and the breve it was written for), so every cell whose
#: fixture happened to land on a named length reported `.` no matter what note
#: it was supposed to be testing. A 128th came back named `thirty_second`, which
#: is four times its length, and the matrix called that covered.
#:
#: 6720 = 2^6 x 3 x 5 x 7, which makes every length in the cross-product a whole
#: number of ticks: the finest is a septuplet dotted 128th at 3/112 of a quarter.
#: `_ticks` asserts integrality rather than rounding, because a rounded tick
#: count reintroduces exactly the disagreement this constant exists to remove.
MATRIX_DIVISIONS = 6720

#: What each written value is worth in quarter-beats, before dots and ratio.
_BASE_BEATS = {
    "breve": Fraction(8),
    "whole": Fraction(4),
    "half": Fraction(2),
    "quarter": Fraction(1),
    "eighth": Fraction(1, 2),
    "16th": Fraction(1, 4),
    "32nd": Fraction(1, 8),
    "64th": Fraction(1, 16),
    "128th": Fraction(1, 32),
    "256th": Fraction(1, 64),
}
_DOTS = {0: Fraction(1), 1: Fraction(3, 2), 2: Fraction(7, 4)}


def _ticks(kind: str, dots: int, ratio: tuple[int, int] | None) -> int | None:
    """The tick count for this written value, or None if it is not exact."""
    beats = _BASE_BEATS[kind] * _DOTS[dots]
    if ratio is not None:
        beats *= Fraction(ratio[1], ratio[0])
    exact = beats * MATRIX_DIVISIONS
    return int(exact) if exact.denominator == 1 else None


def names_a_value(kind: str, dots: int, ratio: tuple[int, int] | None) -> bool:
    ticks = _ticks(kind, dots, ratio)
    if ticks is None or ticks < 1:
        # Not representable at this resolution. Reported as uncovered rather
        # than silently skipped — a cell nobody can even write a fixture for is
        # a fact about the matrix, not an absence of one.
        return False
    modification = (
        ""
        if ratio is None
        else f"<time-modification><actual-notes>{ratio[0]}</actual-notes>"
        f"<normal-notes>{ratio[1]}</normal-notes></time-modification>"
    )
    xml = one_bar(
        f"<note><pitch><step>C</step><octave>4</octave></pitch><duration>{ticks}</duration>"
        f"<type>{kind}</type>{'<dot/>' * dots}{modification}</note>",
        div=MATRIX_DIVISIONS,
    )
    try:
        score = score_json_from_musicxml(xml)
    except Exception:  # noqa: BLE001 — a bench reports, it does not raise
        return False
    notes = score.measures[0].notes if score.measures else []
    if not notes:
        return False
    # **Named is not enough — it has to be named *correctly*.** Nothing else
    # here would notice a value that came back under another value's name, and
    # that is precisely the failure the first version of this shipped with.
    beats = _BASE_BEATS[kind] * _DOTS[dots] * (
        Fraction(1) if ratio is None else Fraction(ratio[1], ratio[0])
    )
    return abs(DURATION_BEATS[notes[0].duration] - float(beats)) < 1e-9


def constructs() -> None:
    print("CONSTRUCTS — one file each, through the real importer\n")
    print(f"{'':3}{'construct':<28}{'bars':>5}{'notes':>7}  verdicts")
    for name, xml in CONSTRUCTS.items():
        try:
            score = score_json_from_musicxml(xml)
        except Exception as exc:  # noqa: BLE001
            print(f"XX {name:<28} {type(exc).__name__}: {str(exc)[:40]}")
            continue
        findings = validate_measures(score)
        verdicts = [f.verdict for f in findings]
        clean = all(v in ("ok", "pickup") for v in verdicts)
        notes = sum(len(m.notes) for m in score.measures)
        print(
            f"{'  ' if clean else '!!'} {name:<28}{len(score.measures):>5}{notes:>7}  "
            f"{', '.join(verdicts)}"
        )


def values() -> None:
    print("\n\nNOTE VALUES — '.' named, 'X' dropped\n")
    header = "".join(f"{('plain' if r is None else f'{r[0]}:{r[1]}'):>8}" for r in RATIOS)
    print(f"{'written':<12}{header}")
    for kind in TYPES:
        for dots in (0, 1, 2):
            label = kind + "." * dots
            row = "".join(f"{('.' if names_a_value(kind, dots, r) else 'X'):>8}" for r in RATIOS)
            print(f"{label:<12}{row}")
    print(
        "\nKnown and unfixed: 128th and shorter have no name at any ratio, and\n"
        "dotted notes inside tuplets are patchy. Both drop the note — which the\n"
        "bar's beat sum then reports, so they are visible rather than silent.\n"
        "`Duration` is a closed union shared with the app, so widening it is a\n"
        "change to both sides and to the editor; it has not been made on the\n"
        "strength of a construct nobody here has seen in a real part."
    )


if __name__ == "__main__":
    if "--values" not in sys.argv:
        constructs()
    if "--constructs" not in sys.argv:
        values()
