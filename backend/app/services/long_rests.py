"""Shortening a long stretch of rest, for practising the notes around it.

**The analysis has to be told.** A musician who skips a twenty-bar rest plays
the bar after it twenty bars early, and `build_timeline` still expects the
silence — measured on an otherwise perfect take, quality falls from **1.000 to
0.000** and the verdict becomes "check you're on the right piece". That is true
of a two-bar rest as much as a twenty-bar one, because the fit is against a
steady grid and the shape is unexplainable either way.

So the same transformation is applied to the score before the timeline is
built, and the rule lives in `fixtures/practice/long_rests.json` because the
app has to shorten the score identically to play it and to count it. Two walks,
two languages, one contract — the same arrangement as `fixtures/timeline`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.services.score_schema import Measure, ScoreJson

_CONTRACT = (
    Path(__file__).resolve().parents[3] / "fixtures" / "practice" / "long_rests.json"
)


@dataclass(frozen=True)
class LongRestRule:
    """How long a run has to be, and how much of it survives."""

    min_bars: int
    kept_bars: int


@lru_cache(maxsize=1)
def rule() -> LongRestRule:
    """The numbers, read from the contract rather than written down twice."""
    raw = json.loads(_CONTRACT.read_text(encoding="utf-8"))
    return LongRestRule(min_bars=int(raw["min_bars"]), kept_bars=int(raw["kept_bars"]))


def _is_silent(measure: Measure) -> bool:
    """Holds notes, and every one of them is a rest.

    A bar with **no notes at all** is not a bar of rest — it is a bar nothing
    was read from, and `validate_measures` already calls it `empty`. Folding it
    into a run of silence would let a hole in the reading shorten the piece.
    """
    return bool(measure.notes) and all(n.pitch == "rest" for n in measure.notes)


@dataclass(frozen=True)
class Shortened:
    score: ScoreJson
    #: How many bars of rest were taken out, for saying so to the musician.
    skipped_bars: int


def shorten_long_rests(score: ScoreJson) -> Shortened:
    """Replace each long run of silent bars with the first few of them.

    The **first** few, so the bar that survives keeps its number and any metre
    change printed on it — and a bar rather than nothing, so there is a downbeat
    to come in on and the metronome has something to count.

    Measure numbers of everything after a shortened run are left exactly as
    they were. They are labels off the page and the bars they name were skipped
    on purpose; the gap in the numbering is the truth about what was played.
    """
    limits = rule()
    kept: list[Measure] = []
    skipped = 0

    index = 0
    measures = score.measures
    while index < len(measures):
        if not _is_silent(measures[index]):
            kept.append(measures[index])
            index += 1
            continue

        end = index
        while end < len(measures) and _is_silent(measures[end]):
            end += 1
        run = end - index
        if run >= limits.min_bars:
            kept.extend(measures[index : index + limits.kept_bars])
            skipped += run - limits.kept_bars
        else:
            kept.extend(measures[index:end])
        index = end

    if skipped == 0:
        # Bit-identical, not merely equivalent: a score with nothing to skip is
        # the common case, and rebuilding it would put this in that path for no
        # gain.
        return Shortened(score=score, skipped_bars=0)
    return Shortened(score=score.model_copy(update={"measures": kept}), skipped_bars=skipped)
