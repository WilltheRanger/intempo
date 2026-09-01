"""The tempo printed on the page.

`<sound tempo=...>` is a playback hint and optional. homr writes none at all,
and plenty of exporters write only the mark the engraver drew — so a piece
whose page says **♩ = 132** opened at the app's 80 BPM fallback with the number
sitting unread in the file it came from.

The conversion is the whole risk. See `_metronome_bpm`.
"""

from __future__ import annotations

import pytest

from app.services.ocr.musicxml import score_json_from_musicxml

_HEAD = """<?xml version='1.0'?><score-partwise version='4.0'>
<part-list><score-part id='P1'><part-name>B</part-name></score-part></part-list>
<part id='P1'><measure number='1'>
<attributes><divisions>4</divisions><key><fifths>0</fifths></key>
<time><beats>4</beats><beat-type>4</beat-type></time>
<clef><sign>F</sign><line>4</line></clef></attributes>{}
<note><pitch><step>A</step><octave>3</octave></pitch><duration>16</duration>
<type>whole</type></note>
</measure></part></score-partwise>"""


def _mark(unit: str, per_minute: object, *, dots: int = 0, extra: str = "") -> str:
    return (
        "<direction placement='above'><direction-type><metronome>"
        f"<beat-unit>{unit}</beat-unit>{'<beat-unit-dot/>' * dots}"
        f"<per-minute>{per_minute}</per-minute></metronome></direction-type>"
        f"{extra}</direction>"
    )


def _tempo(body: str) -> tuple[int | None, str | None]:
    score = score_json_from_musicxml(_HEAD.format(body))
    return score.bpm_hint, score.tempo_beat_unit


def _hint(body: str) -> int | None:
    return _tempo(body)[0]


def test_a_quarter_note_mark_is_read_straight() -> None:
    assert _tempo(_mark("quarter", 132)) == (132, "quarter")


@pytest.mark.parametrize(
    "unit,dots,printed,quarters",
    [
        # **`bpm_hint` is quarter notes per minute**, because `target_bpm` is:
        # `build_timeline` measures every duration in quarter-beats, and the
        # app's own metronome says "a beat is a quarter note, everywhere".
        ("eighth", 0, 120, 60),
        ("half", 0, 60, 120),
        ("quarter", 1, 60, 90),  # ♩. = 60 — a third out if read straight
        ("eighth", 1, 80, 60),
        ("16th", 0, 240, 60),
    ],
)
def test_the_beat_unit_is_converted(unit, dots, printed, quarters) -> None:
    """**Reading `<per-minute>` on its own is a tempo error, not a rounding.**

    ♩. = 60 is ninety quarter notes a minute. Taking the 60 puts a musician's
    practice tempo a third out on any compound-metre page, and half out on a
    page marked in eighths — and `target_bpm` builds the whole expected
    timeline, so it is not only the number on the screen that moves.
    """
    score = score_json_from_musicxml(_HEAD.format(_mark(unit, printed, dots=dots)))
    expected_unit = {
        ("eighth", 0): "eighth",
        ("half", 0): "half",
        ("quarter", 1): "dotted_quarter",
        ("eighth", 1): "dotted_eighth",
        ("16th", 0): "sixteenth",
    }[(unit, dots)]
    assert (score.bpm_hint, score.tempo_beat_unit) == (quarters, expected_unit)


def test_a_range_takes_the_lower_number() -> None:
    """`<per-minute>` is free text and an engraver may write `120-132`. The
    lower is the tempo a player would start from — a reading, rather than an
    average nobody printed."""
    assert _hint(_mark("quarter", "120-132")) == 120


def test_a_metric_modulation_states_no_speed() -> None:
    """`♩ = ♪` carries two beat units and no per-minute: it states a *ratio*,
    and there is nothing to convert."""
    assert (
        _hint(
            "<direction><direction-type><metronome>"
            "<beat-unit>quarter</beat-unit><beat-unit>eighth</beat-unit>"
            "</metronome></direction-type></direction>"
        )
        is None
    )


def test_two_beat_units_are_a_ratio_even_beside_a_number() -> None:
    """The guard has to look at the *count* of beat units, not at whether a
    per-minute is present.

    A modulation with no per-minute already reads as nothing, so believing the
    first unit is harmless there — but an exporter that writes both leaves a
    mark that says "a quarter here equals an eighth there", and reading it as
    "quarter = N" invents a tempo from a ratio.
    """
    assert (
        _hint(
            "<direction><direction-type><metronome>"
            "<beat-unit>quarter</beat-unit><beat-unit>eighth</beat-unit>"
            "<per-minute>120</per-minute>"
            "</metronome></direction-type></direction>"
        )
        is None
    )


def test_a_playback_tempo_outranks_a_printed_one() -> None:
    """`<sound tempo>` is quarter-note BPM by definition, so believing it needs
    no arithmetic — and an arithmetic answer should not overrule a stated one.
    """
    assert _tempo(_mark("eighth", 120, extra="<sound tempo='144'/>")) == (
        144,
        "eighth",
    )


def test_a_sound_only_tempo_is_quarter_note_bpm() -> None:
    assert _tempo("<direction><sound tempo='96'/></direction>") == (96, "quarter")


def test_an_impossible_tempo_is_refused_rather_than_clamped() -> None:
    """The same range `<sound tempo>` is held to, and for the same reason: a
    number outside it is a misreading, and 300 is not a better answer than
    admitting the page did not say."""
    assert _hint(_mark("quarter", 900)) is None
    assert _hint(_mark("quarter", 4)) is None


def test_an_unreadable_beat_unit_is_skipped() -> None:
    assert _hint(_mark("crotchet", 120)) is None
    assert _hint(_mark("quarter", "presto")) is None


def test_a_triple_dotted_beat_unit_is_skipped_rather_than_crashing() -> None:
    """Three dots index past the table of dot factors, which is an exception in
    the middle of transcribing a page — the whole scan failing on one exotic
    marking instead of one number going unread."""
    assert _hint(_mark("quarter", 60, dots=3)) is None


def test_a_page_with_no_mark_still_has_none() -> None:
    assert _tempo("") == (None, None)
