#!/usr/bin/env python3
"""Build the beat-sum validator sandbox into a single openable HTML file.

    cd backend && uv run python ../tools/build-validator-sandbox.py

Writes `tools/validator-sandbox.html`, which needs no server, no API keys and
no install — open it in a browser. It carries the cached OCR responses from
`fixtures/ocr_responses/` so the rules can be tried against real transcriptions
rather than invented ones, and the JSON is editable so a measure can be broken
by hand to see what the pipeline would do about it.

The generated file is gitignored. The template beside it is the source, and
`app/tests/test_sandbox_parity.py` fails the build if the JavaScript in it ever
stops agreeing with `services/ocr/validate.py`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# Started with the wrong interpreter, this dies on `import pydantic` before it
# reads a fixture. `backend_python` re-execs under `backend/.venv`, so the
# command in the docstring above works and so does a plain `tools/x.py`.
from backend_python import use_backend_python  # noqa: E402
from sandbox_shared import render  # noqa: E402

use_backend_python()

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "tools" / "validator-sandbox.template.html"
OUTPUT = ROOT / "tools" / "validator-sandbox.html"
FIXTURES = ROOT / "fixtures" / "ocr_responses"


def main() -> int:
    if not TEMPLATE.exists():
        print(f"missing template: {TEMPLATE}", file=sys.stderr)
        return 1

    cases = []
    for path in sorted(FIXTURES.glob("*.json")):
        payload = json.loads(path.read_text())
        response = payload.get("ocr_response", payload)
        cases.append(
            {
                "name": payload.get("fixture_filename", path.stem),
                "score": response.get("score", response),
            }
        )
    if not cases:
        print(f"no cached OCR responses in {FIXTURES}", file=sys.stderr)
        return 1

    html = TEMPLATE.read_text()
    if "__FIXTURES__" not in html:
        print("template has no __FIXTURES__ placeholder", file=sys.stderr)
        return 1

    # The beat table and the thresholds come out of the backend rather than
    # out of this file, so the sandbox cannot disagree with the validator it
    # stands for. See tools/sandbox_shared.py.
    try:
        html = render(html)
    except KeyError as exc:
        print(exc.args[0], file=sys.stderr)
        return 1

    OUTPUT.write_text(html.replace("__FIXTURES__", json.dumps(cases)))
    measures = sum(len(c["score"].get("measures", [])) for c in cases)
    print(
        f"{OUTPUT.relative_to(ROOT)}  —  {len(cases)} transcriptions, "
        f"{measures} measures, {OUTPUT.stat().st_size / 1024:.0f} KB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
