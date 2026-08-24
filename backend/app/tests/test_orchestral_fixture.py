"""The fixture the corpus was missing.

Every other score checked in here is a simple exercise-book page: quarters and
eighths, one metre, almost no rests. Measured by `tools/engraver-coverage.py`
they made the engraver look adequate — 95% of notes drawable, worst page 67% —
right up until the first part out of a real orchestral folder rendered as a
title and a photograph and nothing else.

`fixtures/scores/orchestral_part.json` is what such a page is made of. It is
**synthetic and says so**; it is not a transcription of anybody's music. What
it is for is having something in the corpus that the corpus was missing, so the
next limitation of this kind fails a test here rather than surprising a
musician.

The tests below split into two halves that are easy to confuse. One half checks
the pipeline **handles** the page. The other checks the page **still contains
what it claims to** — because a fixture that quietly became simple would make
every test above it pass while measuring nothing, which is exactly how the
corpus got into this state.
"""

from __future__ import annotations

import collections
import json
from pathlib import Path

from app.services.alignment import build_timeline
from app.services.ocr.validate import validate_measures
from app.services.score_schema import (
    ScoreJson,
    measures_under_tempo_change,
    tempo_change_spans,
)

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "scores" / "orchestral_part.json"

#: Mirrors `DRAWABLE` in `mobile/src/lib/notation/fromScore.ts`.
DRAWABLE = {"whole", "half", "quarter", "eighth"}


def _score() -> ScoreJson:
    return ScoreJson.model_validate(json.loads(FIXTURE.read_text())["score"])


def _notes():
    return [note for measure in _score().measures for note in measure.notes]


# ---------------------------------------------------------------------------
# Does the pipeline handle it
# ---------------------------------------------------------------------------


def test_every_bar_adds_up() -> None:
    """A fixture whose arithmetic is wrong tests the validator, not the page.

    Every bar has to be *musically correct* — including the ones in a different
    metre from the header and the ones made of triplets, whose thirds do not
    sum exactly in binary.
    """
    problems = [row.measure_number for row in validate_measures(_score()) if row.is_problem]

    assert problems == [], f"bars that do not add up: {problems}"


def test_the_timeline_can_be_built_from_it() -> None:
    """One onset per sounded note, rests advancing the clock and sounding
    nothing. If a metre change or a tuplet broke this, every bar after it would
    be measured against the wrong second."""
    score = _score()
    timeline = build_timeline(score, 96)
    rests = sum(1 for n in _notes() if n.pitch == "rest")

    onsets = list(timeline.onsets)  # a numpy array; compare as a list

    assert len(onsets) == len(_notes()) - rests
    assert onsets == sorted(onsets), "the clock went backwards"


def test_the_written_rit_is_found_and_bounded() -> None:
    """A `rit.` carries no printed end, so what ends it is the next change or
    the music. A span running off the end would put every remaining bar under a
    tempo change and suppress the verdict for all of them."""
    spans = tempo_change_spans(_score())
    under = measures_under_tempo_change(_score())

    assert spans, "the fixture's rit. was not found"
    assert max(under) <= len(_score().measures)
    assert min(under) > 1, "a change at bar 1 would cover the whole piece"


# ---------------------------------------------------------------------------
# Does the fixture still contain what it claims
# ---------------------------------------------------------------------------


def test_it_is_harder_to_draw_than_anything_else_here() -> None:
    """The reason it exists. If it ever became drawable, the corpus would be
    back to having no page that resembles real repertoire — and nothing would
    say so."""
    notes = _notes()
    drawn = sum(1 for n in notes if n.pitch != "rest" and n.duration in DRAWABLE)
    share = drawn / len(notes)

    assert share < 0.6, (
        f"{share:.0%} of this fixture is drawable. The next-hardest page in the "
        "corpus draws 67%, so this one has stopped being the hard case it was "
        "added to be."
    )


def test_it_holds_the_things_an_exercise_sheet_does_not() -> None:
    """Named individually, because "it is complicated" is not checkable and
    each of these is a distinct thing the simple fixtures never exercise."""
    score = _score()
    durations = collections.Counter(n.duration for n in _notes())

    assert durations["sixteenth"] >= 8, "no run of sixteenths"
    assert any(d.startswith("dotted_") for d in durations), "no dotted rhythm"
    assert any(d.startswith("triplet_") for d in durations), "no tuplet"
    assert sum(1 for n in _notes() if n.pitch == "rest") >= 4, "almost no rests"
    assert score.tempo_changes, "no written tempo change"

    metres = {m.time_signature for m in score.measures if m.time_signature}
    assert len(metres) > 1, f"one metre throughout ({metres}); a part changes metre"

    assert len(score.measures) >= 12, "too short to have sections at all"


def test_it_says_it_is_synthetic() -> None:
    """It is not a transcription of anybody's page, and a fixture that stopped
    saying so would eventually be cited as evidence about a real one."""
    raw = json.loads(FIXTURE.read_text())

    assert "synthetic" in raw["what"].lower()
    assert raw["why"].strip(), "no reason recorded for why this exists"
