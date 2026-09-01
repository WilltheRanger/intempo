"""A grace note has no duration and is still an attack.

The importer discarded `<grace>` outright, on reasoning that was true about
duration and silent about onsets. The timeline is a list of attacks, so a page
with ornaments on it expected fewer sounds than the musician made, and enough
of them broke the alignment on a take that was played perfectly.

Read `Note.grace_notes` and `ExpectedNote.is_grace_note` for the measurements.
These are the rules those two docstrings claim.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.alignment import (
    ORNAMENT_SHARE,
    AlignmentResult,
    align_dtw,
    align_take,
    apply_fuzzy_match,
    build_timeline,
)
from app.services.classification import Band, compute_deltas
from app.services.ocr.musicxml import score_json_from_musicxml
from app.services.ocr.validate import validate_measures
from app.services.score_schema import Measure, Note, ScoreJson, Slur

BPM = 60.0


def _xml(body: str, *, parts: str = "") -> str:
    return f"""<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Bass</part-name></score-part>{parts}</part-list>
  <part id="P1">{body}</part>
</score-partwise>"""


def _note(step: str = "A", octave: int = 3, kind: str = "quarter", dur: int = 4) -> str:
    return (
        f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch>"
        f"<duration>{dur}</duration><type>{kind}</type></note>"
    )


def _grace(step: str = "B", chord: bool = False, voice: str | None = None) -> str:
    return (
        "<note><grace/>"
        + ("<chord/>" if chord else "")
        + f"<pitch><step>{step}</step><octave>3</octave></pitch><type>16th</type>"
        + (f"<voice>{voice}</voice>" if voice else "")
        + "</note>"
    )


_ATTRS = (
    "<attributes><divisions>4</divisions>"
    "<key><fifths>0</fifths></key>"
    "<time><beats>4</beats><beat-type>4</beat-type></time>"
    "<clef><sign>F</sign><line>4</line></clef></attributes>"
)


def _one_bar(inner: str) -> ScoreJson:
    return score_json_from_musicxml(
        _xml(f'<measure number="1">{_ATTRS}{inner}</measure>')
    )


# --------------------------------------------------------------------------
# Reading the page
# --------------------------------------------------------------------------


def test_a_grace_is_counted_on_the_note_it_decorates() -> None:
    score = _one_bar(_note() + _grace() + _note() + _note() + _note())
    assert [n.grace_notes for n in score.measures[0].notes] == [0, 1, 0, 0]


def test_the_bar_still_adds_up() -> None:
    """The whole reason it is a count and not a note.

    Giving the ornament an entry of its own would push four quarters past the
    metre, and `validate.py` would send a repair pass at the one bar that had
    been read correctly — plus the check would need porting to both browser
    copies for a fact that is not about beats at all.
    """
    score = _one_bar(_note() + _grace() + _note() + _note() + _note())
    assert validate_measures(score)[0].verdict == "ok"


def test_two_graces_before_one_note_are_both_counted() -> None:
    score = _one_bar(_grace("B") + _grace("C") + _note() + _note() + _note() + _note())
    assert score.measures[0].notes[0].grace_notes == 2


def test_a_grace_chord_is_one_attack() -> None:
    """Rolled together, struck once — the same rule an ordinary chord follows."""
    score = _one_bar(
        _grace("B") + _grace("D", chord=True) + _note() + _note() + _note() + _note()
    )
    assert score.measures[0].notes[0].grace_notes == 1


def test_a_grace_before_a_rest_decorates_nothing() -> None:
    rest = "<note><rest/><duration>4</duration><type>quarter</type></note>"
    score = _one_bar(_note() + _grace() + rest + _note() + _note())
    assert [n.grace_notes for n in score.measures[0].notes] == [0, 0, 0, 0]


def test_a_grace_before_a_cue_is_dropped_with_it() -> None:
    """A cue is somebody else's line, and is read back as a rest.

    Keeping the count there would put an invented onset in the bar the musician
    sits through before an entry — the bar they most need to be right.
    """
    cue = (
        "<note><cue/><pitch><step>A</step><octave>4</octave></pitch>"
        "<duration>4</duration><type>quarter</type></note>"
    )
    score = _one_bar(_note() + _grace() + cue + _note() + _note())
    assert [n.grace_notes for n in score.measures[0].notes] == [0, 0, 0, 0]


def test_a_grace_carries_across_the_barline() -> None:
    """Engravers print the ornament before the barline and the note after it."""
    score = score_json_from_musicxml(
        _xml(
            f'<measure number="1">{_ATTRS}{_note()}{_note()}{_note()}'
            f'{_note()}{_grace()}</measure>'
            f'<measure number="2">{_note()}{_note()}{_note()}{_note()}</measure>'
        )
    )
    assert score.measures[1].notes[0].grace_notes == 1


def test_a_grace_in_a_voice_that_was_filtered_out_is_not_counted() -> None:
    """Same rule as every other note here: only the line being read counts."""
    # The ornament is the **last** thing in the voice being discarded, and the
    # kept voice is written after it. That is the one ordering that can tell
    # the rule from its absence: with any note of the discarded voice in
    # between, the count is consumed there and never had a chance to reach the
    # kept line, so the test would pass with the check deleted.
    kept = "".join(
        "<note><pitch><step>A</step><octave>3</octave></pitch>"
        "<duration>4</duration><type>quarter</type><voice>1</voice></note>"
        for _ in range(4)
    )
    body = (
        f'<measure number="1">{_ATTRS}'
        "<note><pitch><step>C</step><octave>4</octave></pitch>"
        "<duration>16</duration><type>whole</type><voice>2</voice></note>"
        + _grace(voice="2")
        + "<backup><duration>16</duration></backup>"
        + kept
        + "</measure>"
    )
    score = score_json_from_musicxml(_xml(body))
    assert [n.pitch for n in score.measures[0].notes] == ["A3"] * 4
    assert all(n.grace_notes == 0 for n in score.measures[0].notes)


def test_a_grace_whose_note_this_schema_drops_rides_on() -> None:
    """The decorated note is gone and the attack was still made.

    The same rule that governs the dropped note governs its ornament: an onset
    lost outright is worse than one placed a little late, so the grace lands on
    the next real note instead of vanishing with it.

    **The example changed and the rule did not.** This used to use an
    E-double-flat, which the pitch grammar refused. It no longer does — see
    `PITCH_PATTERN` — so the case needs a note that is still genuinely
    unspellable, and a *triple* accidental is one.
    """
    triple_sharp = (
        "<note><pitch><step>E</step><alter>3</alter><octave>3</octave></pitch>"
        "<duration>4</duration><type>quarter</type></note>"
    )
    score = _one_bar(_note() + _grace() + triple_sharp + _note() + _note())
    assert [n.grace_notes for n in score.measures[0].notes] == [0, 1, 0]


def test_the_bundled_fixture_keeps_the_ornament_on_its_last_note() -> None:
    """**This asserted the ornament was lost, and it is not lost any more.**

    `bass_excerpt.musicxml` prints a grace before its very last note, and that
    note is an `Ebb3`. The pitch grammar refused a double accidental, so the
    note was dropped — and because it was the *last* note there was nothing
    further along for the grace to ride to, so the ornament went with it. The
    old docstring called that "the one place where the rule above cannot help",
    which was true of the grammar it was written against.

    Widening the grammar recovered both in one move: the note is read, and the
    grace that decorates it is counted on it. Worth keeping as a test because it
    is the only case in the corpus where a dropped note took an ornament with
    it, and because it measures the page-*end* path specifically.
    """
    from app.tests.test_musicxml import FIXTURE

    score = score_json_from_musicxml(FIXTURE.read_text(encoding="utf-8"))

    last = score.measures[-1].notes[-1]
    assert last.pitch == "Ebb3"
    assert last.grace_notes == 1
    assert sum(n.grace_notes for m in score.measures for n in m.notes) == 1


# --------------------------------------------------------------------------
# Putting it in the timeline
# --------------------------------------------------------------------------


def _score(grace_at: dict[int, int] | None = None, bars: int = 4) -> ScoreJson:
    grace_at = grace_at or {}
    measures = []
    for b in range(1, bars + 1):
        measures.append(
            Measure(
                measure_number=b,
                notes=[
                    Note(
                        pitch="A4",
                        duration="quarter",
                        grace_notes=grace_at.get((b - 1) * 4 + n, 0),
                    )
                    for n in range(4)
                ],
            )
        )
    return ScoreJson(
        measures=measures, time_signature="4/4", clef="treble", ocr_confidence=1.0
    )


def test_the_ornament_sounds_before_the_note_it_decorates() -> None:
    timeline = build_timeline(_score({4: 1}), BPM)
    kinds = [(n.is_grace_note, n.after_grace_note) for n in timeline.notes]
    assert kinds[4] == (True, False)
    assert kinds[5] == (False, True)
    assert timeline.onsets[4] < timeline.onsets[5]
    assert list(timeline.onsets) == sorted(timeline.onsets)


def test_the_ornament_sits_inside_the_run_up_and_never_before_it() -> None:
    timeline = build_timeline(_score({4: 1}), BPM)
    beat = 60.0 / BPM
    assert timeline.onsets[5] - timeline.onsets[4] == pytest.approx(
        ORNAMENT_SHARE * beat
    )
    assert timeline.onsets[4] > timeline.onsets[3]


def test_several_ornaments_share_the_run_up_in_order() -> None:
    timeline = build_timeline(_score({4: 3}), BPM)
    graces = [n.onset_s for n in timeline.notes if n.is_grace_note]
    assert len(graces) == 3
    assert graces == sorted(graces)
    assert graces[-1] < timeline.onsets[7]


def test_the_run_up_is_capped_by_the_notes_own_value() -> None:
    """Otherwise an ornament after a long rest is placed seconds early."""
    score = ScoreJson(
        measures=[
            Measure(
                measure_number=1,
                notes=[
                    Note(pitch="A4", duration="quarter"),
                    Note(pitch="rest", duration="dotted_half"),
                ],
            ),
            Measure(
                measure_number=2,
                notes=[Note(pitch="A4", duration="eighth", grace_notes=1)]
                + [Note(pitch="A4", duration="eighth") for _ in range(7)],
            ),
        ],
        time_signature="4/4",
        clef="treble",
        ocr_confidence=1.0,
    )
    timeline = build_timeline(score, BPM)
    grace = next(n for n in timeline.notes if n.is_grace_note)
    decorated = next(n for n in timeline.notes if n.after_grace_note)
    beat = 60.0 / BPM
    # An eighth's own value, not the three-and-a-half beats of silence before it.
    assert decorated.onset_s - grace.onset_s == pytest.approx(
        0.5 * beat * ORNAMENT_SHARE
    )


def test_the_run_up_is_the_gap_from_the_last_sound_not_the_last_note() -> None:
    """A short note before a long one is the case that tells them apart.

    An ornament on a half note after an eighth has an eighth of run-up to be
    squeezed into, not two beats: the interval the ear hears is the one between
    *sounds*, and rests, slur interiors and tied-over notes advance the clock
    without making one.
    """
    score = ScoreJson(
        measures=[
            Measure(
                measure_number=1,
                notes=[
                    Note(pitch="A4", duration="eighth"),
                    Note(pitch="A4", duration="eighth"),
                    Note(pitch="A4", duration="half", grace_notes=1),
                    Note(pitch="A4", duration="quarter"),
                ],
            )
        ],
        time_signature="4/4",
        clef="treble",
        ocr_confidence=1.0,
    )
    timeline = build_timeline(score, BPM)
    grace = next(n for n in timeline.notes if n.is_grace_note)
    decorated = next(n for n in timeline.notes if n.after_grace_note)
    beat = 60.0 / BPM
    assert decorated.onset_s - grace.onset_s == pytest.approx(
        0.5 * beat * ORNAMENT_SHARE
    )


def test_the_first_note_of_the_piece_can_carry_one() -> None:
    """There is no run-up at all, so its own value is the reference."""
    timeline = build_timeline(_score({0: 1}), BPM)
    assert timeline.notes[0].is_grace_note is True
    assert timeline.onsets[0] == pytest.approx(-ORNAMENT_SHARE * 60.0 / BPM)


def test_an_ornament_on_a_note_that_is_never_attacked_is_not_invented() -> None:
    """A note under a bow has no onset here; a grace in front of one would be
    an attack this code made up rather than one it restored."""
    score = _score({1: 1})
    score.measures[0].slurs = [Slur(start_note_index=0, end_note_index=1)]
    timeline = build_timeline(score, BPM)
    assert not any(n.is_grace_note for n in timeline.notes)


def test_an_ornament_on_a_tied_over_note_is_not_invented() -> None:
    score = _score({1: 1})
    score.measures[0].notes[0].tied_to_next = True
    timeline = build_timeline(score, BPM)
    assert not any(n.is_grace_note for n in timeline.notes)


# --------------------------------------------------------------------------
# What the musician is told
# --------------------------------------------------------------------------


def _masks(timeline):
    optional = np.array([n.is_grace_note for n in timeline.notes], dtype=bool)
    steady = np.array(
        [not n.is_grace_note and not n.after_grace_note for n in timeline.notes],
        dtype=bool,
    )
    return optional, steady


def _run(timeline, detected):
    optional, steady = _masks(timeline)
    anchored = align_take(
        detected, timeline.onsets, target_bpm=BPM, steady=steady, optional=optional
    )
    cleaned = apply_fuzzy_match(
        anchored.alignment, anchored.onsets, timeline.onsets, optional=optional
    )
    deltas = compute_deltas(cleaned, anchored.onsets, timeline, BPM)
    return anchored.alignment, cleaned, deltas


@pytest.mark.parametrize("which", ["the ornament", "the note it decorates"])
def test_neither_the_ornament_nor_the_note_it_moves_is_banded(which) -> None:
    """The page states that the ornament is played, not when.

    An acciaccatura leaves the decorated note on the beat; an appoggiatura
    pushes it half the written value late. Timing a musician against
    `ORNAMENT_SHARE` — a number this code chose — would be worse than not
    placing the ornament at all.

    Read against a control in the same take: an unornamented note pushed by
    exactly as much is called `severe`, so what is being asserted is the
    refusal and not a tolerance that happens to swallow it.
    """
    timeline = build_timeline(_score({4: 1}), BPM)
    graced = next(i for i, n in enumerate(timeline.notes) if n.is_grace_note)
    target = graced if which == "the ornament" else graced + 1
    control = graced + 4

    detected = timeline.onsets + 1.0
    detected[target] += 0.35
    detected[control] += 0.35

    optional, _ = _masks(timeline)
    # A straight one-to-one mapping, so the matcher's own choices cannot stand
    # in for the rule under test.
    cleaned = apply_fuzzy_match(
        AlignmentResult(
            mapping=[(i, i) for i in range(len(timeline.notes))],
            cost=0.0,
            quality=1.0,
            n_detected=detected.size,
            n_expected=timeline.onsets.size,
        ),
        detected,
        timeline.onsets,
        optional=optional,
    )
    deltas = {d.global_index: d for d in compute_deltas(cleaned, detected, timeline, BPM)}
    assert deltas[target].band is Band.on
    assert deltas[control].band is not Band.on


def test_an_ornament_nobody_played_is_not_a_skipped_note() -> None:
    """An acciaccatura can sit inside the onset detector's own resolution, and
    a musician may simply not play it. Counting those as unheard notes took a
    perfectly played take from 1.000 to 0.350 — under the cutoff that asks for
    a re-record."""
    timeline = build_timeline(_score({2: 1, 6: 1, 10: 1}), BPM)
    plain = build_timeline(_score(), BPM)
    alignment, cleaned, _ = _run(timeline, plain.onsets + 1.0)
    assert cleaned.missed_expected == []
    assert alignment.quality == pytest.approx(1.0)


def test_a_take_that_plays_the_ornaments_is_no_longer_called_wrong() -> None:
    """The failure this whole change exists for.

    Sixteen quarters on the grid with the ornaments played just before the
    beat. With the graces dropped the extra attacks are unexplained,
    `_initial_ratio` reads the pace off the gaps between detections, and the
    verdict turns on a take that was played exactly as printed.
    """
    ornaments = {i: 1 for i in (1, 3, 5, 7, 9, 11, 13, 15)}
    grid = build_timeline(_score(), BPM).onsets + 1.0
    played = np.sort(
        np.concatenate([grid, [grid[i] - 0.09 for i in sorted(ornaments)]])
    )

    dropped, _, dropped_deltas = _run(build_timeline(_score(), BPM), played)
    read, cleaned, read_deltas = _run(build_timeline(_score(ornaments), BPM), played)

    assert dropped.quality < 0.6
    assert any(d.band is not Band.on for d in dropped_deltas)
    assert read.quality > 0.9
    assert all(d.band is Band.on for d in read_deltas)
    assert cleaned.extra_detected == []


# --------------------------------------------------------------------------
# The `optional` mask itself
# --------------------------------------------------------------------------


def test_an_unmatched_optional_onset_costs_no_coverage() -> None:
    expected = np.array([0.0, 0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    optional = np.zeros(expected.size, dtype=bool)
    optional[1] = True
    detected = np.delete(expected, 1)
    with_mask = align_dtw(detected, expected, target_bpm=BPM, optional=optional)
    without = align_dtw(detected, expected, target_bpm=BPM)
    assert with_mask.quality > without.quality


def test_matching_an_optional_onset_is_not_free_credit() -> None:
    """It is dropped from the numerator as well as the denominator, so an
    ornament cannot pay for a note that went unheard."""
    expected = np.array([0.0, 0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    optional = np.zeros(expected.size, dtype=bool)
    optional[1] = True
    heard = align_dtw(expected, expected, target_bpm=BPM, optional=optional)
    assert heard.quality == pytest.approx(
        align_dtw(expected, expected, target_bpm=BPM).quality
    )


def test_every_onset_optional_falls_back_rather_than_dividing_by_zero() -> None:
    expected = np.array([0.0, 1.0, 2.0, 3.0])
    optional = np.ones(expected.size, dtype=bool)
    result = align_dtw(expected, expected, target_bpm=BPM, optional=optional)
    assert result.quality > 0.0
