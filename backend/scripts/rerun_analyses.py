"""Run takes through the deployed analysis again, by id.

    python scripts/rerun_analyses.py <analysis-id> [<analysis-id> ...]

**Why this exists.** Every take the first real bass player recorded was refused
by an analysis that has since learned to hear it — the chain of notes, octaves,
holds, tuning, restarts, a bar skipped, half a page. A verdict is written once,
when the take arrives, so without this the takes stay refused forever: the
musician would have to play them all again to find out the app can now read
them.

**The deployed worker, not this checkout.** Each id goes to the `run_analysis`
function Modal is running (`dispatch.MODAL_FUNCTION_NAME` on `MODAL_APP_NAME`),
the same call the API makes for a new take, so a take is re-judged by exactly
the code that judges a new one. It reads the original WAV if it is still
there and the Opus playback copy if not — see `analysis_runner.run_analysis`.

**It overwrites the verdict.** The row's `result_json`, `status` and
`diagnostics` become the new analysis's. Run from `rerun-analyses.yml`, whose
run log keeps the ids and what each came back as.

One at a time, and waited on: a handful of takes at a few seconds each, and a
failure is then printed beside the take it belongs to.
"""

from __future__ import annotations

import os
import sys
import uuid

MODAL_APP_NAME = os.getenv("MODAL_APP_NAME", "intempo")
MODAL_FUNCTION_NAME = "run_analysis"


def _ids(argv: list[str]) -> list[str]:
    """Every argument, split on commas and whitespace, each a UUID."""
    ids = [part for arg in argv for part in arg.replace(",", " ").split()]
    for value in ids:
        uuid.UUID(value)  # raises on anything that is not an analysis id
    return ids


def main(argv: list[str]) -> int:
    ids = _ids(argv)
    if not ids:
        print(__doc__)
        return 2

    import modal

    fn = modal.Function.from_name(MODAL_APP_NAME, MODAL_FUNCTION_NAME)
    failed = 0
    for analysis_id in ids:
        try:
            fn.remote(analysis_id)
        except Exception as exc:  # noqa: BLE001 — report it and carry on
            failed += 1
            print(f"{analysis_id}  FAILED  {type(exc).__name__}: {exc}")
            continue
        print(f"{analysis_id}  re-analysed")
    print(f"{len(ids) - failed} of {len(ids)} re-analysed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
