#!/usr/bin/env python3
"""What homr actually reads, page by page, as a table.

Run it before and after any change to the reader. `ocr_confidence` here is the
share of bars whose durations add up — computed by `homr_provider`, not by
homr — so it is the number that moves when a page is read better.

    tools/homr-bench.py fixtures/scores/*.jpg other/page.jpg

homr is installed only in the Modal container, so this needs a virtualenv with
it. See EDIT_LOG 2026-08-26 for the one used to find the `ProcessingConfig`
bug; the short version is `uv pip install homr==0.7.0` plus the backend's own
dependencies.
"""

from __future__ import annotations

import contextlib
import io
from collections import Counter
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))


def measure(path: Path) -> dict:
    from app.services.ocr.base import OCRProviderError
    from app.services.ocr.homr_provider import homr_provider

    started = time.perf_counter()
    hushed = io.StringIO()
    try:
        # homr narrates every staff to stdout; the table is the output here.
        with contextlib.redirect_stdout(hushed):
            response = homr_provider.parse(path.read_bytes(), mime_type="image/jpeg")
    except OCRProviderError as exc:
        return {"page": path.name, "failed": str(exc)[:60]}
    except Exception as exc:  # noqa: BLE001 — a bench reports, it does not raise
        return {"page": path.name, "failed": f"{type(exc).__name__}: {exc}"[:60]}

    score = response.score
    measures = score.measures or []
    notes = sum(len(m.notes or []) for m in measures)
    return {
        "page": path.name,
        "measures": len(measures),
        "notes": notes,
        "confidence": score.ocr_confidence,
        "clef": score.clef,
        "seconds": round(time.perf_counter() - started, 1),
        # **The failure the beat check cannot see.** A bar of four quarters
        # adds up in 4/4 whether or not the page shows eight eighths, so
        # confidence says nothing about whether the rhythms are right — and
        # `alignment.py` accumulates durations, so a reading that quantised a
        # page would tell a musician they rushed every passage written short.
        #
        # Two fixtures make this checkable by hand, because `SOURCES.md`
        # documents what is printed on them: `01_simple_printed` is Wohlfahrt
        # No. 1, continuous eighths, and `03_complex_printed` is Kreutzer
        # No. 2, continuous sixteenths. If either comes back as anything else,
        # something upstream is rounding.
        "durations": dict(
            Counter(
                n.duration for m in measures for n in (m.notes or [])
            ).most_common()
        ),
    }


#: Shortest first, because the short values are the ones a rounding failure
#: eats — a quantised page loses its sixteenths, never its wholes.
_ORDER = ("thirty_second", "sixteenth", "eighth", "quarter", "half", "whole")


def _mix(durations: dict) -> str:
    known = [f"{n}x{durations[n]}" for n in _ORDER if durations.get(n)]
    rest = [f"{k}x{v}" for k, v in durations.items() if k not in _ORDER]
    return " ".join(known + rest) or "-"


def main(argv: list[str]) -> int:
    pages = [Path(a) for a in argv[1:]]
    if not pages:
        print(__doc__)
        return 2

    rows = [measure(p) for p in pages]
    width = max(len(r["page"]) for r in rows)
    print(
        f"{'page':<{width}}  {'meas':>4} {'notes':>5} {'conf':>5} {'clef':>6}  "
        f"{'s':>4}  durations"
    )
    for row in rows:
        if "failed" in row:
            print(f"{row['page']:<{width}}  FAILED: {row['failed']}")
            continue
        print(
            f"{row['page']:<{width}}  {row['measures']:>4} {row['notes']:>5} "
            f"{row['confidence']:>5.2f} {str(row['clef']):>6}  {row['seconds']:>4}"
            f"  {_mix(row['durations'])}"
        )

    read = [r for r in rows if "failed" not in r]
    if read:
        mean = sum(r["confidence"] for r in read) / len(read)
        print()
        print(f"read {len(read)}/{len(rows)} pages, mean confidence {mean:.2f}")
        print(f"worst page: {min(read, key=lambda r: r['confidence'])['page']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
