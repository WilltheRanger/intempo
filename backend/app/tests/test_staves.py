"""A part that writes more than one staff.

A grand staff — a keyboard part, a divisi, anything written on two systems
braced together — puts both lines inside one `<part>`, separated by `<backup>`,
and tells them apart with `<staff>`. The voice filter cannot see that axis, and
is explicitly right not to try: *"an untagged note is not in a competing voice
— it is a note."* True, and it is a note **on another staff**.

Read `_staff_carrying_the_music` for what it cost.
"""

from __future__ import annotations

from app.services.ocr.musicxml import score_json_from_musicxml
from app.services.ocr.validate import validate_measures

_ATTRS = (
    "<attributes><divisions>4</divisions><key><fifths>0</fifths></key>"
    "<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>"
    "<clef number='1'><sign>G</sign><line>2</line></clef>"
    "<clef number='2'><sign>F</sign><line>4</line></clef></attributes>"
)


def _note(
    step: str,
    octave: int,
    ticks: int,
    kind: str,
    *,
    staff: int | None = None,
    voice: int | None = None,
    rest: bool = False,
) -> str:
    head = (
        "<rest/>"
        if rest
        else f"<pitch><step>{step}</step><octave>{octave}</octave></pitch>"
    )
    return (
        f"<note>{head}<duration>{ticks}</duration><type>{kind}</type>"
        + (f"<voice>{voice}</voice>" if voice else "")
        + (f"<staff>{staff}</staff>" if staff else "")
        + "</note>"
    )


def _part(measures: str) -> str:
    return (
        "<?xml version='1.0'?><score-partwise version='4.0'>"
        "<part-list><score-part id='P1'><part-name>Pno</part-name></score-part>"
        f"</part-list><part id='P1'>{measures}</part></score-partwise>"
    )


def _grand(upper: str, lower: str, number: int = 1, attrs: str = _ATTRS) -> str:
    return (
        f'<measure number="{number}">{attrs}{upper}'
        f"<backup><duration>16</duration></backup>{lower}</measure>"
    )


def test_both_hands_are_not_one_line() -> None:
    """**Eight quarter-beats in a four-beat bar.**

    Four quarters over two halves, with no `<voice>` tags — which plenty of
    exporters omit. Every note of both staves was read as one line, the bar
    came out `long`, and since `alignment.py` accumulates, every bar after it
    on the page was expected four beats late.
    """
    upper = _note("C", 5, 4, "quarter", staff=1) * 4
    lower = _note("C", 3, 8, "half", staff=2) * 2
    score = score_json_from_musicxml(_part(_grand(upper, lower)))

    assert [n.pitch for n in score.measures[0].notes] == ["C5"] * 4
    assert [f.verdict for f in validate_measures(score)] == ["ok"]


def test_the_staff_with_the_most_played_notes_wins() -> None:
    """The same rule and the same reason as the voice filter: a staff holding
    one held note under a running line is the accompaniment, not the line."""
    upper = _note("C", 5, 16, "whole", staff=1)
    lower = _note("E", 2, 4, "quarter", staff=2) * 4
    score = score_json_from_musicxml(_part(_grand(upper, lower)))

    assert [n.pitch for n in score.measures[0].notes] == ["E2"] * 4


def test_the_clef_is_the_chosen_staff_s() -> None:
    """**A bass line labelled "Treble clef" is worse than no label.**

    A grand staff prints two clefs and `find("clef")` took the top one, so a
    part read off the lower staff was captioned with the upper staff's clef —
    and any screen drawing from it places every notehead a seventh off.
    """
    upper = _note("C", 5, 16, "whole", staff=1)
    lower = _note("E", 2, 4, "quarter", staff=2) * 4
    assert score_json_from_musicxml(_part(_grand(upper, lower))).clef == "bass"


def test_a_single_staff_part_is_untouched() -> None:
    """Which is every single-line instrument's part, and so almost every page
    this app will ever see."""
    plain = "".join(_note("E", 2, 4, "quarter", staff=1) for _ in range(4))
    score = score_json_from_musicxml(_part(f'<measure number="1">{_ATTRS}{plain}</measure>'))
    assert len(score.measures[0].notes) == 4
    assert score.clef == "treble"


def test_a_part_with_no_staff_tags_at_all_is_untouched() -> None:
    plain = "".join(_note("E", 2, 4, "quarter") for _ in range(4))
    score = score_json_from_musicxml(_part(f'<measure number="1">{_ATTRS}{plain}</measure>'))
    assert len(score.measures[0].notes) == 4


def test_the_staff_is_chosen_once_for_the_part_not_per_bar() -> None:
    """**A staff is a stable property of a line; a voice number is not.**

    Choosing per measure would let the reading jump hands wherever one of them
    rests — here the lower staff holds the music and the upper one rests
    through bar 2, which per-bar counting would read as "the upper staff has
    the most notes in this bar" and hand back a bar of somebody else's line.
    """
    bar1 = _grand(
        _note("C", 5, 4, "quarter", staff=1) * 4,
        _note("E", 2, 2, "eighth", staff=2) * 8,
    )
    bar2 = _grand(
        _note("C", 5, 4, "quarter", staff=1) * 4,
        _note("E", 2, 16, "whole", staff=2),
        number=2,
        attrs="",
    )
    score = score_json_from_musicxml(_part(bar1 + bar2))

    assert [n.pitch for n in score.measures[0].notes] == ["E2"] * 8
    assert [n.pitch for n in score.measures[1].notes] == ["E2"]


def test_rests_and_cues_do_not_elect_a_staff() -> None:
    """Same rule as the voice filter, and it exists there because both were
    once counted: a staff of nothing but rests is never the music."""
    upper = _note("", 0, 4, "quarter", staff=1, rest=True) * 4
    lower = _note("E", 2, 8, "half", staff=2) * 2
    score = score_json_from_musicxml(_part(_grand(upper, lower)))
    assert [n.pitch for n in score.measures[0].notes] == ["E2", "E2"]


def test_the_voice_filter_still_runs_inside_the_chosen_staff() -> None:
    """Two axes, both needed. A divisi written on the lower staff of a grand
    staff is two voices *within* the staff this reads."""
    upper = _note("C", 5, 16, "whole", staff=1, voice=1)
    lower = (
        _note("E", 2, 4, "quarter", staff=2, voice=2) * 4
        + "<backup><duration>16</duration></backup>"
        + _note("G", 2, 16, "whole", staff=2, voice=3)
    )
    score = score_json_from_musicxml(_part(_grand(upper, lower)))
    assert [n.pitch for n in score.measures[0].notes] == ["E2"] * 4


def test_a_gap_on_another_staff_does_not_pad_this_one() -> None:
    """`<forward>` carries a staff too, and silence written for the other hand
    is not silence in this line — it would push every later note late."""
    upper = (
        _note("C", 5, 4, "quarter", staff=1)
        + "<forward><duration>12</duration><staff>1</staff></forward>"
    )
    lower = _note("E", 2, 4, "quarter", staff=2) * 4
    score = score_json_from_musicxml(_part(_grand(upper, lower)))
    assert [n.pitch for n in score.measures[0].notes] == ["E2"] * 4
    assert [f.verdict for f in validate_measures(score)] == ["ok"]


def test_a_gap_on_the_staff_being_read_still_pads_it() -> None:
    """The other half of the rule, and the one that keeps a real rest."""
    upper = _note("C", 5, 16, "whole", staff=1)
    lower = (
        "<forward><duration>8</duration><staff>2</staff></forward>"
        + _note("E", 2, 4, "quarter", staff=2) * 2
    )
    score = score_json_from_musicxml(_part(_grand(upper, lower)))
    assert [n.pitch for n in score.measures[0].notes] == ["rest", "E2", "E2"]
    assert [f.verdict for f in validate_measures(score)] == ["ok"]


def test_a_tie_goes_to_the_upper_staff() -> None:
    """The same tiebreak as the voice filter, for the same reason: nothing here
    can tell two genuine lines apart, and the upper part is written first by
    convention."""
    upper = _note("C", 5, 4, "quarter", staff=1) * 4
    lower = _note("E", 2, 4, "quarter", staff=2) * 4
    score = score_json_from_musicxml(_part(_grand(upper, lower)))
    assert [n.pitch for n in score.measures[0].notes] == ["C5"] * 4


def test_an_untagged_note_is_staff_one_because_musicxml_says_so() -> None:
    """**Absence is a claim here, unlike `<voice>`.**

    Exporters leave `<staff>` off the upper staff often enough that this
    matters: the spec says an omitted staff is staff 1. Treating those notes as
    "keep either way" would hand back both hands wherever the *lower* staff was
    the one chosen — the double count this filter exists to prevent, arriving
    by another door.
    """
    upper = _note("C", 5, 8, "half") * 2  # no <staff> at all
    lower = _note("E", 2, 4, "quarter", staff=2) * 4
    score = score_json_from_musicxml(_part(_grand(upper, lower)))
    assert [n.pitch for n in score.measures[0].notes] == ["E2"] * 4
    assert [f.verdict for f in validate_measures(score)] == ["ok"]


def test_an_untagged_note_is_kept_when_staff_one_is_the_music() -> None:
    """The other half of the same rule."""
    upper = _note("C", 5, 4, "quarter") * 4  # no <staff> at all
    lower = _note("E", 2, 16, "whole", staff=2)
    score = score_json_from_musicxml(_part(_grand(upper, lower)))
    assert [n.pitch for n in score.measures[0].notes] == ["C5"] * 4


def test_the_voice_is_elected_from_the_chosen_staff_alone() -> None:
    """**Two filters in sequence, and the order matters.**

    A grand staff writes each hand in its own voice, so counting voices across
    the whole bar can elect a voice that lives on the staff being discarded.
    Everything on the staff being *read* then fails the voice test, the bar
    empties, and the fallback hands back every note of it — the double count
    this filter exists to prevent, arriving by another door.

    Here the upper staff's single voice holds five notes, more than either of
    the two voices sharing the lower staff, while the lower staff holds more
    notes in total and is the line to read.
    """
    upper = _note("C", 5, 2, "eighth", staff=1, voice=1) * 5
    lower = (
        _note("E", 2, 4, "quarter", staff=2, voice=2) * 3
        + "<backup><duration>12</duration></backup>"
        + _note("G", 2, 4, "quarter", staff=2, voice=3) * 3
    )
    score = score_json_from_musicxml(_part(_grand(upper, lower)))
    assert [n.pitch for n in score.measures[0].notes] == ["E2"] * 3
