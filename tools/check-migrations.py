#!/usr/bin/env python3
"""Apply every migration, in order, to an empty database.

**Nothing has ever checked that these files run.** They are applied by hand to
a Supabase project, one at a time, and the only evidence any of them works is
that somebody watched it. CLAUDE.md records what that costs: 013, 014 and 015
sat unapplied for weeks while a defect they fix looked parked, and the project
named `intempo` is *still* four behind `intempo-dev` — so the day it is
unpaused, four migrations run in a row against production with nobody having
seen them run in sequence anywhere.

This runs them in sequence. It is the cheapest possible version of that day.

**What it proves:** the set applies in filename order on an empty database,
no file references a table or column an earlier one has not created, the SQL
parses, and every file that claims to be idempotent survives being applied
twice.

**What it cannot prove:** anything about Supabase's own semantics. `auth` and
`storage` are stubbed by `tools/supabase_stubs.sql` in the shape these files
need, so whether a policy grants what it means to is still a question only a
real project can answer. That half was never the one that broke.

Usage:

    tools/check-migrations.py --dsn postgresql://user@host:5432/db

`--dsn` may also come from `DATABASE_URL`. The database must be **empty**;
this creates schemas and tables in it and does not clean up, because a failure
is worth inspecting. CI gives it a throwaway `postgres:16` service.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MIGRATIONS = REPO / "backend" / "app" / "migrations"
STUBS = REPO / "tools" / "supabase_stubs.sql"

#: `013_training_corrections.sql` → (13, path). Anything not numbered this way
#: is not a migration and is not applied — the check is on the set that ships.
_NUMBERED = re.compile(r"^(\d{3})_.+\.sql$")

#: The first migration written under the rule that a migration must survive
#: being run twice.
#:
#: **Must equal `FIRST_IDEMPOTENT_MIGRATION` in `test_readiness.py`**, which
#: enforces the *spelling* — `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT
#: EXISTS`, a `DROP CONSTRAINT IF EXISTS` before every `ADD CONSTRAINT`. That
#: test reads the SQL; this file runs it. A test there holds the two numbers
#: together, because a static rule and a runtime check disagreeing about which
#: files are under the rule is worse than either alone.
FIRST_IDEMPOTENT_MIGRATION = 13


def _claims_idempotent() -> list[Path]:
    """Every migration that promises it can be applied a second time.

    **This was the single name `016_storage_buckets.sql`, hand-written**, and
    by the time it was looked at, four other files were making the same promise
    and none of them was being held to it. 013, 014, 015 and 017 are all
    written in the guarded spelling `test_readiness.py` requires — which is a
    claim about what happens when an operator, unsure whether a migration
    already ran, runs it again. The claim was
    checked by reading and never by running.

    Derived rather than listed for the reason the readiness test gives about
    its own generalisation: a hand-maintained set is enforced for the files
    that happened to exist when somebody wrote it, which is the shape of a
    convention rather than a check.
    """
    return [path for number, path in _migrations() if number >= FIRST_IDEMPOTENT_MIGRATION]


def _migrations() -> list[tuple[int, Path]]:
    found = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        match = _NUMBERED.match(path.name)
        if match:
            found.append((int(match.group(1)), path))
    return sorted(found)


def _apply(dsn: str, path: Path, label: str) -> tuple[bool, str]:
    """Run one file. `ON_ERROR_STOP` so a mid-file failure is a failure."""
    result = subprocess.run(
        ["psql", dsn, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(path)],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return True, ""
    return False, f"{label}\n{result.stderr.strip()}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", default=os.getenv("DATABASE_URL", ""))
    args = parser.parse_args()

    if not args.dsn:
        print("no --dsn and no DATABASE_URL; nothing to apply to", file=sys.stderr)
        return 2

    migrations = _migrations()
    if not migrations:
        print(f"no migrations found in {MIGRATIONS}", file=sys.stderr)
        return 2

    # A gap in the numbering is worth saying out loud. It is not always wrong —
    # a migration can be withdrawn — but it is always worth knowing, because
    # the numbers are what a person applies them by.
    numbers = [n for n, _ in migrations]
    gaps = [n for n in range(numbers[0], numbers[-1] + 1) if n not in numbers]
    duplicates = sorted({n for n in numbers if numbers.count(n) > 1})

    print(f"applying {len(migrations)} migrations to {args.dsn.split('@')[-1]}")

    ok, message = _apply(args.dsn, STUBS, "supabase stubs")
    if not ok:
        print(f"FAIL  {message}", file=sys.stderr)
        return 1
    print("  ok    supabase stubs (auth, storage)")

    for _, path in migrations:
        ok, message = _apply(args.dsn, path, path.name)
        if not ok:
            print(f"\nFAIL  {message}", file=sys.stderr)
            return 1
        print(f"  ok    {path.name}")

    for path in _claims_idempotent():
        ok, message = _apply(args.dsn, path, f"{path.name} (second time)")
        if not ok:
            print(
                f"\n\nFAIL  {message}\n\n{path.name} is written in the guarded "
                "spelling, which is a promise that an operator who cannot "
                "remember whether it already ran may run it again. It is not "
                "one.",
                file=sys.stderr,
            )
            return 1
        print(f"  ok    {path.name} applied twice, as it says it can be")

    if duplicates:
        print(f"\nFAIL  two migrations share a number: {duplicates}", file=sys.stderr)
        return 1
    if gaps:
        print(f"\nnote: gaps in the numbering: {gaps}")

    print(f"\nPASS  {len(migrations)} migrations, {numbers[0]:03d}–{numbers[-1]:03d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
