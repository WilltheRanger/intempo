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

**What the fixture deliberately leaves out**, because these are decisions
rather than arithmetic and each side has its reason written down:

- **Repeats.** The server writes them out, because the musician plays them
  twice. Playback plays straight through, because a preview that doubles in
  length is more surprising than useful.
- **Slurs.** The server emits no onset for a note under a bow stroke, because
  there is no attack to detect. Playback sounds it, because you want to hear
  the note.

**What it deliberately includes**: a rest that advances the clock and sounds
nothing; a *real* tie across a barline, which folds into one onset; a **fake**
tie between two different pitches, which is a slur written badly and must still
sound twice; triplets, whose thirds are not exactly representable; and a dotted
value.
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

    assert len(fixture["expected_onsets_s"]) == len(notes) - len(rests) - len(real_ties)


def test_the_fixture_has_no_repeats_or_slurs() -> None:
    """The two walks differ on both, on purpose. A fixture that grew one would
    make this file fail for a reason that is not a defect, and the fix would be
    to weaken it."""
    score = ScoreJson.model_validate(_fixture()["score"])

    assert not score.repeats, "the fixture grew a repeat"
    for measure in score.measures:
        assert not measure.slurs, f"measure {measure.measure_number} has a slur"
