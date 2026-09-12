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
    _HUMAN_STAGES,
    _reading_page,
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


def test_every_stage_the_worker_can_name_is_in_the_contract() -> None:
    """The direction the file above did not have.

    `test_the_worker_says_exactly_the_static_words_the_fixture_lists` builds
    its expected set from **four hand-written calls** to `_human_stage`. So a
    stage added to `_HUMAN_STAGES` changes nothing that test looks at, and
    **passes** — measured: adding one left all ten green, while the same stage
    added to the *fixture* failed two here and two in
    `transcriptionProgress.test.ts`. `CLAUDE.md` said the contract fails "in
    both directions"; it failed in three of four.

    The cost is not a crash. `lib/transcriptionProgress.ts` **holds** the bar
    on a stage it does not recognise — deliberately, because falling back once
    threw a read at 70% down to 5%. So a new pipeline stage with no fixture
    entry makes the bar stop moving for exactly as long as that stage takes,
    which is the promise of measured progress quietly weakening rather than
    breaking. Nothing would report it.

    Reads `_HUMAN_STAGES` itself, so a stage cannot be added without either an
    entry in the contract or a deliberate edit here.
    """
    contract = set(_contract()["static"])
    said = set(_HUMAN_STAGES.values())

    missing = sorted(said - contract)
    assert not missing, (
        f"the worker can say {missing}, which the contract does not list — add "
        f"them to fixtures/stages/parity.json and to STAGE_PROGRESS in "
        f"lib/transcriptionProgress.ts, or the bar stops moving for that stage"
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


def test_a_multi_page_scan_reports_the_page_it_is_on() -> None:
    """The words the app's `PAGE_COUNT` is keyed on.

    A multi-page read used to report "Reading the notation" for the whole of
    it — true from the first page to the last, and a bar that never moved
    across a wait N times longer than a single page's.
    """
    for case in _contract()["per_page"]:
        assert _reading_page(case["page"], case["total"]) == case["words"], case


def test_the_page_counter_is_never_used_for_a_single_page_scan() -> None:
    """A one-page scan keeps the per-stave counter, which is finer.

    The two counters must never both be live: page 2 opening at "Reading stave
    1 of 9" after page 1 finished at "9 of 9" walks the bar backwards. The
    worker guarantees it by reporting the page counter only when `single` is
    false and suppressing `report()` in the same branch — this holds the
    fixture to the same split so a contract that described both at once would
    fail here.
    """
    assert all(case["total"] > 1 for case in _contract()["per_page"]), (
        "the per_page contract must not describe a one-page scan; that is the "
        "per_stave counter's job and the two cannot both drive the bar"
    )


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


# ---------------------------------------------------------------------------
# A step is never reported after a later one has been
# ---------------------------------------------------------------------------


def test_the_fallback_cannot_walk_the_bar_backwards() -> None:
    """**The failure `transcriptionProgress.ts` exists to prevent, arriving
    from the server.**

    The app places the bar by the worker's words and does not clamp — a
    recognised stage moves it wherever its position says, including backwards.
    A page read whole at low confidence reports `reading` (0.8) and `rereading`
    (0.9); then `_read_page_whole` calls `parse_sheet_music` again for the rest
    of the chain, which begins by cutting the page into systems and reporting
    `splitting`, at **0.3**. Nine tenths to a third, mid-read, which reads as
    the scan having restarted.

    Dormant while the chain is `homr` alone, and one environment variable from
    being live — the registry keeps the vision providers so that variable
    works. Which is why this drives a real fallback rather than the ordering
    table: a first version of the fix left the recursive call carrying the raw
    callback, so the inner `parse_sheet_music` started the ordering again from
    nothing, and a test that never ran a fallback passed against it.
    """
    from app.services.ocr import pipeline
    from app.services.score_schema import Measure, Note, ScoreJson

    def _doubtful() -> ScoreJson:
        # Two bars, one of which does not add up: under the gate, so the rest
        # of the chain is asked as well.
        return ScoreJson(
            time_signature="4/4",
            clef="bass",
            measures=[
                Measure(
                    measure_number=1,
                    notes=[Note(pitch="D3", duration="quarter") for _ in range(4)],
                ),
                Measure(
                    measure_number=2,
                    notes=[Note(pitch="D3", duration="quarter")],
                ),
            ],
            ocr_confidence=0.5,
        )

    class _Engine:
        name = "engine"
        reads_whole_page = True

        def available(self):
            return True

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            from app.services.ocr.base import OCRResponse

            return OCRResponse(
                score=_doubtful(), raw_text="", model=self.name,
                input_tokens=0, output_tokens=0, cost_usd=0.0, latency_ms=1,
            )

    class _Model:
        name = "model"

        def available(self):
            return True

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            raise pipeline.OCRProviderError("model: nothing here")

    seen: list[str] = []
    try:
        pipeline.parse_sheet_music(
            b"x", providers=[_Engine(), _Model()], on_stage=seen.append
        )
    except Exception:  # the fallback fails; the reports are the subject
        pass

    ranks = [
        pipeline._STAGE_ORDER.get(name.split(":", 1)[0], -1) for name in seen
    ]
    known = [r for r in ranks if r >= 0]
    assert known == sorted(known), seen
    assert any(r == pipeline._STAGE_ORDER[pipeline.STAGE_READING] for r in known), (
        f"the engine never reported reading, so nothing was ordered: {seen}"
    )
