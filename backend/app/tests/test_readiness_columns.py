"""That `/v1/ready` knows about every column a migration added.

**The list it checks is written by hand, and nothing checked the list.**
`readiness.REQUIRED_COLUMNS` exists because migrations here are applied by
hand through the Supabase SQL editor — shipping code and applying its
migration are two separate acts, and its own docstring records the time the
gap between them went live: `analyses.instrument` reached production before
the column did, and every take submission failed with a column-not-found
error that reads like a server bug.

That is precisely the shape of list this repository has been bitten by before.
`fixtures/timeline/parity.json`'s `excluded_on_purpose` carried a reason that
had stopped being true. `test_client_reachability.py`'s `NOT_WIRED` is checked
in both directions *because* of it. `_HUMAN_STAGES` was closed on 2026-09-03
after a stage the worker could name sat outside the contract. This one had no
check at all, and it was three rows short:

    scores.transcription_stage      (006)
    scores.transcription_error      (006)
    scores.page_image_discarded_at  (007)

Each fails differently, which is the argument `REQUIRED_COLUMNS` already makes
for itself two blocks lower — "one row per column the code reads, not one per
migration: a deployment can be half-applied". The 009 block follows that rule
with four separate rows. The 006 block did not.

**Both directions, for the same reason `NOT_WIRED` is.** A column the code
uses and the list omits is a readiness endpoint that says ready when it is
not. A column on the list that no migration adds is a probe for something that
cannot exist, which fails forever and teaches people to ignore the page.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.services.readiness import REQUIRED_COLUMNS, REQUIRED_TABLES

REPO = Path(__file__).resolve().parents[3]
MIGRATIONS = REPO / "backend" / "app" / "migrations"
APP = REPO / "backend" / "app"

#: `ALTER TABLE ... ADD COLUMN ...`, in the forms these migrations use.
_ADD_COLUMN = re.compile(
    r"alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)\s+"
    r"add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)",
    re.IGNORECASE,
)

_CREATE_TABLE = re.compile(
    r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)", re.IGNORECASE
)


def _migration_number(path: Path) -> str:
    return path.name.split("_")[0]


def _added_columns() -> dict[tuple[str, str], str]:
    """Every column added *after* the initial schema, and by which migration.

    `001_initial.sql` is excluded by construction: it creates the tables, so
    its columns are not something a deployment can be missing while having the
    table at all. `004` is excluded because it drops a NOT NULL and adds
    nothing — `REQUIRED_COLUMNS` says so in a comment, and this regex agrees
    with that comment without needing to know about it.
    """
    added: dict[tuple[str, str], str] = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        for table, column in _ADD_COLUMN.findall(path.read_text()):
            added.setdefault((table, column), _migration_number(path))
    return added


def _created_tables() -> dict[str, str]:
    created: dict[str, str] = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        number = _migration_number(path)
        if number == "001":
            continue
        for table in _CREATE_TABLE.findall(path.read_text()):
            created.setdefault(table, number)
    return created


def _backend_source() -> str:
    """Every line of shipping backend Python, as one string.

    **Deliberately coarse.** A column is "used" if its name appears anywhere
    outside the tests — not if a parser can tie it to a `.table(...)` call.
    Two of the three columns this test found are written into a `patch` dict
    built several lines away from the query that sends it, and a stricter
    reading missed one of them.

    The cost of coarseness is a false *negative*: a column whose name happens
    to occur in an unrelated sentence would pass. That is the direction a check
    has to fail in if people are going to keep running it — the same argument
    `tools/check-dead-exports.py` makes for having no allowlist.
    """
    return "\n".join(
        path.read_text()
        for path in sorted(APP.rglob("*.py"))
        if "tests" not in path.parts
    )


def test_every_migrated_column_the_code_uses_is_checked_at_startup() -> None:
    listed = {(table, column) for table, column, _ in REQUIRED_COLUMNS}
    source = _backend_source()

    missing = sorted(
        (table, column, migration)
        for (table, column), migration in _added_columns().items()
        if (table, column) not in listed
        and re.search(rf"\b{re.escape(column)}\b", source)
    )

    assert not missing, (
        "these columns were added by a migration and are used by the code, so a "
        "deployment missing them fails at runtime while `/v1/ready` says ready: "
        + ", ".join(f"{t}.{c} ({m})" for t, c, m in missing)
    )


def test_no_column_is_checked_that_no_migration_adds() -> None:
    """The other direction, and the one that rots quietly.

    A probe for a column nothing creates fails on every deployment forever.
    Nobody fixes it, because there is nothing to fix — and a readiness page
    with a permanently red row is a readiness page people stop reading.
    """
    added = set(_added_columns())

    invented = sorted(
        (table, column)
        for table, column, _ in REQUIRED_COLUMNS
        if (table, column) not in added
    )

    assert not invented, (
        "no migration adds these, so the readiness probe can never pass: "
        + ", ".join(f"{t}.{c}" for t, c in invented)
    )


def test_the_migration_each_column_names_is_the_one_that_adds_it() -> None:
    """The third field is instructions to a human at 2am.

    It goes into the failure detail as *"apply
    `backend/app/migrations/NNN_*.sql`"*. Pointing at the wrong file sends
    somebody to run a migration that will not fix what they are looking at.
    """
    added = _added_columns()

    wrong = sorted(
        (table, column, named, added[(table, column)])
        for table, column, named in REQUIRED_COLUMNS
        if (table, column) in added and added[(table, column)] != named
    )

    assert not wrong, (
        "the readiness detail would name the wrong migration file: "
        + ", ".join(f"{t}.{c} says {said}, added by {real}" for t, c, said, real in wrong)
    )


def test_every_table_a_migration_created_is_checked_at_startup() -> None:
    """The same rule one level up, where a whole feature is what goes missing."""
    listed = {table for table, _ in REQUIRED_TABLES}
    source = _backend_source()

    missing = sorted(
        (table, migration)
        for table, migration in _created_tables().items()
        if table not in listed and re.search(rf"\b{re.escape(table)}\b", source)
    )

    assert not missing, (
        "these tables were created by a migration and are used by the code: "
        + ", ".join(f"{t} ({m})" for t, m in missing)
    )
