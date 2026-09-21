"""The legs the analysis runner writes, and the legs the app draws.

`analysis_runner.STAGES` names them; `mobile/src/lib/analysis/waitProgress.ts`
places each on the bar. `fixtures/stages/analysis.json` is the single statement
of that contract — this file holds the runner to it, and
`waitProgress.test.ts` holds the app.

**Written at the same time as the thing it guards, because the sibling
contract was not.** `test_stage_parity.py` exists because the transcription
stages drifted twice while a docstring called them a contract and nothing
enforced one, and an unrecognised stage threw that bar from 70% back to 5%
mid-read. The failure mode here is quieter and worse: a leg added to the runner
and forgotten in the app shows the *generic* line for the longest part of a
two-and-a-half minute wait, which is precisely the defect the bar was added to
fix, and it would look like the bar simply not working.

The runner's own values are read out of `STAGES` rather than restated here — a
third copy of the answer is the failure being tested for.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.workers.analysis_runner import STAGES

CONTRACT = json.loads(
    (
        Path(__file__).resolve().parents[3] / "fixtures" / "stages" / "analysis.json"
    ).read_text()
)


def test_the_runner_writes_exactly_the_legs_the_contract_names() -> None:
    assert list(STAGES) == CONTRACT["stages"]


def test_the_runner_writes_them_in_the_contract_order() -> None:
    """Order is the pipeline order, and the bar depends on it.

    The app's positions rise monotonically through this list, so a runner that
    reported them out of order would walk the bar backwards — which reads as
    the analysis restarting, the same misreading `test_stage_parity.py`
    records for the transcription bar.
    """
    positions = [CONTRACT["through"][stage] for stage in STAGES]
    assert positions == sorted(positions)
    assert all(0.0 < p < 1.0 for p in positions), (
        "a leg at 0 or 1 claims the run has not started or has finished, "
        "and `status` is the only thing entitled to say either"
    )


def test_every_leg_the_runner_can_write_has_a_place_on_the_bar() -> None:
    """Every `_stage()` call site, not just the ones in `STAGES`.

    `STAGES` is a tuple a reader can edit without touching the calls, and the
    calls are what actually reach the database. Parsing them keeps the two in
    step with each other as well as with the app.
    """
    source = (
        Path(__file__).resolve().parents[1] / "workers" / "analysis_runner.py"
    ).read_text()
    written = set(re.findall(r'_stage\(client, analysis_id, "([a-z_]+)"\)', source))
    # `STAGES[0]` is written by the status update rather than through `_stage`.
    assert written <= set(STAGES), (
        f"{sorted(written - set(STAGES))} reach the database but are not in "
        "STAGES, so the app has no place for them on the bar"
    )
