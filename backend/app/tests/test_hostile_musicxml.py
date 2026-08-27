"""Reading anything includes not falling over on it.

`score_json_from_musicxml` is reached two ways and both of them turn an
unexpected exception into a bad answer for a musician:

* `POST /v1/scores/import` catches `MusicXMLError` and nothing else, so
  anything else is a **500** — "Something went wrong" for a file with one bad
  notehead in it.
* `HomrProvider.parse` also catches `MusicXMLError` alone. Anything else
  unwinds to the pipeline's broad handler, and with `OCR_PROVIDER_CHAIN =
  "homr"` there is no second provider to try, so the **scan fails** — with a
  reason string that matches no needle in `_FAILURE_REASONS` and lands on
  *"a flatter, better-lit shot of the page usually fixes it"*. A server fault
  blamed on the musician, which this project has done three times already.

So the contract is: **every input either produces a score or raises
`MusicXMLError`.** These are the inputs that broke it, kept as the table that
found them.
"""

from __future__ import annotations

import pytest

from app.routers.scores import _concerns_for
from app.services.alignment import build_timeline, expand_repeats
from app.services.ocr.musicxml import MusicXMLError, score_json_from_musicxml
from app.services.ocr.validate import describe_for_retry, validate_measures

_HEAD = (
    "<?xml version='1.0'?><score-partwise version='4.0'>"
    "<part-list><score-part id='P1'><part-name>B</part-name></score-part></part-list>"
    "<part id='P1'>{}</part></score-partwise>"
)
_ATTRS = (
    "<attributes><divisions>{div}</divisions><key><fifths>{fifths}</fifths></key>"
    "<time><beats>{beats}</beats><beat-type>{bt}</beat-type></time>"
    "<clef><sign>F</sign><line>4</line></clef></attributes>"
)
_A4 = _ATTRS.format(div=4, fifths=0, beats=4, bt=4)
_N = (
    "<note><pitch><step>A</step><octave>3</octave></pitch>"
    "<duration>4</duration><type>quarter</type></note>"
)


def _bar(inner: str, attrs: str = "") -> str:
    return _HEAD.format(f"<measure number='1'>{attrs}{inner}</measure>")


def _note(step: str = "A", octave: str = "3", extra: str = "") -> str:
    return (
        f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch>"
        f"<duration>4</duration><type>quarter</type>{extra}</note>"
    )


#: Every one of these was written to break something, and two of them did.
HOSTILE: dict[str, str] = {
    # --- the two that were real ---------------------------------------------
    # `<octave>99</octave>` builds "A99", which the pitch grammar rejects — and
    # rejecting it was `Note`'s job, by raising, out of the importer.
    "octave out of range": _bar(_note(octave="99"), _A4),
    # A step outside A–G. German-language software writes **H** for B natural,
    # so this is not only a fuzzer's idea.
    "german H for B natural": _bar(_note(step="H"), _A4),
    "step not a letter at all": _bar(_note(step="Z"), _A4),
    # `<beats>four</beats>` built the string "four/four".
    "time signature in words": _bar(_N, _ATTRS.format(div=4, fifths=0, beats="four", bt="four")),
    # --- structure ----------------------------------------------------------
    "empty string": "",
    "not xml at all": "hello",
    "truncated mid-tag": "<?xml version='1.0'?><score-partwise><part",
    "no part element": "<?xml version='1.0'?><score-partwise version='4.0'><part-list/></score-partwise>",
    "part id does not match the list": (
        "<?xml version='1.0'?><score-partwise version='4.0'>"
        "<part-list><score-part id='PX'><part-name>B</part-name></score-part></part-list>"
        f"<part id='PY'><measure number='1'>{_N}</measure></part></score-partwise>"
    ),
    "namespaced": (
        "<?xml version='1.0'?><score-partwise xmlns='http://www.musicxml.org/ns' "
        "version='4.0'><part-list><score-part id='P1'><part-name>B</part-name>"
        f"</score-part></part-list><part id='P1'><measure number='1'>{_N}</measure>"
        "</part></score-partwise>"
    ),
    "four hundred deep": _HEAD.format(
        "<measure number='1'>" + "<x>" * 400 + "</x>" * 400 + _N + "</measure>"
    ),
    "ten thousand empty bars": _HEAD.format("<measure number='1'/>" * 10000),
    # --- numbers that are not numbers, or are absurd ones --------------------
    "divisions zero": _bar(_N, _ATTRS.format(div=0, fifths=0, beats=4, bt=4)),
    "divisions negative": _bar(_N, _ATTRS.format(div=-4, fifths=0, beats=4, bt=4)),
    "divisions astronomical": _bar(_N, _ATTRS.format(div=10**18, fifths=0, beats=4, bt=4)),
    "divisions in words": _bar(_N, _ATTRS.format(div="lots", fifths=0, beats=4, bt=4)),
    "key of ninety-nine sharps": _bar(_N, _ATTRS.format(div=4, fifths=99, beats=4, bt=4)),
    "metre with a zero in it": _bar(_N, _ATTRS.format(div=4, fifths=0, beats=4, bt=0)),
    "metre of a billion": _bar(_N, _ATTRS.format(div=4, fifths=0, beats=10**9, bt=1)),
    "negative duration": _bar(
        "<note><pitch><step>A</step><octave>3</octave></pitch>"
        "<duration>-8</duration><type>quarter</type></note>",
        _A4,
    ),
    "triple sharp": _bar(
        "<note><pitch><step>A</step><alter>7</alter><octave>3</octave></pitch>"
        "<duration>4</duration><type>quarter</type></note>",
        _A4,
    ),
    "twenty dots": _bar(
        "<note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration>"
        "<type>quarter</type>" + "<dot/>" * 20 + "</note>",
        _A4,
    ),
    "bar numbered in words": _HEAD.format(f"<measure number='X1'>{_N}</measure>"),
    "bar numbered minus five": _HEAD.format(f"<measure number='-5'>{_N}</measure>"),
    "bar numbered astronomically": _HEAD.format(f"<measure number='{10**18}'>{_N}</measure>"),
    # --- markings that contradict themselves ---------------------------------
    "multi-bar rest of zero bars": _bar(
        "<attributes><measure-style><multiple-rest>0</multiple-rest></measure-style>"
        "</attributes><note><rest/><duration>16</duration><type>whole</type></note>"
    ),
    "multi-bar rest of a hundred thousand": _bar(
        "<attributes><divisions>4</divisions><measure-style>"
        "<multiple-rest>100000</multiple-rest></measure-style></attributes>"
        "<note><rest/><duration>16</duration><type>whole</type></note>"
    ),
    "repeat-bar sign over 99999 bars": _bar(
        "<attributes><measure-style><measure-repeat type='start'>99999"
        "</measure-repeat></measure-style></attributes>" + _N
    ),
    "beat-repeat with 99 slashes": _bar(
        "<attributes><divisions>4</divisions><measure-style>"
        "<beat-repeat type='start' slashes='99'/></measure-style></attributes>" + _N
    ),
    "tuplet of zero in the time of zero": _bar(
        "<note><pitch><step>A</step><octave>3</octave></pitch><type>quarter</type>"
        "<time-modification><actual-notes>0</actual-notes>"
        "<normal-notes>0</normal-notes></time-modification></note>",
        _A4,
    ),
    "tuplet of minus three": _bar(
        "<note><pitch><step>A</step><octave>3</octave></pitch><type>quarter</type>"
        "<time-modification><actual-notes>-3</actual-notes>"
        "<normal-notes>2</normal-notes></time-modification></note>",
        _A4,
    ),
    "gap of minus four bars": _bar("<forward><duration>-16</duration></forward>" + _N, _A4),
    "gap of a hundred million": _bar(
        "<forward><duration>100000000</duration></forward>" + _N, _A4
    ),
    "slur that only stops": _bar(
        _note(extra="<notations><slur type='stop' number='1'/></notations>"), _A4
    ),
    "repeat that only closes": _bar(
        _N + "<barline location='right'><repeat direction='backward'/></barline>", _A4
    ),
    "repeat played zero times": _bar(
        _N + "<barline location='right'><repeat direction='backward' times='0'/></barline>",
        _A4,
    ),
    "ending numbered 'fine'": _bar(
        _N + "<barline><ending number='fine' type='start'/></barline>", _A4
    ),
    "da capo with nothing to go back to": _bar(
        "<direction><sound dacapo='yes'/></direction>" + _N, _A4
    ),
    "dal segno before the segno": _bar(
        "<direction><sound dalsegno='yes'/></direction>"
        + _N
        + "<direction><direction-type><segno/></direction-type></direction>",
        _A4,
    ),
    "tempo marked 'fast'": _bar("<direction><sound tempo='fast'/></direction>" + _N, _A4),
    "metronome with no number": _bar(
        "<direction><direction-type><metronome><beat-unit>quarter</beat-unit>"
        "</metronome></direction-type></direction>" + _N,
        _A4,
    ),
    "metronome of twenty digits": _bar(
        "<direction><direction-type><metronome><beat-unit>double-whole</beat-unit>"
        "<per-minute>99999999999999999999</per-minute></metronome>"
        "</direction-type></direction>" + _N,
        _A4,
    ),
    "metronome of NaN": _bar(
        "<direction><direction-type><metronome><beat-unit>quarter</beat-unit>"
        "<per-minute>NaN</per-minute></metronome></direction-type></direction>" + _N,
        _A4,
    ),
    # --- shapes the newer filters have to survive ----------------------------
    "staff named in words": _bar(
        _note(extra="<staff>upper</staff>") + _note(step="C", octave="4", extra="<staff>2</staff>"),
        _A4,
    ),
    "staff tag left empty": _bar(_note(extra="<staff></staff>") + _N, _A4),
    "grace note with nothing after it": _bar(
        "<note><grace/><pitch><step>B</step><octave>3</octave></pitch>"
        "<type>16th</type></note>",
        _A4,
    ),
    "two thousand grace notes": _bar(
        "<note><grace/><pitch><step>B</step><octave>3</octave></pitch>"
        "<type>16th</type></note>" * 2000
        + _N,
        _A4,
    ),
    "chord member with no chord": _bar(
        "<note><chord/><pitch><step>A</step><octave>3</octave></pitch>"
        "<duration>4</duration><type>quarter</type></note>" + _N,
        _A4,
    ),
    "backup and nothing else": _bar("<backup><duration>16</duration></backup>", _A4),
    "voice tag left empty": _bar(
        _note(extra="<voice></voice>")
        + "<backup><duration>4</duration></backup>"
        + _note(step="C", octave="4", extra="<voice>2</voice>"),
        _A4,
    ),
    "note with no type": _bar(
        "<note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration></note>",
        _A4,
    ),
}


@pytest.mark.parametrize("label", sorted(HOSTILE))
def test_it_reads_it_or_refuses_it_and_never_raises_anything_else(label: str) -> None:
    try:
        score_json_from_musicxml(HOSTILE[label])
    except MusicXMLError:
        pass  # A refusal is an answer. The import route turns it into a 422.


@pytest.mark.parametrize("label", sorted(HOSTILE))
def test_whatever_it_reads_survives_everything_downstream(label: str) -> None:
    """A score that imports is immediately validated, described, turned into
    concerns and built into a timeline. A crash in any of those is the same
    500, one call later."""
    try:
        score = score_json_from_musicxml(HOSTILE[label])
    except MusicXMLError:
        return

    findings = validate_measures(score)
    describe_for_retry(findings)
    _concerns_for(score.model_dump(mode="json"))
    expand_repeats(score)
    build_timeline(score, 96.0)
    # And it round-trips through the column it is stored in.
    type(score).model_validate(score.model_dump(mode="json"))


# --------------------------------------------------------------------------
# The grammars themselves
#
# The importer now asks the *same* pattern object the schema enforces, so the
# two cannot disagree — which is the point, and which also means a mutation
# loosening the pattern loosens both and no round-trip test can see it. What
# catches that is pinning the grammar by example.
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    ["rest", "A3", "C#4", "Bb2", "F#0", "G9", "A-1"],
)
def test_the_pitch_grammar_accepts_a_pitch(value: str) -> None:
    from app.services.score_schema import PITCH_PATTERN

    assert PITCH_PATTERN.match(value)


@pytest.mark.parametrize(
    "value",
    [
        "H3",  # German for B natural, and not a step MusicXML has
        "A99",  # two octave digits
        "Abb2",  # double flat
        "A##3",
        "",
        "A",  # no octave
        "3",
        "Rest",
        "A3 ",
    ],
)
def test_the_pitch_grammar_refuses_what_is_not_one(value: str) -> None:
    from app.services.score_schema import PITCH_PATTERN

    assert not PITCH_PATTERN.match(value)


@pytest.mark.parametrize("value", ["4/4", "3/4", "6/8", "12/8", "2/2"])
def test_the_metre_grammar_accepts_a_metre(value: str) -> None:
    from app.services.score_schema import TIME_SIG_PATTERN

    assert TIME_SIG_PATTERN.match(value)


@pytest.mark.parametrize(
    "value", ["four/four", "C", "4-4", "4 / 4", "", "/", "4/", "/4", "4/4/4"]
)
def test_the_metre_grammar_refuses_what_is_not_one(value: str) -> None:
    from app.services.score_schema import TIME_SIG_PATTERN

    assert not TIME_SIG_PATTERN.match(value)
