"""Checking a transcription against arithmetic rather than against a model.

The durations in a measure must add up to what the time signature says a
measure holds. That is not an opinion, it needs no ground truth and no second
model, and it catches the error class this app cares about most: `alignment.py`
builds its entire expected timeline from `_beats(note.duration)`, so a measure
whose durations are wrong desynchronises every measure after it. A wrong pitch,
by contrast, is read exactly once — to ask whether the note is a rest.

So this is deliberately narrow. It says nothing about whether the notes are the
*right* notes. It says whether the transcription is internally coherent, which
is the part that can be established for free.

**What it cannot check, and says so rather than guessing:**

- **`time_signature: "unknown"`** was the common case, not the edge one — the
  OCR prompt authorises that string when the header is illegible, which a phone
  photo of an inner page usually is, and three of the five bundled fixtures come
  back unknown. Rather than go blind on 60% of scores, the meter is **inferred
  from the transcription itself** when the header cannot be read: if most
  measures agree on a beat count, that count is the meter, and the measures that
  disagree are the suspects. See `infer_beats_per_measure`.
- **Tuplets.** `Duration` now names triplets — `triplet_eighth` and friends —
  so a 3:2 passage *can* be written correctly and a bar of them sums. What
  still cannot be written is a quintuplet, a septuplet, or a dotted triplet.
  Those approximate and will not sum, and flagging that as a transcription
  error would be blaming the reader for the schema's remaining gap — see
  `TUPLET_NOTE`.
- **A pickup measure**, which is short by design. Only the first measure can be
  one, so only the first measure gets that benefit of the doubt.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Literal

from app.services.score_schema import (
    DURATION_BEATS,
    BrokenTie,
    ScoreJson,
    TupletFault,
    broken_ties,
    tuplet_faults,
)

#: Imported, not copied — see `score_schema.DURATION_BEATS` for why.

#: Floating-point slack, so an exact comparison cannot flag correct music.
#:
#: Thirds are not exactly representable in binary, so the
#: arithmetic here is not the exact arithmetic the notation implies. As it
#: happens every triplet grouping in this table still *sums* back to its bar
#: length exactly — round-to-nearest recovers it — verified exhaustively over
#: every ordered combination up to six notes and 600k random bars up to
#: eighteen. That is a property of these particular values, not a theorem, and
#: it is not something a beat check should depend on.
TOLERANCE = 1e-6

TUPLET_NOTE = (
    "triplets can be written, but no other tuplet can — a quintuplet, a "
    "septuplet or a dotted triplet has to be approximated and will not sum"
)

Verdict = Literal["ok", "short", "long", "empty", "pickup", "unverifiable"]


@dataclass(frozen=True)
class NumberingGap:
    """A jump in the measure numbers, which is evidence of a misread page."""

    after: int
    next: int

    @property
    def missing(self) -> int:
        return self.next - self.after - 1

    def describe(self) -> str:
        return f"{self.missing} measure(s) missing between {self.after} and {self.next}"


@dataclass(frozen=True)
class RepeatedRun:
    """A block of measures that repeats verbatim later in the score."""

    first_at: int   # 0-based index where the block first appears
    again_at: int   # 0-based index where the copy starts
    length: int

    def describe(self) -> str:
        block = "measure" if self.length == 1 else f"{self.length} measures"
        return (
            f"{block} at position {self.first_at + 1} reappear verbatim at "
            f"position {self.again_at + 1}"
        )


def _fingerprint(measure) -> tuple:
    """What makes two measures the same reading, for this purpose.

    Pitch and duration in order. Not the measure number, which is a label, and
    not slurs or dynamics, which can legitimately differ between two measures
    that are otherwise the same music.
    """
    return tuple((n.pitch, n.duration) for n in measure.notes)


def repeated_runs(score: ScoreJson, *, min_length: int = 2) -> list[RepeatedRun]:
    """Blocks of measures repeated note-for-note — the shape of a lost model.

    **This is the failure the beat-sum check cannot see.** A model that has
    lost its place on a dense page does not produce nonsense; it produces a
    plausible measure again, and again. Every copy sums to the time signature,
    so every constraint passes and the confidence comes back high. Internally
    consistent and wrong is the hardest state to detect, and repetition is its
    signature.

    Real music does repeat, which is why `min_length` is 2 and why this is
    evidence rather than a verdict: two identical measures in a row can be an
    ostinato, and a returning phrase is what phrases do. What is not music is
    the same three measures appearing twice inside nine on a page where the
    printed part shows no repeat at all.
    """
    prints = [_fingerprint(m) for m in score.measures]
    n = len(prints)
    found: list[RepeatedRun] = []
    claimed: set[int] = set()

    # Longest first. A six-measure repeat trivially contains a three-measure
    # one, and reporting both says the same thing twice.
    for length in range(n // 2, min_length - 1, -1):
        for start in range(n - length + 1):
            block = list(prints[start : start + length])
            # Empty measures are already reported by `validate_measures`;
            # counting them here would flag every page with two unreadable bars
            # as a repetition.
            if any(len(b) == 0 for b in block):
                continue
            for other in range(start + length, n - length + 1):
                if list(prints[other : other + length]) != block:
                    continue
                span = set(range(start, start + length)) | set(range(other, other + length))
                # ABC ABC ABC otherwise reports 1→4, 2→5 and 3→6, which are
                # one repetition described three times with the window slid
                # along it. The first one covers the phenomenon.
                if span & claimed:
                    continue
                found.append(RepeatedRun(first_at=start, again_at=other, length=length))
                claimed |= span
                break
    return found


def describe_repeats(runs: list[RepeatedRun]) -> str:
    """The repetition complaint, for a retry or a report."""
    if not runs:
        return ""
    return (
        "Measures repeat verbatim: "
        + "; ".join(r.describe() for r in runs)
        + ". If the part really does repeat, say so in notes_to_human. "
        "Otherwise re-read those measures — repeating a plausible measure is "
        "what happens when the place is lost on a dense page."
    )


def pickup_complement(score: ScoreJson) -> str | None:
    """A pickup must be paid back by the final measure, or it is a dropped note.

    Music that opens with an anacrusis of *n* beats conventionally ends with a
    measure of `meter - n`, so the two together make one whole. When they do
    not, the short opening measure was probably not a pickup at all — which
    matters, because `validate_measures` forgives a short first measure on the
    assumption that it was.

    Returns None when there is nothing to say: no meter, too little music, or
    a first measure that is already full.
    """
    findings = validate_measures(score)
    if len(findings) < 3:
        return None
    first, last = findings[0], findings[-1]
    meter = first.expected_beats
    if meter is None or first.verdict != "pickup":
        return None
    total = first.actual_beats + last.actual_beats
    if abs(total - meter) <= TOLERANCE:
        return None
    return (
        f"measure {first.measure_number} is short ({first.actual_beats:g} of "
        f"{meter:g}) and was allowed as a pickup, but the last measure is "
        f"{last.actual_beats:g} rather than the {meter - first.actual_beats:g} "
        "that would complete it — so the opening may be a dropped note rather "
        "than an anacrusis"
    )


def repeat_balance(score: ScoreJson) -> list[str]:
    """Repeat and ending brackets that do not close.

    Cheap, and it catches a specific misreading: a barline with dots read as a
    repeat when the dots were staccato marks, or an ending bracket opened and
    never closed because the page ran out before the second ending.
    """
    numbers = {m.measure_number for m in score.measures}
    complaints: list[str] = []
    for repeat in score.repeats:
        if repeat.end_measure < repeat.start_measure:
            complaints.append(
                f"{repeat.type} runs backwards, from measure "
                f"{repeat.start_measure} to {repeat.end_measure}"
            )
        for edge, label in ((repeat.start_measure, "start"), (repeat.end_measure, "end")):
            if numbers and edge not in numbers:
                complaints.append(
                    f"{repeat.type} {label}s at measure {edge}, which is not in the score"
                )
    firsts = sum(1 for r in score.repeats if r.type == "first_ending")
    seconds = sum(1 for r in score.repeats if r.type == "second_ending")
    if firsts != seconds:
        complaints.append(
            f"{firsts} first ending(s) against {seconds} second ending(s) — "
            "endings come in pairs"
        )
    return complaints


def numbering_gaps(score: ScoreJson) -> list[NumberingGap]:
    """Measure numbers that skip.

    Not arithmetic like the beat check, but the same kind of evidence: a
    transcription running 409, 414, 415 has either lost four measures or
    mis-numbered them, and either way something on the page is not in the JSON.

    Seen in the wild on a real photograph — a **boxed rehearsal mark reading
    49** came back as measure **409**, which inserted an empty measure and
    renumbered the rest of the line. The prompt now names that case explicitly;
    this catches it when the prompt does not.
    """
    numbers = [m.measure_number for m in score.measures]
    return [
        NumberingGap(after=a, next=b)
        for a, b in zip(numbers, numbers[1:], strict=False)
        if b - a != 1
    ]

#: How much of the score has to agree before a beat count is treated as the
#: meter. Below this there is no majority to be an outlier *from*, and calling
#: the most common of four different answers "the meter" would manufacture
#: errors in the other three.
MIN_AGREEMENT = 0.6

#: And a floor on how many measures that fraction is computed over. Two
#: measures agreeing is not a majority, it is a coincidence.
MIN_MEASURES_TO_INFER = 3

#: How far above the page's own median density a measure must sit to be worth
#: a second look.
#:
#: Relative, not absolute, and that is the whole design. An absolute ceiling
#: cannot work here: `thirty_second` is the shortest duration the schema has, so
#: **32 notes is the most a four-beat bar can hold** and any fixed
#: notes-per-beat limit high enough to avoid flagging real thirty-second
#: passages is a limit no correctly-summing bar can reach. The first version of
#: this check used one, and was unreachable.
#:
#: What is actually suspicious is a bar out of character with its neighbours.
DENSITY_MULTIPLE = 3.0

#: ...and a floor on the note count, so "three times the median" cannot flag a
#: three-note bar on a page of whole notes. Nothing under this is dense.
DENSITY_MIN_NOTES = 8

#: The failure these exist for: a model reading a tremolo, a trill or a turn as
#: a run of separate notes. One half note with a mark over it becomes sixteen
#: sixteenths — which sums to **exactly the same number of beats**, so the
#: arithmetic check cannot see it, and `note_count` had been sitting in this
#: dataclass unread since it was written.
#:
#: Starting values. Nothing here has been measured against real pages yet.


@dataclass(frozen=True)
class MeasureFinding:
    measure_number: int
    verdict: Verdict
    expected_beats: float | None
    actual_beats: float
    note_count: int
    #: True when `expected_beats` came from the music rather than the header.
    #: Callers that act on a finding should know which, because an inferred
    #: meter is a majority vote and a stated one is a reading.
    meter_inferred: bool = False
    #: Ties written in this measure that cannot be honoured.
    #:
    #: Separate from `verdict` rather than a value of it, because the two are
    #: independent: a measure whose beats add up perfectly can still carry a
    #: tie between two different pitches, and that tie is what deletes an onset
    #: from the timeline. Collapsing them would let a clean beat sum hide it.
    broken_ties: tuple[BrokenTie, ...] = ()
    #: Bracketed groups whose contents contradict the ratio printed over them.
    #:
    #: Separate from the beat sum for the same reason as `broken_ties`, and with
    #: a sharper example: three `triplet_eighth`s written where the page
    #: brackets a 5:4 quintuplet sum to exactly 1.0. The bar adds up. Only the
    #: stated ratio can see it.
    tuplet_faults: tuple[TupletFault, ...] = ()
    #: More notes than this measure can plausibly hold, and more than the rest
    #: of the page runs to.
    #:
    #: `note_count` had been populated since this dataclass existed and read by
    #: nothing, so a measure with nineteen notes that happened to sum correctly
    #: was trusted in silence. That is the shape of a tremolo or an ornament
    #: read as a run of real notes — and it can sum to exactly the right number
    #: of beats, which is why the arithmetic check cannot see it.
    too_dense: bool = False

    @property
    def is_problem(self) -> bool:
        """A pickup and an unverifiable measure are not faults."""
        return (
            bool(self.broken_ties)
            or bool(self.tuplet_faults)
            or self.too_dense
            or self.verdict in {"short", "long", "empty"}
        )

    def describe(self) -> str:
        # A broken tie leads, because it is the fault that changes the timeline
        # even when the arithmetic is clean.
        if self.broken_ties:
            return "; ".join(tie.describe() for tie in self.broken_ties)
        if self.tuplet_faults:
            return "; ".join(fault.describe() for fault in self.tuplet_faults)
        if self.too_dense:
            return (
                f"measure {self.measure_number}: {self.note_count} notes in "
                f"{self.expected_beats:g} beats — far more than the rest of the page"
            )
        if self.verdict == "unverifiable":
            return f"measure {self.measure_number}: not checkable"
        source = " (meter inferred from the music)" if self.meter_inferred else ""
        if self.verdict == "pickup":
            return (
                f"measure {self.measure_number}: {self.actual_beats:g} of "
                f"{self.expected_beats:g} beats — allowed, a first measure may be a pickup"
            )
        if self.verdict == "empty":
            return f"measure {self.measure_number}: no notes"
        if self.verdict == "ok":
            return f"measure {self.measure_number}: {self.actual_beats:g} beats"
        return (
            f"measure {self.measure_number}: {self.actual_beats:g} beats, "
            f"expected {self.expected_beats:g} ({self.verdict}){source}"
        )


def beats_per_measure(time_signature: str | None) -> float | None:
    """Quarter-note beats in one measure, or None when it cannot be known.

    Quarter-note beats rather than notated beats, to match `alignment.py`,
    where `target_bpm` is always quarter-notes-per-minute regardless of the
    time signature's lower number. So 6/8 is 3.0 quarter-beats, not 6.
    """
    if not time_signature or time_signature == "unknown":
        return None
    try:
        upper, lower = time_signature.split("/")
        count, unit = int(upper), int(lower)
    except (ValueError, AttributeError):
        return None
    if count <= 0 or unit <= 0:
        return None
    return count * (4.0 / unit)


def infer_beats_per_measure(sums: list[float]) -> float | None:
    """The meter, read off the music, or None when the music does not agree.

    Every measure in a piece holds the same number of beats, so a transcription
    is its own evidence: if seven of eight measures come to 2.0 beats, the meter
    is 2/4 and the eighth measure is the error. That is worth having because the
    header — which is where a meter is supposed to come from — is illegible on
    most phone photographs of an inner page, and without this the check that
    catches duration errors is switched off for exactly those scores.

    Every measure votes, including a pickup. Excluding the first measure was
    the obvious refinement and it made things worse: on a genuine 50/50 split
    like 4,4,4,3,3,3 — a transcription nobody should be confident about —
    dropping the first vote turned a 3-3 tie into 3 of 5 and manufactured a
    meter. A real pickup is one short measure among many correct ones, so the
    majority survives it without help.
    """
    votes = [s for s in sums if s > 0]
    if len(votes) < MIN_MEASURES_TO_INFER:
        return None
    tally: dict[float, int] = {}
    for value in votes:
        tally[value] = tally.get(value, 0) + 1
    winner, hits = max(tally.items(), key=lambda kv: (kv[1], -kv[0]))
    if hits / len(votes) < MIN_AGREEMENT:
        return None
    return winner


def validate_measures(score: ScoreJson) -> list[MeasureFinding]:
    """One finding per measure, in order."""
    sums = [
        sum(DURATION_BEATS[note.duration] for note in measure.notes)
        for measure in score.measures
    ]
    ties_by_measure: dict[int, list[BrokenTie]] = {}
    for tie in broken_ties(score.measures):
        ties_by_measure.setdefault(tie.measure_number, []).append(tie)

    tuplets_by_measure: dict[int, list[TupletFault]] = {}
    for fault in tuplet_faults(score.measures):
        tuplets_by_measure.setdefault(fault.measure_number, []).append(fault)

    stated = beats_per_measure(score.time_signature)
    inferred = None
    densities: list[float] = []
    if stated is None:
        inferred = infer_beats_per_measure(sums)
    expected = stated if stated is not None else inferred
    from_music = stated is None and inferred is not None
    findings: list[MeasureFinding] = []

    if expected:
        densities = [
            len(measure.notes) / expected
            for measure in score.measures
            if measure.notes
        ]
    median_density = median(densities) if densities else 0.0
    density_limit = DENSITY_MULTIPLE * median_density

    for index, measure in enumerate(score.measures):
        actual = sums[index]
        count = len(measure.notes)
        dense = (
            bool(expected)
            and count >= DENSITY_MIN_NOTES
            and count / expected > density_limit
        )

        if count == 0:
            verdict: Verdict = "empty"
        elif expected is None:
            verdict = "unverifiable"
        elif abs(actual - expected) <= TOLERANCE:
            verdict = "ok"
        elif index == 0 and actual < expected:
            # Only the first measure can be a pickup. A short measure anywhere
            # else is a dropped or mis-read note.
            verdict = "pickup"
        else:
            verdict = "short" if actual < expected else "long"

        findings.append(
            MeasureFinding(
                measure_number=measure.measure_number,
                verdict=verdict,
                expected_beats=expected,
                actual_beats=actual,
                note_count=count,
                meter_inferred=from_music,
                broken_ties=tuple(ties_by_measure.get(measure.measure_number, ())),
                tuplet_faults=tuple(tuplets_by_measure.get(measure.measure_number, ())),
                too_dense=dense,
            )
        )
    return findings


def problems(score: ScoreJson) -> list[MeasureFinding]:
    """Only the measures that are provably wrong."""
    return [f for f in validate_measures(score) if f.is_problem]


def describe_numbering(gaps: list[NumberingGap]) -> str:
    """The numbering complaint, for the retry text. Empty when it is fine."""
    if not gaps:
        return ""
    return (
        "The measure numbers skip: "
        + "; ".join(g.describe() for g in gaps)
        + ". Number the measures sequentially from 1 in the order they appear, "
        "and do not emit a measure for a boxed rehearsal mark."
    )


def describe_for_retry(findings: list[MeasureFinding]) -> str:
    """What to tell the model so a second attempt is aimed rather than blind.

    Names the measures and the arithmetic. A bare "try again" re-rolls the same
    dice; naming the measure and how far off it is gives the model somewhere to
    look, and lets it answer that the passage is a tuplet — which is a real
    answer this schema cannot represent.
    """
    bad = [f for f in findings if f.is_problem]
    if not bad:
        return ""

    lines = [f.describe() for f in bad]
    # Two different faults reach here now, and the instruction has to match the
    # one the model is being shown. Telling it the durations do not sum, when
    # what is wrong is a tie between two pitches, aims the re-read at the wrong
    # thing entirely.
    sums = [f for f in bad if f.verdict in {"short", "long", "empty"}]
    ties = [f for f in bad if f.broken_ties]
    tuplets = [f for f in bad if f.tuplet_faults]
    dense = [f for f in bad if f.too_dense]

    header = "Your previous transcription has measures that cannot be right:"
    body = "\n".join(f"  - {line}" for line in lines)

    instructions = ["\n\nRe-read only those measures against the image."]
    if sums:
        instructions.append(
            " Correct the durations. If a passage is a triplet or other tuplet, "
            "say so in notes_to_human and leave your best approximation — "
            f"{TUPLET_NOTE}."
        )
    if ties:
        instructions.append(
            " Where a curve joins two *different* pitches it is a slur, not a "
            "tie: record it in `slurs` and set tied_to_next false. Only set "
            "tied_to_next when the same pitch is written twice and held as one "
            "sound."
        )
    if tuplets:
        instructions.append(
            " Count the notes inside each bracket again and make `tuplets` say "
            "what is printed over it: actual_notes is the number on the bracket "
            f"and normal_notes is what it replaces. {TUPLET_NOTE}."
        )
    if dense:
        instructions.append(
            " Where a measure holds far more notes than the rest of the page, "
            "check it is not a tremolo, a trill or a turn: those are one written "
            "note with a mark over it, not a run of separate notes."
        )
    return header + "\n" + body + "".join(instructions)
