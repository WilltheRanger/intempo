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

# Started with the wrong interpreter, this dies on `import pydantic` before it
# reads a fixture. `backend_python` re-execs under `backend/.venv` so the
# command in the docstring above is one that works — see its own header.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend_python import use_backend_python  # noqa: E402

use_backend_python()

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))


def measure(path: Path) -> dict:
    from app.services.ocr.base import OCRProviderError
    from app.services.ocr.homr_provider import homr_provider
    from app.services.page_image import too_small_to_read

    # **Say when this page would never get here in production.**
    #
    # This bench calls the provider directly, so it skips the two gates the
    # worker applies first: `too_small_to_read`, and `prepare_for_model`, which
    # hands the reader a resized copy rather than the photograph.
    #
    # Both have misled me. `05_handwritten_messy` was written up in `EDIT_LOG`
    # as evidence about an engine's handwriting; it is 1200×72 with six pixels
    # between staff lines, and the size gate refuses it before any provider is
    # asked. A bench that shows a reader's opinion of a page no reader is ever
    # given is worse than one that shows nothing, because the number looks
    # exactly like every other number in the table.
    #
    # The reading is still taken — what the engine does with an unreadable page
    # is worth seeing — but it is labelled, and `tools/pipeline-check.py` is
    # the tool that answers what production would actually do.
    refused = too_small_to_read(path.read_bytes())

    started = time.perf_counter()
    hushed = io.StringIO()
    try:
        # homr narrates every staff to stdout; the table is the output here.
        with contextlib.redirect_stdout(hushed):
            response = homr_provider.parse(path.read_bytes(), mime_type="image/jpeg")
    except OCRProviderError as exc:
        return {"page": path.name, "failed": str(exc)[:60], "refused": refused}
    except Exception as exc:  # noqa: BLE001 — a bench reports, it does not raise
        return {
            "page": path.name,
            "failed": f"{type(exc).__name__}: {exc}"[:60],
            "refused": refused,
        }

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
        "refused": refused,
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
            if row.get("refused"):
                print(f"{'':<{width}}  ^ production refuses this page before any "
                      f"provider sees it")
            continue
        print(
            f"{row['page']:<{width}}  {row['measures']:>4} {row['notes']:>5} "
            f"{row['confidence']:>5.2f} {str(row['clef']):>6}  {row['seconds']:>4}"
            f"  {_mix(row['durations'])}"
        )
        if row.get("refused"):
            print(f"{'':<{width}}  ^ production refuses this page before any "
                  f"provider sees it — this row is not evidence about a reader")

    read = [r for r in rows if "failed" not in r]
    if read:
        mean = sum(r["confidence"] for r in read) / len(read)
        print()
        print(f"read {len(read)}/{len(rows)} pages, mean confidence {mean:.2f}")
        worst = min(read, key=lambda r: r["confidence"])
        # Only when there is one. Naming a "worst page" that scored 1.00 is the
        # same kind of misleading as an unlabelled refused page: it reads as a
        # finding and is an artefact of `min` breaking a tie.
        if worst["confidence"] < 1.0:
            print(f"worst page: {worst['page']} at {worst['confidence']:.2f}")
        else:
            print("every page read completely")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
