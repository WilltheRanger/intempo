#!/usr/bin/env python3
"""What the importer and the beat checks make of the MusicXML corpus.

    tools/musicxml-bench.py                       # the whole corpus
    tools/musicxml-bench.py path/to/page.musicxml

**The one bench that runs without Modal.** `homr-bench.py` and
`pipeline-check.py` both need homr, which is installed only in the transcription
container — so neither can be run while working on `musicxml.py` or
`validate.py`, which is where every measured accuracy win in this project has
actually come from: `_expand_multiple_rests` took `page-upright.jpg` from 0.70
to 0.86, and `_whole_rests_that_mean_a_bar` took it from 0.86 to 0.98 and the
corpus mean from 0.81 to 1.00. Both of those are pure XML-to-score reasoning
with no engine in the loop, and both were measured by hand.

`confidence` here is `confidence_from_arithmetic` — the share of bars that add
up, the same number `homr_provider` computes and stores as `ocr_confidence`. A
bar whose metre could not be established counts against it, deliberately: it has
not been *shown* to add up. See that function's docstring.

**Read the worst page, never the mean.** The corpus mean is flattered by
`orchestral_part.musicxml`, which is a clean engraving. The two phone
photographs are the pages that resemble what the app receives.
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Started with the wrong interpreter, this dies on `import pydantic` before it
# reads a fixture. `backend_python` re-execs under `backend/.venv` so the
# command in the docstring above is one that works — see its own header.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend_python import use_backend_python  # noqa: E402

use_backend_python()

sys.path.insert(0, str(ROOT / "backend"))

from app.services.ocr.homr_provider import confidence_from_arithmetic  # noqa: E402
from app.services.ocr.musicxml import score_json_from_musicxml  # noqa: E402
from app.services.ocr.validate import (  # noqa: E402
    describe_for_retry,
    problems,
    validate_measures,
)


def measure(path: Path) -> dict:
    xml = path.read_text()

    # **A multi-part file is a different kind of thing, not a failed page.**
    # This bench asks how well the importer reads a photographed part, and
    # scores each page's confidence into a mean. A publisher's multi-part file
    # is not that: the importer refuses it without a chosen part — correctly,
    # since handing a cellist the piccolo line is worse than a refusal — and it
    # appeared here as a red `MusicXMLError` row, which reads as a broken
    # fixture rather than a category this bench is not about.
    #
    # Reading its parts anyway would be worse than the confusing line: a
    # hand-authored duo scores 1.00 trivially, and averaging that into a bench
    # about photographs would flatter the number this exists to report.
    try:
        parts = len(list(ET.fromstring(xml).iterfind("part-list/score-part")))
    except ET.ParseError as exc:
        return {"page": path.name, "failed": f"not parseable as XML: {exc}"[:70]}
    if parts > 1:
        return {"page": path.name, "skipped": f"{parts} parts — not a single-part page"}

    try:
        score = score_json_from_musicxml(xml)
    except Exception as exc:  # noqa: BLE001 — a bench reports, it does not raise
        return {"page": path.name, "failed": f"{type(exc).__name__}: {exc}"[:70]}

    findings = validate_measures(score)
    return {
        "page": path.name,
        "bars": len(score.measures),
        "notes": sum(len(m.notes) for m in score.measures),
        "metre": score.time_signature or "—",
        "clef": score.clef or "—",
        "confidence": confidence_from_arithmetic(findings),
        "verdicts": Counter(f.verdict for f in findings),
        "problems": len(problems(score)),
        "retry": describe_for_retry(findings),
    }


def main(argv: list[str]) -> int:
    paths = [Path(a) for a in argv] or sorted(
        (ROOT / "fixtures" / "musicxml").glob("*.musicxml")
    )
    if not paths:
        print("no MusicXML to read", file=sys.stderr)
        return 1

    rows = [measure(p) for p in paths]

    print(f"{'page':<34} {'bars':>5} {'notes':>6} {'metre':>6} {'conf':>6}  verdicts")
    scored = []
    for row in rows:
        if "failed" in row:
            print(f"{row['page']:<34} {row['failed']}")
            continue
        if "skipped" in row:
            print(f"{row['page']:<34} — {row['skipped']}")
            continue
        scored.append(row["confidence"])
        counts = ", ".join(f"{v} {k}" for k, v in sorted(row["verdicts"].items()))
        print(
            f"{row['page']:<34} {row['bars']:>5} {row['notes']:>6} "
            f"{row['metre']:>6} {row['confidence']:>6.2f}  {counts}"
        )

    if scored:
        # The worst page, printed as loudly as the mean, because the mean is
        # what let a reader that scored 0% on real repertoire look adequate.
        print(
            f"\nmean {sum(scored) / len(scored):.2f}   worst {min(scored):.2f}   "
            f"pages {len(scored)}"
        )

    for row in rows:
        if "failed" not in row and "skipped" not in row and row["retry"]:
            print(f"\n{row['page']}: {row['retry']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
