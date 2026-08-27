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


def _score(
    measures: list[list[str]],
    time_signature: str | None,
    tuplets: dict[int, list[dict]] | None = None,
    meters: dict[int, str] | None = None,
) -> dict:
    """`meters` states a *change* of time signature at those measure indices."""
    tuplets = tuplets or {}
    meters = meters or {}
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
                    # A "!" suffix on a duration writes a tie into the next
                    # note, so the cases can cover ties without a second helper.
                    # An "@" prefix makes it a rest — without which no case
                    # could hold a bar of rest, and the density rule that
                    # excludes them from the median would be unported and
                    # unnoticed, which is exactly what happened.
                    {
                        "pitch": (
                            "rest"
                            if d.startswith("@")
                            else ("A4" if not d.startswith("~") else "G4")
                        ),
                        "duration": d.strip("~!@"),
                        "tied_to_next": d.endswith("!"),
                    }
                    for d in durations
                ],
                "slurs": [],
                "tuplets": tuplets.get(i, []),
                "time_signature": meters.get(i),
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
    # Inference is two tests now, and both ports have to make both of them.
    #
    # A clear winner among scattered singletons: eight bars at 4.0 against
    # seven different wrong answers. The old share-of-everything test read 0.53
    # and switched the beat check off for the whole page. Shaped after
    # `audiveris_phone_photo`, which is a real phone photograph.
    #
    # Seven *different* wrong answers, not four: with fewer the winner still
    # clears 0.6 of every vote and the old rule agrees, so the case proves
    # nothing. Measured — a mutation reverting either port survived until the
    # noise was this wide. 8 of 15 is 0.53.
    _score(
        [Q] * 8
        + [["quarter"] * n for n in (3, 5, 6, 7, 9, 10, 11)],
        "unknown",
    ),
    # A genuine tie, which must still refuse: 4,4,4,3,3,3 is a transcription
    # nobody should be confident about, and manufacturing a metre from it would
    # call three correct bars errors.
    _score([Q] * 3 + [["quarter"] * 3] * 3, "unknown"),
    # And the coverage floor: three agreeing bars in fifteen of noise. Decisive
    # against any single rival, and still not a metre.
    _score([Q] * 3 + [["quarter"] * n for n in range(5, 17)], "unknown"),
    # Bars of rest must not vote on the median density. Without these two, both
    # ports carried the old filter and every parity test still passed — a rule
    # changed in `validate.py` and ported nowhere, which is the failure
    # `CLAUDE.md` says this file exists to prevent.
    #
    # Quiet: eight eighths is ordinary music on a page that is mostly resting.
    _score(
        [Q, Q] + [["@whole"]] * 8 + [["eighth"] * 8],
        "4/4",
    ),
    # Loud: sixteen sixteenths on the same resting page is the tremolo this
    # check exists for, and both sides must still catch it.
    _score(
        [Q, Q] + [["@whole"]] * 8 + [["sixteenth"] * 16],
        "4/4",
    ),
    # And the distinction between "a bar of nothing but rests" and "a bar with
    # a rest in it". These bars are music and must keep voting; if a port used
    # `some` instead of `every`, the tremolo would become the only voter and be
    # measured against itself, and both sides would go quiet on the one bar
    # that is wrong.
    _score(
        [["quarter", "@quarter", "quarter", "quarter"]] * 6
        + [["sixteenth"] * 16],
        "4/4",
    ),
    _score([Q, Q, Q, ["quarter"] * 3, ["quarter"] * 3, ["quarter"] * 3], "unknown"),  # 50/50
    _score([["dotted_quarter", "eighth", "sixteenth", "sixteenth", "eighth", "quarter"]], "4/4"),
    _score([["dotted_half"], ["dotted_half"], ["dotted_half"]], "6/8"),
    _score([], "4/4"),
    # Ties. The parity suite had none, so the JS port could have gone
    # tie-blind without anything noticing — which is how the beat tables
    # drifted. A tie between two pitches ("~" marks the second note as G4)
    # sums perfectly and must still be a problem in both implementations.
    _score([["quarter!", "quarter", "quarter", "quarter"]], "4/4"),
    _score([["quarter!", "~quarter", "quarter", "quarter"]], "4/4"),
    _score([["quarter", "quarter", "quarter", "quarter!"], Q], "4/4"),
    _score([["quarter", "quarter", "quarter", "quarter!"], ["~quarter", "quarter", "quarter", "quarter"]], "4/4"),
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
    # Meter changes. A score carries one header time signature and the
    # repertoire does not honour that — four bars of 3/4 after four of 4/4 had
    # every 3/4 bar called "short" on a page written and read correctly. The
    # port had to learn the same rule, and without a case here it could have
    # gone on reading the header for the whole piece and nothing would notice.
    _score([Q, Q, ["quarter"] * 3, ["quarter"] * 3], "4/4", meters={2: "3/4"}),
    # The change is real, and a genuinely short bar *after* it must still show.
    _score([Q, ["quarter"] * 3, ["quarter"] * 2], "4/4", meters={1: "3/4"}),
    # Back again, which is how a piece that borrows a bar of 3/4 is printed.
    _score([Q, ["quarter"] * 3, Q], "4/4", meters={1: "3/4", 2: "4/4"}),
    # A change into a compound meter: 6/8 is three quarter-beats, not six.
    _score([Q, ["dotted_half"], ["dotted_half"]], "4/4", meters={1: "6/8"}),
    # An illegible change invalidates the meter that was running rather than
    # continuing it — the bars after it are unverifiable, not wrong.
    _score([Q, ["quarter"] * 3, ["quarter"] * 5], "4/4", meters={1: "unknown"}),
    # Brackets. A 5:4 approximated as triplets sums to exactly 4.0 and must be
    # a problem in all three implementations.
    _score(
        [["triplet_eighth"] * 3 + ["quarter"] * 3],
        "4/4",
        {0: [{"start_note_index": 0, "end_note_index": 2, "actual_notes": 3, "normal_notes": 2}]},
    ),
    _score(
        [["triplet_eighth"] * 3 + ["quarter"] * 3],
        "4/4",
        {0: [{"start_note_index": 0, "end_note_index": 2, "actual_notes": 5, "normal_notes": 4}]},
    ),
    _score(
        [["triplet_eighth"] * 2 + ["quarter"] * 3],
        "4/4",
        {0: [{"start_note_index": 0, "end_note_index": 1, "actual_notes": 3, "normal_notes": 2}]},
    ),
    # A duplet: two in the time of three, ordinary in any compound metre and
    # worth a dotted value each. Both sides used to call this `unwritable`,
    # because 3:2 was hard-coded as the only ratio that could be written.
    _score(
        [["dotted_eighth"] * 4],
        "6/8",
        {0: [{"start_note_index": 0, "end_note_index": 1, "actual_notes": 2, "normal_notes": 3}]},
    ),
    # A quadruplet: four in the time of three, and a dotted sixteenth each.
    _score(
        [["dotted_sixteenth"] * 8],
        "6/8",
        {0: [{"start_note_index": 0, "end_note_index": 3, "actual_notes": 4, "normal_notes": 3}]},
    ),
    # A 3:2 bracket whose notes are still plain eighths — the case the general
    # rule must not stop catching. 3:2 turns written values into lengths no
    # notehead writes, so a plain eighth inside one is the bracket having been
    # read and its arithmetic not applied.
    _score(
        [["eighth"] * 3 + ["quarter"] * 2],
        "4/4",
        {0: [{"start_note_index": 0, "end_note_index": 2, "actual_notes": 3, "normal_notes": 2}]},
    ),
    # Density: a page of quarters with one bar of thirty-seconds that still
    # sums to 4.0.
    _score([Q, Q, ["thirty_second"] * 32, Q], "4/4"),
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
const fn = new Function(html.slice(from, to) + '; return { repeatedRuns, numberingGaps, validateMeasures };')();
console.log(JSON.stringify(cases.map((c) => ({
  repeats: fn.repeatedRuns(c), gaps: fn.numberingGaps(c),
  findings: fn.validateMeasures(c) }))));
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

        # The bench has its own `validateMeasures`, and only repeats and gaps
        # were ever compared — so it had already drifted out of step with the
        # backend on ties, brackets and density without anything noticing.
        py_flags = [(f.measure_number, f.verdict, f.is_problem) for f in validate_measures(score)]
        js_flags = [(f["measure_number"], f["verdict"], f["is_problem"]) for f in js["findings"]]
        assert py_flags == js_flags, f"bench findings differ for {label}"


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
