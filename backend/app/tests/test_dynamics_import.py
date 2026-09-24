"""Dynamics and hairpins, read from MusicXML onto the note they stand over.

Listen plays a phrase at the level its page prints, and swells or falls
through a hairpin. None of that can happen unless the reading carries the
markings, and it did not: the importer found every `<dynamics>` in a bar and
discarded it, never looked at a `<wedge>`, and took "cresc." as the piece's
tempo marking whenever it was the first word printed.

A `<direction>` has no note of its own. It is written in the bar before the
note it applies to, and a hairpin's `stop` after the last note under it — so
each is attached to the next note or rest in the line being read, which is
where the level it describes takes effect.
"""

from __future__ import annotations

from app.services.ocr.musicxml import score_json_from_musicxml
from app.services.score_schema import Note, hairpin_from_text
from app.tests.test_grace_notes import _ATTRS, _note, _one_bar, _xml


def _direction(body: str, staff: str | None = None) -> str:
    on = f"<staff>{staff}</staff>" if staff else ""
    return f"<direction><direction-type>{body}</direction-type>{on}</direction>"


def _dynamic(mark: str) -> str:
    return _direction(f"<dynamics><{mark}/></dynamics>")


def _wedge(kind: str) -> str:
    return _direction(f'<wedge type="{kind}"/>')


def _words(text: str) -> str:
    return _direction(f"<words>{text}</words>")


_REST = "<note><rest/><duration>4</duration><type>quarter</type></note>"


def test_a_dynamic_lands_on_the_note_it_is_written_before() -> None:
    score = _one_bar(_note() + _dynamic("p") + _note() + _note() + _note())
    assert [n.dynamics for n in score.measures[0].notes] == [None, "p", None, None]


def test_a_hairpin_starts_on_the_next_note_and_ends_on_the_note_after_its_stop() -> None:
    score = _one_bar(
        _wedge("crescendo") + _note() + _note() + _wedge("stop") + _dynamic("f")
        + _note() + _note()
    )
    notes = score.measures[0].notes
    assert [n.hairpin for n in notes] == ["crescendo", None, None, None]
    assert [n.hairpin_end for n in notes] == [False, False, True, False]
    assert notes[2].dynamics == "f", "the level the hairpin arrives at"


def test_a_diminuendo_wedge_is_a_diminuendo() -> None:
    score = _one_bar(_wedge("diminuendo") + _note() + _note() + _note() + _note())
    assert score.measures[0].notes[0].hairpin == "diminuendo"


def test_the_printed_words_are_hairpins_too() -> None:
    score = _one_bar(
        _words("cresc.") + _note() + _note() + _words("poco a poco dim.") + _note() + _note()
    )
    assert [n.hairpin for n in score.measures[0].notes] == [
        "crescendo", None, "diminuendo", None,
    ]


def test_cresc_is_not_the_pieces_tempo_marking() -> None:
    """It was, whenever it was the first word a part printed: the tempo loop
    took the first `<words>` it met, whatever they said."""
    score = _one_bar(_words("cresc.") + _note() + _note() + _note() + _note())
    assert score.tempo_marking is None
    score = _one_bar(_words("Adagio") + _note() + _note() + _note() + _note())
    assert score.tempo_marking == "Adagio"


def test_a_marking_over_a_rest_is_kept_on_the_rest() -> None:
    """The level is in force from where it is written; the rest carries it to
    the note after, which is the one heard at it."""
    score = _one_bar(_note() + _dynamic("pp") + _REST + _note() + _note())
    notes = score.measures[0].notes
    assert notes[1].pitch == "rest"
    assert notes[1].dynamics == "pp"
    assert notes[2].dynamics is None


def test_a_marking_carries_across_the_barline() -> None:
    score = score_json_from_musicxml(
        _xml(
            f'<measure number="1">{_ATTRS}{_note()}{_note()}{_note()}{_note()}'
            f'{_wedge("stop")}</measure>'
            f'<measure number="2">{_note()}{_note()}{_note()}{_note()}</measure>'
        )
    )
    assert score.measures[1].notes[0].hairpin_end is True


def test_a_dynamic_on_the_note_itself_is_read() -> None:
    marked = (
        "<note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration>"
        "<type>quarter</type><notations><dynamics><sfz/></dynamics></notations></note>"
    )
    score = _one_bar(marked + _note() + _note() + _note())
    assert score.measures[0].notes[0].dynamics == "sfz"


def test_a_marking_for_the_staff_not_read_is_not_taken() -> None:
    """On a two-staff part only one staff is read; the other's dynamics are
    somebody else's hand."""
    staffed = (
        "<note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration>"
        "<type>quarter</type><staff>{}</staff></note>"
    )
    attrs = _ATTRS.replace("<attributes>", "<attributes><staves>2</staves>")
    body = (
        f'<measure number="1">{attrs}'
        + _direction("<dynamics><ff/></dynamics>", staff="2")
        + "".join(staffed.format("1") for _ in range(4))
        + "<backup><duration>16</duration></backup>"
        + "".join(staffed.format("2") for _ in range(4))
        + "</measure>"
    )
    score = score_json_from_musicxml(_xml(body))
    assert all(n.dynamics is None for m in score.measures for n in m.notes)


def test_a_real_phone_photographs_hairpins_are_read() -> None:
    """Audiveris wrote these from a photograph of a printed bass part: three
    hairpins and eight dynamics, every one of which used to be discarded.

    The diminuendo in bar 12 is written in the second voice, which is not the
    line read, so it is not here — the level of a line nobody is playing.
    """
    from app.tests.test_musicxml import AUDIVERIS

    score = score_json_from_musicxml(AUDIVERIS.read_text(encoding="utf-8"))
    marks = [
        (m.measure_number, i, n.dynamics, n.hairpin, n.hairpin_end)
        for m in score.measures
        for i, n in enumerate(m.notes)
        if n.dynamics or n.hairpin or n.hairpin_end
    ]
    assert (4, 6, "mf", "crescendo", False) in marks
    assert (4, 9, None, None, True) in marks
    assert (13, 3, None, None, True) in marks
    assert (14, 0, "f", None, False) in marks
    assert not any(hairpin == "diminuendo" for *_, hairpin, _ in marks)


# ---- the schema ------------------------------------------------------------


def test_a_hairpin_is_read_from_the_way_a_page_writes_it() -> None:
    for text, expected in [
        ("cresc.", "crescendo"),
        ("Crescendo", "crescendo"),
        ("poco a poco cresc.", "crescendo"),
        ("dim.", "diminuendo"),
        ("dimin.", "diminuendo"),
        ("decresc.", "diminuendo"),
        ("poco_dim", "diminuendo"),
        ("Allegro", None),
        ("dolce", None),
    ]:
        assert hairpin_from_text(text) == expected, text
        assert Note(pitch="A4", duration="quarter", hairpin=text).hairpin == expected


def test_an_unknown_hairpin_is_dropped_never_refused() -> None:
    assert Note(pitch="A4", duration="quarter", hairpin=3).hairpin is None


def test_grace_pitches_keep_only_what_can_be_played() -> None:
    note = Note(
        pitch="A4", duration="quarter", grace_pitches=["D4", "rest", "X9", 7, "E4"]
    )
    assert note.grace_pitches == ["D4", "E4"]


def test_every_named_ornament_is_counted() -> None:
    note = Note(pitch="A4", duration="quarter", grace_pitches=["D4", "E4"])
    assert note.grace_notes == 2
    more = Note(pitch="A4", duration="quarter", grace_notes=3, grace_pitches=["D4"])
    assert more.grace_notes == 3, "more attacks than names: some pitches unknown"


def test_a_run_too_long_to_be_an_ornament_keeps_its_count_and_loses_its_names() -> None:
    note = Note(pitch="A4", duration="quarter", grace_notes=40, grace_pitches=["D4"] * 40)
    assert note.grace_pitches == []
    assert note.grace_notes == 40
