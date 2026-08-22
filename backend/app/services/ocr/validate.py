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
- **Tuplets.** `Duration` has no triplet member, so a triplet passage cannot be
  written down correctly in this schema at all. The model has to approximate,
  and the approximation will not sum. Flagging that as a transcription error
  would be blaming the model for the schema's gap — see `TUPLET_NOTE`.
- **A pickup measure**, which is short by design. Only the first measure can be
  one, so only the first measure gets that benefit of the doubt.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.services.score_schema import ScoreJson

#: Quarter-note beats per duration. Deliberately the same table as
#: `alignment._DURATION_BEATS` — if these two ever disagree, this validator
#: would be checking a timeline the analysis does not build.
DURATION_BEATS: dict[str, float] = {
    "whole": 4.0,
    "dotted_whole": 6.0,
    "half": 2.0,
    "dotted_half": 3.0,
    "quarter": 1.0,
    "dotted_quarter": 1.5,
    "eighth": 0.5,
    "dotted_eighth": 0.75,
    "sixteenth": 0.25,
    "dotted_sixteenth": 0.375,
    "thirty_second": 0.125,
}

#: Floating-point slack. A dotted-sixteenth is 0.375 and sums of thirds never
#: land exactly, so an exact comparison would flag correct music.
TOLERANCE = 1e-6

TUPLET_NOTE = (
    "no triplet duration exists in the schema, so a tuplet passage cannot sum"
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

    @property
    def is_problem(self) -> bool:
        """A pickup and an unverifiable measure are not faults."""
        return self.verdict in {"short", "long", "empty"}

    def describe(self) -> str:
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
        sum(DURATION_BEATS.get(note.duration, 0.0) for note in measure.notes)
        for measure in score.measures
    ]
    stated = beats_per_measure(score.time_signature)
    inferred = None
    if stated is None:
        inferred = infer_beats_per_measure(sums)
    expected = stated if stated is not None else inferred
    from_music = stated is None and inferred is not None
    findings: list[MeasureFinding] = []

    for index, measure in enumerate(score.measures):
        actual = sums[index]
        count = len(measure.notes)

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
    return (
        "Your previous transcription does not add up. In these measures the "
        "note durations do not sum to the time signature:\n"
        + "\n".join(f"  - {line}" for line in lines)
        + "\n\nRe-read only those measures against the image and correct the "
        "durations. If a passage is a triplet or other tuplet, say so in "
        "notes_to_human and leave your best approximation — "
        f"{TUPLET_NOTE}."
    )
