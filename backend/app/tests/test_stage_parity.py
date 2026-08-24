"""The stage names the worker says, and the stage names the app draws.

`transcription_runner._human_stage` produces the words that go in
`scores.transcription_stage`. `mobile/src/lib/transcriptionProgress.ts` places
each one on the bar. The component's docstring has always called those words
"the contract between `transcription_runner.py` and this screen" — and nothing
held them to it.

They had drifted both ways:

- The worker says **"Checking the bar counts"**; the map said "Checking the
  reading". So the one stage that fires late in every read with a doubtful bar
  in it was unrecognised, and an unrecognised stage fell through to
  `QUEUED_PROGRESS` — it did not merely fail to advance the bar, it threw it
  back to 5% partway through, which reads as the scan restarting.
- The map had **"Finding the staves"**, which nothing had emitted since the
  Audiveris engine was removed (DECISIONS.md, 2026-08-25).

`fixtures/stages/parity.json` is now the single statement of the contract. This
file holds the server to it and `transcriptionProgress.test.ts` holds the app —
and the app's positions are *parsed* out of the TypeScript rather than restated
here, because a third copy of the answer is the failure being tested for.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.services.ocr.pipeline import STAGE_CONFIRMING, STAGE_READING, STAGE_SPLITTING
from app.workers.transcription_runner import (
    STAGE_FETCHING,
    STAGE_READING_HUMAN,
    _human_stage,
)

REPO = Path(__file__).resolve().parents[3]
FIXTURE = REPO / "fixtures" / "stages" / "parity.json"
#: The app's side of the contract. It moved out of `TranscribingPanel.tsx` so
#: the hold-on-unknown rule could be tested — there is no way to render a React
#: Native component in that test setup, and the rule was four lines inside the
#: component with one of them wrong.
PANEL = REPO / "mobile" / "src" / "lib" / "transcriptionProgress.ts"


def _contract() -> dict:
    return json.loads(FIXTURE.read_text())


def _panel_stages() -> dict[str, float]:
    """`STAGE_PROGRESS` as the app declares it."""
    body = re.search(
        r"STAGE_PROGRESS: Record<string, number> = \{(.*?)\};",
        PANEL.read_text(),
        re.DOTALL,
    )
    assert body, f"STAGE_PROGRESS is no longer in {PANEL.name}"
    pairs = re.findall(r"'([^']+)':\s*([0-9.]+)", body.group(1))
    assert pairs, "STAGE_PROGRESS parsed as empty, so everything below is vacuous"
    return {name: float(value) for name, value in pairs}


def test_the_app_places_exactly_the_stages_the_fixture_names() -> None:
    """The failure this file exists for, in both directions at once.

    A stage the app cannot place is not a stage that quietly does nothing — the
    bar moves to wherever the fallback is. And a position for a stage nothing
    reports is indistinguishable, by reading either file, from a live one, so
    the next person to wire a stage up has no way to know which words are real.
    """
    assert _panel_stages() == _contract()["static"]


def test_the_worker_says_exactly_the_static_words_the_fixture_lists() -> None:
    """The server half. Every static position in the contract has to be
    something `_human_stage` can actually produce."""
    said = {
        STAGE_FETCHING,
        _human_stage(STAGE_SPLITTING),
        _human_stage(f"{STAGE_READING}:claude-sonnet-5"),
        _human_stage(STAGE_CONFIRMING),
    }
    assert said == set(_contract()["static"]), (
        f"the worker says {sorted(said)}; the contract lists "
        f"{sorted(_contract()['static'])}"
    )


def test_a_finished_stave_is_reported_with_its_count() -> None:
    """Real measured progress, and it is said out loud.

    A page is read one stave at a time, so a five-minute read reports seven
    times instead of once. Collapsing all of it to "Reading the notation" left
    a musician watching a still bar for minutes, which is the failure this
    reporting exists to prevent rather than a cosmetic shortfall. The worker
    knows it has finished 3 of 7; nothing estimates anything.
    """
    for case in _contract()["per_stave"]:
        assert _human_stage(case["pipeline_stage"]) == case["words"], case


def test_a_page_read_whole_never_names_the_engine_that_read_it() -> None:
    """The provider's name tells a musician nothing they can act on and quite a
    lot they did not ask about. It is in the log line, which is where the person
    debugging it looks."""
    for case in _contract()["whole_page"]:
        assert _human_stage(case["pipeline_stage"]) == case["words"], case
        assert case["words"] == STAGE_READING_HUMAN


def test_the_bar_never_walks_backwards() -> None:
    """The static stages are listed in the order the worker reaches them, so
    their positions have to increase. "Checking the bar counts" sat at 0.6 under
    "Reading the notation"'s 0.7 — so even once the key matched, reaching the
    later step would have moved the bar back."""
    contract = _contract()
    placed = _panel_stages()
    positions = [placed[word] for word in contract["_static_order"]]
    assert positions == sorted(positions), (
        f"positions {positions} for {contract['_static_order']} are out of order"
    )
    assert contract["queued_progress"] < positions[0]
    assert positions[-1] <= 1.0


def test_reading_a_stave_ends_where_reading_a_whole_page_sits() -> None:
    """Why the reading band ends at 0.8 rather than below it.

    A page read stave by stave that then fails falls back to being read whole,
    so "Reading the notation" arrives *after* "Reading stave 7 of 7". If the
    band ended lower the bar would retreat on a page that is still working —
    and falling back is exactly when a musician is most likely to be watching.
    """
    contract = _contract()
    start, end = contract["_reading_band"]
    placed = _panel_stages()
    assert start == placed["Finding the staves"]
    assert end == placed["Reading the notation"]
    assert start < end < placed["Checking the bar counts"]


def test_the_fixture_covers_the_counts_that_actually_occur() -> None:
    """A single stave, a full page, and the ceiling. `_MAX_SYSTEMS_TO_READ` is
    16, so `16 of 16` is the widest count the worker can emit; a fixture that
    only held `3 of 7` would say nothing about either end."""
    from app.services.ocr.pipeline import _MAX_SYSTEMS_TO_READ

    totals = {
        int(case["pipeline_stage"].rsplit(" ", 1)[1])
        for case in _contract()["per_stave"]
    }
    assert 1 in totals, "a page with one stave on it is the common case here"
    assert _MAX_SYSTEMS_TO_READ in totals, (
        f"the ceiling is {_MAX_SYSTEMS_TO_READ} and the fixture stops short of it"
    )
