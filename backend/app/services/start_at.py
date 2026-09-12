"""Recording from partway into a piece.

**Practising a passage is what practice mostly is**, and until now a take
always began at bar 1: the app could *play* from any bar (`startAtMeasure` in
`lib/score/schedule.ts`) but could only ever *record* from the top. Someone
working on bar 40 of a concerto had to play the preceding thirty-nine to be
told anything about it.

The same rule as `skip_long_rests`, and for the same reason: the take was
played against a different score than the one on file, so the analysis has to
judge it against that one. A timeline that still contains the bars the musician
never played is a timeline every onset is misaligned against, and
`alignment.py` accumulates durations — so the error does not stay local, it
moves every bar after it.
"""

from __future__ import annotations

from app.services.score_schema import Measure, ScoreJson


def start_from_measure(score: ScoreJson, measure_number: int) -> ScoreJson:
    """The piece from `measure_number` on, numbered as it is on the page.

    **Measure numbers are not rebased.** A verdict about the fourteenth bar has
    to say fourteen; renumbering it to one would be the app and the page
    disagreeing about which bar is which, which is the one thing a practice
    report cannot afford.
    """
    kept = [m for m in score.measures if m.measure_number >= measure_number]
    if not kept or len(kept) == len(score.measures):
        # Nothing to trim, or nothing left: either way the score on file is the
        # score that was played.
        return score

    return score.model_copy(
        update={
            "measures": [_entry_bar(score, kept[0]), *kept[1:]],
            "repeats": _repeats_from(score, measure_number),
            "tempo_changes": _tempo_changes_from(score, measure_number),
        }
    )


#: The three facts a bar can print that hold until the next bar prints one.
_STANDING_FIELDS = ("time_signature", "clef", "key_signature")


def _entry_bar(score: ScoreJson, entry: Measure) -> Measure:
    """The entry bar, carrying whatever metre, clef and key were in force at it.

    The same rule as the tempo change below, one level down. A metre printed at
    bar 5 rides on bar 5 and nowhere else, so a take entering at bar 8 lost it:
    the trimmed score's header still said 4/4 and no bar in it said otherwise,
    and everything that walks measures for the metre in force — the beat check,
    the count-in, the long-rest cues the app counts from the first bar played —
    ran in the wrong metre. The clef and the key are the same shape and were
    lost the same way.

    Stamped onto the entry bar only where it prints nothing of its own; a bar
    that states a change states it.
    """
    before = [m for m in score.measures if m.measure_number < entry.measure_number]
    update = {}
    for field in _STANDING_FIELDS:
        if getattr(entry, field) is not None:
            continue
        standing = next(
            (getattr(m, field) for m in reversed(before) if getattr(m, field) is not None),
            None,
        )
        if standing is not None:
            update[field] = standing
    return entry.model_copy(update=update) if update else entry


def _repeats_from(score: ScoreJson, measure_number: int) -> list:
    """Only the repeats the musician could actually have taken.

    A repeat that opens before the entry bar is dropped, including one that
    *spans* it: someone starting mid-passage plays straight on rather than
    jumping back to a sign they never passed. Keeping it would expand the
    timeline with bars nobody played.
    """
    return [r for r in score.repeats if r.start_measure >= measure_number]


def _tempo_changes_from(score: ScoreJson, measure_number: int) -> list:
    """Changes at or after the entry bar, plus the one still in force at it.

    **The carried-forward one is the point.** A `rit.` printed at bar 13 is
    still in force at bar 14, and `classification.py` refuses to time notes
    under a written change — so dropping it would judge a passage the page told
    the musician to slow through, and report them dragging for reading it
    correctly. That is the exact failure `under_tempo_change` exists to
    prevent, reintroduced by trimming.

    It is moved to the entry bar rather than left where it was printed, because
    a change outside the score cannot be found by `tempo_change_spans`, which
    walks measures.
    """
    after = [c for c in score.tempo_changes if c.measure_number >= measure_number]
    before = [c for c in score.tempo_changes if c.measure_number < measure_number]
    if not before:
        return after
    # The last one printed before the cut is the one still standing at it.
    standing = max(before, key=lambda c: c.measure_number)
    if any(c.measure_number == measure_number for c in after):
        # Something is already printed at the entry bar; it supersedes.
        return after
    return [standing.model_copy(update={"measure_number": measure_number}), *after]
