"""One score, one tempo, and the note times both implementations must produce.

**Why a fixture rather than a shared function.** There are two walks over a
score and there have to be: `alignment.build_timeline` builds what the analysis
*expects to hear*, and `mobile/src/lib/score/schedule.ts` builds what the app
*plays*. Different languages, different runtimes, no way to share code between
them. What they cannot be is different arithmetic.

If they drift, nothing looks broken from either side. The app plays the piece,
the analysis judges the recording, and a musician who played exactly along with
what the app sounded is told they rushed. Both halves are behaving.

So the fixture is the contract. This file checks the server against it;
`mobile/src/lib/score/schedule.parity.test.ts` checks the app against the same
file. A walk that drifts fails in its own suite.

**What the fixture deliberately leaves out**: slurs, and only slurs. The server
emits no onset for a note under a bow stroke, because there is no attack to
detect; playback sounds it, because a reference you cannot hear is not one.
That is a decision, and each side has it written down.

**Repeats used to be on that list, and the reason given was false.** It said
playback plays straight through. It does not, and has not since `scheduleScore`
started running `measuresInPlayOrder` — a hand port of `expand_repeats`,
recursive, with first and second endings, and the one piece of arithmetic here
most likely to drift. The stale line was load-bearing: a test in this file
asserted the fixture had no repeat, so the coverage could not be added without
first disbelieving the file. Meanwhile the app held the performed order with
numbers typed into its own suite, under a test named for a backend it never
consulted.

**What it deliberately includes**: a rest that advances the clock and sounds
nothing; a *real* tie across a barline, which folds into one onset; a **fake**
tie between two different pitches, which is a slur written badly and must still
sound twice; triplets, whose thirds are not exactly representable; a dotted
value; and a repeated section with first and second endings, whose bars hold
two, four, one and three notes so that the performed order shows in the times
and not only in `expected_measures`.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.alignment import build_timeline
from app.services.score_schema import ScoreJson

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "timeline" / "parity.json"


def _fixture() -> dict:
    return json.loads(FIXTURE.read_text())


def test_the_server_still_produces_the_times_in_the_fixture() -> None:
    """Change the server's walk and this fails, loudly, here.

    Regenerating the fixture is then a deliberate act — and the moment you do,
    the app's own test starts failing until it is changed to match. That is the
    whole mechanism.
    """
    fixture = _fixture()
    timeline = build_timeline(ScoreJson.model_validate(fixture["score"]), fixture["bpm"])

    assert [pytest.approx(o, abs=1e-9) for o in timeline.onsets] == pytest.approx(
        fixture["expected_onsets_s"], abs=1e-9
    )


def test_the_server_plays_the_bars_in_the_order_the_fixture_records() -> None:
    """The times alone cannot say this, and that is why the order is held too.

    Two bars of equal length swapped produce the same list of onsets. The
    fixture's repeated section is shaped so they are not equal — but shaping a
    fixture is a thing a later edit can undo without noticing, and the order is
    the whole reason a repeat is in here.
    """
    fixture = _fixture()
    timeline = build_timeline(ScoreJson.model_validate(fixture["score"]), fixture["bpm"])

    assert [n.measure_number for n in timeline.notes] == fixture["expected_measures"]


def test_the_fixture_exercises_what_it_claims_to() -> None:
    """A fixture that quietly stopped containing a tie would still pass the test
    above, and would be testing nothing but a straight run of quarter notes."""
    fixture = _fixture()
    score = ScoreJson.model_validate(fixture["score"])
    notes = [note for measure in score.measures for note in measure.notes]

    rests = [n for n in notes if n.pitch == "rest"]
    tied = [i for i, note in enumerate(notes) if note.tied_to_next]
    # A tie is only real when both noteheads are the same pitch. Otherwise it
    # is a slur written badly, and folding it would delete an onset the
    # musician actually attacked.
    real_ties = [
        i for i in tied if i + 1 < len(notes) and notes[i + 1].pitch == notes[i].pitch
    ]
    fake_ties = [i for i in tied if i not in real_ties]

    assert rests, "no rest — nothing checks that the clock advances in silence"
    assert real_ties, "no real tie — nothing checks that two noteheads fold into one onset"
    assert fake_ties, (
        "no tie between different pitches — nothing checks that a slur written "
        "as a tie still sounds twice, which is the case that deletes an onset "
        "a musician actually played"
    )
    assert any("triplet" in n.duration for n in notes), "no triplet — thirds untested"

    # Written once, sounded twice. This used to read `len(notes) - rests -
    # real_ties`, which counted the page rather than the performance; with a
    # repeat in the fixture the two numbers are no longer the same, and the
    # second assertion is the one that says so.
    sounded = len(build_timeline(score, fixture["bpm"]).notes)

    assert len(fixture["expected_onsets_s"]) == sounded
    assert sounded > len(notes) - len(rests) - len(real_ties), (
        "the fixture sounds no more notes than it writes — the repeated "
        "section is not being played twice"
    )


def test_the_fixture_still_holds_a_repeat_with_both_endings() -> None:
    """The coverage this file spent a release without, guarded the way the ties
    above are: a fixture that lost its repeat would still pass every test that
    only compares numbers, because the numbers would be regenerated with it.

    Endings specifically. A plain `|: :|` exercises the span; the endings
    exercise `bracketed`, whose rule — an ending belongs only to a section
    starting strictly before it — is the one a measured bug came from.
    """
    score = ScoreJson.model_validate(_fixture()["score"])
    kinds = {r.type for r in score.repeats}

    assert "repeat" in kinds, "the fixture lost its repeated section"
    assert {"first_ending", "second_ending"} <= kinds, (
        "the fixture has a repeat but no endings — `bracketed` is untested "
        "across the wire"
    )


def test_the_fixture_has_no_slurs() -> None:
    """The one difference that is still a decision. A fixture that grew a slur
    would make this file fail for a reason that is not a defect, and the fix
    would be to weaken it."""
    score = ScoreJson.model_validate(_fixture()["score"])

    for measure in score.measures:
        assert not measure.slurs, f"measure {measure.measure_number} has a slur"
