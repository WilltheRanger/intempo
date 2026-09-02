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
- **Tuplets.** `Duration` names triplets, quintuplets and septuplets —
  `triplet_eighth`, `quintuplet_sixteenth` and friends — so 3:2, 5:4 and 7:4
  passages *can* be written correctly and a bar of them sums. A dotted triplet
  resolves too, because the product lands on a written value. What still cannot
  be written is a ratio landing on none of those lengths, such as a 5:6 group in
  a compound metre. Those approximate and will not sum, and flagging that as a
  transcription error would be blaming the reader for the schema's remaining
  gap — see `TUPLET_NOTE`.
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
    "triplets, quintuplets and septuplets can be written, and so can a dotted "
    "triplet — a ratio landing on none of those lengths (a 5:6 group in a "
    "compound metre, a triplet of thirty-seconds) still has to be approximated "
    "and will not sum"
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

    **Nothing calls this, and wiring it in naively would be wrong** (measured
    2026-08-26). `_concerns_for` builds what a musician sees out of
    `validate_measures` alone; this is reachable only from tests.

    It fires whenever the opening and closing bars do not sum to one measure —
    including when the closing bar is simply **full**, which is the ordinary
    state of a photographed page, because a page break is not the end of a
    piece. Measured on a three-bar page opening with a one-beat pickup: a page
    ending in a complete bar is flagged, and so is a page ending in a multi-bar
    rest, which is what an orchestral part does constantly.

    The rule is sound for a whole *piece* and unsound for a *page*, and which
    one a `ScoreJson` holds is not knowable from here. Left as it is rather
    than redesigned on speculation: it is doing no harm while nothing calls it,
    and the thing a future reader needs is this paragraph rather than a
    different guess.
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

#: How decisively the commonest beat count has to beat the **runner-up** before
#: it is treated as the meter. Below this the top two are a tie or near it,
#: there is no majority to be an outlier *from*, and calling one of them "the
#: meter" would manufacture errors in every bar holding the other.
#:
#: Measured against the runner-up rather than against every vote, which is what
#: it used to be, because those are two different questions and only the first
#: one is being asked. On `audiveris_phone_photo` — a real phone photograph —
#: **eight of fifteen bars sum to exactly 4.0** and the other seven are
#: scattered singletons: 9.5, 5.0, 4.5, 8.0, 3.0, 3.0, 3.5. The metre is
#: obvious to any musician and seven bars are visibly wrong. Under the old
#: share-of-everything test that was 8/15 = 0.53, so the beat check switched
#: itself **off for the whole page** and reported all fifteen bars
#: `unverifiable` — turning itself off on exactly the page it exists for.
#: Against the runner-up it is 8 against 2, which is not a tie by any reading.
MIN_AGREEMENT = 0.6

#: And a floor on how much of the page the winner covers. Dominance alone would
#: call three agreeing bars in a forty-bar page of noise a metre: 3 against 1 is
#: decisive and means nothing. This is the half of the old test worth keeping.
MIN_COVERAGE = 1 / 3

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


#: How far a bar's length may sit from the page's median before it is suspect,
#: on a page whose metre nobody could read.
#:
#: **The beat check is switched off exactly where a reading is worst.** A metre
#: comes from the header, which is illegible on most phone photographs of an
#: inner page, and `infer_beats_per_measure` refuses to name one when the bars
#: do not agree — correctly, since a wrong metre flags every correct bar. The
#: cost is that a page whose bars *wildly* disagree gets no complaint at all.
#:
#: Measured on `oemer_phone_photo`, five bars reading **43.25, 1.0, 1.5, 22.0
#: and 11.5** quarter-beats: no metre inferred, every bar `unverifiable`, and
#: one concern on the whole page. A bar holding forty-three beats is not a
#: reading of music whatever the metre is.
#:
#: Deliberately coarse. This does not name a metre and must not become a way of
#: sneaking one in: it says the bars disagree with each other, which is a
#: weaker claim and the only one available. Three times the median — the same
#: shape and the same multiple as the density check next to it — flags 3 of the
#: 5 bars above and, run against `audiveris_phone_photo`, would flag none.
LENGTH_MULTIPLE = 3.0


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
    #: Notes the reading saw in this measure and this schema cannot write.
    #:
    #: Separate from every other field here because it is not a doubt about the
    #: reading — the page was read correctly and the *schema* ran out of names.
    #: Re-reading cannot fix it, which is why it is deliberately not part of
    #: `worth_a_re_read`.
    unwritable_notes: int = 0
    #: This bar's length is wildly out of step with the rest of the page.
    #:
    #: Only ever set where no metre could be read, because where one could,
    #: `short` and `long` say it better. See `LENGTH_MULTIPLE`.
    out_of_line: bool = False

    @property
    def worth_a_re_read(self) -> bool:
        """A fault a fresh look at the image could actually correct.

        What `is_problem` used to be, and what `describe_for_retry` still
        wants: a bar with a note this schema has no name for was read right,
        and asking a model to read it again gets the same answer back.
        """
        return (
            bool(self.broken_ties)
            or bool(self.tuplet_faults)
            or self.too_dense
            or self.out_of_line
            or self.verdict in {"short", "long", "empty"}
        )

    @property
    def is_problem(self) -> bool:
        """A pickup and an unverifiable measure are not faults."""
        return self.worth_a_re_read or bool(self.unwritable_notes)

    def describe(self) -> str:
        # **Prefixed rather than ranked.** Notes this schema could not write are
        # often the *cause* of whatever else is wrong with the bar — the reason
        # it comes up short — so choosing between the two sentences would drop
        # the half that explains the other. Nothing changes for a measure that
        # has none, which is nearly all of them.
        if self.unwritable_notes:
            count = self.unwritable_notes
            return (
                f"measure {self.measure_number}: {count} note"
                f"{'' if count == 1 else 's'} the reading could not write "
                "(a duration or accidental this app has no name for)"
                + (f" — {self._without_prefix()}" if self.worth_a_re_read else "")
            )
        return self._describe_fault()

    def _without_prefix(self) -> str:
        """The fault sentence with its own "measure N:" removed.

        Every branch below opens with it, which reads correctly alone and
        twice in one line when two sentences are joined.
        """
        head = f"measure {self.measure_number}: "
        fault = self._describe_fault()
        return fault[len(head):] if fault.startswith(head) else fault

    def _describe_fault(self) -> str:
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
        if self.out_of_line:
            return (
                f"measure {self.measure_number}: {self.actual_beats:g} beats, "
                "far out of step with the rest of the page — the metre could "
                "not be read, so this is measured against the other bars"
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

    **Two tests, because there are two ways to have no answer**, and one number
    was being asked to carry both. The winner must beat the runner-up
    (`MIN_AGREEMENT`) — that is the tie above, and it still refuses 4,4,4,3,3,3.
    And it must cover enough of the page (`MIN_COVERAGE`) — three agreeing bars
    in forty of noise is decisive against any single rival and still means
    nothing.

    What the single test got wrong is the page in between: one clear winner
    surrounded by scattered singletons. Measured on `audiveris_phone_photo`,
    eight of fifteen bars at exactly 4.0 and seven different wrong answers, the
    old test read 0.53 and switched the beat check off for the whole page —
    reporting fifteen `unverifiable` bars where seven were flaggable and the
    metre was not in doubt.
    """
    votes = [s for s in sums if s > 0]
    if len(votes) < MIN_MEASURES_TO_INFER:
        return None
    tally: dict[float, int] = {}
    for value in votes:
        tally[value] = tally.get(value, 0) + 1
    winner, hits = max(tally.items(), key=lambda kv: (kv[1], -kv[0]))
    runner_up = max(
        (count for value, count in tally.items() if value != winner), default=0
    )
    if hits / (hits + runner_up) < MIN_AGREEMENT:
        return None
    if hits / len(votes) < MIN_COVERAGE:
        return None
    return winner


def meters_in_force(score: ScoreJson) -> list[float | None]:
    """Quarter-note beats expected in each measure, meter changes included.

    A score carries one header time signature and the repertoire does not
    honour that. Any measure may state a new one, and it holds until the next
    change — the way it is printed, and the way a player reads it.

    Returns None for a measure whose meter cannot be known, which is the
    ordinary case for a phone photo of an inner page: the header is cropped off
    and `infer_beats_per_measure` takes over. Inference is deliberately *not*
    done here, because it looks at the whole piece at once and a piece that
    changes meter has no single answer to give it.
    """
    running = beats_per_measure(score.time_signature)
    out: list[float | None] = []
    for measure in score.measures:
        if measure.time_signature is not None:
            changed = beats_per_measure(measure.time_signature)
            # "unknown" on a measure means the change is visible but illegible,
            # which is worse than no change at all — it invalidates the meter
            # that was running rather than continuing it.
            running = changed
        out.append(running)
    return out


def keys_in_force(score: ScoreJson) -> list[str | None]:
    """The key signature each measure is written in, key changes included.

    The sibling of `meters_in_force`, and the same walk: a key holds until
    another one is printed. `ScoreJson.key_signature` is only the key the page
    *opens* in, so reading it for a bar after a change names the wrong one.

    **This produces no finding, so the sandbox ports owe it nothing.** Every
    rule in this module that decides whether a bar is wrong is mirrored in
    `tools/validator-sandbox.template.html` and held there by
    `test_sandbox_parity.py`. This one only tells the corrector which key to
    name in a prompt — a page's beats add up or do not add up regardless of
    what key it is in.
    """
    running = score.key_signature
    out: list[str | None] = []
    for measure in score.measures:
        if measure.key_signature is not None:
            running = measure.key_signature
        out.append(running)
    return out


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

    # The meter in force at each measure, which is not one number for the piece.
    # A change of meter is ordinary — a 3/4 bar after four of 4/4 — and reading
    # it against the header called every one of those bars short, on a page
    # written and read correctly. See `Measure.time_signature`.
    meters = meters_in_force(score)
    stated = meters[0] if meters else beats_per_measure(score.time_signature)
    inferred = None
    densities: list[float] = []
    if all(m is None for m in meters):
        inferred = infer_beats_per_measure(sums)
    from_music = stated is None and inferred is not None
    expected_per_measure = [
        meter if meter is not None else inferred for meter in meters
    ]
    findings: list[MeasureFinding] = []

    # **A bar of nothing but rests does not vote on how dense this music is.**
    #
    # The density is notes per beat, and a rest is a note in this schema — so a
    # bar of rest contributes 1/meter to a median that is supposed to describe
    # how many *notes* a bar of this page holds. It carries no evidence about
    # that, exactly as a lone whole rest carries none about the metre and gets
    # no vote there either (`musicxml._bar_lengths`).
    #
    # **Measured (2026-08-26), and made worse by a fix earlier the same day.**
    # On the two-page part fixture, counting every bar: median **0.50** and a
    # limit of **1.50** — so an ordinary run of eight eighths, at 2.0 notes per
    # beat, was flagged as three times the density of its own page. Excluding
    # rest bars gives a median of **1.000** and a limit of **3.00** on one page
    # and on two alike, and the run is silent. Re-derived 2026-08-27: all four
    # numbers unchanged.
    #
    # The bar counts that used to be quoted here — 16 counted, 7 of them rests
    # — are not, because bars were added to that fixture the next day. They
    # were never the evidence: the medians are, and they are what survives
    # someone extending the page. A number in a comment that moves whenever the
    # fixture grows is a number that will be wrong and unnoticed, which is
    # exactly how `_MIN_STAFF_SPACE_PX`'s table went stale for three days.
    #
    # A bass part is mostly bars of rest, and expanding a four-bar rest turns
    # one voting bar into four — so `_expand_multiple_rests` multiplied this on
    # precisely the repertoire it was written for. The check exists to catch a
    # tremolo read as sixteen sixteenths; a tremolo is still 4 notes per beat
    # against a limit of 3, so nothing it was for has been given up.
    densities = [
        len(measure.notes) / meter
        for measure, meter in zip(score.measures, expected_per_measure)
        if measure.notes and meter
        and not all(note.pitch == "rest" for note in measure.notes)
    ]
    median_density = median(densities) if densities else 0.0
    density_limit = DENSITY_MULTIPLE * median_density

    # **A page with no readable metre is still evidence about itself.**
    #
    # Every bar of a piece holds the same number of beats, so where the metre
    # could not be read the bars can still be compared with one another — a
    # weaker claim than naming a metre, and the only one available. See
    # `LENGTH_MULTIPLE` for what it costs to say nothing.
    #
    # Bars of rest **do** vote here, unlike the density median above: a bar of
    # rest is exactly one bar long, which is the whole question. A bar with no
    # notes at all does not, because it has no length — and it is already
    # `empty`, which is reported.
    #
    # `MIN_MEASURES_TO_INFER` shared with the metre vote deliberately: both ask
    # the same question, which is whether there are enough bars for the page to
    # be evidence about itself.
    lengths = [total for total, m in zip(sums, score.measures) if m.notes]
    median_length = (
        median(lengths) if len(lengths) >= MIN_MEASURES_TO_INFER else 0.0
    )

    for index, measure in enumerate(score.measures):
        expected = expected_per_measure[index]
        actual = sums[index]
        count = len(measure.notes)
        dense = (
            bool(expected)
            and count >= DENSITY_MIN_NOTES
            and count / expected > density_limit
        )

        # Only where no metre could be read. Where one could, `short` and
        # `long` say the same thing against a real number instead of a median.
        adrift = bool(
            expected is None
            and count
            and median_length > 0
            and (
                actual > LENGTH_MULTIPLE * median_length
                or actual * LENGTH_MULTIPLE < median_length
            )
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
                unwritable_notes=measure.unwritable_notes,
                out_of_line=adrift,
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
    # `worth_a_re_read`, not `is_problem`: a bar holding a note this schema has
    # no name for was read correctly and a fresh look returns the same note.
    # Listing it would spend a re-read on the one fault a re-read cannot touch.
    bad = [f for f in findings if f.worth_a_re_read]
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
    adrift = [f for f in bad if f.out_of_line]

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
    if adrift:
        instructions.append(
            " The time signature could not be read on this page, so those "
            "measures are measured against the other bars rather than against "
            "a metre. Read their durations again, and if you can see the time "
            "signature anywhere on the image, state it."
        )
    return header + "\n" + body + "".join(instructions)
