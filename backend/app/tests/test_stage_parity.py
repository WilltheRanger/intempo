"""The stage names the worker says, and the stage names the app draws.

`transcription_runner._human_stage` produces the words that go in
`scores.transcription_stage`. `mobile/src/components/score/TranscribingPanel.tsx`
looks each one up in `STAGE_PROGRESS` to decide where the bar sits. The
component's own docstring calls those words "the contract between
`transcription_runner.py` and this screen" — and nothing held them to it.

They had drifted both ways:

- The worker says **"Checking the bar counts"**; the map said "Checking the
  reading". So the one stage that fires late in every read with a doubtful bar
  in it was unrecognised, and an unrecognised stage fell through to
  `QUEUED_PROGRESS` — it did not merely fail to advance the bar, it threw it
  back to 5% partway through, which reads as the scan restarting.
- The map had **"Finding the staves"**, which nothing had emitted since the
  Audiveris engine was removed (DECISIONS.md, 2026-08-25).

This file is the thing that was missing. It parses the map out of the TSX
rather than duplicating it, for the same reason `test_meter_parity.py` parses
`reading.ts`: a second copy of the answer is the failure being tested for.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.services.ocr.pipeline import STAGE_CONFIRMING, STAGE_READING, STAGE_SPLITTING
from app.workers.transcription_runner import (
    STAGE_FETCHING,
    STAGE_READING_HUMAN,
    _human_stage,
)

#: The app's side of the contract. It moved out of `TranscribingPanel.tsx` so
#: the hold-on-unknown rule could be tested — there is no way to render a React
#: Native component in that test setup, and the rule was four lines inside the
#: component with one of them wrong.
PANEL = (
    Path(__file__).resolve().parents[3]
    / "mobile" / "src" / "lib" / "transcriptionProgress.ts"
)


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


#: Every stage the pipeline can report, in the order it reaches them, paired
#: with the words the worker turns each into. `STAGE_READING` carries a suffix
#: in practice (`reading:claude-sonnet-4-6`, `reading:system 3 of 7`); the
#: suffix is deliberately not shown to anyone, so both forms are checked.
WORKER_WORDS = [
    STAGE_FETCHING,
    _human_stage(STAGE_SPLITTING),
    _human_stage(f"{STAGE_READING}:claude-sonnet-4-6"),
    _human_stage(f"{STAGE_READING}:system 3 of 7"),
    _human_stage(STAGE_CONFIRMING),
]


def test_every_word_the_worker_says_is_a_word_the_app_can_place() -> None:
    """The failure this file exists for. A stage the app cannot place is not a
    stage that quietly does nothing — the bar moves to wherever the fallback
    is, and the musician sees a read that appears to have started over."""
    placed = _panel_stages()
    missing = [word for word in WORKER_WORDS if word not in placed]
    assert not missing, (
        f"the worker reports {missing} and the panel has no position for it; "
        f"the panel knows {sorted(placed)}"
    )


def test_the_app_has_no_position_for_a_stage_nothing_reports() -> None:
    """The other direction, and it is not tidiness.

    "Finding the staves" sat in the map for weeks after the engine that
    reported it was removed. A dead key is indistinguishable from a live one by
    reading either file, so the next person to wire a stage up has no way to
    know which words are real — and the two that had drifted apart were exactly
    the ones nobody could check.
    """
    placed = _panel_stages()
    unreachable = [word for word in placed if word not in WORKER_WORDS]
    assert not unreachable, (
        f"the panel has positions for {unreachable}, which nothing reports"
    )


def test_the_bar_never_walks_backwards() -> None:
    """The stages are listed in the order the worker reaches them, so their
    positions have to increase. "Checking the bar counts" sat at 0.6 under
    "Reading the notation"'s 0.7 — so even once the key matched, reaching the
    later step would have moved the bar back."""
    placed = _panel_stages()
    positions = [placed[word] for word in WORKER_WORDS if word in placed]
    assert positions == sorted(positions), (
        f"positions {positions} for stages {WORKER_WORDS} are out of order"
    )
    assert 0 < positions[0] and positions[-1] <= 1.0


def test_reading_a_system_at_a_time_says_the_same_thing_as_reading_a_page() -> None:
    """Per-system reading multiplied the number of stage reports by the number
    of systems, and every one of them has to land on the same position — a bar
    that stepped per line would be reporting a fraction nobody measures, since
    the systems are not the same size and the count is not known to the app."""
    assert _human_stage(f"{STAGE_READING}:system 1 of 9") == STAGE_READING_HUMAN
    assert _human_stage(f"{STAGE_READING}:gemini-2.5-flash") == STAGE_READING_HUMAN
