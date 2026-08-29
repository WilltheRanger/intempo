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

import itertools
import typing
from fractions import Fraction

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


@pytest.mark.parametrize("prefix,ratio", [("quintuplet", 5), ("septuplet", 7)])
def test_five_and_seven_fill_the_space_of_four_plain_notes(
    prefix: str, ratio: int
) -> None:
    """The defining property of the two ratios added after the triplets.

    Five in the time of four, and seven in the time of four — so five
    `quintuplet_sixteenth`s are a quarter, exactly as three `triplet_eighth`s
    are. Fifths and sevenths are no more representable in binary than thirds,
    so this is checked to the tolerance the code actually uses.
    """
    for base, plain in [
        ("half", "double_whole"),
        ("quarter", "whole"),
        ("eighth", "half"),
        ("sixteenth", "quarter"),
    ]:
        name = f"{prefix}_{base}"
        assert (
            abs(ratio * DURATION_BEATS[name] - DURATION_BEATS[plain])
            < validate.TOLERANCE
        ), f"{ratio} x {name} is not a {plain}"


#: What each duration name means, as an exact rational.
#:
#: **A second table on purpose**, which is otherwise the thing this whole file
#: exists to prevent. Every other copy is a copy of the same floating-point
#: answer and can only agree or disagree with it; this one is the *question* —
#: the value the notation denotes, in arithmetic with no rounding — so it is the
#: only thing that can say whether the floats are right rather than merely
#: consistent. The key sets are asserted equal below, so it cannot fall behind a
#: new duration in silence.
EXACT_BEATS: dict[str, Fraction] = {
    "whole": Fraction(4), "dotted_whole": Fraction(6),
    "half": Fraction(2), "dotted_half": Fraction(3),
    "quarter": Fraction(1), "dotted_quarter": Fraction(3, 2),
    "eighth": Fraction(1, 2), "dotted_eighth": Fraction(3, 4),
    "sixteenth": Fraction(1, 4), "dotted_sixteenth": Fraction(3, 8),
    "thirty_second": Fraction(1, 8), "dotted_thirty_second": Fraction(3, 16),
    "sixty_fourth": Fraction(1, 16),
    "double_whole": Fraction(8),
    "double_dotted_half": Fraction(7, 2),
    "double_dotted_quarter": Fraction(7, 4),
    "double_dotted_eighth": Fraction(7, 8),
    "triplet_half": Fraction(4, 3), "triplet_quarter": Fraction(2, 3),
    "triplet_eighth": Fraction(1, 3), "triplet_sixteenth": Fraction(1, 6),
    "quintuplet_half": Fraction(8, 5), "quintuplet_quarter": Fraction(4, 5),
    "quintuplet_eighth": Fraction(2, 5), "quintuplet_sixteenth": Fraction(1, 5),
    "septuplet_half": Fraction(8, 7), "septuplet_quarter": Fraction(4, 7),
    "septuplet_eighth": Fraction(2, 7), "septuplet_sixteenth": Fraction(1, 7),
}


def test_every_duration_is_the_nearest_double_to_the_value_it_denotes() -> None:
    """The float table against exact arithmetic, name by name."""
    assert set(EXACT_BEATS) == DURATIONS, {
        "in the schema but not stated exactly": sorted(DURATIONS - set(EXACT_BEATS)),
        "stated exactly but not in the schema": sorted(set(EXACT_BEATS) - DURATIONS),
    }
    wrong = {
        name: (DURATION_BEATS[name], str(exact))
        for name, exact in EXACT_BEATS.items()
        if DURATION_BEATS[name] != float(exact)
    }
    assert not wrong, wrong


def test_no_bar_that_should_add_up_fails_the_beat_check() -> None:
    """**The claim the tolerance is there to make, checked instead of assumed.**

    `validate.py` compares a measure's float sum against its meter with
    `TOLERANCE`. That is sound only if every bar which adds up *exactly* in real
    arithmetic also adds up to within the tolerance in floating point — and with
    thirds, fifths and sevenths in the same table, mixed in one bar, that is not
    obvious. If it ever fails, a musician is told a bar they played and wrote
    correctly does not add up, which is the exact failure this file was created
    after.

    So: every combination of up to six durations whose *exact* total is a whole
    number of beats, summed the way the validator sums it. Measured at the time
    this was written — 11,293 such bars out of 1.6M combinations, worst
    floating-point error **0.0**. Not a theorem, which is why it is a test.

    Six because that is where the combination count stops being free (about a
    tenth of a second) and because a bar of more than six notes is built out of
    the same values in the same way.
    """
    names = list(DURATION_BEATS)
    checked = 0
    worst = 0.0
    failures: list[tuple[tuple[str, ...], float, str]] = []
    for size in range(1, 7):
        for combo in itertools.combinations_with_replacement(names, size):
            exact = sum((EXACT_BEATS[c] for c in combo), Fraction(0))
            # Only bars that land on a whole number of beats — those are the
            # ones a meter can be compared against, and the only ones where a
            # rounding error would change the verdict.
            if exact.denominator != 1 or exact > 12:
                continue
            checked += 1
            total = sum(DURATION_BEATS[c] for c in combo)
            error = abs(total - float(exact))
            worst = max(worst, error)
            if error > validate.TOLERANCE:
                failures.append((combo, total, str(exact)))

    assert checked > 10_000, f"only {checked} whole-beat bars — the sweep shrank"
    assert not failures, failures[:5]
    assert worst == 0.0, f"the sums are no longer exact; worst error {worst!r}"


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
    triplets are writable — it used to tell the model they were not.

    Asserted on the substring that names the tuplets rather than the whole
    sentence: `TUPLET_NOTE` also lists what is *not* writable, and that half
    changes every time the schema learns a ratio.
    """
    # Not measure 1 — a short opening bar is read as a pickup, which is not a
    # problem and so is never asked about.
    full = _bar(*["triplet_eighth"] * 6, "half")
    short = _bar("triplet_eighth", "triplet_eighth", "triplet_eighth")
    short.measure_number = 2
    score = _score(full, short)
    findings = validate.validate_measures(score)
    assert [f.verdict for f in findings] == ["ok", "short"]
    text = validate.describe_for_retry(findings)
    assert "triplets, quintuplets and septuplets can be written" in text


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


# ---------------------------------------------------------------------------
# The two copies nothing was holding
#
# The docstring at the top of this file counts the copies of "how many beats is
# a dotted quarter" and has been wrong twice. There are two more, and neither is
# a beat table — which is exactly why they were missed. One is the *prompt*,
# which tells the model what names exist, and one is `DURATION_LABELS`, which
# tells a musician what they are looking at.
# ---------------------------------------------------------------------------

PROMPT = (
    __import__("pathlib").Path(__file__).resolve().parents[1]
    / "prompts" / "ocr_prompt.txt"
)
READING_TS = REPO / "mobile" / "src" / "lib" / "notation" / "reading.ts"


def _prompt_duration_names() -> set[str]:
    """The list the prompt gives the model, parsed out of the prompt itself."""
    import re

    text = PROMPT.read_text()
    block = re.search(
        r"^DURATION NAMES — the complete list\. There is no other value:\n\n(.*?)\n\n",
        text,
        re.DOTALL | re.MULTILINE,
    )
    assert block, "the DURATION NAMES block is no longer where this test looks"
    return set(block.group(1).split())


def test_the_prompt_offers_exactly_the_durations_the_schema_accepts() -> None:
    """The copy that decides what the model writes, and it was open-ended.

    The list used to end in `| ...`, which reads as an invitation to coin a name
    for anything not shown — and a name the schema does not hold is rejected for
    the **whole page**, not for the note. Asking a model for a value that
    destroys the answer is a fault in the question.

    Both directions. A name in the prompt but not the schema loses pages; a name
    in the schema but not the prompt is a value the model is never told it may
    use, so a correctly-read note gets written as something else.
    """
    offered = _prompt_duration_names()
    assert offered == DURATIONS, {
        "in the prompt but not the schema": sorted(offered - DURATIONS),
        "in the schema but not the prompt": sorted(DURATIONS - offered),
    }


def test_every_duration_has_a_label_a_musician_can_read() -> None:
    """`DURATION_LABELS` is what a person sees while correcting a bar.

    It was typed `Record<string, string>`, so a missing entry was not a
    typecheck error — the app would show `undefined` next to a note, in the one
    screen whose whole job is letting someone check what was read. It is
    `Record<Duration, string>` now, and this holds the other direction: a label
    for a duration that no longer exists is a name nothing can produce.
    """
    import re

    source = READING_TS.read_text()
    body = source[
        source.index("DURATION_LABELS") : source.index("};", source.index("DURATION_LABELS"))
    ]
    labelled = set(re.findall(r"^\s*([a-z_]+):\s*'", body, re.MULTILINE))

    assert labelled == DURATIONS, {
        "labelled but not a duration": sorted(labelled - DURATIONS),
        "a duration with no label": sorted(DURATIONS - labelled),
    }


def test_the_new_values_are_exactly_representable() -> None:
    """Unlike the triplets, these divide evenly in binary, so they carry no
    rounding risk at all — a double dot is base × 1.75 and a breve is 8."""
    assert DURATION_BEATS["double_whole"] == 8.0
    assert DURATION_BEATS["double_dotted_half"] == 3.5
    assert DURATION_BEATS["double_dotted_quarter"] == 1.75
    assert DURATION_BEATS["double_dotted_eighth"] == 0.875
    assert DURATION_BEATS["dotted_thirty_second"] == 0.1875
    assert DURATION_BEATS["sixty_fourth"] == 0.0625

    for name in (
        "double_whole", "double_dotted_half", "double_dotted_quarter",
        "double_dotted_eighth", "dotted_thirty_second", "sixty_fourth",
    ):
        beats = DURATION_BEATS[name]
        assert beats * 16 == int(beats * 16), f"{name} does not land on a 64th grid"


def test_a_double_dot_is_the_base_value_and_three_quarters_again() -> None:
    """The arithmetic, stated once. A dot adds half; a second dot adds half of
    the dot. Getting this wrong is invisible in a beat sum only when it happens
    to cancel, and wrong in the timeline always."""
    for base, doubled in (
        ("half", "double_dotted_half"),
        ("quarter", "double_dotted_quarter"),
        ("eighth", "double_dotted_eighth"),
    ):
        assert DURATION_BEATS[doubled] == DURATION_BEATS[base] * 1.75, doubled
