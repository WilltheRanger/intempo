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
