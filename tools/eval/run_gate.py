#!/usr/bin/env python3
"""The regression gate `tools/preflight.py` runs on every push.

Synthetic takes only — no network, no `intempo-eval-data/` dependency, so
this is always available and fast (the twelve scenarios in
`datasets/synthetic.py` run in well under a second of `analyze()` time).
URMP is deliberately not in this gate: a dataset that is not always present
cannot be a pass/fail condition for every push.

Compares the current run's overall metrics against `baseline/synthetic.json`
— the numbers `tools/eval/run.py` produced on main and this issue's
BASELINE comment recorded — and fails if any of them has dropped by more
than `[regression_gate]`'s tolerance in `eval_config.toml`. A metric that
*improves* never fails the gate; only regressions do.

    tools/eval/run_gate.py              # check against the committed baseline
    tools/eval/run_gate.py --update     # overwrite the baseline with this run
                                         # (only after a deliberate grading
                                         # change — log it in TUNING_LOG.md)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_EVAL = Path(__file__).resolve().parent
if str(_EVAL) not in sys.path:
    sys.path.insert(0, str(_EVAL))

from datasets.synthetic import SyntheticDataset
from harness import load_eval_config, run_datasets
from report import build_report

BASELINE_PATH = _EVAL / "baseline" / "synthetic.json"

#: `(report key, higher-is-better)`. Every metric the gate watches; anything
#: in `report.py`'s aggregate but not here is tracked in the full report,
#: not enforced on every push.
_GATED_METRICS: list[tuple[str, str]] = [
    ("onset_f1", "onset_f1_tolerance"),
    ("alignment_accuracy", "alignment_accuracy_tolerance"),
    ("verdict_agreement_rate", "verdict_agreement_tolerance"),
    ("false_rush_drag_rate", "false_positive_rate_tolerance"),
]


def current_overall() -> dict[str, float | None]:
    results = run_datasets([SyntheticDataset()], load_eval_config())
    return build_report(results)["overall"]


def check(current: dict[str, float | None], baseline: dict[str, float | None], config: dict) -> list[str]:
    tolerances = config["regression_gate"]
    failures = []
    for metric, tolerance_key in _GATED_METRICS:
        base = baseline.get(metric)
        now = current.get(metric)
        if base is None or now is None:
            continue
        tolerance = float(tolerances[tolerance_key])
        # `false_rush_drag_rate` is bad when *high* — lower is better — every
        # other gated metric here is the opposite, so the comparison flips.
        regressed = (
            (base - now > tolerance)
            if metric != "false_rush_drag_rate"
            else (now - base > tolerance)
        )
        if regressed:
            failures.append(
                f"{metric}: {base:.3f} -> {now:.3f} (tolerance {tolerance:.3f})"
            )
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update", action="store_true")
    args = parser.parse_args()

    config = load_eval_config()
    current = current_overall()

    if args.update:
        BASELINE_PATH.parent.mkdir(parents=True, exist_ok=True)
        BASELINE_PATH.write_text(json.dumps(current, indent=2, sort_keys=True))
        print(f"eval gate: wrote baseline to {BASELINE_PATH}")
        return 0

    if not BASELINE_PATH.exists():
        print(f"eval gate: no baseline at {BASELINE_PATH} — run with --update first", file=sys.stderr)
        return 2

    baseline = json.loads(BASELINE_PATH.read_text())
    failures = check(current, baseline, config)
    if failures:
        print("eval gate: regression beyond tolerance:", file=sys.stderr)
        for line in failures:
            print(f"  - {line}", file=sys.stderr)
        return 1

    print("eval gate: ok (no metric regressed beyond tolerance)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
