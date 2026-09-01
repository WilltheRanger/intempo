"""Tuplet ratios: what the bracket says, checked against what is inside it.

The durations already carry the beats. The ratio adds the one fault the beat
sum cannot see — three `triplet_eighth`s written where the page brackets a 5:4
quintuplet sum to **exactly 1.0**, the bar adds up, and the reading is silently
wrong. Before this, the vision path had no ratio to check against at all: the
model emitted a duration name and nothing else.
"""

from __future__ import annotations

import pytest

from app.services.ocr.musicxml import score_json_from_musicxml
from app.services.ocr.validate import (
    MeasureFinding,
    describe_for_retry,
    validate_measures,
)
from app.services.score_schema import (
    DURATION_BEATS,
    Measure,
    Note,
    ScoreJson,
    Tuplet,
    clear_unwritable_where_rewritten,
    tuplet_faults,
)


def _measure(durations: list[str], tuplets: list[Tuplet] | None = None) -> Measure:
    return Measure(
        measure_number=1,
        notes=[Note(pitch="E2", duration=d) for d in durations],
        slurs=[],
        tuplets=tuplets or [],
    )


def _score(measure: Measure) -> ScoreJson:
    return ScoreJson(
        time_signature="4/4", key_signature="C major", clef="bass",
        measures=[measure], ocr_confidence=0.9,
    )


TRIPLET_3_2 = Tuplet(start_note_index=0, end_note_index=2, actual_notes=3, normal_notes=2)


# --- the ratio agrees with the bracket -------------------------------------

def test_a_well_formed_triplet_group_is_clean() -> None:
    measure = _measure(["triplet_eighth"] * 3 + ["quarter"] * 3, [TRIPLET_3_2])
    assert tuplet_faults([measure]) == []
    assert validate_measures(_score(measure))[0].is_problem is False


def test_two_triplet_groups_are_two_brackets() -> None:
    """The grouping a per-note marking could not express: six consecutive
    triplet eighths are two groups of three, and a flat key on each note cannot
    say which."""
    measure = _measure(
        ["triplet_eighth"] * 6 + ["half"],
        [
            Tuplet(start_note_index=0, end_note_index=2, actual_notes=3, normal_notes=2),
            Tuplet(start_note_index=3, end_note_index=5, actual_notes=3, normal_notes=2),
        ],
    )
    assert tuplet_faults([measure]) == []


def test_an_incomplete_group_is_caught() -> None:
    """Two notes claiming three-in-the-time-of-two."""
    measure = _measure(
        ["triplet_eighth"] * 2 + ["quarter"] * 3,
        [Tuplet(start_note_index=0, end_note_index=1, actual_notes=3, normal_notes=2)],
    )
    (fault,) = tuplet_faults([measure])
    assert fault.reason == "count"
    assert "holds 2 notes, not 3" in fault.describe()


def test_a_group_running_past_the_measure_is_caught() -> None:
    measure = _measure(
        ["triplet_eighth"] * 3,
        [Tuplet(start_note_index=0, end_note_index=5, actual_notes=6, normal_notes=4)],
    )
    (fault,) = tuplet_faults([measure])
    assert fault.reason == "range"


def test_a_ratio_the_durations_cannot_express_is_reported() -> None:
    """The case the beat sum is blind to, stated as arithmetic.

    Five notes bracketed **5:6** — a quintuplet in a compound metre, replacing
    six — approximated as three triplet eighths plus two more. The durations sum
    to a plausible number and nothing else in the system can tell. Only the
    printed ratio can.

    5:4 until `Duration` learned to name quintuplets, at which point this became
    a test that a *writable* ratio is reported unwritable. 5:6 is the same
    situation the 5:4 case used to be in, and is what the schema now documents
    as the remaining gap.
    """
    measure = _measure(
        ["triplet_eighth"] * 3 + ["sixteenth"] * 2,
        [Tuplet(start_note_index=0, end_note_index=4, actual_notes=5, normal_notes=6)],
    )
    (fault,) = tuplet_faults([measure])
    assert fault.reason == "unwritable"
    # The message named 3:2 as the only writable ratio. It is not any more —
    # duplets, quadruplets, sextuplets, quintuplets and septuplets all land on
    # values with names — so what it says now is what is still true of 5:6.
    assert "no written value survives it" in fault.describe()


def test_a_bracket_over_plain_durations_is_caught() -> None:
    """A 3:2 bracket whose notes were written as plain eighths — the durations
    are half a beat each instead of a third, so the bar runs long, but this says
    *why*."""
    measure = _measure(
        ["eighth"] * 3 + ["quarter"] * 2,
        [TRIPLET_3_2],
    )
    (fault,) = tuplet_faults([measure])
    assert fault.reason == "durations"
    assert "not 3:2 values" in fault.describe()


# --- flagging --------------------------------------------------------------

def test_a_quintuplet_flags_a_measure_whose_beats_are_perfect() -> None:
    """The whole reason the ratio is worth its output tokens."""
    measure = _measure(
        ["triplet_eighth"] * 3 + ["quarter"] * 3,
        [Tuplet(start_note_index=0, end_note_index=2, actual_notes=5, normal_notes=4)],
    )
    (finding,) = validate_measures(_score(measure))

    assert finding.actual_beats == pytest.approx(4.0), "the arithmetic really is fine"
    assert finding.verdict == "ok"
    assert finding.is_problem, "a clean beat sum must not hide a misread bracket"
    assert finding.tuplet_faults


def test_the_retry_prompt_asks_about_the_bracket() -> None:
    measure = _measure(
        ["triplet_eighth"] * 2 + ["quarter"] * 3,
        [Tuplet(start_note_index=0, end_note_index=1, actual_notes=3, normal_notes=2)],
    )
    note = describe_for_retry(validate_measures(_score(measure)))
    assert "Count the notes inside each bracket" in note
    assert "actual_notes" in note and "normal_notes" in note


# --- the beats themselves are unchanged ------------------------------------

def test_three_triplet_eighths_still_fill_one_beat() -> None:
    """The ratio is a check, not a source of durations."""
    assert sum(DURATION_BEATS["triplet_eighth"] for _ in range(3)) == pytest.approx(1.0)


# --- the file path states the same thing -----------------------------------

_XML = """<?xml version="1.0"?><score-partwise version="4.0"><part id="P1">
<measure number="1">
  <attributes><time><beats>4</beats><beat-type>4</beat-type></time>
    <clef><sign>F</sign><line>4</line></clef></attributes>
  {notes}
</measure></part></score-partwise>"""

_TRIPLET_NOTE = (
    "<note><pitch><step>E</step><octave>2</octave></pitch><type>eighth</type>"
    "<time-modification><actual-notes>3</actual-notes>"
    "<normal-notes>2</normal-notes></time-modification></note>"
)
_PLAIN_QUARTER = (
    "<note><pitch><step>E</step><octave>2</octave></pitch><type>quarter</type></note>"
)


def test_an_imported_file_states_its_brackets_too() -> None:
    """Both provenances describe a tuplet the same way, so the check does not
    behave differently depending on how the piece arrived."""
    score = score_json_from_musicxml(
        _XML.format(notes=_TRIPLET_NOTE * 3 + _PLAIN_QUARTER * 3)
    )
    (measure,) = score.measures
    assert [n.duration for n in measure.notes[:3]] == ["triplet_eighth"] * 3
    assert len(measure.tuplets) == 1
    assert (measure.tuplets[0].actual_notes, measure.tuplets[0].normal_notes) == (3, 2)
    assert (measure.tuplets[0].start_note_index, measure.tuplets[0].end_note_index) == (0, 2)
    assert tuplet_faults(score.measures) == []


def test_an_imported_file_with_two_brackets_gets_two_entries() -> None:
    score = score_json_from_musicxml(
        _XML.format(notes=_TRIPLET_NOTE * 3 + _PLAIN_QUARTER + _TRIPLET_NOTE * 3)
    )
    (measure,) = score.measures
    assert len(measure.tuplets) == 2, "one run of triplets, a plain note, then another"
    assert [(t.start_note_index, t.end_note_index) for t in measure.tuplets] == [(0, 2), (4, 6)]


def test_a_file_with_no_brackets_states_none() -> None:
    score = score_json_from_musicxml(_XML.format(notes=_PLAIN_QUARTER * 4))
    assert score.measures[0].tuplets == []


# --------------------------------------------------------------------------
# Ratios other than three-in-the-time-of-two
#
# The importer used to drop every one of them, so nothing here could ever have
# a bracket to check. It reads any ratio whose product lands on a written
# value, and these are the rules that keeps the fault honest.
# --------------------------------------------------------------------------


def _bracket(actual: int, normal: int, at: int = 0, through: int = 1) -> Tuplet:
    return Tuplet(
        start_note_index=at,
        end_note_index=through,
        actual_notes=actual,
        normal_notes=normal,
    )


def test_a_duplet_of_dotted_values_is_not_a_fault() -> None:
    """Two in the time of three, worth a dotted value each.

    Every one of these was `unwritable` — the ratio set held 3:2 alone — so the
    first duplet the importer could read would have been reported as broken on
    a bar it had read correctly.
    """
    measure = _measure(["dotted_eighth"] * 4, [_bracket(2, 3)])
    assert tuplet_faults([measure]) == []


def test_a_quadruplet_of_dotted_sixteenths_is_not_a_fault() -> None:
    measure = _measure(["dotted_sixteenth"] * 8, [_bracket(4, 3, through=3)])
    assert tuplet_faults([measure]) == []


def test_a_sextuplet_is_three_in_the_time_of_two_twice_over() -> None:
    measure = _measure(["triplet_eighth"] * 9, [_bracket(6, 4, through=5)])
    assert tuplet_faults([measure]) == []


def test_a_duplet_bracket_over_plain_values_is_caught_by_the_arithmetic() -> None:
    """A duplet bracket read but not applied leaves a plain eighth.

    Caught without needing the visible-ratio rule at all: un-tupleting an
    eighth under 2:3 gives a third of a beat, which no notehead writes, so the
    stored value cannot have come from this bracket. What the correctly-read
    duplet carries — a dotted eighth — un-tuplets to a plain eighth and passes.
    """
    (fault,) = tuplet_faults([_measure(["eighth"] * 4, [_bracket(2, 3)])])
    assert fault.reason == "durations"
    assert tuplet_faults([_measure(["dotted_eighth"] * 4, [_bracket(2, 3)])]) == []


def test_a_three_in_two_bracket_over_plain_values_is_still_caught() -> None:
    """And this is why the ambiguity above is not simply forgiven everywhere.

    3:2 turns written values into lengths no notehead writes, so a plain eighth
    inside one is the bracket having been read and its arithmetic not applied.
    """
    measure = _measure(["eighth"] * 3 + ["quarter"] * 2, [_bracket(3, 2, through=2)])
    (fault,) = tuplet_faults([measure])
    assert fault.reason == "durations"


def test_five_in_the_time_of_six_still_has_no_name() -> None:
    """Six fifths of a sixteenth has no notehead, and guessing the nearest
    triplet would put notes at times nobody played.

    Five in the time of *four* used to be this test, and is now writable —
    `quintuplet_sixteenth`. Five in the time of six, which is how a quintuplet is
    bracketed in a compound metre, still is not.
    """
    measure = _measure(["triplet_eighth"] * 5 + ["quarter"] * 3, [_bracket(5, 6, through=4)])
    (fault,) = tuplet_faults([measure])
    assert fault.reason == "unwritable"


def test_five_in_the_time_of_four_now_has_one() -> None:
    """The other half of the pair above, so the boundary is pinned from both
    sides: a bar of quintuplet sixteenths is ordinary notation and must not be
    reported as a fault."""
    measure = _measure(
        ["quintuplet_sixteenth"] * 5 + ["quarter"] * 3, [_bracket(5, 4, through=4)]
    )
    assert tuplet_faults([measure]) == []
    (finding,) = validate_measures(_score(measure))
    assert finding.actual_beats == pytest.approx(4.0)
    assert finding.is_problem is False


# --------------------------------------------------------------------------
# A group with no writable parts still has a writable length
# --------------------------------------------------------------------------


def _xml(body: str, *, beats: int = 4, beat_type: int = 4, divisions: int = 12) -> str:
    return f"""<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>B</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>{divisions}</divisions><key><fifths>0</fifths></key>
    <time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time>
    <clef><sign>F</sign><line>4</line></clef></attributes>{body}
  </measure></part>
</score-partwise>"""


_QUARTER = (
    "<note><pitch><step>A</step><octave>3</octave></pitch>"
    "<duration>12</duration><type>quarter</type></note>"
)


def _bracketed(kind: str, actual: int, normal: int, count: int) -> str:
    one = (
        "<note><pitch><step>A</step><octave>3</octave></pitch>"
        f"<type>{kind}</type><time-modification>"
        f"<actual-notes>{actual}</actual-notes>"
        f"<normal-notes>{normal}</normal-notes></time-modification></note>"
    )
    return one * count


def _nameless(count: int = 9) -> str:
    """A bracketed group no `Duration` can write, one note at a time.

    **These cases need a ratio that has no name, not a quintuplet.** They were
    written with `5:4` sixteenths, which was the ordinary unwritable ratio until
    `Duration` learned `quintuplet_sixteenth` — at which point every one of them
    silently stopped testing what it says it tests, because the notes came back
    named and no rest was ever flushed. Same expiry as the examples in
    `test_score_schema.test_a_duration_this_schema_cannot_express_is_still_fatal`,
    third time in this repository.

    Nine in the time of eight thirty-seconds: each note is 1/9 of a beat, which
    no notehead writes, and a nonuplet is real notation rather than a value
    invented to fail. A group's *total* is `base x normal` and does not depend
    on how many notes are inside it, so this comes to a **quarter** — exactly
    what the 5:4 group it replaces came to, which is why these cases keep their
    shape and their surrounding bars.
    """
    return _bracketed("32nd", 9, 8, count)


def test_a_quintuplet_keeps_its_length_as_a_rest() -> None:
    """**Because a bar short by a beat moves every bar after it.**

    Five in the time of four sixteenths is a quarter however it is subdivided,
    and a quarter has a rest — so the length survives even though none of its
    parts can be written. Before this, the five notes vanished, the bar read
    three beats, and `alignment.py` accumulates: every bar on the rest of the
    page was expected a beat early.
    """
    score = score_json_from_musicxml(
        _xml(_QUARTER + _nameless() + _QUARTER * 2)
    )
    assert [(n.pitch, n.duration) for n in score.measures[0].notes] == [
        ("A3", "quarter"),
        ("rest", "quarter"),
        ("A3", "quarter"),
        ("A3", "quarter"),
    ]
    assert [f.verdict for f in validate_measures(score)] == ["ok"]


def test_the_rest_stands_where_the_group_stood() -> None:
    """Flushed at the note that ended the run, before that note is appended.

    Position is not decoration here: `alignment.py` walks the measure in order,
    so a rest emitted after the note it preceded swaps two onsets in time.
    """
    score = score_json_from_musicxml(
        _xml(_QUARTER * 2 + _nameless() + _QUARTER)
    )
    assert [n.pitch for n in score.measures[0].notes] == ["A3", "A3", "rest", "A3"]


def test_a_group_that_runs_to_the_barline_is_still_flushed() -> None:
    """There is no following note to flush it, so the measure end must."""
    score = score_json_from_musicxml(
        _xml(_QUARTER * 3 + _nameless())
    )
    assert [n.pitch for n in score.measures[0].notes] == ["A3", "A3", "A3", "rest"]
    assert [f.verdict for f in validate_measures(score)] == ["ok"]


def test_a_septuplet_of_thirty_seconds_is_read_rather_than_silenced() -> None:
    """Seven in the time of eight thirty-seconds is a quarter, and this used to
    assert that the quarter came back as **one rest**.

    It comes back as seven notes now. That is the whole point of naming
    septuplets: keeping the group's length was the best that could be done while
    its parts had no names, and it cost every onset inside the bracket — a
    musician playing seven notes was measured against a bar that expected
    silence. Each note is an eighth of a beat... which `septuplet_sixteenth`
    (1/7 of a quarter) is not, so the ratio here is 7:8 and lands on
    `septuplet_quarter` scaled down: see the beats table.
    """
    score = score_json_from_musicxml(
        _xml(_QUARTER + _bracketed("32nd", 7, 8, 7) + _QUARTER * 2)
    )
    notes = score.measures[0].notes
    assert [f.verdict for f in validate_measures(score)] == ["ok"]
    assert not any(n.pitch == "rest" for n in notes), "no onset may be lost"
    assert [n.duration for n in notes[1:8]] == ["septuplet_sixteenth"] * 7
    assert score.measures[0].unwritable_notes == 0


def test_half_a_group_leaves_the_bar_visibly_short() -> None:
    """**The one case where being wrong out loud is the right answer.**

    Four sixteenths of a quintuplet is four fifths of a beat, and no
    combination of rests writes that. Rather than round it — which would put
    the notes after it at times nobody played — nothing is flushed, and the bar
    comes up short where the beat check can see it.
    """
    # In bar *two*, because `validate_measures` forgives a short first measure
    # as a pickup — so putting it there would prove nothing about being seen.
    score = score_json_from_musicxml(
        _xml(_QUARTER * 4).replace(
            "</measure>",
            '</measure><measure number="2">'
            + _QUARTER
            + _nameless(8)
            + _QUARTER * 2
            + "</measure>",
            1,
        )
    )
    assert all(n.pitch != "rest" for n in score.measures[1].notes)
    assert [f.verdict for f in validate_measures(score)] == ["ok", "short"]


def test_a_ratio_that_does_have_a_name_is_not_turned_into_silence() -> None:
    """The guard that keeps this from eating the tuplets the last change
    taught the importer to read."""
    score = score_json_from_musicxml(
        _xml(_QUARTER + _bracketed("eighth", 3, 2, 3) + _QUARTER * 2)
    )
    assert all(n.pitch == "A3" for n in score.measures[0].notes)
    assert [n.duration for n in score.measures[0].notes[1:4]] == ["triplet_eighth"] * 3


@pytest.mark.parametrize(
    "kind,actual,normal,count,name",
    [
        ("16th", 5, 4, 5, "quintuplet_sixteenth"),
        ("eighth", 5, 4, 5, "quintuplet_eighth"),
        ("16th", 7, 4, 7, "septuplet_sixteenth"),
        # Seven in the time of *eight* is the compound-metre spelling of a
        # septuplet. It needs no name of its own: it lands on the same length
        # `septuplet_quarter` denotes, and the beats-to-name lookup finds it.
        ("eighth", 7, 8, 7, "septuplet_quarter"),
    ],
)
def test_a_bracket_an_engraver_writes_keeps_every_onset(
    kind: str, actual: int, normal: int, count: int, name: str
) -> None:
    """**The measurement this change was made for.**

    Before `Duration` named these, `_unnameable_tuplet_beats` kept the group's
    *length* and wrote it as rests — the right trade when the alternative is
    moving every later bar, and completely silent to every check here. Measured
    on the first case below, a 4/4 bar read correctly off the page:

        onsets in the transcription   3 of 8
        beat-sum verdict              ok, 4.0 of 4.0
        the only trace                unwritable_notes = 5

    `alignment.py` matches what was played against that timeline, so a musician
    playing the quintuplet was scored against a bar expecting silence there.

    The bar has to stay correct as well as complete, which is why the verdict
    and the total are asserted alongside the onsets: a duration that recovers
    the notes but not the length would move every bar after it instead.
    """
    tail = 4 - (DURATION_BEATS[name] * count)
    body = _bracketed(kind, actual, normal, count) + _QUARTER * int(round(tail))
    score = score_json_from_musicxml(_xml(body))
    (measure,) = score.measures
    (finding,) = validate_measures(score)

    assert [n.duration for n in measure.notes[:count]] == [name] * count
    assert not any(n.pitch == "rest" for n in measure.notes), "no onset may be lost"
    assert measure.unwritable_notes == 0
    assert finding.verdict == "ok"
    assert finding.actual_beats == pytest.approx(4.0)
    assert finding.is_problem is False


def test_the_notes_are_still_declared_lost() -> None:
    """Keeping the time is not the same as reading the notes, and the count is
    still the count of notes this schema could not write."""
    score = score_json_from_musicxml(
        _xml(_QUARTER + _nameless() + _QUARTER * 2)
    )
    assert "9 note(s)" in score.notes_to_human
    assert "kept as a rest" in score.notes_to_human
    assert score.ocr_confidence < 0.5


# --------------------------------------------------------------------------
# The bar that adds up and is still missing notes
# --------------------------------------------------------------------------


def test_the_measure_carries_what_the_reading_lost() -> None:
    """The count has to live on the schema the app shares.

    `notes_to_human` names the bar in one sentence for the whole page, and no
    screen can point that at a measure. Since an unwritable tuplet now keeps
    its length as rests, the beat check is silent by construction — so without
    this the app has nothing at all to show.
    """
    score = score_json_from_musicxml(
        _xml(_QUARTER + _nameless() + _QUARTER * 2)
    )
    assert score.measures[0].unwritable_notes == 9
    assert [f.verdict for f in validate_measures(score)] == ["ok"]


def test_a_clean_page_carries_nothing() -> None:
    score = score_json_from_musicxml(_xml(_QUARTER * 4))
    assert score.measures[0].unwritable_notes == 0
    assert not any(f.is_problem for f in validate_measures(score))


def test_it_becomes_a_concern_on_a_bar_whose_beats_add_up() -> None:
    score = score_json_from_musicxml(
        _xml(_QUARTER + _nameless() + _QUARTER * 2)
    )
    (finding,) = validate_measures(score)
    assert finding.is_problem is True
    # ...and not a re-read: the page was read correctly and this app ran out
    # of names, so a fresh look at the image returns the same note.
    assert finding.worth_a_re_read is False
    assert describe_for_retry(validate_measures(score)) == ""
    assert "could not write" in finding.describe()


def test_a_bar_that_is_short_as_well_says_both() -> None:
    """The missing notes are usually *why* the bar is short, so choosing
    between the two sentences would drop the half that explains the other."""
    finding = MeasureFinding(
        measure_number=4,
        verdict="short",
        expected_beats=4.0,
        actual_beats=3.0,
        note_count=3,
        unwritable_notes=2,
    )
    described = finding.describe()
    assert "2 notes the reading could not write" in described
    assert "3 beats, expected 4 (short)" in described
    # ...and says "measure 4" once, not twice, which is what joining two
    # sentences that each open with it would do.
    assert described.count("measure 4") == 1
    assert finding.worth_a_re_read is True


def test_a_bar_the_musician_rewrites_stops_claiming_it_lost_notes() -> None:
    """**A caveat nobody can clear is worse than no caveat.**

    `MeasureEditScreen` spreads the measure it saves, deliberately, so fields
    it does not know about survive — and the count came straight back with it.
    The bar a musician had just repaired kept telling them it was broken.
    """
    read = score_json_from_musicxml(
        _xml(_QUARTER + _nameless() + _QUARTER * 2)
    )
    stored = read.model_dump(mode="json")

    repaired = read.model_copy(
        update={
            "measures": [
                read.measures[0].model_copy(
                    update={
                        "notes": [
                            Note(pitch="A3", duration="sixteenth") for _ in range(4)
                        ]
                    }
                )
            ]
        }
    )
    cleared = clear_unwritable_where_rewritten(repaired, stored)
    assert cleared.measures[0].unwritable_notes == 0


def test_a_bar_saved_untouched_keeps_its_count() -> None:
    """Renaming a piece, or fixing a slur three bars away, is not a repair."""
    read = score_json_from_musicxml(
        _xml(_QUARTER + _nameless() + _QUARTER * 2)
    )
    stored = read.model_dump(mode="json")
    assert (
        clear_unwritable_where_rewritten(read, stored).measures[0].unwritable_notes == 9
    )


def test_a_bar_that_did_not_exist_when_the_page_was_read_carries_nothing() -> None:
    read = score_json_from_musicxml(
        _xml(_QUARTER + _nameless() + _QUARTER * 2)
    )
    invented = read.measures[0].model_copy(update={"measure_number": 9})
    with_new_bar = read.model_copy(update={"measures": [*read.measures, invented]})
    cleared = clear_unwritable_where_rewritten(
        with_new_bar, read.model_dump(mode="json")
    )
    assert cleared.measures[0].unwritable_notes == 9
    assert cleared.measures[-1].unwritable_notes == 0


def test_stored_measures_are_matched_by_number_not_position() -> None:
    """A bar inserted in the middle shifts every index after it, and clearing
    the wrong bar's count is the same mistake as naming the wrong bar."""
    read = score_json_from_musicxml(
        _xml(_QUARTER + _nameless() + _QUARTER * 2)
    )
    stored = read.model_dump(mode="json")
    shifted = read.model_copy(
        update={
            "measures": [
                Measure(measure_number=0 + 1, notes=[]).model_copy(
                    update={"measure_number": 7}
                ),
                read.measures[0],
            ]
        }
    )
    cleared = clear_unwritable_where_rewritten(shifted, stored)
    assert cleared.measures[1].unwritable_notes == 9
