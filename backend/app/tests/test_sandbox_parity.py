"""The sandbox must agree with the validator it stands for.

`tools/validator-sandbox.template.html` carries a JavaScript port of
`services/ocr/validate.py` so the rules can be poked at in a browser with no
Python, no keys and no install. A port is a second copy, and a second copy
drifts — at which point the sandbox teaches people rules the pipeline does not
follow, which is worse than having no sandbox.

So both are run over the same cases and compared. Node is required; the test
skips rather than fails if it is missing, since a Python-only environment
should not be blocked by a browser tool.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from app.services.ocr.validate import validate_measures
from app.services.score_schema import ScoreJson

SANDBOX = Path(__file__).resolve().parents[3] / "tools" / "validator-sandbox.template.html"


def _score(measures: list[list[str]], time_signature: str | None) -> dict:
    return {
        "time_signature": time_signature,
        "key_signature": "C major",
        "tempo_marking": None,
        "bpm_hint": None,
        "clef": "treble",
        "measures": [
            {
                "measure_number": i + 1,
                "notes": [
                    {"pitch": "A4", "duration": d, "tied_to_next": False} for d in durations
                ],
                "slurs": [],
            }
            for i, durations in enumerate(measures)
        ],
        "repeats": [],
        "ocr_confidence": 0.9,
        "notes_to_human": "",
    }


Q = ["quarter"] * 4

#: Chosen to cover every branch either implementation can take, including the
#: ones where they must agree to stay *quiet*.
CASES = [
    _score([Q, Q, Q], "4/4"),
    _score([Q, ["quarter"] * 3, Q], "4/4"),                      # short
    _score([Q, ["quarter"] * 5], "4/4"),                          # long
    _score([["quarter"], Q, Q], "4/4"),                           # pickup
    _score([Q, [], Q], "4/4"),                                    # empty
    _score([Q, Q], "unknown"),                                    # too little to infer
    _score([["half"], ["half"], ["half"], ["half"]], "unknown"),  # inferred 2.0
    _score([Q, Q, ["quarter"] * 3, Q, Q], "unknown"),             # outlier vs inferred
    _score([["quarter"] * 3] * 4, "4/4"),                         # stated beats inferred
    _score([Q, Q, Q, ["quarter"] * 3, ["quarter"] * 3, ["quarter"] * 3], "unknown"),  # 50/50
    _score([["dotted_quarter", "eighth", "sixteenth", "sixteenth", "eighth", "quarter"]], "4/4"),
    _score([["dotted_half"], ["dotted_half"], ["dotted_half"]], "6/8"),
    _score([], "4/4"),
    # No malformed time signature here: `ScoreJson` validates it to N/N,
    # "unknown" or null, so one cannot reach `validate_measures` in production
    # and there is nothing for the two implementations to agree about. The
    # sandbox still has to cope, since a person can type anything into a
    # textarea — that is its own concern, tested by the page not throwing.
]

RUNNER = """
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
// Take the ported functions out of the page, without the DOM code below them.
const body = html.slice(html.indexOf('const DURATION_BEATS'), html.indexOf('// --- rendering'));
const cases = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const fn = new Function(body + '; return { validateMeasures, describeForRetry };')();
console.log(JSON.stringify(cases.map((c) => fn.validateMeasures(c))));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_the_sandbox_agrees_with_the_validator() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        runner = Path(tmp) / "runner.js"
        runner.write_text(RUNNER)
        cases = Path(tmp) / "cases.json"
        cases.write_text(json.dumps(CASES))
        result = subprocess.run(
            ["node", str(runner), str(SANDBOX), str(cases)],
            capture_output=True, text=True, timeout=60,
        )
    assert result.returncode == 0, result.stderr
    js_all = json.loads(result.stdout)

    for case, js in zip(CASES, js_all, strict=True):
        py = validate_measures(ScoreJson.model_validate(case))
        label = f"{case['time_signature']} / {[len(m['notes']) for m in case['measures']]}"
        assert len(py) == len(js), f"measure count differs for {label}"
        for p, j in zip(py, js, strict=True):
            assert p.verdict == j["verdict"], f"verdict differs for {label} m{p.measure_number}"
            assert p.expected_beats == j["expected_beats"], f"expected differs for {label}"
            assert abs(p.actual_beats - j["actual_beats"]) < 1e-9, f"actual differs for {label}"
            assert p.meter_inferred == j["meter_inferred"], f"inference differs for {label}"
            assert p.is_problem == j["is_problem"], f"is_problem differs for {label}"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_the_sandbox_template_still_carries_its_placeholder() -> None:
    """The template is built by substitution; a template with data baked in has
    been edited by hand and will go stale against the fixtures."""
    assert "__FIXTURES__" in SANDBOX.read_text()
