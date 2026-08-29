"""The closed vocabularies the app types against.

Four enums cross the wire into a TypeScript union: what a musician plays, how
the metronome marks the beat, and the two words the verdict is said in. The app
declares each of them again, because a TypeScript union cannot be imported from
Python — and CLAUDE.md is explicit that these are closed unions the app types
against, so **adding a value is a breaking change**.

What each drift costs, which is not the same in every case:

- **`Instrument`** decides how the pipeline looks for onsets. A double bass
  needs a lower threshold, because the note swells in rather than snapping in
  and most of its energy sits where the detector is weakest. An instrument the
  app cannot store falls back to violin, and that musician is analysed with
  settings for a treble string with nothing anywhere reporting it.
- **`MetronomeMode`** is stored on `analyses`, so a mode the app cannot round
  trip silently becomes `off`.
- **`Band` and `Direction`** are what the verdict screen switches on. A value
  the app has never heard of is a branch nothing matches — a bar with no
  colour and no word, on the screen the whole app exists to show.

The check is by *name*, against the app's own `types.ts`, because that file is
what every screen is compiled against.
"""

from __future__ import annotations

import re
from enum import Enum
from pathlib import Path

import pytest

from app.models.analysis import BpmSource, Instrument, MetronomeMode
from app.routers.scores import MAX_PAGES
from app.services.classification import Band, Direction

MOBILE = Path(__file__).resolve().parents[3] / "mobile" / "src" / "data"
UPLOAD_PAGES_TS = (
    Path(__file__).resolve().parents[3] / "mobile" / "src" / "lib" / "scan" / "uploadPages.ts"
)
TYPES_TS = MOBILE / "types.ts"
ANALYSES_TS = MOBILE / "api" / "analyses.ts"


def _union(name: str) -> set[str]:
    """The string members of `export type <name> = 'a' | 'b';`."""
    source = TYPES_TS.read_text()
    match = re.search(rf"export type {name}\s*=(.*?);", source, re.DOTALL)
    assert match, f"the app no longer declares a {name} type"
    return set(re.findall(r"'([^']+)'", match.group(1)))


@pytest.mark.parametrize(
    "enum, name",
    [
        (Instrument, "Instrument"),
        (MetronomeMode, "MetronomeMode"),
        (Band, "Band"),
        (Direction, "Direction"),
    ],
)
def test_the_app_declares_exactly_this_vocabulary(enum: type[Enum], name: str) -> None:
    server = {member.value for member in enum}
    app = _union(name)

    assert app == server, (
        f"{name}: only the server knows {sorted(server - app)}; "
        f"only the app knows {sorted(app - server)}"
    )


def test_the_reader_would_notice_a_type_that_stopped_existing() -> None:
    """`_union` asserts rather than returning empty, and this proves it does.

    A regex that quietly matched nothing would make every test above compare
    two empty sets and pass — the failure mode this whole file exists to
    prevent, wearing the file as a disguise.
    """
    with pytest.raises(AssertionError, match="no longer declares"):
        _union("NoSuchTypeExists")

    assert len(_union("Instrument")) == 4


def test_the_app_sends_a_bpm_source_this_api_accepts() -> None:
    """The fifth vocabulary, declared somewhere else.

    `BpmSource` is not in `types.ts`. The response type there says
    `bpm_source: string` — deliberately loose, because no screen switches on
    it — and the closed union lives on the *request*, in `api/analyses.ts`,
    where it has to be closed: a value this API does not accept is a 422 on the
    one request a musician makes after playing.
    """
    source = ANALYSES_TS.read_text()
    match = re.search(r"bpm_source:\s*([^;]+);", source)
    assert match, "the app no longer declares a bpm_source on the request"

    app = set(re.findall(r"'([^']+)'", match.group(1)))
    server = {member.value for member in BpmSource}

    assert app == server, (
        f"only the server accepts {sorted(server - app)}; "
        f"only the app sends {sorted(app - server)}"
    )


def test_the_app_knows_which_analysis_states_are_final() -> None:
    """`waitForAnalysis` polls until the status is in a local `FINISHED` set.

    A terminal status missing from it is not an error anywhere — the app simply
    keeps asking, forty times, and then tells the musician the analysis is
    "taking longer than expected" about a run that finished before the first
    poll. The verdict is sitting in the row the whole time.

    So every state this API can put a row in has to be accounted for on the
    client: either final, or one of the two it is willing to wait through.
    """
    from app.models.analysis import AnalysisStatus

    source = (MOBILE / "practice" / "submitTake.ts").read_text()
    match = re.search(r"const FINISHED = new Set\(\[(.*?)\]\)", source, re.DOTALL)
    assert match, "the app no longer names the finished states"
    final = set(re.findall(r"'([^']+)'", match.group(1)))

    #: The states the app deliberately keeps waiting through. Named here rather
    #: than read out of the client, because "not final" is the *absence* of a
    #: mention and an absence cannot be parsed.
    waited_through = {"queued", "processing"}
    server = {member.value for member in AnalysisStatus}

    assert final <= server, f"the app waits for states this API never sets: {sorted(final - server)}"
    assert server == final | waited_through, (
        f"unaccounted for on the client: {sorted(server - final - waited_through)} — "
        "a final one is forty wasted polls and a wrong message; a new "
        "in-progress one belongs in `waited_through` here"
    )


SCHEDULE_TS = MOBILE.parent / "lib" / "score" / "schedule.ts"
NOTATION_TS = MOBILE / "types.ts"


def _duration_union() -> set[str]:
    return _union("Duration")


def _app_beats() -> dict[str, float]:
    """The app's `BEATS` table, parsed.

    Asserts rather than returning empty, the same rule `_union` follows: a
    regex that quietly matched nothing would make every comparison below
    compare two empty things and pass, wearing this file as a disguise.
    """
    source = SCHEDULE_TS.read_text()
    match = re.search(
        r"export const BEATS: Record<Duration, number> = \{(.*?)\n\};",
        source,
        re.DOTALL,
    )
    assert match, "the app no longer declares a BEATS table"

    table: dict[str, float] = {}
    for name, expr in re.findall(r"^\s{2}([a-z_0-9]+):\s*([^,]+),", match.group(1), re.M):
        cleaned = expr.strip()
        assert re.fullmatch(r"[\d.\s/]+", cleaned), f"{name} is not arithmetic: {cleaned}"
        table[name] = eval(cleaned)  # noqa: S307 — shape asserted immediately above
    assert len(table) > 15, f"only {len(table)} durations parsed out of BEATS"
    return table


def test_the_app_knows_exactly_the_durations_this_api_sends() -> None:
    """`Duration` is the vocabulary every timeline on both sides is built from.

    A value only the server knows arrives at a `Record<Duration, number>` that
    has no entry for it. `scheduleScore` then sounds it as a quarter — a
    deliberate choice, and the least-wrong one — while `reading.beatsOf`
    declines to count the bar at all. Both are documented; neither is a thing
    to discover from a musician.
    """
    from app.services.score_schema import Duration

    import typing

    server = set(typing.get_args(Duration))
    app = _duration_union()

    assert app == server, (
        f"only the server sends {sorted(server - app)}; "
        f"only the app knows {sorted(app - server)}"
    )


def test_both_sides_agree_what_every_duration_is_worth() -> None:
    """**The parity fixture covers five of twenty-one.**

    `fixtures/timeline/parity.json` is the one file both trees are held to, and
    its own docstring says why: *"If they drift, nothing looks broken from
    either side. The app plays the piece, the analysis judges the recording,
    and a musician who played exactly along with what the app sounded is told
    they rushed."*

    It exercises `quarter`, `eighth`, `half`, `dotted_quarter` and
    `triplet_quarter`. **Sixteen durations it never touches** — every
    double-dotted value, every triplet but one, and everything shorter than an
    eighth — so for those the two tables could hold different numbers and the
    fixture would pass.

    Comparing the tables covers all twenty-one at once, which the fixture
    cannot do without becoming a piece nobody would play.
    """
    from app.services.score_schema import DURATION_BEATS

    app = _app_beats()

    assert set(app) == set(DURATION_BEATS), (
        f"only the server has {sorted(set(DURATION_BEATS) - set(app))}; "
        f"only the app has {sorted(set(app) - set(DURATION_BEATS))}"
    )
    differing = {
        name: (DURATION_BEATS[name], app[name])
        for name in DURATION_BEATS
        if abs(DURATION_BEATS[name] - app[name]) > 1e-12
    }
    assert not differing, f"server vs app: {differing}"


def test_the_beats_table_covers_the_duration_union() -> None:
    """TypeScript forces this on the app's side — `Record<Duration, number>`
    will not compile with a member missing. Nothing forces it on the server's,
    and `DURATION_BEATS` is what `alignment.build_timeline` reads."""
    from app.services.score_schema import Duration, DURATION_BEATS

    import typing

    assert set(typing.get_args(Duration)) <= set(DURATION_BEATS)


def test_the_app_declares_exactly_the_repeat_types_this_api_sends() -> None:
    """The fifth closed union, and it went unchecked here because until this
    week nothing ever populated `repeats` — the importer returned an empty list
    unconditionally, so a drift would have shown up as nothing at all.

    Now that a `%`, a da capo and a repeat barline all produce them, a type the
    app has not heard of is a repeat it cannot draw or reason about.
    """
    from app.services.score_schema import RepeatType

    import typing

    server = set(typing.get_args(RepeatType))
    app = _union("RepeatType")

    assert app == server, (
        f"only the server sends {sorted(server - app)}; "
        f"only the app knows {sorted(app - server)}"
    )


PIECES_TS = MOBILE / "hooks" / "usePieces.ts"


def test_the_app_declares_exactly_the_scan_states_this_api_writes() -> None:
    """The sixth closed union, and it had no server-side home until today.

    The four strings were bare literals scattered across the worker and the
    router while the app declared a union of exactly four, so there was
    nothing to compare against and a fifth added anywhere in the backend would
    have been a silent breaking change.
    """
    import typing

    from app.models.score import TranscriptionStatus

    server = set(typing.get_args(TranscriptionStatus))
    app = _union("TranscriptionStatus")

    assert app == server, (
        f"only the server writes {sorted(server - app)}; "
        f"only the app knows {sorted(app - server)}"
    )


def test_the_app_polls_exactly_the_scan_states_a_worker_moves_off() -> None:
    """**The mirror of the analysis-status failure, in the other direction.**

    `usePieces` keeps asking only while the row is `queued` or `reading`, and
    stops otherwise. So a new in-progress state the app has not heard of is
    treated as terminal: the app stops asking, and shows a scan stuck half-read
    forever with no error anywhere. Where the analysis version costs forty
    wasted polls and a wrong message, this one costs no polls at all and no
    message either.

    Read out of the hook rather than restated, because the hook is what runs.
    """
    from app.models.score import TRANSCRIPTION_IN_PROGRESS, TranscriptionStatus

    import typing

    source = PIECES_TS.read_text()
    match = re.search(
        r"const status = query\.state\.data\?\.transcriptionStatus;\s*"
        r"return (.*?) \? TRANSCRIPTION_POLL_MS : false;",
        source,
        re.DOTALL,
    )
    assert match, "usePieces no longer decides polling from the scan state"
    polled = set(re.findall(r"'([^']+)'", match.group(1)))

    assert polled == set(TRANSCRIPTION_IN_PROGRESS), (
        f"the app polls {sorted(polled)}; a worker moves off "
        f"{sorted(TRANSCRIPTION_IN_PROGRESS)}"
    )
    terminal = set(typing.get_args(TranscriptionStatus)) - TRANSCRIPTION_IN_PROGRESS
    assert terminal == {"done", "failed"}, terminal


def test_every_scan_state_the_backend_writes_is_in_the_vocabulary() -> None:
    """The vocabulary is only worth having if nothing writes around it.

    Scanned from the source because that is where the values are — a constant
    nobody uses would pass a comparison against itself and prove nothing.
    """
    from app.models.score import TranscriptionStatus

    import typing

    backend = Path(__file__).resolve().parents[1]
    written: set[str] = set()
    for path in (backend / "workers" / "transcription_runner.py",
                 backend / "routers" / "scores.py"):
        source = path.read_text()
        written |= set(
            re.findall(r'"transcription_status":\s*"([a-z_]+)"', source)
        )
        written |= set(
            re.findall(
                r'"transcription_status":\s*"[a-z_]+" if \w+ else "([a-z_]+)"', source
            )
        )

    assert written, "no scan state is written anywhere — the scan cannot report"
    assert written <= set(typing.get_args(TranscriptionStatus)), (
        f"written but not in the vocabulary: "
        f"{sorted(written - set(typing.get_args(TranscriptionStatus)))}"
    )


READING_TS = MOBILE.parent / "lib" / "notation" / "reading.ts"


def _interface_field(interface: str, field: str) -> set[str]:
    """The string members of one field inside `export interface <name>`.

    For the unions declared inline rather than as a named type. Asserts on both
    halves, because a regex that matched the interface but not the field would
    hand back an empty set and pass every comparison below.
    """
    source = TYPES_TS.read_text()
    block = re.search(rf"export interface {interface} \{{(.*?)\n\}}", source, re.DOTALL)
    assert block, f"the app no longer declares a {interface}"
    match = re.search(rf"\n\s*{field}:\s*([^;]+);", block.group(1))
    assert match, f"{interface} no longer has a {field}"
    found = set(re.findall(r"'([^']+)'", match.group(1)))
    assert found, f"{interface}.{field} names no literals"
    return found


@pytest.mark.parametrize(
    ("name", "members"),
    [
        ("Clef", "app.services.score_schema.Clef"),
        ("Articulation", "app.services.score_schema.Articulation"),
        ("Dynamics", "app.services.score_schema.Dynamics"),
    ],
)
def test_the_app_declares_exactly_this_score_vocabulary(name: str, members: str) -> None:
    """The three remaining named unions in the score schema.

    None can hang a screen the way the scan state could — they are read for
    display and for playback shaping — but each is still a value the app types
    against, and `Clef` in particular is one `CLAUDE.md` is emphatic about: a
    bass part labelled "Treble clef" is worse than no label.
    """
    import importlib
    import typing

    module, _, attribute = members.rpartition(".")
    server = set(typing.get_args(getattr(importlib.import_module(module), attribute)))

    assert _union(name) == server, (
        f"{name}: only the server sends {sorted(server - _union(name))}; "
        f"only the app knows {sorted(_union(name) - server)}"
    )


def test_the_app_declares_exactly_the_result_states_this_api_sets() -> None:
    """What the verdict screen switches on when an analysis finishes."""
    import typing

    from app.services.analysis import Status

    server = set(typing.get_args(Status))
    app = _union("ResultStatus")

    assert app == server, (
        f"only the server sets {sorted(server - app)}; "
        f"only the app knows {sorted(app - server)}"
    )


def test_the_app_declares_exactly_the_tempo_changes_this_api_sends() -> None:
    """Declared inline on `ScoreTempoChange` rather than as a named type, which
    is why it was missed when the named unions were swept."""
    import typing

    from app.services.score_schema import TempoChangeKind

    server = set(typing.get_args(TempoChangeKind))
    app = _interface_field("ScoreTempoChange", "kind")

    assert app == server, (
        f"only the server sends {sorted(server - app)}; "
        f"only the app knows {sorted(app - server)}"
    )


def test_the_app_declares_exactly_the_concern_kinds_this_api_sends() -> None:
    """`validate.py` had one check and now has four, three of which fire on
    measures whose beats add up exactly. A fifth is a question of when, not
    whether."""
    import typing

    from app.routers.scores import MeasureConcern

    server = set(typing.get_args(MeasureConcern.model_fields["kind"].annotation))
    app = _interface_field("MeasureConcern", "kind")

    assert app == server, (
        f"only the server sends {sorted(server - app)}; "
        f"only the app knows {sorted(app - server)}"
    )


def test_a_new_concern_kind_would_still_reach_the_musician() -> None:
    """**The property that makes the union above safe to grow, pinned before
    somebody removes it.**

    The app does not switch on `kind`. It separates `'beats'` — the one wording
    that can promise arithmetic — and shows the server's own sentence verbatim
    for everything else. So a fifth check added to `validate.py` appears on the
    screen the day it ships, with no client change at all.

    A `switch` here would undo that silently: a kind with no branch is a
    caveat that says nothing, on the screen that exists to say what is wrong.
    So the assertion is that `'beats'` is the **only** kind the app names.
    """
    import typing

    from app.routers.scores import MeasureConcern

    source = READING_TS.read_text()
    named = set(re.findall(r"c\.kind\s*[!=]==\s*'([^']+)'", source))
    named |= set(re.findall(r"kind\s*===\s*'([^']+)'", source))

    assert named == {"beats"}, (
        f"the app now branches on {sorted(named)} — a kind with no branch is a "
        "caveat that says nothing"
    )
    assert "beats" in set(
        typing.get_args(MeasureConcern.model_fields["kind"].annotation)
    )


# --------------------------------------------------------------------------
# Numbers, not vocabularies — and the same failure
#
# Two limits are written down on both sides of the wire, and nothing has held
# them together. They are not enums, so no union test covers them; the drift
# costs the same thing a drifted enum costs, which is a musician told no after
# the work rather than before it.
# --------------------------------------------------------------------------

MOBILE_SRC = Path(__file__).resolve().parents[3] / "mobile" / "src"


def _number_in(path: Path, name: str) -> int:
    """`const NAME = 8_000_000;` — the app's own copy of a limit."""
    source = path.read_text()
    match = re.search(rf"\b{name}\s*=\s*([0-9_ */]+);", source)
    assert match, f"the app no longer declares {name} in {path.name}"
    return int(eval(match.group(1).replace("_", "")))  # noqa: S307 — arithmetic only


def test_the_app_refuses_a_score_file_the_api_would_refuse() -> None:
    """**Checked before the upload, or the musician waits for a no.**

    `ImportScoreRequest.musicxml` is capped, and the app caps the same thing
    before it sends. If the app's number were the larger one, a file would be
    read, unzipped, uploaded and then refused by a validation error naming a
    field and a character count — the shape of the 413 message this project has
    already had to rewrite once, for being advice a musician could not follow.
    """
    from app.routers.scores import ImportScoreRequest

    api = ImportScoreRequest.model_fields["musicxml"].metadata
    limit = next(m.max_length for m in api if hasattr(m, "max_length"))
    app = _number_in(MOBILE_SRC / "screens" / "addPiece" / "ImportFile.tsx", "MAX_XML_CHARS")
    assert app <= limit, (
        f"the app accepts {app} characters of MusicXML and the API accepts {limit}"
    )


def test_the_unzip_guard_cannot_refuse_a_score_the_size_check_would_accept() -> None:
    """**A guard that refuses valid work is a bug dressed as safety.**

    `MAX_UNZIPPED_BYTES` exists only to stop a `.mxl` allocating gigabytes
    before anything has looked at it — measured at 1070:1, so a 10MB file
    expands to about ten. `MAX_XML_CHARS` is what actually decides whether a
    score is too big. If the first were the smaller, a legitimate score would
    be refused as a bomb, and the message would tell its owner the file was
    damaged.

    Checked from here rather than from the app's own test, because reading the
    screen's source needs `node:fs` and this project has no `@types/node`.
    """
    reader = _number_in(MOBILE_SRC / "lib" / "musicxml" / "file.ts", "MAX_UNZIPPED_BYTES")
    chars = _number_in(
        MOBILE_SRC / "screens" / "addPiece" / "ImportFile.tsx", "MAX_XML_CHARS"
    )
    assert reader >= chars, (
        f"the unzip guard stops at {reader} bytes and a score may be "
        f"{chars} characters"
    )


def test_the_app_shrinks_a_page_to_something_the_worker_will_read() -> None:
    """**The app's cap is the stricter one, and that is load-bearing.**

    `uploadPage` shrinks a photograph to `MAX_PAGE_BYTES` before sending;
    `page_image.MAX_IMAGE_BYTES` is what the worker refuses at, **after** the
    upload has finished and the row exists. Headroom in that direction is
    invisible; headroom the other way is a scan that uploads, saves, and then
    fails at the reading step for a size the app itself approved.
    """
    from app.services.page_image import MAX_IMAGE_BYTES

    app = _number_in(MOBILE_SRC / "lib" / "scan" / "uploadPage.ts", "MAX_PAGE_BYTES")
    assert app <= MAX_IMAGE_BYTES, (
        f"the app uploads up to {app} bytes and the worker refuses over "
        f"{MAX_IMAGE_BYTES}"
    )


def test_the_app_stops_a_scan_at_the_same_page_count_the_server_does() -> None:
    """The page ceiling is declared twice, and the drift is expensive.

    `MAX_PAGES` here is what `POST /v1/scores` refuses above. The app declares
    it again so a scan too long is refused **at the shutter**, before anything
    is uploaded — the two numbers disagreeing means a musician photographs
    thirteen pages, waits for all thirteen to upload over cellular, and is then
    told by the server that the scan is too long, in a sentence written for
    whoever wrote the client.

    Too *low* in the app is the cheaper direction and still wrong: pages the
    server would have accepted are refused with an explanation that is not true.
    """
    source = UPLOAD_PAGES_TS.read_text()
    match = re.search(r"export const MAX_PAGES = (\d+);", source)
    assert match, "the app no longer declares MAX_PAGES in lib/scan/uploadPages.ts"
    assert int(match.group(1)) == MAX_PAGES, (
        f"the app stops a scan at {match.group(1)} pages and the server refuses "
        f"above {MAX_PAGES}"
    )
