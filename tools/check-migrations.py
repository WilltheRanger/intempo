#!/usr/bin/env python3
"""Apply every migration, in order, to an empty database.

**Nothing has ever checked that these files run.** They are applied by hand to
a Supabase project, one at a time, and the only evidence any of them works is
that somebody watched it. CLAUDE.md records what that costs: 013, 014 and 015
sat unapplied for weeks while a defect they fix looked parked, and the
**paused** project is *still* four behind the live one — so the day it is
unpaused, four migrations run in a row against production with nobody having
seen them run in sequence anywhere. (Both are named in `LOCAL_NOTES.md`, which
is not in the repository; `list_projects` distinguishes them by status.)

This runs them in sequence. It is the cheapest possible version of that day.

**What it proves:** the set applies in filename order on an empty database,
no file references a table or column an earlier one has not created, the SQL
parses, every file that claims to be idempotent survives being applied twice,
and every behavioural assertion under `migrations/checks/` holds against the
finished schema — see `_checks()` for why that stage exists at all.

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
CHECKS = MIGRATIONS / "checks"
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


def _checks() -> list[Path]:
    """Behavioural assertions to run once the whole set has applied.

    A migration whose effect is not visible in its own text may ship a file of
    the same name under `migrations/checks/`. It is plain SQL — `DO $$ ...
    RAISE EXCEPTION ... $$` — so `ON_ERROR_STOP` makes a failed assertion a
    failed gate, and it never runs against a project.

    **This exists because 021 is the first migration that installs behaviour.**
    Everything before it adds a column, a table or a policy, and the static
    readers cover those: `test_readiness.py` reads the spelling,
    `test_rls_invariants.py` reads the policies. Neither can say whether a
    trigger rejects `archived -> assigned`, and `readiness.py` cannot either —
    it probes columns and tables over REST, and a trigger is neither. Running
    the SQL is the only thing that knows, and this is the one place with a
    database to run it against.

    Derived from the directory rather than listed, for the reason
    `_claims_idempotent` gives about its own set: a hand-maintained list is
    enforced for the files that happened to exist when somebody wrote it.

    Run after **every** migration rather than after its own, because an
    assertion about the finished schema is the useful kind — a later migration
    that revokes the wrong grant or drops the trigger should fail here too.
    """
    if not CHECKS.is_dir():
        return []
    return sorted(CHECKS.glob("*.sql"))


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


def _simulate_client_grants(dsn: str) -> tuple[bool, str]:
    """Recreate the permissive grants a live Supabase project may carry."""
    sql = (
        "GRANT UPDATE ON public.users, public.assignments TO authenticated; "
        "GRANT UPDATE (tier, email) ON public.users TO anon; "
        "GRANT UPDATE (status, teacher_user_id) ON public.assignments TO anon;"
    )
    result = subprocess.run(
        ["psql", dsn, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0, result.stderr.strip()


def _verify_client_grants_closed(dsn: str) -> tuple[bool, str]:
    """Ask migration 021's own deployment probe after the hostile grants."""
    result = subprocess.run(
        [
            "psql",
            dsn,
            "-v",
            "ON_ERROR_STOP=1",
            "-qAt",
            "-c",
            "SELECT public.client_write_grants_closed();",
        ],
        capture_output=True,
        text=True,
    )
    closed = result.returncode == 0 and result.stdout.strip() == "t"
    detail = result.stderr.strip() or (
        "client_write_grants_closed() returned " + repr(result.stdout.strip())
    )
    return closed, detail


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

    for number, path in migrations:
        if number == 21:
            ok, message = _simulate_client_grants(args.dsn)
            if not ok:
                print(f"\nFAIL  simulated client grants\n{message}", file=sys.stderr)
                return 1
        ok, message = _apply(args.dsn, path, path.name)
        if not ok:
            print(f"\nFAIL  {message}", file=sys.stderr)
            return 1
        print(f"  ok    {path.name}")
        if number == 21:
            ok, message = _verify_client_grants_closed(args.dsn)
            if not ok:
                print(f"\nFAIL  client grant probe\n{message}", file=sys.stderr)
                return 1
            print("  ok    client write grants closed, table and column level")

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

    checks = _checks()
    if not checks:
        print("\nnote: no behavioural checks under migrations/checks/")
    for path in checks:
        ok, message = _apply(args.dsn, path, f"checks/{path.name}")
        if not ok:
            print(
                f"\n\nFAIL  {message}\n\nThat is a behavioural assertion about "
                "the finished schema, not a syntax error. The migration applied; "
                "what it installed does not do what its header says.",
                file=sys.stderr,
            )
            return 1
        print(f"  ok    checks/{path.name}")

    if duplicates:
        print(f"\nFAIL  two migrations share a number: {duplicates}", file=sys.stderr)
        return 1
    if gaps:
        print(f"\nnote: gaps in the numbering: {gaps}")

    print(f"\nPASS  {len(migrations)} migrations, {numbers[0]:03d}–{numbers[-1]:03d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
