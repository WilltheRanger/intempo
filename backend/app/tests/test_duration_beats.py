"""The one beat table, and the invariants that keep it one table.

Four separate copies of "how many beats is a dotted quarter" existed across
this repo: `score_schema`, `alignment`, `ocr/validate`, and the JavaScript in
two browser tools. There is a fifth — `mobile/src/lib/score/schedule.ts` — and
it went uncounted here until long after it was written; see the section at the
bottom of this file. Each carried a comment saying it was deliberately the same
as the others. When triplet durations were added, three of the four were
missed, and the failure was silent in the worst possible way — `validate.py`
defaulted an unrecognised duration to **zero beats** and reported correct bars
as short, while `alignment.py` defaulted to **one beat** and would have shifted
every onset after a triplet.

A comment is not an invariant. These are.
"""

from __future__ import annotations

import typing

import pytest

from app.services import alignment
from app.services.ocr import validate
from app.services.score_schema import DURATION_BEATS, Duration, Measure, Note, ScoreJson

DURATIONS = set(typing.get_args(Duration))


def test_the_table_covers_exactly_the_durations_the_schema_allows() -> None:
    """Add a duration to the Literal without adding it to the table and this
    fails here, rather than as a wrong tempo verdict weeks later."""
    assert set(DURATION_BEATS) == DURATIONS


def test_every_module_uses_the_same_table_object() -> None:
    """Not "equal" — the same object. Equal tables can be edited apart."""
    assert alignment._DURATION_BEATS is DURATION_BEATS
    assert validate.DURATION_BEATS is DURATION_BEATS


@pytest.mark.parametrize("duration", sorted(DURATIONS))
def test_no_duration_is_silently_worth_a_default(duration: str) -> None:
    assert alignment._beats(duration) == DURATION_BEATS[duration]


def test_an_unknown_duration_raises_rather_than_counting_as_a_quarter() -> None:
    with pytest.raises(KeyError, match="score_schema.DURATION_BEATS"):
        alignment._beats("hemidemisemiquaver")


def test_a_dot_adds_half_again() -> None:
    for plain, dotted in [
        ("whole", "dotted_whole"),
        ("half", "dotted_half"),
        ("quarter", "dotted_quarter"),
        ("eighth", "dotted_eighth"),
        ("sixteenth", "dotted_sixteenth"),
    ]:
        assert DURATION_BEATS[dotted] == DURATION_BEATS[plain] * 1.5


def test_three_triplets_fill_the_space_of_two_plain_notes() -> None:
    """The defining property. Checked to the tolerance the code actually uses,
    because thirds are not representable in binary and 3 x (1/3) is not 1.0."""
    for triplet, plain in [
        ("triplet_half", "whole"),
        ("triplet_quarter", "half"),
        ("triplet_eighth", "quarter"),
        ("triplet_sixteenth", "eighth"),
    ]:
        assert abs(3 * DURATION_BEATS[triplet] - DURATION_BEATS[plain]) < validate.TOLERANCE


def test_triplet_bars_still_sum_exactly_despite_the_thirds() -> None:
    """Documents the thing the tolerance exists *in case* stops being true.

    Thirds are not representable in binary, so the obvious expectation is that
    a triplet bar sums to 0.999... and needs the tolerance to pass. It does not:
    round-to-nearest recovers the bar length exactly for every grouping in this
    table. That is luck in these particular values, not a theorem — so the
    tolerance stays, and this test is what will notice if the luck runs out."""
    for triplet, count, expected in [
        ("triplet_eighth", 3, 1.0),
        ("triplet_eighth", 6, 2.0),
        ("triplet_quarter", 3, 2.0),
        ("triplet_half", 3, 4.0),
        ("triplet_sixteenth", 6, 1.0),
    ]:
        total = sum([DURATION_BEATS[triplet]] * count)
        assert total == expected, f"{count} x {triplet} summed to {total!r}"


# --- end to end: a triplet bar has to survive every stage -------------------

def _bar(*durations: str) -> Measure:
    return Measure(
        measure_number=1,
        notes=[Note(pitch="A4", duration=d, tied_to_next=False) for d in durations],
        slurs=[],
    )


def _score(*measures: Measure) -> ScoreJson:
    return ScoreJson(
        time_signature="4/4",
        key_signature="C major",
        tempo_marking=None,
        bpm_hint=None,
        clef="treble",
        measures=list(measures),
        repeats=[],
        ocr_confidence=0.9,
        notes_to_human="",
    )


def test_a_triplet_bar_validates_as_ok() -> None:
    """Six triplet eighths and a half note is four beats. Before the tables
    were unified this reported 2.0 beats and asked the model to re-read a bar
    it had read correctly."""
    score = _score(_bar(*["triplet_eighth"] * 6, "half"))
    (finding,) = validate.validate_measures(score)
    assert finding.verdict == "ok"
    assert not finding.is_problem
    assert abs(finding.actual_beats - 4.0) < validate.TOLERANCE


def test_a_triplet_bar_produces_evenly_spaced_onsets() -> None:
    """At 60bpm a quarter is one second, so a triplet eighth is a third of one.
    The timeline is what the tempo verdict is measured against; if a triplet
    were worth a quarter here, the player would be told they rushed."""
    score = _score(_bar(*["triplet_eighth"] * 6, "half"))
    timeline = alignment.build_timeline(score, 60.0)
    gaps = [
        round(b - a, 6)
        for a, b in zip(timeline.onsets, timeline.onsets[1:], strict=False)
    ]
    assert gaps[:5] == [round(1 / 3, 6)] * 5
    assert gaps[5] == round(1 / 3, 6)


def test_a_triplet_measure_asked_about_is_asked_about_by_name() -> None:
    """A short triplet bar still reaches the retry prompt, and the prompt says
    triplets are writable — it used to tell the model they were not."""
    # Not measure 1 — a short opening bar is read as a pickup, which is not a
    # problem and so is never asked about.
    full = _bar(*["triplet_eighth"] * 6, "half")
    short = _bar("triplet_eighth", "triplet_eighth", "triplet_eighth")
    short.measure_number = 2
    score = _score(full, short)
    findings = validate.validate_measures(score)
    assert [f.verdict for f in findings] == ["ok", "short"]
    text = validate.describe_for_retry(findings)
    assert "triplets can be written" in text


# ---------------------------------------------------------------------------
# The fifth copy
#
# The docstring above counts four: `score_schema`, `alignment`, `ocr/validate`
# and the two browser tools. It has been wrong since the Expo app was written.
# `mobile/src/lib/score/schedule.ts` holds a `BEATS` table of its own, and its
# own comment says it is "kept deliberately parallel" — the same sentence the
# other four carried on the day three of them went stale.
#
# It is also the copy that matters most, because it is the only one a musician
# *hears*. `schedule.ts` turns the score into note times for playback and the
# metronome. If it disagrees with the server's table, the app sounds the piece
# one way and the analysis judges it another, and the person is told they
# rushed a bar they played exactly along with what the app itself played.
# ---------------------------------------------------------------------------

REPO = __import__("pathlib").Path(__file__).resolve().parents[3]
SCHEDULE_TS = REPO / "mobile" / "src" / "lib" / "score" / "schedule.ts"
TYPES_TS = REPO / "mobile" / "src" / "data" / "types.ts"


def _js_object(source: str, name: str) -> dict[str, float]:
    """The numeric object literal assigned to `name`, evaluated.

    Values are evaluated rather than read as text because the interesting ones
    are written as arithmetic — `4 / 3`, not `1.3333333333333333`. Comparing
    the *text* would pass a table that had rounded a third, which is the one
    way these two could drift far enough to matter: a rounded triplet accrues
    across a bar until it exceeds `validate.TOLERANCE`.
    """
    import ast
    import re

    start = source.index(f"{name}")
    body = source[source.index("{", start) : source.index("};", start)]

    def value_of(expression: str) -> float:
        tree = ast.parse(expression, mode="eval").body

        def walk(node):
            if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
                return float(node.value)
            if isinstance(node, ast.BinOp) and isinstance(
                node.op, (ast.Div, ast.Mult, ast.Add, ast.Sub)
            ):
                left, right = walk(node.left), walk(node.right)
                return {
                    ast.Div: lambda: left / right,
                    ast.Mult: lambda: left * right,
                    ast.Add: lambda: left + right,
                    ast.Sub: lambda: left - right,
                }[type(node.op)]()
            raise AssertionError(f"unexpected expression in {name}: {expression!r}")

        return walk(tree)

    found = {}
    for line in body.splitlines():
        line = line.split("//", 1)[0].strip()
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?),?$", line)
        if match:
            found[match.group(1)] = value_of(match.group(2))
    return found


def test_the_app_counts_a_beat_the_way_the_server_does() -> None:
    """The table the app plays from, against the table the server judges with.

    Exact equality, not `pytest.approx`. Both write thirds as `4 / 3` and
    `1 / 3`, so the same IEEE double comes out of both languages; a difference
    here means somebody typed a rounded decimal, and a rounded triplet is
    precisely the drift that accumulates past `TOLERANCE` over a bar.
    """
    app_beats = _js_object(SCHEDULE_TS.read_text(), "BEATS")

    assert app_beats == DURATION_BEATS, (
        "the app and the server disagree about how long a note is. The app "
        "would sound the piece one way and the analysis judge it another: "
        + ", ".join(
            f"{name}: app {app_beats.get(name)}, server {DURATION_BEATS.get(name)}"
            for name in sorted(set(app_beats) | set(DURATION_BEATS))
            if app_beats.get(name) != DURATION_BEATS.get(name)
        )
    )


def test_the_app_knows_every_duration_the_schema_can_send() -> None:
    """A duration added to the Python `Literal` and not to the app's union.

    Contained rather than catastrophic — `reading.beatsOf` returns null for an
    unknown duration and refuses to count the bar, and playback falls back to a
    quarter — but "the app quietly stops checking bars containing this note" is
    not something to discover from a musician.
    """
    import re

    union = TYPES_TS.read_text()
    union = union[union.index("export type Duration =") :]
    union = union[: union.index(";")]
    app_durations = set(re.findall(r"'([a-z_]+)'", union))

    assert app_durations == DURATIONS, (
        f"only the server knows: {sorted(DURATIONS - app_durations)}; "
        f"only the app knows: {sorted(app_durations - DURATIONS)}"
    )
