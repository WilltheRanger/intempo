"""Layer 2 of the audio pipeline: match detected onsets to the score.

Three jobs:
  1. Turn the score JSON into the sequence of onset times we *expect* at
     the target tempo (`compute_expected_onsets` / `build_timeline`).
  2. Warp the detected onset sequence onto the expected one with DTW
     (`align_dtw`), returning a monotonic index mapping + a 0..1 quality
     score.
  3. Clean up the count mismatches DTW can't (`apply_fuzzy_match`):
     missed notes (one-to-many) and extra/false-trigger notes
     (many-to-one), per spec §7.

If alignment is too poor to trust, `is_alignment_broken` says so and the
orchestrator refuses to report rather than inventing deltas.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import librosa
import numpy as np

from app.services.audio_config import AudioConfig, load_audio_config
from app.services.score_schema import (
    DURATION_BEATS,
    Measure,
    ScoreJson,
    measures_under_tempo_change,
    read_ties,
)

# Note duration → length in quarter-note beats. `target_bpm` is always
# quarter-notes-per-minute, so a quarter note is 1.0 beats regardless of
# the notated time signature's lower number (a pragmatic MVP choice; the
# common exceptions like 6/8 are a documented V2 gap).
#: Imported, not copied — see `score_schema.DURATION_BEATS` for why.
_DURATION_BEATS = DURATION_BEATS


@dataclass(frozen=True)
class ExpectedNote:
    """One sounded onset we expect, with the metadata deltas need later."""

    onset_s: float
    measure_number: int
    note_index_in_measure: int
    global_index: int
    is_slur_interior: bool
    #: First note of a slur, or the first note after one ends — the notes that
    #: carry a real bow attack and so are held to the tolerance bands.
    #:
    #: Nothing reads this yet; `is_slur_interior` is what the verdict filters
    #: on, and its complement is the same set. Kept because it is the spec's
    #: vocabulary and it is what a slur-total check (spec: "we measure the
    #: *total* duration of the slur") would need. One honest limitation: a slur
    #: ending on a measure's last note puts "the first note after" in the next
    #: measure, and this is computed per measure, so that one goes unmarked.
    is_slur_boundary: bool
    #: The note's own written length in beats — a quarter is 1.0 at any tempo.
    #:
    #: Carried so `insights.timing_by_note_value` can group the take by what
    #: was written rather than by what was played: "you rush your sixteenths
    #: and your quarters are fine" is a thing to practise, and "you rushed"
    #: is not. `_beats` already computes it while building the timeline, so
    #: this costs nothing to keep and cannot drift from the onsets it produced.
    #:
    #: 1.0 rather than 0.0 as the default, because every caller that does not
    #: set it is constructing a grace note or a test fixture, and a *zero*
    #: would silently create a note value nothing can be grouped under.
    beats: float = 1.0
    #: A written tempo change — rit., accel. — covers this note's measure.
    #:
    #: The tolerance bands do not apply here, and cannot: they measure distance
    #: from a steady grid, and the page has said the grid stops being steady.
    #: A musician who slowed exactly as marked was being told they dragged by
    #: 24 BPM. What replaces the bands is how *evenly* the change was made,
    #: which is a different measurement against a different reference.
    under_tempo_change: bool = False
    #: The note **before** this one carried a fermata.
    #:
    #: So the interval this note arrives after is not the written one — the
    #: page said the length was the player's, and this is where the holding
    #: shows up. `pulse_anchors` re-anchors after the run, so the damage stops
    #: at this note; it cannot tell a hold from a hesitation, and keeps the
    #: drift, which for a hesitation is right and here is a musician being
    #: told off for reading the page.
    #:
    #: Marked on the note **after** rather than on the fermata itself because
    #: the fermata's own attack is on time. It is the arrival of the next note
    #: that the hold moves, and that is what gets judged.
    after_fermata: bool = False
    #: This onset is a grace note.
    #:
    #: **The page prints the ornament and does not say when it sounds.** An
    #: acciaccatura is squeezed in before the beat and takes its time from the
    #: note before; an appoggiatura lands *on* the beat and takes half the value
    #: of the note after. The two readings put the same two attacks the better
    #: part of a beat apart, and nothing on the page chooses between them —
    #: which is why both the ornament and the note it decorates carry this.
    #:
    #: The same refusal as `under_tempo_change` and `after_fermata`, and the
    #: same shape as `is_slur_interior`: the onset is kept, because keeping it
    #: is what stops the timeline losing an attack the musician makes, and it
    #: is excluded from the verdict, because its written time is an assumption
    #: this file made rather than something the page states.
    #:
    #: It is also the **only** thing here that may go unheard without being a
    #: mistake — see `align_dtw`'s `optional`. Sixty milliseconds from the note
    #: it decorates is inside the onset detector's resolution.
    is_grace_note: bool = False
    #: A grace note is printed in front of this one.
    #:
    #: Separate from `is_grace_note` because the two need opposite treatment
    #: where it counts: this note is **certainly** played, so failing to hear
    #: it is a skipped note and must stay one. Only its *time* is in doubt, and
    #: badly — an acciaccatura leaves it on the beat, an appoggiatura pushes it
    #: half the written value late, and the page does not choose. So it is not
    #: banded, exactly as `after_fermata` is not.
    after_grace_note: bool = False


@dataclass(frozen=True)
class ExpectedTimeline:
    onsets: np.ndarray  # shape (N,), seconds since start of the first note
    notes: list[ExpectedNote]


def _beats(duration: str) -> float:
    """Beats for a duration, or a loud failure.

    This indexed with a `.get(duration, 1.0)` default. `Duration` is a closed
    Literal that Pydantic validates, so nothing unknown reaches here from a
    stored score — but a duration added to the Literal and forgotten in the
    table would have been silently counted as a quarter note, which does not
    produce a wrong beat, it produces a wrong *timeline*: every onset after it
    shifts, and the analysis reports the player rushing or dragging from that
    bar to the end of the piece.

    The identical default in `validate.py` — `.get(duration, 0.0)` — did
    exactly that when the triplets landed. Raise instead.
    """
    try:
        return _DURATION_BEATS[duration]
    except KeyError:  # pragma: no cover - unreachable via a validated score
        raise KeyError(
            f"no beat value for duration {duration!r}; add it to "
            "score_schema.DURATION_BEATS"
        ) from None


def expand_repeats(score: ScoreJson) -> list[Measure]:
    """The measures in playing order, with repeated sections written out twice.

    **`build_timeline` walked `score.measures` once and ignored
    `score.repeats` entirely.** A musician who takes an eight-bar repeat plays
    sixteen bars and produces roughly twice the onsets, against a timeline that
    held eight — so DTW was matching a doubled performance to a single pass and
    every delta after the repeat sign was meaningless. Silent, because the
    alignment still produced *a* number.

    Endings are handled the way a player reads them: the first time through,
    play the first ending and go back; the second time, skip it and take the
    second. A `repeat` with no endings is simply the span played twice.

    **Measure numbers are not renumbered.** The musician's part says bar 5 once
    and they play it twice, so both passes stay bar 5 — the verdict then names
    the bar they can find on the page. The consequence, which is the honest
    one, is that `PerMeasure` averages both passes of a repeated bar: it cannot
    say "you rushed the second time through" because nothing downstream
    distinguishes the passes, and inventing bar numbers that are not printed
    anywhere would be worse than averaging.

    A repeat naming measures that do not exist is ignored rather than fatal —
    OCR produces those, and losing the whole take to a mis-read repeat sign
    would be the wrong trade.

    **Sections nest, and the inner one is expanded first.** A minuet is
    `|: A :| |: B :|` and then *D.C. al Fine*, which is two spans inside a
    third — ordinary form, not an edge case. Measured on exactly that, before
    this was recursive: a player performs **twelve** bars and the timeline held
    **six**. Two separate faults produced that one number, and both are the
    same shape:

    - the outer span never fired at all, because the first span *starting* at
      bar 1 consumed bars 1–2 and marked them done; and
    - the D.C.'s "first ending" — bars 3–4, played once — was applied to the
      **inner** B repeat as well, deleting its second pass. A rule right about
      its own span and wrong beside its neighbour.

    Both are fixed by the same shape: at each position take the **widest** span
    that starts there, expand its body by recursing on the spans inside it, and
    only then filter that expanded run by ending. Filtering after expansion is
    what makes a first ending that contains a repeat skip the repeat with it,
    which is what a player does.
    """
    if not score.repeats:
        return list(score.measures)

    by_number = {m.measure_number: m for m in score.measures}
    order = [m.measure_number for m in score.measures]

    # Only plain repeats define a span to play twice; endings modify one.
    #
    # **Nothing is filtered here beyond the type, and that is a change.** Four
    # conditions stood in this list — the start and the end must be real bars,
    # the span must not run backwards, and an empty list returned early — all
    # written for the iterative version this replaced, and all dead since.
    # `play` selects a span only when its end appears in the bars *after* its
    # start, so a span naming a bar that does not exist, or running backwards,
    # is never chosen; and with no spans at all `play` walks the numbers and
    # returns every one. Mutations removing each of the four changed nothing,
    # which is what dead means.
    #
    # The promise they were there to keep is unchanged and now tested rather
    # than guarded: a repeat naming measures that do not exist is ignored, not
    # fatal.
    spans = [r for r in score.repeats if r.type == "repeat"]

    first_brackets = [
        (r.start_measure, r.end_measure)
        for r in score.repeats
        if r.type == "first_ending"
    ]
    second_brackets = [
        (r.start_measure, r.end_measure)
        for r in score.repeats
        if r.type == "second_ending"
    ]

    def bracketed(brackets: list[tuple[int, int]], span, body: list[int]) -> set[int]:
        """The bars an ending removes from one pass **of this span**.

        **An ending belongs to the span it closes, and a global set of bar
        numbers cannot say which that is.** Measured on a minuet — `|: A :|
        `|: B :|` then *D.C. al Fine* — where the da capo's synthetic first
        ending, bars 3–4, was also applied to the inner B repeat and deleted
        its second pass: ten bars where a player performs twelve.

        The rule is that a first ending cannot begin where its section begins,
        because there would be nothing before it to repeat. So an ending
        applies to a span only when the span starts **strictly before** it.
        For the inner B repeat that range *is* the whole span, so it does not
        apply; for the da capo it is the tail, so it does.
        """
        return {
            n
            for start, end in brackets
            if start > span.start_measure and start in body and end in body
            for n in range(start, end + 1)
        }

    def play(numbers: list[int], available: list) -> list[int]:
        out: list[int] = []
        position = 0
        while position < len(numbers):
            number = numbers[position]
            here = [
                span
                for span in available
                if span.start_measure == number
                and span.end_measure in numbers[position:]
            ]
            if not here:
                out.append(number)
                position += 1
                continue

            # The widest, so an outer span wraps the inner ones rather than
            # being shadowed by whichever happened to be listed first.
            span = max(here, key=lambda s: numbers.index(s.end_measure, position))
            stop = numbers.index(span.end_measure, position)
            body = numbers[position : stop + 1]
            # `inside` never contains `span`, by identity *or* by naming the
            # same bars — so every level has strictly fewer spans available
            # than the one above it and the depth is bounded by `len(spans)`.
            # A cap stood here; a mutation removing it changed nothing, and it
            # could only ever have truncated a deeply nested reading into a
            # quietly wrong one. Termination is structural, so the cap was a
            # failure mode with no benefit.
            inside = [
                other
                for other in available
                if other is not span
                and (other.start_measure, other.end_measure)
                != (span.start_measure, span.end_measure)
                and other.start_measure in body
                and other.end_measure in body
            ]
            written = play(body, inside)
            firsts = bracketed(first_brackets, span, body)
            seconds = bracketed(second_brackets, span, body)
            out.extend(n for n in written if n not in seconds)
            out.extend(n for n in written if n not in firsts)
            position = stop + 1
        return out

    # No `or list(score.measures)` fallback: `play` cannot come back empty.
    # Every span's **first** bar survives both passes, because an ending is
    # only applied to a span that starts strictly before it — so a bracket
    # sitting on the span's opening bar is not that span's ending and filters
    # nothing. A fifth dead condition, from the same rewrite.
    return [by_number[n] for n in play(order, spans)]


#: How much of the run-up to a note its grace notes are assumed to occupy.
#:
#: **A named assumption, in the sense `UNREAD_CLEF_PLACEMENT` is one.** The
#: page states that an ornament is played and not when; a timeline is a list of
#: instants, so something has to be written down. A quarter of the interval
#: leading into the note sits between the two readings an engraver may have
#: meant — an acciaccatura is nearer a tenth of it, an appoggiatura a half —
#: and no reading is preferred, because the ornament and the note it decorates
#: are both excluded from the verdict for exactly this reason.
#:
#: What the number has to be good enough for is the matching, and there the
#: cost is intervals with position saturated past a sixth of a gap, so being a
#: tenth of a beat out of place is far cheaper than not being there at all.
#: The span is also capped by the decorated note's own value, so an ornament
#: after eight bars' rest is not placed two seconds early.
#:
#: **Chosen against two synthetic takes and no real recording**, which is the
#: honest limit on it. Both series are in `EDIT_LOG.md`, 2026-08-27. What they
#: agree on is the shape rather than the value: an acciaccatura take scores
#: 1.000 anywhere from 0.05 to 0.5, and a take of a page whose ornaments were
#: *not* played needs at least 0.15 — below that the grace sits so close to the
#: note it decorates that the matcher takes the wrong one and reports skipped
#: notes. The appoggiatura take is the only one that discriminates inside the
#: safe range, and it is also the one that most depends on the fixture, so the
#: bottom of that range is taken rather than its best score.
ORNAMENT_SHARE = 0.15


def build_timeline(score: ScoreJson, target_bpm: float) -> ExpectedTimeline:
    """Walk the score, accumulating time, emitting one entry per *sounded* onset.

    - Rests advance the clock but produce no onset.
    - A note tied FROM the previous note is not re-attacked: it advances
      the clock but produces no onset of its own.
    - Slur interiors are marked so classification can suppress per-note
      timing there (musical license within one bow; §4 layer 2).
    - **Repeated sections are written out twice**, because the musician plays
      them twice. See `expand_repeats`.
    """
    under_tempo_change = measures_under_tempo_change(score)
    if target_bpm <= 0:
        raise ValueError(f"target_bpm must be positive, got {target_bpm}")
    sec_per_beat = 60.0 / target_bpm

    onsets: list[float] = []
    notes: list[ExpectedNote] = []
    elapsed_beats = 0.0
    global_index = 0
    #: Whether the previous sounded note carried a fermata. Kept across the
    #: measure loop on purpose: a fermata at a barline is the commonest place
    #: for one, and the note it moves is the first of the next bar.
    fermata_pending = False
    #: Beat position of the last onset emitted, so a grace note can be placed
    #: inside the run-up the ear actually hears. Not `elapsed_beats` at the
    #: previous note: rests, slur interiors and tied-over notes advance the
    #: clock without being attacked, and the interval an ornament is squeezed
    #: into is the one between *sounds*.
    last_onset_beats: float | None = None

    played = expand_repeats(score)
    # Read over the *played* order, not the written one: a repeat plays the
    # measures again, and a tie across the repeat's seam is a tie in that pass.
    ties = read_ties(played)
    position = 0  # index into the flattened note sequence `ties` is keyed by

    for measure in played:
        # Slur interiors/boundaries are per-measure (slur indices are
        # note offsets within the measure).
        interior: set[int] = set()
        boundary: set[int] = set()
        for slur in measure.slurs:
            # Spec §"Slurred passages": the boundary notes are "first note of
            # the slur, first note after the slur ends" — so the slur's *own*
            # last note is interior, not a boundary.
            #
            # This read `range(start + 1, end)` and marked `end` a boundary,
            # which timed the last note under the bow. That note has no bow
            # attack; it is a left-hand change inside one stroke. The onset
            # detector either misses it or fires late, which is precisely the
            # phantom-"dragging" report the spec warns about — a player using
            # ordinary legato was being told they dragged on the last note of
            # every slur.
            boundary.add(slur.start_note_index)
            boundary.add(slur.end_note_index + 1)
            for i in range(slur.start_note_index + 1, slur.end_note_index + 1):
                interior.add(i)

        for i, note in enumerate(measure.notes):
            is_rest = note.pitch == "rest"
            # A note under a bow stroke is not attacked, so there is no onset to
            # expect and none will be detected. Emitting one anyway was not a
            # cosmetic error: `04_slurred` writes 32 notes of which 8 are bow
            # changes, the detector found all 8 — a **perfect** reading — and
            # the pipeline scored it 0.196 and reported `alignment_failed`,
            # because quality is weighted by coverage and coverage could not
            # exceed 8/32. Slurred playing could never be analysed at all.
            #
            # The clock still advances for these notes; only the expectation of
            # hearing them is dropped.
            under_the_bow = i in interior
            held = fermata_pending
            # **A rest counts.** A fermata over a rest is a held silence — it
            # is how a page writes a pause before an entry — and the note after
            # it arrives just as late as one after a held note. This read
            # `note.fermata and not is_rest`, which was reflex rather than
            # reasoning; a mutation removing the guard survived, and looking at
            # why showed the mutation was the correct version.
            fermata_pending = note.fermata
            # Absorbed only when the tie is real — same pitch on both sides.
            # This read `tied_to_next` alone, so a tie the model invented across
            # two different pitches deleted an onset the musician had actually
            # attacked, and every note after it aligned against the wrong one.
            sounded = not is_rest and not ties.absorbed[position] and not under_the_bow
            if sounded:
                # **The ornament first, because it is played first.**
                #
                # Discarding these is what made a perfectly played take of
                # sixteen quarters with six appoggiaturas score 0.000 and call
                # fifteen of its notes `severe`: the attacks were real, the
                # page printed them, and only the timeline had never heard of
                # them. See `Note.grace_notes` for the measurements.
                #
                # Placed only when the note they decorate is itself attacked.
                # A note under a bow or absorbed by a tie has no onset here at
                # all, and claiming an ornament was struck in front of one
                # would be inventing an attack rather than restoring one.
                if note.grace_notes:
                    own = _beats(note.duration)
                    run_up = (
                        elapsed_beats - last_onset_beats
                        if last_onset_beats is not None
                        else own
                    )
                    span = max(0.0, min(run_up, own)) * ORNAMENT_SHARE
                    for g in range(note.grace_notes, 0, -1):
                        at = elapsed_beats - span * g / note.grace_notes
                        onsets.append(at * sec_per_beat)
                        notes.append(
                            ExpectedNote(
                                onset_s=at * sec_per_beat,
                                measure_number=measure.measure_number,
                                note_index_in_measure=i,
                                global_index=global_index,
                                under_tempo_change=(
                                    measure.measure_number in under_tempo_change
                                ),
                                is_slur_interior=False,
                                is_slur_boundary=False,
                                is_grace_note=True,
                            )
                        )
                        global_index += 1
                onsets.append(elapsed_beats * sec_per_beat)
                last_onset_beats = elapsed_beats
                notes.append(
                    ExpectedNote(
                        onset_s=elapsed_beats * sec_per_beat,
                        measure_number=measure.measure_number,
                        note_index_in_measure=i,
                        global_index=global_index,
                        under_tempo_change=(
                            measure.measure_number in under_tempo_change
                        ),
                        after_fermata=held,
                        # A tie written between two pitches is a slur — the same
                        # curve on the page, and the mark a vision model most
                        # often confuses. So it is read as one: the note keeps
                        # its onset, which is what makes the timeline right, but
                        # it is not *timed*, because whether the bow was
                        # re-attacked there is exactly what is now in doubt.
                        # Timing a note that may have no attack is how phantom
                        # "dragging" gets reported. The measure is flagged for
                        # review either way — see `validate.broken_ties`.
                        # Reaching here means the note *is* expected to sound.
                        # The flag now carries the narrower claim its name has
                        # always implied downstream: sounded, but we cannot
                        # vouch for the attack, so do not time it.
                        #
                        # Only a broken tie is in that position — a slur mark
                        # misread as a tie, where whether the bow was
                        # re-attacked is exactly what is in doubt. It keeps its
                        # onset, which is what stops the timeline losing a note,
                        # and is excluded from the verdict. A *genuine* slur
                        # interior never reaches here; it has no onset to keep.
                        is_slur_interior=ties.broken[position],
                        is_slur_boundary=i in boundary and not ties.broken[position],
                        # Its own attack is the one the ornament moves, and
                        # which way depends on a reading the page does not
                        # state. See `ExpectedNote.after_grace_note`.
                        after_grace_note=bool(note.grace_notes),
                        beats=_beats(note.duration),
                    )
                )
                global_index += 1
            elapsed_beats += _beats(note.duration)
            position += 1

    return ExpectedTimeline(onsets=np.asarray(onsets, dtype=float), notes=notes)


def compute_expected_onsets(score: ScoreJson, target_bpm: float) -> np.ndarray:
    """Seconds-since-start of every expected onset (spec signature)."""
    return build_timeline(score, target_bpm).onsets


@dataclass
class AlignmentResult:
    """Raw DTW output: monotonic detected→expected index mapping + quality."""

    mapping: list[tuple[int, int]]  # (detected_idx, expected_idx), ascending
    cost: float  # total DTW path cost (seconds)
    quality: float  # 0..1; higher = better fit
    n_detected: int
    n_expected: int
    #: `quality` is `timing_quality * coverage`, and the product cannot say
    #: which half refused a take. Both were computed and discarded, so the only
    #: way to tell "the shape disagrees" from "we heard a third of the notes"
    #: was to re-run the pipeline by hand against a copy of the row. Carried so
    #: one log line can answer it.
    timing_quality: float = 0.0
    coverage: float = 0.0
    #: Whether the match was allowed to start and end mid-page.
    subsequence: bool = False


@dataclass
class CleanedAlignment:
    """Fuzzy-matched result: clean note pairs plus the count-mismatch fallout."""

    matched: list[tuple[int, int]] = field(default_factory=list)  # (detected, expected)
    missed_expected: list[int] = field(default_factory=list)  # skipped notes
    extra_detected: list[int] = field(default_factory=list)  # re-attacks / added notes
    quality: float = 1.0


#: How far from the typical gap a gap may sit and still count toward the pace.
#:
#: Wide, because it is only excluding things that are not one note after
#: another: a pause where the musician stopped, or a doubled detection on one
#: attack. Everything a player does *within* a passage sits well inside.
_GAP_CORE_LOW = 0.6
_GAP_CORE_HIGH = 1.6


def typical_gap(gaps: np.ndarray) -> float:
    """The interval between one note and the next, as this take actually plays it.

    A median, which is what this used to be, is snapped to whatever grid its
    inputs live on — and onset times are quantised to the hop, 23.2 ms at the
    configured rate. Eighth notes at 72 BPM are written 416.67 ms apart and
    detected a uniform **418.0 ms** apart, which is 18 frames exactly. The
    0.3% that rounding invents does not sound like anything and cannot be
    played away, but it accumulates: past half a note gap the alignment has to
    give back a whole note at once, and what is left is two parallel ramps with
    a step between them, which no straight line can remove.

        128 notes   drift 162 ms   quality 0.986
        256 notes   drift 324 ms   quality 0.761   ← half a gap is 208 ms
        768 notes   drift 995 ms   quality 0.759

    `warn_quality` is 0.7, so any practice session past about 150 notes was
    heading for "results may be inaccurate" on account of arithmetic.

    A **mean** has no such bias — the frames above and below the true interval
    average out — but one long pause moves it, and a musician who stops to turn
    a page has not changed tempo. So the median picks the centre and the mean
    of everything near it supplies the precision. Measured across eighths at
    72 BPM, quarters at 60, and sixteenths at 100 — where the median is off by
    7% because doubled detections drag it down — this leaves **no residual
    drift at any length**.

    A trimmed mean was tried and is wrong here: trimming by rank throws away
    the minority of gaps that are one frame short, and those are exactly the
    ones carrying the correction.
    """
    gaps = np.asarray(gaps, dtype=float)
    if gaps.size == 0:
        return 0.0
    centre = float(np.median(gaps))
    if centre <= 0:
        return centre
    core = gaps[(gaps > _GAP_CORE_LOW * centre) & (gaps < _GAP_CORE_HIGH * centre)]
    return float(core.mean()) if core.size else centre


#: How much a detection's distance from where the score expects it counts,
#: relative to how well its interval matches.
#:
#: Position is the tie-breaker, not the decision. Its job is to order a plateau
#: of equal intervals so the path through a uniform passage is the right one;
#: anything from 0.25 to 2.0 does that equally well in measurement, so this
#: sits in the middle of a flat region rather than on a tuned point.
POSITION_WEIGHT = 0.5

#: How far from its written place a detection may be before distance stops
#: counting against it, in written note gaps.
#:
#: The whole point of the cap. Past it, a musician who hesitated is not made to
#: look more and more like a musician who skipped ahead. Measured on twenty
#: bars with one bar held a beat too long, as sounds attributed to the wrong
#: written note out of 96:
#:
#:     cap  0.12 gaps   0 wrong, but a genuinely dropped note costs one
#:     cap  0.15 gaps   0 wrong, every case, at 0.7x and 1.4x the tempo
#:     cap  0.25 gaps   7 wrong
#:     cap  1.00 gaps  27 wrong
#:     no cap          48 wrong
POSITION_CAP_GAPS = 0.15


def _clamp_ratio(ratio: float) -> float:
    """Hold a tempo rescale inside what a musician plausibly did."""
    return min(max(ratio, MIN_TEMPO_RATIO), MAX_TEMPO_RATIO)


def pulse_anchors(
    offsets: np.ndarray, beat_s: float, *, config: AudioConfig | None = None
) -> np.ndarray:
    """The reference each note's drift is measured from, note by note.

    **Two things look identical to a clock and are opposite to a musician.**
    Playing steadily a little fast is a *ramp*: every interval is slightly
    short, the offset grows note after note, and it must be reported — that is
    the entire product. Hesitating is a *step*: one or two intervals are much
    too long and then the pulse resumes, and reporting it as "every bar after
    this one dragged" is false. It was false, and it named eight bars in a take
    where one bar was long.

    Measured on twenty bars with bar 8 held a beat too long, the app said:

        m8 +29%  m9 +99%  m10 +100%  m11 +99%  m12 +100%  …  m15 +99%

    So the reference re-anchors after a *run* of intervals that departs from
    what this take otherwise does. The notes inside the run keep the drift —
    a bar genuinely played slow is dragging and has to say so — and the notes
    after it start again from where the musician actually is.

    A run, not a single interval, because a bar played 25% slow is four
    stretched intervals in a row, not one. Absorbing them individually would
    report the bar as clean, which is the opposite mistake.

    The two thresholds live in `[tolerance.pulse]`. They are far apart from
    what they have to separate — the rushing fixture drifts 8 ms a beat, note
    after note, while a bar held a quarter longer moves an interval by 208 ms —
    so neither sits near a decision, and both are starting values that want a
    real recording and an ear.
    """
    cfg = config or load_audio_config()
    anchors = np.empty(offsets.size, dtype=float)
    if offsets.size == 0:
        return anchors
    steps = np.diff(offsets, prepend=offsets[0])
    # The take's own habit, robustly: what a typical interval error looks like
    # here, immune to the handful that are the disturbance.
    centre = float(np.median(steps))
    spread = float(np.median(np.abs(steps - centre)))
    limit = max(
        cfg.tolerance.disturbance_deviations * spread,
        cfg.tolerance.disturbance_floor_beats * beat_s,
    )
    disturbed = np.abs(steps - centre) > limit

    anchor = offsets[0]
    for i in range(offsets.size):
        anchors[i] = anchor
        # Re-anchor once the run ends, so the last note of the disturbance
        # still carries it and the next note starts from where the player is.
        if disturbed[i] and (i + 1 >= offsets.size or not disturbed[i + 1]):
            anchor = offsets[i]
    return anchors


def _residuals(
    mapping: list[tuple[int, int]],
    detected: np.ndarray,
    expected: np.ndarray,
    *,
    sec_per_beat: float = 0.5,
    config: AudioConfig | None = None,
    steady: np.ndarray | None = None,
) -> np.ndarray:
    """What a steady tempo, plus the musician's own pulse, cannot explain.

    Quality asks whether an alignment can be trusted, and it has to ask that
    the same way the verdict reads the take — otherwise a take is analysed
    correctly and then labelled inaccurate for the reason it was correct.

    A hesitation is a step in the offset series. Fitting one straight line
    across it leaves large residuals everywhere, so a take whose every note
    matched and whose two disturbed bars were named exactly scored **0.592**,
    under `warn_quality`. The same take reads 0.954 once the step is taken out
    first, and everything that must be refused still is: half a take, every
    other note, the last third, a swung rhythm, note values drawn at random,
    and sixty seeds of uniform noise all stay at 0.000.

    **The order matters, and it was wrong.** The step has to be taken out of a
    series the steady tempo has already left, or the tempo difference is itself
    read as a run of disturbances — see the measurements on the pace estimate
    below. A steady 1.08x is now 1.000 where it was 0.000; the hesitation above
    is unchanged; every refusal in the list above is unchanged.

    That is not luck — it is the same robustness that makes `pulse_anchors`
    safe. A wrong piece has a huge spread of interval errors, so its
    disturbance threshold is huge, so nothing is absorbed.

    `steady` marks the expected onsets that a steady tempo is *supposed* to
    explain. Notes under a written `rit.` are not among them, and including
    them made a take played exactly as marked score 0.560 — under
    `warn_quality`, on a reading that had named the marked bars correctly and
    called nothing else wrong. They are dropped rather than modelled: a
    ritardando carries no amount, so there is no curve to fit that the page
    actually specifies, and a note the page says will not be steady can say
    nothing about whether a steady-tempo alignment is trustworthy. They still
    count toward coverage, because they were matched.
    """
    det = np.array([detected[d] for d, _ in mapping], dtype=float)
    exp = np.array([expected[e] for _, e in mapping], dtype=float)
    if det.size == 0:
        return np.array([], dtype=float)
    if steady is not None:
        keep = np.array([bool(steady[e]) for _, e in mapping], dtype=bool)
        # Unless there is nothing left. A page that is *entirely* a rit. still
        # has to be judged on something, and a straight line is a poor model of
        # it rather than no model at all.
        if keep.sum() >= 3:
            det, exp = det[keep], exp[keep]
    # **The steady tempo comes out before the hesitation detector, not after.**
    # `pulse_anchors` judges a step against the spread of the take's other
    # steps, and a tempo difference makes every step proportional to its own
    # note: at 1.3x, an eighth drifts 68 ms and a half drifts 271 ms, from one
    # cause. The long notes then read as disturbances, the anchor resets part
    # way down the ramp, and what reaches `polyfit` is a sawtooth rather than a
    # line. Measured on the 25-bar corpus page at 102 BPM, a take of the same
    # notes played steadily faster:
    #
    #     1.05x   fitted rate 0.9524 (exact)   residual   0 ms   quality 1.000
    #     1.08x   fitted rate 0.9909 (0.9259)  residual 357 ms   quality 0.000
    #     1.30x   fitted rate 0.9560 (0.7692)  residual 955 ms   quality 0.000
    #
    # So every take more than about 6% off the tempo its player set was refused
    # with "check you're on the right piece", on an alignment that had matched
    # all 75 notes at coverage 1.000. Eleven consecutive takes in production
    # failed this way and none ever produced a verdict.
    #
    # The pace is a **median of per-interval rates** rather than a least-squares
    # slope, because the series this has to survive is the one `pulse_anchors`
    # exists for: a single held bar moves one interval enormously and a median
    # ignores it, where a fitted line is dragged by it and the hesitation case
    # falls from 0.640 to 0.569. `typical_gap` is the wrong instrument here —
    # its core filter drops the long gaps, so the ratio of two filtered means is
    # not a rate when the two gap distributions differ, and it scores 0.220.
    if det.size >= 2 and float(np.ptp(exp)) > 0:
        played_steps, written_steps = np.diff(det), np.diff(exp)
        usable = written_steps > 0
        pace = (
            float(np.median(played_steps[usable] / written_steps[usable]))
            if usable.any()
            else 1.0
        )
        if not np.isfinite(pace) or pace <= 0:
            pace = 1.0
    else:
        pace = 1.0
    # What a steady pace cannot explain. This is what a hesitation looks like
    # on its own, which is what `pulse_anchors` was written to read.
    flat = det - (pace * exp + float(np.median(det - pace * exp)))
    settled = det - pulse_anchors(flat, sec_per_beat, config=config)
    if settled.size >= 2 and float(np.ptp(exp)) > 0:
        rate, offset = np.polyfit(exp, settled, 1)
    else:
        rate, offset = 1.0, float(np.median(settled - exp))
    return np.abs(settled - (rate * exp + offset))


def _quality_from_cost(total_cost: float, path_len: int, sec_per_beat: float) -> float:
    """Map average per-step timing error to a 0..1 quality score.

    Average error is expressed as a fraction of a beat; half a beat of
    average error is treated as fully broken (quality 0). This is a
    starting curve — it is meant to be re-shaped during tuning, which is
    why the 0.5-beat anchor is the only magic number and it lives here,
    documented, rather than scattered through the pipeline.
    """
    if path_len == 0 or sec_per_beat <= 0:
        return 0.0
    avg_error_beats = (total_cost / path_len) / sec_per_beat
    return float(np.clip(1.0 - avg_error_beats / 0.5, 0.0, 1.0))


#: How far the matching step may rescale a recording toward the written pace.
#:
#: Not a tolerance on playing — the verdict's bands do that, and they call ±20%
#: severe. This is a bound on what the *matcher* is allowed to believe, and the
#: two numbers it has to exclude are exact: **2.0**, which is a take of half the
#: piece read as the whole of it, and **0.5**, which is every-other-note read as
#: a complete slow performance. Both produce a confident analysis of bars nobody
#: played. Everything a musician plausibly does against a tempo they set
#: themselves sits well inside.
MIN_TEMPO_RATIO = 0.6
MAX_TEMPO_RATIO = 1.7

#: How many onsets a take needs before its pace is estimated from it at all.
#:
#: Below this the estimate is both unnecessary and unreliable, and the two facts
#: have the same cause. Unnecessary: the sliding error that scaling exists to
#: prevent grows with the length of the take, and measured at 20% fast a take of
#: six notes or fewer matches **perfectly** with no scaling, while eight notes
#: collapses to 38% and thirty-two to 9%. Unreliable: a median over two or three
#: intervals is not a median, and a single *missed* note inflates an interval —
#: [0.5, 1.0] medians to 0.75 and compresses a take that was played evenly.
#:
#: So below the crossover the score's own units are used unchanged, which is
#: exactly right: `expected` is built at `target_bpm`, the tempo the musician
#: set.
MIN_ONSETS_TO_ESTIMATE_TEMPO = 7


def closest_expected_gap(
    expected: np.ndarray, *, optional: np.ndarray | None = None
) -> float | None:
    """The smallest interval between notes the score expects, in seconds.

    What the onset detector needs in order to size its local-max window: it
    must not be wider than the closest pair of notes, or the quieter of them is
    never reported. See `audio.peak_window_frames`.

    **Grace notes are left out, and this is the one place their `optional`
    flag has to buy something instead of costing it.** An acciaccatura is
    placed a fraction of a beat before the note it decorates — 75 ms at 120
    BPM — and that becomes the closest pair on the whole page, so the window
    shrinks everywhere to chase an attack that may not be there. Measured on a
    click track of eight quarters played exactly on the grid, ornaments printed
    and played straight: **14 onsets detected for 8 clicks**, three of them
    called extra, quality 0.665 and a low-confidence caveat on a take that was
    perfect.

    The window is sized for what must be heard. An ornament this close is
    already at the edge of what the detector can resolve, which is why it is
    optional in the first place — paying for it across the whole take is the
    wrong side of that trade.
    """
    if expected.size < 2:
        return None
    if optional is not None:
        keep = ~np.asarray(optional, dtype=bool)
        # Unless there is nothing left to measure between.
        if keep.sum() >= 2:
            expected = expected[keep]
    gaps = np.diff(expected)
    positive = gaps[gaps > 0]
    return float(positive.min()) if positive.size else None


def attacks_outnumber_the_music(
    detected: np.ndarray, expected: np.ndarray
) -> bool:
    """Did more sound arrive than any performance of this page could produce?

    **A count against the page is the wrong question and it was asked for a
    long time.** A take of half a page reporting 77 onsets against a 75-note
    score is 1.03x by count and looks unremarkable, while against the ~43 notes
    its own span writes it is nearly double. The span is not known until the
    match is made, so what can be asked first is how *thickly* attacks arrive.

    **The threshold is `MAX_TEMPO_RATIO` and nothing else is chosen.** That is
    the fastest the matcher will believe a performance of this page, so a take
    whose attacks arrive closer together than the page's own notes at that
    tempo is not a performance of it — some of what was heard is not the music.
    Derived, like the floor in `collapse_double_attacks`, rather than picked.

    Measured against every take this app has received, and against takes
    synthesised from the same page and read through the same detector:

        115 onsets / 34.2s = 3.36/s   vs 2.49/s   over-detected
         88 onsets / 32.6s = 2.70/s   vs 1.72/s   over-detected
         77 onsets / 29.1s = 2.65/s   vs 2.19/s   over-detected
         31 onsets / 10.8s = 2.87/s   vs 2.49/s   over-detected
         25 onsets / 17.6s = 1.42/s   vs 2.49/s   ordinary

    It says nothing about *why* — a bass under a bow re-triggering, a room, a
    microphone too close to the body of the instrument. What it buys is that
    the musician stops being told to check they are on the right piece when
    the page was never the problem.
    """
    if detected.size < 2 or expected.size < 2:
        return False
    page_span = float(expected[-1] - expected[0])
    take_span = float(detected[-1] - detected[0])
    if page_span <= 0 or take_span <= 0:
        return False
    believable = (expected.size / page_span) * MAX_TEMPO_RATIO
    return detected.size / take_span > believable


def collapse_double_attacks(
    detected: np.ndarray,
    expected: np.ndarray,
    *,
    optional: np.ndarray | None = None,
) -> np.ndarray:
    """Drop detections too close together to be two of *this page's* notes.

    **A partial take of an over-detected recording was read as a wrong piece.**
    The owner played the first half of a 25-bar part, starting at bar 1, and
    the run reported `onsets=77/75`: more attacks than the whole page writes,
    from half of it. Two things then went wrong together.

    `subsequence` is the machinery for a take that covers part of a page, and
    it is gated on `detected.size < expected.size` as well as on the span. The
    span test was right — 29.1 s at the fastest believable tempo does not reach
    the end of a 58.2 s page — and the count test vetoed it, because
    over-detection had pushed 43 played notes to 77 reported ones. So the match
    fell back to the corner-anchored path, which stretches a half-take across
    the whole page, and every residual was enormous: **quality 0.000, "check
    you're on the right piece"**, on a take that was the right piece.

    Measured on that page, a take of its first 43 notes:

        doubled attacks   onsets   as shipped   collapsed here
                      0       43        0.974            0.974
                     10       53        0.607            0.974
                     20       63        0.536            0.974
                     34       77        0.000            0.974

    **The floor is derived, not chosen.** `closest_expected_gap` is the nearest
    two notes this page prints; `MAX_TEMPO_RATIO` is the fastest the matcher
    will believe a performance of it. Their quotient is therefore the closest
    two of *this page's* notes can honestly arrive, and anything nearer is one
    attack reported twice — a bass's slow attack under a bow, or string ring
    after a pizzicato. There is no number to tune here and nothing to put in
    `config.toml`: it falls out of two constants that already exist, and it
    moves with the page rather than with a guess about instruments.

    Checked against the takes it must not touch: a whole page played at tempo,
    and one played at 1.6x — just inside the clamp — both lose **zero**
    onsets.

    `wait_ms` in `[onset]` is the detector's own floor and stays at 60 ms: it
    is a fact about how fast a *string* can be re-attacked, and it does not
    know what is on the stand. This is the page's floor, and the two are
    different claims.

    **The earlier attack is the one kept**, which is the same choice
    `librosa`'s `wait` makes and the safe one here: the first is the note, and
    what follows inside the floor is its ring.

    `optional` is passed through to `closest_expected_gap` so an ornament does
    not set the floor for the whole page — the same argument, and the same
    omission, that `prepare_for_alignment` records for the detector's window.
    """
    if detected.size < 2 or expected.size < 2:
        return detected
    # **A page that prints an ornament is left alone**, and the reason is the
    # one thing this cannot get right. An acciaccatura sits a fraction of a
    # beat before the note it decorates — 75 ms at 120 BPM, inside any floor
    # derived from the *required* notes — so the pair would be collapsed, and
    # the attack kept would be the grace's. The main note is the required one,
    # and handing it a timestamp 60 ms early is a timing error invented on a
    # note that was played correctly. Keeping the *later* attack instead is
    # wrong for the case this exists for, where the first is the note and what
    # follows is its ring. The two cannot be told apart from times alone, so
    # an ornamented page keeps the behaviour it has today.
    if optional is not None and bool(np.any(np.asarray(optional, dtype=bool))):
        return detected
    floor = closest_expected_gap(expected, optional=optional)
    if floor is None or floor <= 0:
        return detected
    floor /= MAX_TEMPO_RATIO
    # **The opening pair is left to `align_take`.** A bow settling half a
    # second before the first note is, in times alone, indistinguishable from
    # that note being reported twice — and the two want opposite repairs, since
    # here the *second* sound is the music. `align_take` already decides the
    # origin with a trim search that has to pay for what it discards, and it is
    # better informed than this rule is; collapsing the first pair pre-empts it
    # and hands the take the scrape's timestamp. Measured: at a 0.5 s settle on
    # a page of quarters at 60 BPM the floor is 588 ms, so the scrape swallowed
    # the first note and the take read as half a beat early.
    kept = [float(detected[0])]
    for index, time in enumerate(detected[1:], start=1):
        if index == 1 or float(time) - kept[-1] >= floor:
            kept.append(float(time))
    return np.asarray(kept, dtype=float)


def to_timeline_base(detected: np.ndarray) -> np.ndarray:
    """Detected onsets re-expressed as seconds since the first note.

    `build_timeline` returns "seconds since start of the first note" — its own
    words. `detect_onsets` returns seconds since the *recording* started. Those
    are two different clocks, and every comparison between them was made in
    whichever clock happened to arrive.

    `compute_deltas` already knew this and corrected for it — "the recording's
    lead-in latency (reaction time before the first note) is not a timing
    error" — but it runs at the *end* of the pipeline, and `align_dtw` and
    `apply_fuzzy_match` run before it in the recording's clock. So a musician
    who tapped record, picked up the bow and then played was compared against a
    score that assumed they began instantly.

    The cost is not subtle. A **perfectly played** take, measured against the
    band-constrained DTW:

        lead-in   0.5s → quality 1.000
        lead-in   2.0s → quality 0.762
        lead-in   3.0s → quality 0.566
        lead-in   5.0s → quality 0.053   ← "check you're on the right piece"

    Five seconds is tapping record, putting the phone down and picking up the
    bow. Every one of those is 1.000 once both sequences are on the same clock.

    Shifted by the first *detected* onset, which is the only origin available
    before anything is matched.

    This used to end by claiming that a spurious first onset "does not reach
    the verdict", on the reasoning that `compute_deltas` re-derives its origin
    from the first *matched* pair. That is wrong, and measurably so: the
    spurious onset is what gets matched. On a take of eight quarters played
    exactly on the grid, one bow-settling scrape a second beforehand gave
    quality 0.604 and a steady verdict; at 0.5 s, "You rushed by 28 BPM"; at
    2 s, "check you're on the right piece". See `test_leading_noise.py`.

    So callers analysing a recording want `align_from_first_note`, which picks
    the origin by evidence. This stays as the primitive it builds on, and as
    the right call when the first onset is known to be a note.
    """
    detected = np.asarray(detected, dtype=float)
    if detected.size == 0:
        return detected
    return detected - detected[0]


#: How many detections may be discarded from each end of a take as noise.
#:
#: Three at each end covers the realistic cases — a bow settling, a chair, a
#: page, putting the instrument down — without letting the search eat into a
#: short take. It is a ceiling, not a target: `align_take` prefers discarding
#: nothing and has to be paid to do otherwise.
MAX_EDGE_TRIM = 3

#: How much better a trimmed alignment must score before its trim is accepted.
#:
#: Trimming can only ever make the matching problem smaller, so a threshold of
#: zero would discard a real note for a rounding difference. A tenth of the
#: quality scale is far above the noise and far below the gaps this repairs —
#: the failures measured ran 0.029 → 0.988.
MIN_TRIM_GAIN = 0.1


@dataclass
class AnchoredAlignment:
    """An alignment plus the onset sequence it was actually computed against."""

    onsets: np.ndarray
    #: Leading detections discarded as pre-play noise.
    trimmed_lead: int
    #: Trailing detections discarded as post-play noise.
    trimmed_tail: int
    alignment: "AlignmentResult"


def align_take(
    detected: np.ndarray,
    expected: np.ndarray,
    *,
    target_bpm: float = 120.0,
    config: AudioConfig | None = None,
    steady: np.ndarray | None = None,
    optional: np.ndarray | None = None,
) -> AnchoredAlignment:
    """Align, having first worked out which detections are the *take*.

    A recording is bracketed by sound that is not playing: a bow settling on
    the string, a chair, a page, the instrument going down at the end. Both
    ends did damage, and for different reasons.

    **The front end moved the origin.** `to_timeline_base` has to pick one
    before anything is matched, and the only candidate is the earliest
    detection. On eight quarters played exactly on the grid at 60 BPM, one
    quiet scrape before them:

        0.5 s before   quality 0.486   "You rushed by 28 BPM"
        1.0 s before   quality 0.604   "Steady tempo"
        2.0 s before   quality 0.100   "check you're on the right piece"

    **The back end cost confidence.** A trailing detection maps to the last
    written note, and its residual is the whole distance between them:

        0.6 s after    0.988 → 0.766
        1.2 s after    0.988 → 0.539
        2.5 s after    0.988 → 0.029

    `warn_quality` is 0.7, so a perfect take was one stray sound away from
    "results may be inaccurate", and two from being refused outright.

    So both ends are chosen by evidence instead of by position: align once per
    (lead, tail) candidate and keep the best. What makes that safe rather than
    a licence to discard inconvenient data is that the metric already penalises
    it — `quality` is `timing_quality * coverage`, and coverage counts
    *expected* notes, so discarding a real note costs coverage while discarding
    noise costs nothing. Measured on a clean take, each note trimmed costs
    about 0.12; the same number that rewards trimming correctly punishes
    trimming too much.

    **Searched jointly, not one end and then the other.** Greedy front-first
    was tried and is wrong: with a stray sound only at the *end*, trimming the
    front also raises the score, so the search threw away a real first note to
    compensate for a problem at the other end. The grid is 16 alignments of
    10 ms against onset detection's 1300 ms — the ordering artifact costs more
    than the exhaustive search does.
    """
    detected = np.asarray(detected, dtype=float)
    base = to_timeline_base(detected)
    untrimmed = AnchoredAlignment(
        onsets=base,
        trimmed_lead=0,
        trimmed_tail=0,
        alignment=align_dtw(
            base,
            expected,
            target_bpm=target_bpm,
            config=config,
            steady=steady,
            optional=optional,
        ),
    )
    if detected.size < 3 or expected.size == 0:
        return untrimmed

    # Never search so far that the take itself disappears. Two onsets is the
    # least that can express an interval, which is the least DTW can score.
    room = detected.size - 2
    candidates = [untrimmed]
    for lead in range(min(MAX_EDGE_TRIM, room) + 1):
        for tail in range(min(MAX_EDGE_TRIM, room - lead) + 1):
            if lead == 0 and tail == 0:
                continue
            kept = detected[lead : detected.size - tail]
            onsets = to_timeline_base(kept)
            candidates.append(
                AnchoredAlignment(
                    onsets=onsets,
                    trimmed_lead=lead,
                    trimmed_tail=tail,
                    alignment=align_dtw(
                        onsets,
                        expected,
                        target_bpm=target_bpm,
                        config=config,
                        # Both masks, the same as the untrimmed candidate. This
                        # passed neither, so the trimmed alignments were scored
                        # under different rules from the one they compete with
                        # — and `MIN_TRIM_GAIN` is a comparison between them.
                        steady=steady,
                        optional=optional,
                    ),
                )
            )

    best = max(c.alignment.quality for c in candidates)
    if best <= untrimmed.alignment.quality + MIN_TRIM_GAIN:
        return untrimmed

    # Among the candidates that reach the best score, take the one that throws
    # away least — and break the remaining ties toward the *tail*, because a
    # wrongly discarded first note moves the origin and rewrites every delta,
    # while a wrongly discarded last note only loses a note.
    return min(
        (c for c in candidates if c.alignment.quality >= best - 1e-9),
        key=lambda c: (c.trimmed_lead + c.trimmed_tail, c.trimmed_lead),
    )


def align_dtw(
    detected: np.ndarray,
    expected: np.ndarray,
    *,
    target_bpm: float = 120.0,
    config: AudioConfig | None = None,
    steady: np.ndarray | None = None,
    optional: np.ndarray | None = None,
) -> AlignmentResult:
    """Align detected onsets to expected onsets with a constrained DTW.

    Onsets are 1-D time sequences; we hand librosa `(1, N)` feature rows
    (1 feature = time, N steps). A Sakoe-Chiba band keeps the warp near
    the diagonal so a lost passage can't cause a wild excursion (§7.5a).
    The warping path is walked start→end and collapsed to the best
    expected index per detected onset.
    """
    cfg = config or load_audio_config()
    sec_per_beat = 60.0 / target_bpm if target_bpm > 0 else 0.5

    detected = np.asarray(detected, dtype=float)
    expected = np.asarray(expected, dtype=float)
    if detected.size == 0 or expected.size == 0:
        return AlignmentResult(
            mapping=[],
            cost=float("inf"),
            quality=0.0,
            n_detected=int(detected.size),
            n_expected=int(expected.size),
        )

    # --- matching is tempo-invariant; measurement is not -------------------
    #
    # DTW ran on raw seconds with a euclidean metric, and that quietly broke
    # the thing this product exists to do. A uniform tempo difference makes the
    # absolute time gap grow along the piece, so the cheapest path is not
    # note-to-note but one that *slides* — and the further in, the further it
    # slides. Measured, on takes played at a steady but different tempo:
    #
    #     32 notes,  5% fast → 31% of notes matched to the right written note
    #     64 notes,  2% fast → 39%
    #     64 notes, 10% fast →  8%
    #
    # A musician who rushes is the entire audience for this app, and their
    # notes were being attributed to the wrong bars.
    #
    # So the recording is put into the score's units before matching. Deciding
    # *which* onset is which note cannot depend on how fast it was played;
    # deciding whether it was early or late must. Only the first happens here —
    # `compute_deltas` works in real seconds and is untouched, so the verdict
    # still reports the rushing this ignores.
    #
    # **Bounded, and that is the whole point.** This scaled each sequence onto
    # its own unit span, which is unbounded: it stretches whatever it is given
    # until the two ends line up, and so it *asserts* that the take covers the
    # score. A musician who played the first half of the piece had those notes
    # smeared across all of it — every delta measured against the wrong written
    # note, reported confidently. Measured on a 40-note score, a take of notes
    # 0–19 mapped to written notes 0–39.
    #
    # A ratio of *typical* inter-onset intervals, clamped, cannot do that —
    # see `typical_gap` for what "typical" has to mean here, which is not a
    # median. The clamp is what makes it safe rather than merely different:
    # reading a half
    # take as a whole one needs 2×, and reading every-other-note as a complete
    # slow take needs 0.5×, and neither is reachable. What is reachable covers
    # a musician far outside the ±20% the verdict bands call severe — so the
    # tempo differences this exists to absorb pass through untouched, and the
    # two rescalings that produce confident nonsense do not.
    #
    # The prior underneath it is that `target_bpm` is a number the musician
    # *set* — `expected` is built at it, so a take near that tempo needs a
    # ratio near 1. Practising slowly is not the exception it looks like: the
    # tempo control is what they moved to do it.
    #
    #   case               span (was)   bounded (now)
    #   perfect               1.000        1.000
    #   20% fast              1.000        1.000
    #   gradual rush 13%      0.725        0.725
    #   first half            0.400        0.500   ← and now maps to 0–19
    #   every other note      0.301        0.119
    #   WRONG PIECE           0.248        0.000
    def _initial_ratio(seq: np.ndarray, reference: np.ndarray) -> float:
        """How much to stretch `seq` toward `reference`'s pace, clamped.

        The *written* pace is read from the steady part of the page only. A
        page with a `rit.` in it has no single pace, and averaging across the
        change gives a number that is wrong for both halves: on eight bars
        slowing over the last four, the estimate landed between them and the
        matcher slipped a note at bar 1, attributing every later sound to the
        note before it. Detection was perfect; the pace was not.

        The *played* side is left whole, because which notes were played under
        the change is not known until after the matching this feeds.
        """
        if seq.size < MIN_ONSETS_TO_ESTIMATE_TEMPO or reference.size < 2:
            return 1.0
        written_gaps = np.diff(reference)
        if steady is not None and steady.size == reference.size:
            # Gaps between two steady notes. A gap that straddles the start of
            # a change belongs to neither pace.
            both = np.asarray(steady[:-1], dtype=bool) & np.asarray(
                steady[1:], dtype=bool
            )
            if both.sum() >= 2:
                written_gaps = written_gaps[both]
        played = typical_gap(np.diff(seq))
        written = typical_gap(written_gaps)
        if played <= 0 or written <= 0:
            return 1.0
        return _clamp_ratio(written / played)

    def _cost_matrix(ratio: float) -> np.ndarray:
        """What it costs to call detection *i* the note written at *j*.

        **Two questions, and absolute time can only answer one of them.**

        Comparing instants answers "where in the piece is this" and gets note
        identity wrong the moment a musician hesitates. Holding one bar a beat
        too long leaves the take offset from the written grid for everything
        after it, so explaining the remainder as "they skipped two notes" costs
        two steps while the truth costs 0.83 s on each of 88 pairs — the shift
        is not a failure of the search, it is the cheaper answer. Measured on
        twenty bars with bar 8 held: **48 of 96 sounds attributed to the wrong
        written note**, and eight bars named as off-tempo in a take where one
        bar was long and the rest was perfect.

        Comparing *intervals* answers "which note is this" and is invariant to
        offset by construction — a hesitation is one long interval rather than
        a permanent shift, and a dropped note merges two intervals, which is
        DTW's native many-to-one. On its own it fixes identity completely and
        is unusable: a passage of equal intervals is a plateau of equal cost,
        so the path through it is arbitrary. Quality then wanders — a take at a
        steady 110% of the written pace scored 0.682 where 125% scored 1.000.

        So intervals decide and position breaks ties, with position's
        contribution **saturated**. Past a sixth of a note gap, being further
        from where the score expects you stops costing more — which is enough
        for absolute time to order a plateau and pick the right note, and not
        enough for it to insist a hesitating musician skipped ahead.

            cost                wrong notes (hesitation / hurry)   unsafe takes
            absolute                     48        29              first half 0.50
            intervals only                0         0              all refused
            saturated hybrid              0         0              all refused

        Verified unchanged on the six corpus clips, on takes from 64 to 1536
        notes, and with everything scaled to 0.7× and 1.4× the tempo — the cap
        is in written gaps, so it carries no tempo of its own.
        """
        origin = detected[0] if detected.size else 0.0
        played = (detected - origin) * ratio
        written = expected - (expected[0] if expected.size else 0.0)
        position = np.abs(played[:, None] - written[None, :])
        if played.size < 2 or written.size < 2:
            # Nothing has an interval before it. One sustained note is a real
            # take (`05_open_e_long`), and position is all there is to go on.
            return position
        gap = typical_gap(np.diff(written))
        # The interval leading into each onset. The first borrows the second's,
        # so index 0 is comparable rather than a special case.
        played_gaps = np.diff(played, prepend=played[0] - (played[1] - played[0]))
        written_gaps = np.diff(written, prepend=written[0] - (written[1] - written[0]))
        return np.abs(played_gaps[:, None] - written_gaps[None, :]) + (
            POSITION_WEIGHT * np.minimum(position, POSITION_CAP_GAPS * gap)
        )

    #: Whether the take can only be *part* of the page, so the match must be
    #: allowed to start and end mid-page.
    #:
    #: **The failure this repairs.** `librosa.sequence.dtw` anchors the warping
    #: path corner to corner: detection 0 is forced onto expected 0 and the last
    #: detection onto the *last* written note. A musician who records four bars
    #: of a fifty-seven-bar orchestral part therefore has those four bars
    #: stretched across the whole page, and every residual is enormous. Measured
    #: on a real 25-bar part, a take of the page's first half scored **0.000 —
    #: `alignment_failed`, "check you're on the right piece"** — and 0.487, a
    #: reported verdict, with the anchoring released. Every one of the first
    #: eight takes this app ever analysed failed this way.
    #:
    #: **Only when the take provably cannot be the whole page.** The test is
    #: the one the matcher already believes elsewhere: `MAX_TEMPO_RATIO` bounds
    #: how much faster than the marked pace a performance may be read as, so a
    #: take whose span, played at that fastest believable tempo, still does not
    #: reach the end of the page is not a performance of the page.
    #:
    #: Counting onsets instead is wrong twice over. A page of eight notes with
    #: two printed ornaments expects ten onsets and a musician who plays it
    #: perfectly, straight, produces eight — fewer detections than written
    #: notes, and a complete performance. Released from its anchors that take
    #: drifts and is refused; it is `test_ornaments_the_musician_did_not_play_
    #: are_not_missed_notes`, and it caught this. Spans are also what a missed
    #: attack does not change: losing notes in the middle leaves the first and
    #: last where they were.
    #:
    #: Subsequence matching is strictly more freedom than the banded path, so
    #: it is taken only where the banded path is provably wrong. It also needs
    #: the detections to be the shorter sequence — it asks where a query sits
    #: inside a longer reference, and with more detections than written notes
    #: there is no such question; librosa walks off the end of the cost matrix.
    #: Over-detection is a different fault with a different repair.
    take_span = float(detected[-1] - detected[0]) if detected.size >= 2 else 0.0
    page_span = float(expected[-1] - expected[0]) if expected.size >= 2 else 0.0
    subsequence = (
        detected.size < expected.size
        and take_span > 0.0
        and take_span * MAX_TEMPO_RATIO < page_span
    )

    def _match(ratio: float) -> list[tuple[int, int]]:
        """Run DTW at one scale and return one written note per detection."""
        cost = _cost_matrix(ratio)
        try:
            if subsequence:
                _, wp = librosa.sequence.dtw(C=cost, subseq=True)
            else:
                _, wp = librosa.sequence.dtw(
                    C=cost,
                    global_constraints=True,
                    band_rad=cfg.alignment.sakoe_chiba_band,
                )
        except Exception:  # noqa: BLE001 — band too tight for the size ratio, etc.
            _, wp = librosa.sequence.dtw(C=cost)

        # librosa returns the path from end → start; flip to ascending.
        # Collapse to one expected index per detected index: keep the cheapest
        # (handles the fan-out DTW leaves on the warp path). Tie-broken by the
        # same cost the path was found with — comparing raw seconds here would
        # reintroduce exactly the bias the cost above removes, on the fan-out
        # where it matters most.
        best: dict[int, tuple[int, float]] = {}
        for det_i, exp_i in wp[::-1]:
            det_i, exp_i = int(det_i), int(exp_i)
            # A subsequence path can report the column one past the last, which
            # is the "matched nothing further" sentinel rather than a note.
            if not (0 <= det_i < cost.shape[0] and 0 <= exp_i < cost.shape[1]):
                continue
            err = float(cost[det_i, exp_i])
            prev = best.get(det_i)
            if prev is None or err < prev[1]:
                best[det_i] = (exp_i, err)
        return sorted((d, e) for d, (e, _) in best.items())

    ratio = _initial_ratio(detected, expected)
    mapping = _match(ratio)

    # A page with a written tempo change has no single pace, and the *played*
    # side cannot be masked before matching — which notes were played under the
    # change is exactly what the matching decides. So it is refined once, from
    # the detections that landed on notes the page says are steady.
    #
    # Without it, a take of four steady bars and four slowing ones estimated a
    # pace between the two, slipped a note at bar 1, and reported the opening
    # bar as severely dragging on playing that was exact. Detection was
    # perfect; the pace was not.
    #
    # Bounded by the same clamp as the first pass, and only run when the score
    # actually marks a change — a page without one is untouched, which is why
    # the six corpus clips do not move.
    if steady is not None and not steady.all() and len(mapping) >= 4:
        played_steady = np.array(
            [detected[d] for d, e in mapping if steady[e]], dtype=float
        )
        written_steady = np.array(
            [expected[e] for _, e in mapping if steady[e]], dtype=float
        )
        if played_steady.size >= MIN_ONSETS_TO_ESTIMATE_TEMPO:
            played = typical_gap(np.diff(played_steady))
            written = typical_gap(np.diff(written_steady))
            if played > 0 and written > 0:
                refined = _clamp_ratio(written / played)
                if abs(refined - ratio) > 1e-6:
                    mapping = _match(refined)

    # Quality measures how well the *shape* of the performance matches the
    # score — not the lead-in before the first note, and not the tempo it was
    # played at. A player who starts 200 ms after "record" and then plays
    # perfectly is a 1.0, and so is one who plays the whole thing steadily at
    # 95% of the marked tempo: both are the right piece, played recognisably.
    #
    # This removed a constant offset only. A tempo difference is not a constant
    # offset, it is a ramp, so the residuals it left grew with the *square* of
    # the take's length — 64 notes at 1% drift scored 0.514, and quality became
    # a measure of how long the piece was.
    #
    # A straight line is removed instead: offset *and* rate. What is left is
    # what a steady tempo cannot explain, which is the only thing "can this
    # alignment be trusted" should turn on. The tempo difference itself is not
    # discarded — it is the verdict, and `compute_deltas` computes it from real
    # seconds further down.
    residuals = _residuals(
        mapping,
        detected,
        expected,
        sec_per_beat=sec_per_beat,
        config=cfg,
        steady=steady,
    )
    total_cost = float(residuals.sum())
    timing_quality = _quality_from_cost(total_cost, len(residuals), sec_per_beat)

    # Timing quality alone is blind to *coverage*: one perfectly-placed
    # onset against an 8-note score scores 1.0 on timing while 7 notes
    # went unheard. Weight by the fraction of expected notes actually
    # matched so a "played two bars then stopped / wrong page" take is
    # correctly flagged as broken rather than "steady".
    #
    # `optional` marks expected onsets that may legitimately not be heard, and
    # they are dropped from **both** halves of that fraction. Grace notes are
    # the case: the page prints the ornament, so the onset belongs in the
    # timeline, but whether a separate attack is *reported* is a coin toss —
    # an acciaccatura can sit sixty milliseconds from the note it decorates,
    # inside the onset detector's own resolution, and a musician may simply
    # not play it. Counting those as unheard notes made a **perfectly played**
    # take of four ornamented bars fall from quality 1.000 to 0.350, under the
    # cutoff that tells the musician to record it again. Left in the numerator
    # they would also be free credit for onsets nobody required.
    covered_all = {e for _, e in mapping}
    required = (
        np.ones(expected.size, dtype=bool)
        if optional is None
        else ~np.asarray(optional, dtype=bool)
    )
    # **Over the passage the take covers, not over the page.**
    #
    # Coverage asks "of the notes this take was supposed to contain, how many
    # were heard". With the whole page as the denominator it silently asks
    # something else — "how much of the page did you record" — and answers a
    # musician practising four bars of a long part with 0.07 however well they
    # played them. Every early take of this app was refused that way: the
    # ceiling `n_detected / n_expected` sat under `broken_quality` before a
    # single note was compared, so no performance could have passed.
    #
    # The passage is the written span the match actually lands in, first
    # matched note to last — and **only when the take cannot be the whole
    # page**, which is the same test `subsequence` is taken on. Two reasons,
    # and the second is not obvious:
    #
    #  - Where the take does cover the page, the page *is* the passage, so the
    #    two denominators agree and the narrower one only adds risk.
    #  - `align_take` competes trim candidates on quality. A denominator that
    #    shrinks with the span is one a trim can never lose by: cutting a real
    #    note off either end removes it from the numerator and the denominator
    #    together, so coverage holds while the take gets shorter. Applied
    #    unconditionally this quietly taught the trim search to eat the last
    #    note of every take — `test_ornaments_the_musician_did_not_play_are_not
    #    _missed_notes` reported one missed note against a complete
    #    performance, which is how it was found.
    #
    # And only once there are enough matches to believe the span at all: below
    # `MIN_ONSETS_TO_ESTIMATE_TEMPO` a handful of stray detections could
    # nominate any two notes as the ends and score themselves against those
    # two — the same crossover, and the same reason, as the tempo estimate.
    in_span = required.copy()
    if subsequence and len(covered_all) >= MIN_ONSETS_TO_ESTIMATE_TEMPO:
        first, last = min(covered_all), max(covered_all)
        in_span[:first] = False
        in_span[last + 1 :] = False
    denominator = int(in_span.sum())
    if denominator:
        covered = sum(1 for e in covered_all if in_span[e])
    else:
        # Every expected onset is optional — vanishingly unlikely, and the old
        # fraction is a better answer than dividing by zero.
        covered, denominator = len(covered_all), expected.size
    coverage = covered / denominator if denominator else 0.0
    quality = timing_quality * coverage
    return AlignmentResult(
        mapping=mapping,
        cost=total_cost,
        quality=quality,
        n_detected=int(detected.size),
        n_expected=int(expected.size),
        timing_quality=timing_quality,
        coverage=coverage,
        subsequence=subsequence,
    )


def apply_fuzzy_match(
    alignment: AlignmentResult,
    detected: np.ndarray,
    expected: np.ndarray,
    *,
    optional: np.ndarray | None = None,
) -> CleanedAlignment:
    """Resolve count mismatches DTW leaves behind (§7).

    - Many-to-one: several detected onsets hit the same expected note.
      Keep the closest in time as the real note; the rest are
      re-attacks / added notes → `extra_detected`.
    - One-to-many: an expected note nobody landed on → `missed_expected`.

    `optional` marks expected onsets it is not a mistake to miss — grace
    notes, whose attack may fall inside the onset detector's resolution or
    simply not be played. An unheard one is not a skipped note, and counting
    it as one reaches the musician twice: `n_missed_notes` on the result, and
    `_why_alignment_failed`, which tells a take with any missed note to check
    it is the right piece rather than naming the real problem.
    """
    detected = np.asarray(detected, dtype=float)
    expected = np.asarray(expected, dtype=float)

    by_expected: dict[int, list[int]] = {}
    for det_i, exp_i in alignment.mapping:
        by_expected.setdefault(exp_i, []).append(det_i)

    matched: list[tuple[int, int]] = []
    extra: list[int] = []
    for exp_i, det_indices in by_expected.items():
        if len(det_indices) == 1:
            matched.append((det_indices[0], exp_i))
            continue
        # Many-to-one: the onset closest to the expected time wins.
        closest = min(det_indices, key=lambda d: abs(detected[d] - expected[exp_i]))
        matched.append((closest, exp_i))
        extra.extend(d for d in det_indices if d != closest)

    matched.sort()
    extra.sort()
    skippable = (
        np.zeros(expected.size, dtype=bool)
        if optional is None
        else np.asarray(optional, dtype=bool)
    )

    # **The note takes its ornament's attack back.**
    #
    # Between a grace and the note it decorates the written gap is a fraction
    # of a beat while the gap *into* the grace is nearly a whole one — and the
    # cost is interval-first, so a lone detection arriving on the beat is
    # cheaper to call the grace than to call the note. The note is then
    # reported skipped on a take where it was the only thing played.
    #
    # Which of the two is certain is not a matter of degree: the page says the
    # note is played and only suggests when the ornament is. So an optional
    # onset may not keep a detection that leaves the next required onset with
    # none. Nothing else is disturbed — the swap is refused unless everything
    # between the two is optional, so it can only ever undo this one confusion.
    #
    # Both narrowing clauses survive mutation, and deliberately: `back not in
    # held` already stops the walk before either can bite in any case that was
    # constructed. They are kept because what they exclude is not nothing — an
    # ornament reclaiming from another ornament changes which detection sits on
    # which, and `pulse_anchors` reads every matched pair — and because the
    # rule is far easier to reason about stated in full than inferred from the
    # loop that happens to make half of it redundant.
    held: dict[int, int] = {exp_i: det_i for det_i, exp_i in matched}
    for exp_i in range(expected.size):
        if skippable[exp_i] or exp_i in held:
            continue
        back = exp_i - 1
        while back >= 0 and skippable[back] and back not in held:
            back -= 1
        if back >= 0 and skippable[back] and back in held:
            held[exp_i] = held.pop(back)
    matched = sorted((det_i, exp_i) for exp_i, det_i in held.items())

    covered = {exp_i for _, exp_i in matched}
    missed = [i for i in range(expected.size) if i not in covered and not skippable[i]]

    return CleanedAlignment(
        matched=matched,
        missed_expected=missed,
        extra_detected=extra,
        quality=alignment.quality,
    )


def is_alignment_broken(quality: float, *, config: AudioConfig | None = None) -> bool:
    """True when quality is below the 'don't show anything' cutoff (§7).

    <0.4 → we ask the user to re-record instead of reporting garbage.
    (The softer <0.7 warn threshold is applied downstream, where we can
    still show results alongside a caveat.)
    """
    cfg = config or load_audio_config()
    return quality < cfg.alignment.broken_quality
