"""The meter table both sides read, and the tolerance both sides use.

`ocr/meter.quarter_beats` and `mobile/src/lib/notation/reading.ts`
answer the same question — how many quarter-note beats a bar should hold — and
the app keeps its own copy so a musician editing a measure sees the count move
as they type, without a round trip.

They disagreed on one case when this was written: `" 4 / 4 "`. The server takes
it, because `int(" 4 ")` strips whitespace; the app's regex did not. A meter
that OCR happened to read with spaces therefore switched the app's beat check
off while the server went on reporting the same bars as short — the app
disagreeing with itself in front of the person trying to fix the bar. Found by
running both over the same list, not by reading either.

This file holds the server to the fixture. `meters.parity.test.ts` holds the
app to it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.services.ocr.meter import quarter_beats
from app.services.ocr.validate import TOLERANCE

REPO = Path(__file__).resolve().parents[3]
FIXTURE = REPO / "fixtures" / "meters" / "parity.json"
READING_TS = REPO / "mobile" / "src" / "lib" / "notation" / "reading.ts"


def _cases() -> dict[str, float | None]:
    return json.loads(FIXTURE.read_text())["cases"]


def test_the_server_still_answers_what_the_fixture_says() -> None:
    cases = _cases()
    assert len(cases) > 30, "the fixture shrank; the app's side is checking less than it thinks"

    for written, expected in cases.items():
        got = quarter_beats(None if written == "__null__" else written)
        assert got == expected, f"{written!r}: now {got}, fixture says {expected}"


def test_the_fixture_covers_the_shapes_that_actually_break() -> None:
    """A fixture of well-formed meters would agree trivially and prove nothing.

    Every disagreement between two parsers of the same string lives in the
    malformed cases, and the one real divergence found here was whitespace.
    """
    cases = _cases()

    assert any(v is not None and v != int(v) for v in cases.values()), "no compound meter"
    assert any(" " in k and "/" in k for k in cases), "no whitespace case"
    assert any(k.count("/") > 1 for k in cases), "no multi-slash case"
    assert any(re.fullmatch(r"\d+/0|0/\d+", k) for k in cases), "no zero case"
    assert "__null__" in cases, "no null case"
    assert "unknown" in cases, "no 'unknown', which the OCR prompt authorises"


def test_the_app_uses_the_same_tolerance() -> None:
    """`BEAT_TOLERANCE` says of itself that it matches this one, and it has to.

    The backend decides which bars are worth re-reading; the app decides which
    bars it offers to fix. A musician told "bar 7 doesn't add up" with no way to
    open bar 7 is the app disagreeing with itself in front of them.
    """
    source = READING_TS.read_text()
    match = re.search(r"export const BEAT_TOLERANCE\s*=\s*([0-9.eE+-]+)", source)

    assert match, "the app no longer names a beat tolerance"
    assert float(match.group(1)) == TOLERANCE
