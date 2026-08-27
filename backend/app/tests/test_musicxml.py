"""MusicXML → `ScoreJson`.

The fixture is hand-authored rather than captured from an engine run, because
what matters is the awkward cases — a chord, a grace note, a double accidental
— and no single photograph is guaranteed to contain them. See
`fixtures/musicxml/bass_excerpt.musicxml`.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.ocr.musicxml import MusicXMLError, score_json_from_musicxml
from app.services.ocr.validate import validate_measures

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "fixtures"
    / "musicxml"
    / "bass_excerpt.musicxml"
)


@pytest.fixture(scope="module")
def score():
    return score_json_from_musicxml(FIXTURE.read_text(encoding="utf-8"))


def test_reads_the_header(score) -> None:
    # F clef on line 4 is bass; on line 3 it would be baritone. Sign alone is
    # not enough, which is the reason the lookup is keyed on both.
    assert score.clef == "bass"
    assert score.time_signature == "4/4"
    assert score.key_signature == "Bb major"
    assert score.tempo_marking == "Poco meno"
    assert score.bpm_hint == 76


def test_accidentals_become_pitch_names(score) -> None:
    assert score.measures[0].notes[1].pitch == "Bb2"
    assert score.measures[1].notes[2].pitch == "F#3"


def test_rests_survive_as_rests(score) -> None:
    """`alignment.py` reads `pitch` in exactly one place, to ask this."""
    assert score.measures[0].notes[2].pitch == "rest"


def test_dot_is_folded_into_the_duration_name(score) -> None:
    assert score.measures[1].notes[0].duration == "dotted_quarter"


def test_tie_and_slur_are_kept(score) -> None:
    assert score.measures[1].notes[0].tied_to_next is True
    assert score.measures[0].slurs == [
        type(score.measures[0].slurs[0])(start_note_index=0, end_note_index=1)
    ]


def test_articulation_is_kept(score) -> None:
    assert score.measures[0].notes[1].articulation == "staccato"


def test_chord_members_are_not_counted(score) -> None:
    """A chord shares one onset.

    Counting the second notehead would push the measure over the metre, and the
    beat-sum check would then report a correctly-read measure as long — sending
    a repair pass at the one measure that did not need one.
    """
    assert [n.pitch for n in score.measures[1].notes] == ["D3", "D3", "F#3"]


def test_grace_notes_are_not_counted(score) -> None:
    """Same reasoning: a grace note carries no duration of its own."""
    assert all(n.pitch != "E3" for n in score.measures[1].notes)


def test_first_measure_sums_to_the_metre(score) -> None:
    rows = validate_measures(score)
    assert rows[0].verdict == "ok"


def test_an_unrepresentable_note_is_dropped_and_declared(score) -> None:
    """E-double-flat has no name in the pitch grammar.

    Writing "Eb3" instead would be a wrong note that reads as a confident one.
    Dropping it leaves the measure short, which the beat-sum check can see, and
    the count is reported rather than buried.
    """
    assert "1 note(s)" in score.notes_to_human
    assert score.ocr_confidence == pytest.approx(6 / 7, abs=1e-3)
    rows = validate_measures(score)
    assert rows[1].verdict == "short"


def test_namespaced_document_is_read() -> None:
    """A compressed .mxl unpacked by some tools carries a namespace.

    Without stripping it every `find()` returns None and the result is an empty
    score rather than an error — the worst failure available to a transcription.
    """
    xml = FIXTURE.read_text(encoding="utf-8").replace(
        "<score-partwise version=\"4.0\">",
        '<score-partwise xmlns="http://www.musicxml.org/ns" version="4.0">',
    )
    assert score_json_from_musicxml(xml).measures


def test_a_document_with_no_part_is_refused() -> None:
    with pytest.raises(MusicXMLError):
        score_json_from_musicxml("<score-partwise/>")


def test_unparseable_input_is_refused() -> None:
    with pytest.raises(MusicXMLError):
        score_json_from_musicxml("not xml at all")


# --- real engine output ------------------------------------------------------

REAL = (
    Path(__file__).resolve().parents[3]
    / "fixtures"
    / "musicxml"
    / "oemer_phone_photo.musicxml"
)


@pytest.fixture(scope="module")
def oemer_score():
    """What oemer actually produced from a phone photo of a cello part.

    Kept because the hand-authored fixture above is *tidy* — it exercises the
    awkward constructs but every one of them is well-formed. A real engine on a
    real photograph produces something else entirely, and the converter has to
    survive it rather than raise.
    """
    return score_json_from_musicxml(REAL.read_text(encoding="utf-8"), clef_fallback="bass")


def test_real_engine_output_converts_without_raising(oemer_score) -> None:
    assert oemer_score.measures


def test_the_validator_catches_that_this_reading_is_wrong(oemer_score) -> None:
    """The point of the beat-sum check, on a real failure.

    The page is five systems of common-time cello music in bass clef with two
    flats. oemer read it as five measures of C major in treble clef, one of them
    holding forty-three beats — it found no barlines at all, so each system
    became one measure. Nothing here compares against the page; the reading
    contradicts itself, and that is enough to reject it.
    """
    beats = [
        sum(_DURATION_BEATS[n.duration] for n in m.notes) for m in oemer_score.measures
    ]
    assert max(beats) > 16, "a measure holding four bars' worth is the tell"
    assert len(oemer_score.measures) < 10, "five systems collapsed into five measures"


# Imported, not copied. A second table here had already drifted once — it was
# written before triplets existed and raised `KeyError: 'triplet_eighth'` the
# moment they did, on a fixture that had held triplets all along. The beat
# value of a duration has exactly one correct answer and `alignment.py` owns it.
from app.services.alignment import _DURATION_BEATS  # noqa: E402


def test_duplicate_measure_numbers_survive_conversion(oemer_score) -> None:
    """oemer emitted `number="3"` three times.

    `Measure.measure_number` does not have to be unique and nothing downstream
    assumes it is — `validate.py` reports by position. Worth a test because the
    obvious "fix" is to renumber, which would hide exactly the damage that
    tells you the reading is broken.
    """
    numbers = [m.measure_number for m in oemer_score.measures]
    assert len(numbers) != len(set(numbers))


AUDIVERIS = (
    Path(__file__).resolve().parents[3]
    / "fixtures"
    / "musicxml"
    / "audiveris_phone_photo.musicxml"
)


@pytest.fixture(scope="module")
def audiveris_score():
    """The same photograph, read by Audiveris 5.4 instead of oemer."""
    return score_json_from_musicxml(
        AUDIVERIS.read_text(encoding="utf-8"), clef_fallback="treble"
    )


def test_audiveris_reads_the_header_correctly(audiveris_score) -> None:
    """Both engines were given the same photograph of the same page.

    oemer said treble clef and C major; Audiveris says bass clef and B-flat
    major, which is what is printed. Kept as a test because it is the only
    direct comparison in the repository between two OMR engines on real input,
    and it is the evidence behind preferring one of them.
    """
    assert audiveris_score.clef == "bass"
    assert audiveris_score.key_signature == "Bb major"


def test_audiveris_finds_barlines_where_oemer_found_none(
    audiveris_score, oemer_score
) -> None:
    """The difference that matters for this product.

    InTempo reports rushing and dragging *per measure*, so measure boundaries
    are not a nicety — without them there is nothing to report against. oemer
    returned one measure per system; Audiveris returned fifteen.
    """
    assert len(audiveris_score.measures) > 2 * len(oemer_score.measures)


def test_audiveris_measures_mostly_add_up(audiveris_score) -> None:
    """Not all of them, and the ones that do not are the honest finding.

    Eight of fifteen sum to exactly four beats. The rest run long, which is what
    a missed barline looks like from here — two bars merged into one. No time
    signature was found, so `validate.py` cannot infer a metre (the modal beat
    count is 4.0 but only in 6 of 15 measures, under the 0.6 agreement floor)
    and correctly reports every measure as unverifiable rather than guessing.
    """
    sums = [
        sum(_DURATION_BEATS[n.duration] for n in m.notes)
        for m in audiveris_score.measures
    ]
    assert sum(1 for value in sums if value == 4.0) >= 6
    assert audiveris_score.time_signature is None
    assert all(row.verdict == "unverifiable" for row in validate_measures(audiveris_score))


def test_clef_falls_back_when_absent() -> None:
    """`ScoreJson.clef` has no null. A missing clef must resolve to something,
    and the caller says to what rather than this file guessing treble."""
    xml = """<score-partwise><part id="P1"><measure number="1">
      <note><rest/><duration>4</duration><type>quarter</type></note>
    </measure></part></score-partwise>"""
    assert score_json_from_musicxml(xml, clef_fallback="bass").clef == "bass"


# ---- files that come from a publisher rather than an OMR engine -------------
#
# An engine reading one photographed staff emits one part, one voice, and no
# `<backup>`. A downloaded file has all three, and each of them silently
# corrupts a timeline rather than failing loudly.


def _wrap(parts_xml: str, part_list: str = '<score-part id="P1"><part-name>Cello</part-name></score-part>') -> str:
    return f"<score-partwise><part-list>{part_list}</part-list>{parts_xml}</score-partwise>"


def _note(step: str = "C", octave: int = 3, type_: str = "quarter", voice: str | None = None) -> str:
    v = f"<voice>{voice}</voice>" if voice else ""
    return f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch><type>{type_}</type>{v}</note>"


def test_a_second_voice_does_not_double_the_bar() -> None:
    """`<backup>` rewinds so another voice is written over the same bar.

    Reading straight through counts both as consecutive notes, so a 4/4 bar
    comes out as 8 beats and the beat-sum check calls a correct file broken.
    """
    bar = (
        "<measure number='1'>"
        "<attributes><time><beats>4</beats><beat-type>4</beat-type></time>"
        "<clef><sign>F</sign></clef></attributes>"
        + "".join(_note(voice="1") for _ in range(4))
        + "<backup><duration>4</duration></backup>"
        + "".join(_note(step="G", octave=2, voice="2") for _ in range(4))
        + "</measure>"
    )
    score = score_json_from_musicxml(_wrap(f"<part id='P1'>{bar}</part>"))
    assert len(score.measures[0].notes) == 4, "the second voice was counted as well"


def test_a_single_voice_file_is_unaffected() -> None:
    """The common case — an engine's output — must not change."""
    bar = "<measure number='1'>" + "".join(_note(voice="1") for _ in range(4)) + "</measure>"
    score = score_json_from_musicxml(_wrap(f"<part id='P1'>{bar}</part>"))
    assert len(score.measures[0].notes) == 4


def test_a_multi_part_file_refuses_to_guess() -> None:
    """A downloaded orchestral score's first part is usually the piccolo.

    A cellist who imports it and silently gets the piccolo line has a
    transcription that is timed, verdicted, and wrong in a way that looks
    right. That is worse than an error message.
    """
    bar = "<measure number='1'>" + _note() + "</measure>"
    xml = _wrap(
        f"<part id='P1'>{bar}</part><part id='P2'>{bar}</part>",
        part_list=(
            '<score-part id="P1"><part-name>Piccolo</part-name></score-part>'
            '<score-part id="P2"><part-name>Violoncello</part-name></score-part>'
        ),
    )
    with pytest.raises(MusicXMLError) as caught:
        score_json_from_musicxml(xml)
    assert "2 parts" in str(caught.value)
    # Names the options, so the caller can offer them rather than guess.
    assert "Piccolo" in str(caught.value) and "Violoncello" in str(caught.value)


def test_a_part_can_be_chosen_by_name_or_by_id() -> None:
    bar_one = "<measure number='1'>" + _note(step="C") + "</measure>"
    bar_two = "<measure number='1'>" + _note(step="G") + "</measure>"
    xml = _wrap(
        f"<part id='P1'>{bar_one}</part><part id='P2'>{bar_two}</part>",
        part_list=(
            '<score-part id="P1"><part-name>Piccolo</part-name></score-part>'
            '<score-part id="P2"><part-name>Violoncello</part-name></score-part>'
        ),
    )
    by_id = score_json_from_musicxml(xml, part="P2")
    assert by_id.measures[0].notes[0].pitch.startswith("G")
    # Substring, not prefix: "cello" is what a cellist would type, and
    # "Violoncello" is what the publisher wrote.
    by_name = score_json_from_musicxml(xml, part="cello")
    assert by_name.measures[0].notes[0].pitch.startswith("G")


def test_asking_for_a_part_that_is_not_there_says_what_is() -> None:
    bar = "<measure number='1'>" + _note() + "</measure>"
    with pytest.raises(MusicXMLError) as caught:
        score_json_from_musicxml(_wrap(f"<part id='P1'>{bar}</part>"), part="Trombone")
    assert "Cello" in str(caught.value)


def test_both_readers_agree_about_chords() -> None:
    """A page can arrive as a photograph or as a file, and they must read a
    double stop the same way.

    The MusicXML importer drops chord members, because the timeline is built by
    accumulating durations and counting the second note of a chord makes the
    measure overrun — the beat-sum check then calls a correctly-read bar long
    and asks a musician to repair something that is right.

    Nothing enforced the same rule on the vision path. The prompt was precise
    about fingerings, rehearsal marks, string indications, triplets and slurs,
    and said nothing at all about two noteheads on one stem — so the model was
    free to emit both, and a bass part with a double stop would shift every
    note after it.

    This asserts the instruction exists rather than the model's obedience,
    which is all a test can do here. It is the cheapest guard against the rule
    being lost in a prompt rewrite, and that is the failure it is for.
    """
    from pathlib import Path

    prompt = (
        Path(__file__).resolve().parents[1] / "prompts" / "ocr_prompt.txt"
    ).read_text()

    assert "DOUBLE STOPS" in prompt
    assert "lowest note only" in prompt
    assert "grace note" in prompt, "grace notes have the same effect and the same fix"


def test_the_prompt_covers_the_marks_that_change_how_many_bars_there_are() -> None:
    """Four conventions, each of which changes the *length* of the music.

    A double stop is caught by the beat check when it goes wrong. These are
    not: a multi-measure rest read as one bar leaves the page short by every
    bar the number stood for, and one whole rest in 4/4 adds up perfectly. The
    validator sees nothing and the musician is told their recording doesn't
    match the piece.

    Measured on a page of one bar, eight bars' rest and four more bars, read as
    a single rest bar: `alignment_failed`, quality 0.000, no validator finding.
    """
    from pathlib import Path

    prompt = (
        Path(__file__).resolve().parents[1] / "prompts" / "ocr_prompt.txt"
    ).read_text()

    assert "MULTI-MEASURE REST" in prompt
    assert "BAR REPEAT SIGN" in prompt
    assert "NAVIGATION MARKS" in prompt, "D.C. and D.S. cannot be represented"
    assert "notes_to_human" in prompt.split("NAVIGATION MARKS")[1][:600], (
        "a mark the format cannot hold has to be reported, not silently dropped"
    )
    assert "FERMATA" in prompt


def _partwise(measures_xml: str) -> str:
    """A minimal single-part document wrapping the measures given."""
    return (
        '<score-partwise version="4.0"><part-list>'
        '<score-part id="P1"><part-name>Bass</part-name></score-part>'
        "</part-list><part id=\"P1\">" + measures_xml + "</part></score-partwise>"
    )


def test_a_double_dotted_note_is_read_rather_than_dropped() -> None:
    """It used to be dropped, on the reasoning that reporting the undotted value
    "would silently shorten the measure". A dropped note shortens it by the
    *whole* value instead, and `alignment.py` accumulates durations, so it moves
    every bar after it as well. Avoiding a wrong length by producing a missing
    note is not avoiding anything.

    A double-dotted quarter plus a sixteenth fills 2 beats — the march rhythm
    the first real page this project has seen is written in.
    """
    score = score_json_from_musicxml(_partwise('''
      <measure number="1">
        <attributes><divisions>16</divisions>
          <time><beats>2</beats><beat-type>4</beat-type></time>
          <clef><sign>F</sign><line>4</line></clef>
        </attributes>
        <note><pitch><step>D</step><octave>3</octave></pitch>
          <duration>28</duration><type>quarter</type><dot/><dot/></note>
        <note><pitch><step>E</step><octave>3</octave></pitch>
          <duration>4</duration><type>16th</type></note>
      </measure>'''))

    notes = score.measures[0].notes
    assert [n.duration for n in notes] == ["double_dotted_quarter", "sixteenth"]
    assert sum(_DURATION_BEATS[n.duration] for n in notes) == 2.0


def test_a_breve_and_a_sixty_fourth_are_read() -> None:
    """Both were listed in this module's own comment as "outside what this
    product reads", alongside `long` and `maxima` — which genuinely are."""
    score = score_json_from_musicxml(_partwise('''
      <measure number="1">
        <attributes><divisions>16</divisions>
          <clef><sign>F</sign><line>4</line></clef>
        </attributes>
        <note><pitch><step>C</step><octave>2</octave></pitch>
          <duration>128</duration><type>breve</type></note>
        <note><pitch><step>D</step><octave>2</octave></pitch>
          <duration>1</duration><type>64th</type></note>
      </measure>'''))

    assert [n.duration for n in score.measures[0].notes] == ["double_whole", "sixty_fourth"]


def test_a_triple_dot_is_still_dropped_rather_than_guessed() -> None:
    """The line stays somewhere. A triple dot has no name here and is genuinely
    rare; writing the double-dotted value would be a length nobody played."""
    score = score_json_from_musicxml(_partwise('''
      <measure number="1">
        <attributes><divisions>16</divisions>
          <clef><sign>F</sign><line>4</line></clef>
        </attributes>
        <note><pitch><step>D</step><octave>3</octave></pitch>
          <duration>30</duration><type>quarter</type><dot/><dot/><dot/></note>
      </measure>'''))

    assert score.measures[0].notes == []


# ---------------------------------------------------------------------------
# What an OMR engine's output actually looks like
#
# Found by running homr 0.7.0 over the first real page this project has seen —
# a photographed String Bass part — and putting its MusicXML through this
# importer. The engine read the page well: 74 measures, 267 notes, and 73 of the
# 74 bars add up. The importer got the *header* wrong three ways, and all three
# came from `find("attributes")` reading only the first block in a measure.
#
# The shapes are reproduced here rather than the file: the notes are a
# transcription of copyrighted music, and none of these bugs needs them.
# ---------------------------------------------------------------------------


def test_a_second_attributes_block_in_the_same_measure_is_read() -> None:
    """homr writes `<attributes><divisions/></attributes>` and *then* a second
    block with the clef and key. Reading only the first found no clef and fell
    through to `clef_fallback` — which defaulted to treble, on a bass part,
    which is the one thing `ScoreJson.clef` is documented never to do.
    """
    score = score_json_from_musicxml(_partwise('''
      <measure number="1">
        <attributes><divisions>2</divisions></attributes>
        <attributes>
          <key><fifths>2</fifths></key>
          <clef><sign>F</sign><line>4</line></clef>
        </attributes>
        <note><pitch><step>D</step><octave>3</octave></pitch>
          <duration>2</duration><type>quarter</type></note>
      </measure>'''))

    assert score.clef == "bass"
    assert score.key_signature == "D major"


def test_the_header_is_the_metre_the_piece_starts_in() -> None:
    """The loop kept looking until it found a metre, so on a file that states
    one only at its *change* it presented that as the header — and every bar
    before the change is then reported as having the wrong number of beats, on
    a file that states both correctly.
    """
    score = score_json_from_musicxml(_partwise('''
      <measure number="1">
        <attributes><divisions>2</divisions>
          <time><beats>4</beats><beat-type>4</beat-type></time>
          <clef><sign>F</sign><line>4</line></clef>
        </attributes>
        <note><pitch><step>D</step><octave>3</octave></pitch>
          <duration>8</duration><type>whole</type></note>
      </measure>
      <measure number="2">
        <attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>E</step><octave>3</octave></pitch>
          <duration>6</duration><type>half</type><dot/></note>
      </measure>'''))

    assert score.time_signature == "4/4", "the change was promoted to the header"
    assert score.measures[0].time_signature is None
    assert score.measures[1].time_signature == "3/4", (
        "the change was dropped, so every bar after it is judged against 4/4"
    )
    # And the validator reads it from there, which is the whole point.
    #
    # 3/4 rather than the 2/2 this was written with first: `beats_per_measure`
    # answers in *quarter* beats, so 2/2 and 4/4 are both 4.0 and the assertion
    # could not have failed whatever the code did.
    assert validate_measures(score)[1].expected_beats == 3.0
    assert validate_measures(score)[0].expected_beats == 4.0


def test_a_metre_restated_unchanged_is_not_a_change() -> None:
    """Engines repeat the metre at a system break. Treating each restatement as
    a change would put a `time_signature` on measures that do not have one, and
    `meters_in_force` would carry it as an event."""
    score = score_json_from_musicxml(_partwise('''
      <measure number="1">
        <attributes><divisions>2</divisions>
          <time><beats>4</beats><beat-type>4</beat-type></time>
          <clef><sign>F</sign><line>4</line></clef>
        </attributes>
        <note><pitch><step>D</step><octave>3</octave></pitch>
          <duration>8</duration><type>whole</type></note>
      </measure>
      <measure number="2">
        <attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>E</step><octave>3</octave></pitch>
          <duration>8</duration><type>whole</type></note>
      </measure>'''))

    assert [m.time_signature for m in score.measures] == [None, None]


def test_a_clef_that_cannot_be_read_is_none_rather_than_treble() -> None:
    """`ScoreJson.clef`: "a bass part labelled 'Treble clef' is a worse answer
    than no label". The importer defaulted to treble anyway, and the only real
    caller never passed anything else."""
    score = score_json_from_musicxml(_partwise('''
      <measure number="1">
        <attributes><divisions>2</divisions>
          <clef><sign>TAB</sign><line>5</line></clef>
        </attributes>
        <note><pitch><step>D</step><octave>3</octave></pitch>
          <duration>2</duration><type>quarter</type></note>
      </measure>'''))

    assert score.clef is None


def test_a_caller_may_still_name_the_clef_it_knows() -> None:
    """The parameter stays, because a caller that *does* know — the import
    screen asks which part you play — is different from one that guesses."""
    xml = _partwise('''
      <measure number="1">
        <attributes><divisions>2</divisions></attributes>
        <note><pitch><step>D</step><octave>3</octave></pitch>
          <duration>2</duration><type>quarter</type></note>
      </measure>''')

    assert score_json_from_musicxml(xml, clef_fallback="bass").clef == "bass"
    assert score_json_from_musicxml(xml).clef is None


def test_a_clef_change_mid_piece_does_not_relabel_the_part() -> None:
    """A bass or cello part goes into tenor clef for a high passage and comes
    back — it is one of the most ordinary things in the repertoire this app is
    for. The header is the clef the part *starts* in; a later one is a change,
    and `ScoreJson` has nowhere to put it, so it must not overwrite the label a
    musician reads.
    """
    score = score_json_from_musicxml(_partwise('''
      <measure number="1">
        <attributes><divisions>2</divisions>
          <clef><sign>F</sign><line>4</line></clef>
        </attributes>
        <note><pitch><step>D</step><octave>2</octave></pitch>
          <duration>2</duration><type>quarter</type></note>
      </measure>
      <measure number="2">
        <attributes><clef><sign>C</sign><line>4</line></clef></attributes>
        <note><pitch><step>A</step><octave>3</octave></pitch>
          <duration>2</duration><type>quarter</type></note>
      </measure>'''))

    assert score.clef == "bass", "a tenor-clef passage relabelled the whole part"


# ---------------------------------------------------------------------------
# A multi-bar rest is N bars of silence, not one empty bar
# ---------------------------------------------------------------------------
#
# This is most of what a bass player does, and it was being dropped. Read
# literally, a four-bar rest arrives as a single `<measure>` with nothing in
# it, so three bars of time vanish — and `alignment.py` accumulates durations,
# so every bar after the rest is compared against the recording eight beats
# early. The musician counts the rest correctly, comes in exactly on time, and
# is told they rushed the whole rest of the page.


def _part(measures: str, *, header: str = "") -> str:
    return (
        '<?xml version="1.0"?><score-partwise version="4.0"><part-list>'
        '<score-part id="P1"><part-name>Bass</part-name></score-part>'
        f'</part-list><part id="P1">{header}{measures}</part></score-partwise>'
    )


def _bar(number: int, notes: str, attributes: str = "") -> str:
    return f'<measure number="{number}">{attributes}{notes}</measure>'


_FOUR_FOUR = (
    "<attributes><divisions>1</divisions>"
    "<time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
)
_A_QUARTER = (
    "<note><pitch><step>D</step><octave>3</octave></pitch>"
    "<duration>1</duration><type>quarter</type></note>"
)
_MULTI_REST_4 = (
    "<attributes><measure-style><multiple-rest>4</multiple-rest>"
    "</measure-style></attributes>"
)


def test_a_four_bar_rest_becomes_four_bars_of_rest() -> None:
    score = score_json_from_musicxml(
        _part(
            _bar(1, _A_QUARTER * 4, _FOUR_FOUR)
            + _bar(2, "", _MULTI_REST_4)
            + _bar(3, _A_QUARTER * 4)
        )
    )

    assert len(score.measures) == 6, [len(m.notes) for m in score.measures]
    silent = score.measures[1:5]
    assert all(
        [(n.pitch, n.duration) for n in m.notes] == [("rest", "whole")] for m in silent
    ), [[(n.pitch, n.duration) for n in m.notes] for m in silent]
    assert [f.verdict for f in validate_measures(score)] == ["ok"] * 6


def test_the_bars_after_it_are_renumbered() -> None:
    """The file numbers a four-bar rest as one bar, so everything after it is
    three too low — and `MeasureEditScreen` and every caveat line address a bar
    by its number."""
    score = score_json_from_musicxml(
        _part(
            _bar(1, _A_QUARTER * 4, _FOUR_FOUR)
            + _bar(2, "", _MULTI_REST_4)
            + _bar(3, _A_QUARTER * 4)
        )
    )

    assert [m.measure_number for m in score.measures] == [1, 2, 3, 4, 5, 6]


def test_the_metre_is_taken_from_the_music_when_the_page_never_prints_one() -> None:
    """**The case the real page is.** The only `<time>` on that photograph is
    printed mid-page after a double barline, which is the ordinary shape of an
    inner part rather than an oddity — so a first attempt that expanded only on
    a *stated* metre left the rest exactly as it found it.

    `infer_beats_per_measure` is what `validate.py` already trusts to check a
    headerless page, asked here rather than copied.
    """
    score = score_json_from_musicxml(
        _part(
            _bar(1, _A_QUARTER * 4)
            + _bar(2, _A_QUARTER * 4)
            + _bar(3, "", _MULTI_REST_4)
            + _bar(4, _A_QUARTER * 4)
        )
    )

    assert len(score.measures) == 7
    assert score.measures[2].notes[0].duration == "whole"


def test_a_metre_no_single_rest_fills_is_left_visibly_short() -> None:
    """5/4 has no rest in this schema that fills a bar of it, and inventing one
    would put a duration on the page that the page does not have.

    Left as one empty measure, which `validate.py` reports as a hole. Being
    visibly short is the failure this can afford; being silently short — three
    bars of time gone with every later verdict wrong and nothing to see — is
    not.
    """
    five_four = (
        "<attributes><divisions>1</divisions>"
        "<time><beats>5</beats><beat-type>4</beat-type></time></attributes>"
    )
    # Numbered 7 and 8, not 1 and 2, so that the *other* half of the rule is
    # visible here too: a rest that was not expanded must not renumber the
    # part. With 1 and 2 an unconditional renumber is indistinguishable from
    # no renumber at all, and the mutation that removes the guard survives.
    score = score_json_from_musicxml(
        _part(_bar(7, _A_QUARTER * 5, five_four) + _bar(8, "", _MULTI_REST_4))
    )

    assert len(score.measures) == 2
    assert score.measures[1].notes == []
    assert [m.measure_number for m in score.measures] == [7, 8]
    assert [f.verdict for f in validate_measures(score)] == ["ok", "empty"]


def test_a_score_with_no_multi_bar_rest_keeps_the_file_s_own_numbers() -> None:
    """Renumbering only happens when something was expanded. Doing it
    unconditionally would change the numbers of every score already in the
    library — including the pickup an engine numbers 0, which the importer
    handles deliberately."""
    score = score_json_from_musicxml(
        _part(_bar(7, _A_QUARTER * 4, _FOUR_FOUR) + _bar(8, _A_QUARTER * 4))
    )

    assert [m.measure_number for m in score.measures] == [7, 8]


@pytest.mark.parametrize("value", ["1", "0", "-3", "lots", ""])
def test_a_multiple_rest_that_is_not_several_bars_is_ignored(value: str) -> None:
    """`1` is one bar and needs no expanding; the rest are an engine writing
    something that is not a count, and guessing at it would add bars of silence
    to a part that has none."""
    odd = (
        f"<attributes><measure-style><multiple-rest>{value}</multiple-rest>"
        "</measure-style></attributes>"
    )
    score = score_json_from_musicxml(
        _part(_bar(1, _A_QUARTER * 4, _FOUR_FOUR) + _bar(2, "", odd))
    )

    assert len(score.measures) == 2


def test_a_multi_rest_measure_that_also_holds_notes_keeps_them() -> None:
    """Defensive: the two together are a contradiction, and the notes are the
    half that was definitely read off the page."""
    score = score_json_from_musicxml(
        _part(_bar(1, _A_QUARTER * 4, _FOUR_FOUR) + _bar(2, _A_QUARTER * 4, _MULTI_REST_4))
    )

    assert len(score.measures) == 2
    assert len(score.measures[1].notes) == 4


def test_a_metre_printed_at_the_rest_is_stated_once_not_at_every_bar() -> None:
    """A metre change printed at a four-bar rest is printed *once*.

    `meters_in_force` reads `Measure.time_signature` as a change taking effect
    at that bar, so repeating it across the expanded bars would put three metre
    changes into a score that has one — and a score that says 3/4, 3/4, 3/4,
    3/4 is a different document from one that says 3/4 and then three bars.
    """
    three_four = (
        "<attributes><time><beats>3</beats><beat-type>4</beat-type></time>"
        "<measure-style><multiple-rest>4</multiple-rest></measure-style>"
        "</attributes>"
    )
    score = score_json_from_musicxml(
        _part(_bar(1, _A_QUARTER * 4, _FOUR_FOUR) + _bar(2, "", three_four))
    )

    assert len(score.measures) == 5
    assert [m.time_signature for m in score.measures] == [None, "3/4", None, None, None]
    assert [n.duration for m in score.measures[1:] for n in m.notes] == ["dotted_half"] * 4


# ---------------------------------------------------------------------------
# A whole rest alone in a bar is a bar of rest, whatever the metre says
# ---------------------------------------------------------------------------
#
# The convention is universal and the notation is not literal: an engraver
# writes the whole-rest glyph for a full bar of rest in any metre — a bar of
# 2/4 rest is a whole rest, never a half rest. homr reads the glyph correctly
# and writes four quarter-beats of duration, which is what the symbol means by
# itself and not what it means in that bar.
#
# Measured on `page-upright.jpg`, a 2/4 part: six bars, each a lone whole rest
# scored 4.0 against 2.0, every one of them correct on the page.

_TWO_FOUR = (
    "<attributes><divisions>1</divisions>"
    "<time><beats>2</beats><beat-type>4</beat-type></time></attributes>"
)
_WHOLE_REST = "<note><rest /><duration>4</duration><type>whole</type></note>"


def test_a_lone_whole_rest_in_two_four_is_one_bar_of_rest() -> None:
    score = score_json_from_musicxml(
        _part(
            _bar(1, _A_QUARTER * 2, _TWO_FOUR)
            + _bar(2, _WHOLE_REST)
            + _bar(3, _A_QUARTER * 2)
        )
    )

    assert score.measures[1].notes[0].duration == "half"
    assert [f.verdict for f in validate_measures(score)] == ["ok", "ok", "ok"]


def test_a_whole_rest_in_four_four_is_left_alone() -> None:
    """It already *is* the bar. Reinterpreting a reading that is right is the
    only way this rule can do harm."""
    score = score_json_from_musicxml(
        _part(_bar(1, _A_QUARTER * 4, _FOUR_FOUR) + _bar(2, _WHOLE_REST))
    )

    assert score.measures[1].notes[0].duration == "whole"
    assert [f.verdict for f in validate_measures(score)] == ["ok", "ok"]


def test_a_whole_rest_in_a_bar_longer_than_a_whole_note_is_left_alone() -> None:
    """In 3/2 the bar is six beats and the whole-rest glyph genuinely means
    four — the convention this rule follows applies to bars *shorter* than a
    whole note."""
    three_two = (
        "<attributes><divisions>1</divisions>"
        "<time><beats>3</beats><beat-type>2</beat-type></time></attributes>"
    )
    score = score_json_from_musicxml(
        _part(_bar(1, "", three_two) + _bar(2, _WHOLE_REST))
    )

    assert score.measures[1].notes[0].duration == "whole"


def test_a_whole_rest_sharing_a_bar_with_notes_is_left_alone() -> None:
    """Two things in the bar means the rest is not the bar. `page-upright.jpg`
    ends with exactly this — a whole rest and a quarter rest in 2/4 — and it is
    a genuine misread that should stay flagged rather than be quietly
    reinterpreted into something that still does not add up."""
    score = score_json_from_musicxml(
        _part(_bar(1, _A_QUARTER * 2, _TWO_FOUR) + _bar(2, _WHOLE_REST + _A_QUARTER))
    )

    assert score.measures[1].notes[0].duration == "whole"
    assert [f.verdict for f in validate_measures(score)] == ["ok", "long"]


def test_a_bar_of_only_a_whole_rest_does_not_vote_on_the_metre() -> None:
    """**Otherwise the wrong reading argues for itself.**

    With no metre printed, the bar length comes from
    `infer_beats_per_measure` — and a lone whole rest sums to 4.0, which is the
    very number in question. Here three real bars of 2.0 are outvoted 4-to-3 by
    four rests: the vote fails its agreement threshold, nothing is inferred,
    and all seven bars stay wrong. Excluding them, 2.0 wins outright.
    """
    score = score_json_from_musicxml(
        _part(
            "".join(_bar(n, _A_QUARTER * 2) for n in (1, 2, 3))
            + "".join(_bar(n, _WHOLE_REST) for n in (4, 5, 6, 7))
        )
    )

    assert [n.duration for m in score.measures[3:] for n in m.notes] == ["half"] * 4
    assert [f.verdict for f in validate_measures(score)] == ["ok"] * 7


def test_a_lone_quarter_rest_in_two_four_stays_short() -> None:
    """A bar of 2/4 holding one quarter rest is genuinely half a bar short, and
    that is a misread the musician should see. The whole-rest convention is
    about one specific glyph — widening it to "whatever is alone in the bar"
    turns the beat check into a rubber stamp."""
    quarter_rest = "<note><rest /><duration>1</duration><type>quarter</type></note>"
    score = score_json_from_musicxml(
        _part(_bar(1, _A_QUARTER * 2, _TWO_FOUR) + _bar(2, quarter_rest))
    )

    assert score.measures[1].notes[0].duration == "quarter"
    assert [f.verdict for f in validate_measures(score)] == ["ok", "short"]


def test_a_lone_whole_note_is_a_note_and_stays_one() -> None:
    """**The one mutation of this rule that would delete music.**

    A whole note alone in a 2/4 bar is a misread — the bar is two beats too
    long — but it is a misread about a *note*, and rewriting it as a bar of
    rest replaces something the musician played with silence. The check is on
    the glyph being a rest, not on it being alone.
    """
    whole_note = (
        "<note><pitch><step>D</step><octave>3</octave></pitch>"
        "<duration>4</duration><type>whole</type></note>"
    )
    score = score_json_from_musicxml(
        _part(_bar(1, _A_QUARTER * 2, _TWO_FOUR) + _bar(2, whole_note))
    )

    assert score.measures[1].notes[0].pitch == "D3"
    assert score.measures[1].notes[0].duration == "whole"
    assert [f.verdict for f in validate_measures(score)] == ["ok", "long"]


# ---------------------------------------------------------------------------
# Three findings from one real photograph, in the order they were found
# ---------------------------------------------------------------------------


def _two_voice(rest_first: str, music: str) -> str:
    """A bar written the way homr writes one: a rest voice, a backup, music."""
    return _part(
        _bar(1, _A_QUARTER * 2, _TWO_FOUR)
        + _bar(2, rest_first + "<backup><duration>4</duration></backup>" + music)
    )


def test_the_voice_that_holds_the_music_is_the_one_kept() -> None:
    """**Four notes of real music, deleted on the one real photograph here.**

    A polyphonic bar keeps one voice, because the timeline is one line and a
    bassist plays one of the two. It used to keep whichever voice was written
    *first* — and homr writes its whole-bar rest in voice 2 before the music in
    voice 1, so the rest won and the bar was thrown away. Measured on
    `page-upright.jpg`: the file holds 75 pitched notes and the reading held
    71.
    """
    rest_voice = (
        "<note><rest /><duration>4</duration><type>whole</type>"
        "<voice>2</voice></note>"
    )
    music = "".join(
        "<note><pitch><step>D</step><octave>3</octave></pitch>"
        "<duration>1</duration><type>quarter</type><voice>1</voice></note>"
        for _ in range(2)
    )
    score = score_json_from_musicxml(_two_voice(rest_voice, music))

    kept = [(n.pitch, n.duration) for n in score.measures[1].notes]
    assert kept == [("D3", "quarter"), ("D3", "quarter")], kept


def test_two_real_voices_still_keep_the_one_written_first() -> None:
    """The tiebreak, and the old behaviour where it was right. Nothing here can
    tell a divisi apart, and the upper part is written first by convention."""
    upper = (
        "<note><pitch><step>A</step><octave>3</octave></pitch>"
        "<duration>4</duration><type>half</type><voice>1</voice></note>"
    )
    lower = (
        "<note><pitch><step>D</step><octave>2</octave></pitch>"
        "<duration>4</duration><type>half</type><voice>2</voice></note>"
    )
    score = score_json_from_musicxml(_two_voice(upper, lower))

    assert [n.pitch for n in score.measures[1].notes] == ["A3"]


def test_a_multi_bar_rest_drawn_with_rest_symbols_still_expands() -> None:
    """**The guard I wrote last week blocking the fix I wrote last week.**

    The expansion required the bar to hold no notes, on the reasoning that a
    bar carrying both a multi-rest marking and notes is a contradiction and the
    notes are the half definitely read off the page. True of *pitched* notes,
    false of rests: homr writes the marking together with the rest symbols that
    draw it. Measured on `page-upright.jpg`, a bar marked
    `<multiple-rest>8</multiple-rest>` carrying a whole rest and a breve rest —
    it stayed one bar, and **seven bars of rest were lost**.
    """
    drawn = (
        "<note><rest /><duration>4</duration><type>whole</type></note>"
        "<note><rest /><duration>2</duration><type>half</type></note>"
    )
    score = score_json_from_musicxml(
        _part(_bar(1, _A_QUARTER * 2, _TWO_FOUR) + _bar(2, drawn, _MULTI_REST_4))
    )

    assert len(score.measures) == 5
    assert all(
        [(n.pitch, n.duration) for n in m.notes] == [("rest", "half")]
        for m in score.measures[1:]
    )


def test_a_note_that_contradicts_itself_is_read_by_its_timing() -> None:
    """**A sixteenfold error in a value that accumulates.**

    Measured on `page-upright.jpg`: four notes typed `breve` — eight
    quarter-beats — carrying a `<duration>` of half a beat. Read by `<type>`,
    one of them moves every onset after it by seven and a half beats.

    This module reads `<type>` and not `<duration>` for a good reason, stated
    at the top of the file. That stands; it just never considered a note where
    both are present and they disagree, which is not a choice between two
    conventions but a malformed note with one wrong number in it.
    """
    four_four_in_quarters = (
        "<attributes><divisions>4</divisions>"
        "<time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
    )
    a_quarter = (
        "<note><pitch><step>D</step><octave>3</octave></pitch>"
        "<duration>4</duration><type>quarter</type></note>"
    )
    # Typed as eight quarter-beats, timed as half of one: the exact shape homr
    # writes, sixteen times too long.
    contradictory = "<note><rest /><duration>2</duration><type>breve</type></note>"
    score = score_json_from_musicxml(
        _part(_bar(1, a_quarter * 4 + contradictory, four_four_in_quarters))
    )

    assert score.measures[0].notes[-1].duration == "eighth"


def test_a_contradiction_that_maps_to_nothing_keeps_the_written_type() -> None:
    """An inexact remainder is not evidence about anything. Five-twelfths of a
    beat is not a duration an engraver writes, so the written value stays."""
    twelfths = (
        "<attributes><divisions>12</divisions>"
        "<time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
    )
    a_quarter = (
        "<note><pitch><step>D</step><octave>3</octave></pitch>"
        "<duration>12</duration><type>quarter</type></note>"
    )
    odd = "<note><rest /><duration>5</duration><type>breve</type></note>"
    score = score_json_from_musicxml(
        _part(_bar(1, a_quarter * 4 + odd, twelfths))
    )

    assert score.measures[0].notes[-1].duration == "double_whole"


def test_a_file_with_no_divisions_is_read_by_its_types_as_before() -> None:
    """The reason `<type>` is the default: divisions are an arbitrary per-file
    tick unit and a damaged file may not carry them at all."""
    no_divisions = (
        "<attributes><time><beats>4</beats><beat-type>4</beat-type></time>"
        "</attributes>"
    )
    score = score_json_from_musicxml(
        _part(
            _bar(
                1,
                "<note><rest /><duration>999</duration><type>half</type></note>",
                no_divisions,
            )
        )
    )

    assert score.measures[0].notes[0].duration == "half"


def test_a_rest_voice_never_wins_on_count() -> None:
    """Three rests against two notes: the rests are more numerous and are still
    not the music. Counting entries rather than *pitched* entries would hand
    the bar to the voice that has nothing in it."""
    three_rests = "".join(
        "<note><rest /><duration>1</duration><type>quarter</type>"
        "<voice>2</voice></note>"
        for _ in range(3)
    )
    two_notes = "".join(
        "<note><pitch><step>D</step><octave>3</octave></pitch>"
        "<duration>1</duration><type>quarter</type><voice>1</voice></note>"
        for _ in range(2)
    )
    score = score_json_from_musicxml(_two_voice(three_rests, two_notes))

    assert [n.pitch for n in score.measures[1].notes] == ["D3", "D3"]


# ---------------------------------------------------------------------------
# The shapes homr never writes, which every engraved file does
# ---------------------------------------------------------------------------
#
# homr emits no ties, no tuplets and no dots, so the only provider in the chain
# exercises none of this. A MusicXML file dropped into `ImportFileScreen` does,
# and that is the one route whose timeline is *stated* rather than read — so it
# is the route that must not be quietly broken by a change made for a
# photograph. These sit directly downstream of the contradiction rule in
# `_duration_name`, which is why they exist.

_D4 = (
    "<attributes><divisions>12</divisions>"
    "<time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
)


def _voiceless(kind: str, ticks: int, extra: str = "") -> str:
    return (
        "<note><pitch><step>D</step><octave>3</octave></pitch>"
        f"<duration>{ticks}</duration><type>{kind}</type>{extra}</note>"
    )


_TRIPLET_MARK = (
    "<time-modification><actual-notes>3</actual-notes>"
    "<normal-notes>2</normal-notes></time-modification>"
)


def test_a_triplet_is_still_a_triplet() -> None:
    """**The regression the contradiction rule could have caused.**

    A triplet eighth is typed `eighth` and timed at a third of a quarter, so it
    *is* a note whose type and duration disagree — by design, and the
    disagreement is what the tuplet marking explains. Mapping it to the nearest
    written value would be reading a bracket that is not there.
    """
    triplets = _voiceless("eighth", 4, _TRIPLET_MARK) * 3
    score = score_json_from_musicxml(
        _part(_bar(1, _voiceless("quarter", 12) * 3 + triplets, _D4))
    )

    kinds = [n.duration for n in score.measures[0].notes]
    assert kinds[-3:] == ["triplet_eighth"] * 3, kinds
    assert [f.verdict for f in validate_measures(score)] == ["ok"]


def test_a_ratio_with_no_name_is_still_dropped_rather_than_guessed() -> None:
    """A quintuplet has no name in this schema, and the nearest triplet would
    put notes at times nobody played. It is dropped and declared — which the
    beat check then sees."""
    five_four = (
        "<time-modification><actual-notes>5</actual-notes>"
        "<normal-notes>4</normal-notes></time-modification>"
    )
    score = score_json_from_musicxml(
        _part(_bar(1, _voiceless("quarter", 12) * 3 + _voiceless("16th", 2, five_four), _D4))
    )

    assert len(score.measures[0].notes) == 3
    assert "could not be represented" in score.notes_to_human


def test_a_dotted_note_keeps_its_dot_when_the_file_states_divisions() -> None:
    """The contradiction rule skips dotted notes outright. A dotted quarter is
    typed `quarter` and timed at one and a half beats — a disagreement the dot
    explains, exactly as the tuplet marking does."""
    score = score_json_from_musicxml(
        _part(_bar(1, _voiceless("quarter", 18, "<dot />") + _voiceless("eighth", 6), _D4))
    )

    assert [n.duration for n in score.measures[0].notes] == [
        "dotted_quarter",
        "eighth",
    ]


def test_a_tie_survives_a_file_that_states_its_divisions() -> None:
    tied = _voiceless(
        "half", 24, '<tie type="start" /><notations><tied type="start" /></notations>'
    )
    score = score_json_from_musicxml(_part(_bar(1, tied + _voiceless("half", 24), _D4)))

    assert score.measures[0].notes[0].tied_to_next is True
    assert score.measures[0].notes[1].tied_to_next is False


def test_a_duplet_now_survives_as_the_note_it_lasts() -> None:
    """**An improvement the contradiction rule made by accident, kept on
    purpose.**

    Two notes in the time of three has no name in `Duration`, so
    `_duration_name` returned None and the note was *dropped* — costing the bar
    the whole value, which `alignment.py` then carries into every later bar.

    A duplet eighth in compound time lasts exactly a dotted eighth. That is not
    an approximation, it is the standard equivalence, and the file states it in
    the one element that drives time. So the note now survives with the right
    duration and the wrong-looking name — and since `alignment.py` reads
    nothing but durations, right is the half that matters.

    Recorded as a test because it was not the point of the change that caused
    it, and an unrecorded behaviour change is one nobody can defend later.
    """
    duplet = (
        "<time-modification><actual-notes>2</actual-notes>"
        "<normal-notes>3</normal-notes></time-modification>"
    )
    six_eight = (
        "<attributes><divisions>12</divisions>"
        "<time><beats>6</beats><beat-type>8</beat-type></time></attributes>"
    )
    score = score_json_from_musicxml(
        _part(_bar(1, _voiceless("quarter", 18, duplet) * 2, six_eight))
    )

    assert [n.duration for n in score.measures[0].notes] == ["dotted_quarter"] * 2
    assert score.notes_to_human == ""
    assert [f.verdict for f in validate_measures(score)] == ["ok"]


def test_a_rehearsal_mark_counted_as_a_bar_survives_the_expansion() -> None:
    """**The multi-bar rest fix was erasing the pipeline's most common
    failure.**

    `renumber` calls it that: a boxed rehearsal mark reading **49** came back as
    measure **409**, which inserts a spurious bar and renumbers the line after
    it. `numbering_gaps` is what catches it, and `renumber`'s own docstring is
    explicit that *"the anomaly is reported before it is normalised, not hidden
    by it"*.

    The expansion numbered its output 1..N, which normalises everything —
    including that. Measured: a page numbered 1, 2, 3, 409 reports the gap; the
    same page with a multi-bar rest reported **nothing at all**. Erased on
    exactly the pages that carry rehearsal marks, because those are the pages
    with multi-bar rests.

    Shifting by what the expansion inserted keeps the file's own numbering
    anomalies intact for `renumber` to find and name.
    """
    from app.services.ocr.validate import numbering_gaps

    rehearsal_mark_as_a_bar = (
        _bar(1, _A_QUARTER * 4, _FOUR_FOUR)
        + _bar(2, _A_QUARTER * 4)
        + _bar(3, "", _MULTI_REST_4)
        + _bar(409, _A_QUARTER * 4)
    )
    score = score_json_from_musicxml(_part(rehearsal_mark_as_a_bar))

    # Four bars of rest inserted, so the bar the file called 409 is 412 here.
    assert [m.measure_number for m in score.measures] == [1, 2, 3, 4, 5, 6, 412]
    assert [(g.after, g.next) for g in numbering_gaps(score)] == [(6, 412)]


def test_an_ordinary_part_still_comes_out_contiguous() -> None:
    """The shift is exactly what the expansion inserted, so a file whose own
    numbering is sound stays sound — which is every score in the library and
    the reason this could not simply stop renumbering."""
    score = score_json_from_musicxml(
        _part(
            _bar(1, _A_QUARTER * 4, _FOUR_FOUR)
            + _bar(2, "", _MULTI_REST_4)
            + _bar(3, _A_QUARTER * 4)
            + _bar(4, _A_QUARTER * 4)
        )
    )

    assert [m.measure_number for m in score.measures] == [1, 2, 3, 4, 5, 6, 7]


def test_a_second_multi_bar_rest_is_numbered_after_the_first() -> None:
    """Two rests on a page, which is an orchestral part rather than an edge
    case — a bass part can hold a dozen.

    Each expansion moves everything after it, **including the next expansion's
    own bars**. Written without that, the second rest starts numbering from the
    file's number for it and lands on top of bars that already exist: 1, 2, 3,
    4, 5, **4, 5**, 8. The single-rest tests cannot see this, because there is
    nothing after the first shift for it to get wrong.
    """
    two_rests = (
        _bar(1, _A_QUARTER * 4, _FOUR_FOUR)
        + '<measure number="2">'
        + "<attributes><measure-style><multiple-rest>3</multiple-rest>"
        + "</measure-style></attributes></measure>"
        + _bar(3, _A_QUARTER * 4)
        + '<measure number="4">'
        + "<attributes><measure-style><multiple-rest>2</multiple-rest>"
        + "</measure-style></attributes></measure>"
        + _bar(5, _A_QUARTER * 4)
    )
    score = score_json_from_musicxml(_part(two_rests))

    assert [m.measure_number for m in score.measures] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert [len(m.notes) for m in score.measures] == [4, 1, 1, 1, 4, 1, 1, 4]
