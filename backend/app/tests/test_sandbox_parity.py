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
import sys
import tempfile
from pathlib import Path

import pytest

from app.services.ocr.validate import numbering_gaps, repeated_runs, validate_measures
from app.services.score_schema import DURATION_BEATS, ScoreJson

TOOLS = Path(__file__).resolve().parents[3] / "tools"
SANDBOX = TOOLS / "validator-sandbox.template.html"
BENCH = TOOLS / "scan-bench.template.html"

sys.path.insert(0, str(TOOLS))
from sandbox_shared import REQUIRED, render  # noqa: E402


def _rendered(template: Path) -> str:
    """The template with the backend's constants substituted in.

    The parity test used to run the template's own hand-written beat table,
    which is why it kept passing while that table and the validator's disagreed
    about every triplet. Rendering first means the JavaScript under test holds
    the same numbers production does — the port's *logic* is what these cases
    are actually checking."""
    return render(template.read_text())


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
    # Triplets. The case the two implementations silently disagreed about:
    # one scored a triplet as zero beats and called a correct bar short. These
    # also pin the two languages to the same thirds — JavaScript and Python
    # both hold 1/3 as the same double, and `_js_number` has to keep it that
    # way when it writes the table out.
    _score([["triplet_eighth"] * 6 + ["half"]], "4/4"),
    _score([["triplet_quarter"] * 3, ["triplet_quarter"] * 3], "2/4"),
    _score([["triplet_half"] * 3, ["whole"]], "4/4"),
    _score([["triplet_sixteenth"] * 6, ["quarter"] * 3], "4/4"),
    # And a genuinely short bar made of triplets, so "tolerant" is not
    # mistaken for "always passes".
    _score([["triplet_eighth"] * 3], "4/4"),
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

#: The scan bench carries the same port plus the repetition check, which the
#: validator sandbox does not. Checked separately so both stay honest.
#:
#: The slice was `indexOf('const DURATION_BEATS')` to `indexOf('// --- Engraving')`
#: — a marker that does not appear in the template, so `indexOf` returned -1,
#: the slice ran to the end of the *file* and node choked on the `</script>`.
#: The runner was never called, so nothing ever reported that. One contiguous
#: slice now, ending at a marker the template actually has.
BENCH_RUNNER = """
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const from = html.indexOf('const DURATION_BEATS');
const to = html.indexOf('// --- providers');
if (from < 0 || to < 0) throw new Error('bench markers moved: ' + from + '/' + to);
const cases = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const fn = new Function(html.slice(from, to) + '; return { repeatedRuns, numberingGaps };')();
console.log(JSON.stringify(cases.map((c) => ({
  repeats: fn.repeatedRuns(c), gaps: fn.numberingGaps(c) }))));
"""


def _run(runner_js: str, template: Path, cases: list) -> list:
    """Run one of the ported implementations over `cases` under node."""
    with tempfile.TemporaryDirectory() as tmp:
        runner = Path(tmp) / "runner.js"
        runner.write_text(runner_js)
        page = Path(tmp) / template.name
        page.write_text(_rendered(template))
        payload = Path(tmp) / "cases.json"
        payload.write_text(json.dumps(cases))
        result = subprocess.run(
            ["node", str(runner), str(page), str(payload)],
            capture_output=True, text=True, timeout=60,
        )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_the_sandbox_agrees_with_the_validator() -> None:
    js_all = _run(RUNNER, SANDBOX, CASES)

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
def test_the_scan_bench_agrees_about_repeats_and_numbering() -> None:
    """The bench carries its own port of the two evidence checks.

    `BENCH_RUNNER` was written and then never called, so the bench's copy of
    `repeatedRuns` and `numberingGaps` was never once compared to the Python it
    claims to port. It is compared now.
    """
    js_all = _run(BENCH_RUNNER, BENCH, CASES)

    for case, js in zip(CASES, js_all, strict=True):
        score = ScoreJson.model_validate(case)
        label = f"{case['time_signature']} / {[len(m['notes']) for m in case['measures']]}"

        py_repeats = [(r.first_at, r.again_at, r.length) for r in repeated_runs(score)]
        js_repeats = [(r["first_at"], r["again_at"], r["length"]) for r in js["repeats"]]
        assert py_repeats == js_repeats, f"repeats differ for {label}"

        py_gaps = [(g.after, g.next) for g in numbering_gaps(score)]
        js_gaps = [(g["after"], g["next"]) for g in js["gaps"]]
        assert py_gaps == js_gaps, f"numbering gaps differ for {label}"


@pytest.mark.parametrize("template", [SANDBOX, BENCH], ids=["sandbox", "bench"])
def test_the_templates_still_name_every_shared_constant(template: Path) -> None:
    """A template is built by substitution. One with the numbers written into it
    has been edited by hand, and the hand copy is what drifts."""
    html = template.read_text()
    for placeholder in REQUIRED:
        assert placeholder in html, f"{template.name} no longer names {placeholder}"


def test_the_sandbox_template_still_carries_its_placeholder() -> None:
    """The fixtures are substituted too; baked-in ones go stale silently."""
    assert "__FIXTURES__" in SANDBOX.read_text()


def test_the_rendered_table_is_the_backend_table() -> None:
    """Not just present — the same numbers, read back out of the JavaScript.

    `_js_number` round-trips through `repr`; if it ever truncated a third, the
    two implementations would disagree by more than `TOLERANCE` on a long
    measure and every triplet bar would read as short in the sandbox only."""
    rendered = _rendered(SANDBOX)
    table = rendered[rendered.index("const DURATION_BEATS = {"):]
    table = table[table.index("{"):table.index("}") + 1]
    read_back = {
        k.strip(): float(v)
        for k, v in (
            line.split(":", 1) for line in table.strip("{}\n").split(",") if ":" in line
        )
    }
    assert read_back == DURATION_BEATS
