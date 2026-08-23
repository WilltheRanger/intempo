#!/usr/bin/env python3
"""The constants the browser tools share with the backend, rendered as JavaScript.

Both `validator-sandbox.template.html` and `scan-bench.template.html` carry a
port of `services/ocr/validate.py`. Porting the *logic* is deliberate — these
tools have to run from a `file://` URL with no server behind them — but the
numbers were copied by hand, and hand copies drift.

They did. When triplet durations were added to `score_schema.Duration`, four
separate beat tables had to learn about them: the schema's, `alignment.py`'s,
`validate.py`'s and the two templates'. Three were missed. `validate.py` scored
every triplet as **zero beats** and reported correct bars as short; the parity
test that exists to catch exactly this ran the template's own stale table
against cases that contained no triplets, and passed.

So the numbers are no longer copied. The template names a placeholder, the
build substitutes the backend's value into it, and `test_sandbox_parity.py`
renders through this same function before running the JavaScript — which means
a table that disagrees with the backend cannot be built or tested against.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _js_number(value: float) -> str:
    """A float as JavaScript reads it, at full precision.

    `repr` on 1/3 gives 0.3333333333333333, which JavaScript parses back to the
    same double. Round-tripping matters here: a truncated third would make the
    two implementations disagree by more than `TOLERANCE` on a long measure.
    """
    return repr(float(value))


def shared_js() -> dict[str, str]:
    """Placeholder → the JavaScript literal to substitute for it."""
    sys.path.insert(0, str(ROOT / "backend"))
    from app.services.ocr.validate import (
        DENSITY_MIN_NOTES,
        DENSITY_MULTIPLE,
        MIN_AGREEMENT,
        MIN_MEASURES_TO_INFER,
        TOLERANCE,
        TUPLET_NOTE,
    )
    from app.services.score_schema import DURATION_BEATS

    table = ",\n  ".join(
        f"{name}: {_js_number(beats)}" for name, beats in DURATION_BEATS.items()
    )
    return {
        "__DURATION_BEATS__": "{\n  " + table + ",\n}",
        "__TOLERANCE__": _js_number(TOLERANCE),
        "__MIN_AGREEMENT__": _js_number(MIN_AGREEMENT),
        "__MIN_MEASURES_TO_INFER__": str(int(MIN_MEASURES_TO_INFER)),
        "__DENSITY_MULTIPLE__": _js_number(DENSITY_MULTIPLE),
        "__DENSITY_MIN_NOTES__": str(int(DENSITY_MIN_NOTES)),
        "__TUPLET_NOTE__": json.dumps(TUPLET_NOTE),
    }


#: Placeholders every port of the validator needs. `__TUPLET_NOTE__` is not
#: here because only the sandbox reproduces the retry prompt; the bench asks
#: its own, shorter question.
REQUIRED = (
    "__DURATION_BEATS__",
    "__TOLERANCE__",
    "__MIN_AGREEMENT__",
    "__MIN_MEASURES_TO_INFER__",
    "__DENSITY_MULTIPLE__",
    "__DENSITY_MIN_NOTES__",
)


def render(html: str) -> str:
    """Substitute every shared constant the template names.

    Raises if a template has stopped naming one of `REQUIRED` — which is what a
    template looks like after someone has pasted the numbers back in by hand.
    """
    values = shared_js()
    for placeholder in REQUIRED:
        if placeholder not in html:
            raise KeyError(f"template has no {placeholder} placeholder")
    for placeholder, value in values.items():
        html = html.replace(placeholder, value)
    return html
