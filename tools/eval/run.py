#!/usr/bin/env python3
"""Run the evaluation harness and write its report.

    tools/eval/run.py                  # synthetic takes only — always available
    tools/eval/run.py --urmp           # + URMP, if tools/eval/fetch_urmp.py has
                                        # populated intempo-eval-data/urmp/
    tools/eval/run.py --out DIR        # default: tools/eval/.report/

See `README.md` for what each dataset needs and `harness.py`/`report.py` for
what gets measured. This is the tool JERA-563 asks to be run on main to
produce the reference BASELINE numbers; re-run it the same way after any
grading change and diff the two `report.json`s.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

_EVAL = Path(__file__).resolve().parent
if str(_EVAL) not in sys.path:
    sys.path.insert(0, str(_EVAL))

from datasets.synthetic import SyntheticDataset
from harness import run_datasets
from report import write_report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--urmp", action="store_true", help="also load the URMP dataset, if present"
    )
    parser.add_argument(
        "--out", type=Path, default=_EVAL / ".report", help="directory for report.json/report.md"
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING)

    datasets = [SyntheticDataset()]
    if args.urmp:
        from datasets.urmp import UrmpDataset

        datasets.append(UrmpDataset())

    results = run_datasets(datasets)
    if not results:
        print("eval: no takes were scored — nothing to report", file=sys.stderr)
        return 1

    json_path, md_path = write_report(results, args.out)
    print(f"eval: wrote {json_path} and {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
