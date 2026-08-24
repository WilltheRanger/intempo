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
from app.services.classification import Band, Direction

MOBILE = Path(__file__).resolve().parents[3] / "mobile" / "src" / "data"
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
