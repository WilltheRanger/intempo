"""The value lists a column allows, against the ones the code believes in.

Three columns are constrained to a fixed set of strings in SQL, and every one
of them has a Python vocabulary beside it. **`instrument` has two**, and that
is the one worth stating in full:

    mobile/src/data/types.ts     Instrument = 'violin' | 'viola' | ...
    app/models/analysis.py       class Instrument(str, Enum)   ← used by
                                 CreateAnalysisRequest and analysis_runner
    app/models/user.py           class Instrument(str, Enum)   ← used by
                                 UpdateMeRequest and MeResponse
    migrations 008 and 009       CHECK (instrument IN (...))   ← twice

Four declarations of one list, and `test_client_enums.py` held exactly one pair
of them — the app against `models/analysis`. The rest agreed by luck.

**What the drift does.** Add a value to `models/user.Instrument` alone and
`PATCH /v1/me` accepts it, onboarding stores it, and then *every take that
musician submits is refused* by `CreateAnalysisRequest` — a 422 on a value the
app itself wrote to their profile. Add it to the enums but not the CHECK and
the API accepts what the database then rejects, which is a 500 on saving a
profile. Neither shows up in either tree alone, and neither is a small failure.

`transcription_status` and `user_verdict` are the same shape with one Python
vocabulary each: a status the worker writes and the column refuses leaves a
scan stuck `reading` for ever, and a verdict the app offers and the column
refuses loses the correction that the router's docstring calls the only route
out of Batch 3's untuned thresholds.

The app's own copies are not read here. `test_client_enums.py` holds them
against `models/analysis`, so with this file holding everything else to the
same list, all four agree transitively — and that split keeps each file reading
one tree.
"""

from __future__ import annotations

import re
from enum import Enum
from pathlib import Path
from typing import Literal, get_args, get_origin

import pytest

from app.models.analysis import Instrument as AnalysisInstrument
from app.models.score import TranscriptionStatus
from app.models.user import Instrument as UserInstrument
from app.routers.corrections import UserVerdict

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

#: Column name → every Python vocabulary that has to match its CHECK.
#:
#: A tuple, because `instrument` genuinely has two and they must agree with the
#: column *and* with each other. Adding a fourth declaration of an existing
#: column means adding it here; adding a new constrained column means adding a
#: row, and the discovery case below says so.
VOCABULARIES: dict[str, tuple[object, ...]] = {
    "instrument": (AnalysisInstrument, UserInstrument),
    "transcription_status": (TranscriptionStatus,),
    "user_verdict": (UserVerdict,),
}

#: `CHECK (column IN ('a', 'b'))`, in the form these migrations write it.
_CHECK = re.compile(r"CHECK \((\w+) IN \(([^)]*)\)\)")


def _name(vocabulary: object) -> str:
    """Where the vocabulary lives, not just what it is called.

    A failure here is instructions to somebody with two files open: `instrument`
    has an `Instrument` in `models/analysis` and another in `models/user`, and
    a message saying only "Instrument" names neither of them. A `Literal` has
    no name at all, so it gets its own definition printed.
    """
    if isinstance(vocabulary, type):
        return f"{vocabulary.__module__}.{vocabulary.__qualname__}"
    return repr(vocabulary)


def _values(vocabulary: object) -> set[str]:
    """The strings a vocabulary allows, whether it is an Enum or a Literal.

    Both forms are in use and neither is wrong: an Enum where the value is
    passed around as an object (`Instrument.double_bass.value` decides the
    onset settings), a Literal where it is only ever a string on the wire.
    """
    if isinstance(vocabulary, type) and issubclass(vocabulary, Enum):
        return {member.value for member in vocabulary}
    if get_origin(vocabulary) is Literal:
        return set(get_args(vocabulary))
    raise TypeError(f"not a vocabulary this can read: {vocabulary!r}")


def _constraints() -> dict[str, list[tuple[str, tuple[str, ...]]]]:
    """Every value-list CHECK in the migrations, by column.

    Read from the files rather than from a running database: this has to fail
    in CI, where there is no database, and the files are what a deployment is
    applied from.
    """
    found: dict[str, list[tuple[str, tuple[str, ...]]]] = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        for match in _CHECK.finditer(path.read_text()):
            values = tuple(
                value.strip().strip("'") for value in match.group(2).split(",")
            )
            found.setdefault(match.group(1), []).append((path.name, values))
    return found


CONSTRAINED = _constraints()


@pytest.mark.parametrize("column", sorted(VOCABULARIES), ids=sorted(VOCABULARIES))
def test_the_column_allows_exactly_what_the_code_believes(column: str) -> None:
    declared = CONSTRAINED.get(column)
    assert declared, f"no migration constrains {column} any more"

    for migration, values in declared:
        for vocabulary in VOCABULARIES[column]:
            assert set(values) == _values(vocabulary), (
                f"{migration} allows {sorted(values)} for {column}; "
                f"{_name(vocabulary)} says {sorted(_values(vocabulary))}"
            )


def test_a_column_constrained_twice_is_constrained_the_same_way() -> None:
    """`instrument` is checked on two tables, and they are two edits.

    A value added to `analyses.instrument` and not to `users.instrument` gives
    a musician a take that submits and a profile that will not save it.
    """
    for column, declared in sorted(CONSTRAINED.items()):
        sets = {values for _, values in declared}
        assert len(sets) == 1, (
            f"{column} is constrained differently in "
            f"{[migration for migration, _ in declared]}: {sorted(sets)}"
        )


def test_the_two_instrument_enums_are_the_same_list() -> None:
    """Stated on its own because of what it costs when it is not.

    `models/user.Instrument` decides what onboarding may store;
    `models/analysis.Instrument` decides what a take may declare. A value in
    the first and not the second means the app writes an instrument to the
    musician's profile and then refuses every recording they make with it.
    """
    assert _values(AnalysisInstrument) == _values(UserInstrument)


def test_every_constrained_column_has_a_vocabulary() -> None:
    """The anti-rot half, discovered rather than listed.

    A new `CHECK (… IN …)` with a Python constant beside it is exactly the
    change this file exists for, and it would arrive with nothing comparing the
    two.
    """
    unmapped = sorted(column for column in CONSTRAINED if column not in VOCABULARIES)

    assert not unmapped, (
        "these columns are constrained to a value list and nothing compares it "
        f"with the code: {unmapped}"
    )


def test_no_vocabulary_names_a_column_that_is_no_longer_constrained() -> None:
    """The other direction, the way `NOT_WIRED` is checked.

    A row here for a column whose CHECK was dropped is a comparison that passes
    against nothing while reading as coverage.
    """
    gone = sorted(column for column in VOCABULARIES if column not in CONSTRAINED)

    assert not gone, f"no migration constrains these any more: {gone}"
