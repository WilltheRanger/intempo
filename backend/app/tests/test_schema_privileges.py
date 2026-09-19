"""Table privileges and function search paths — the other half of the wall.

`test_rls_invariants.py` holds row visibility: every table this schema creates
has RLS on, and no policy's predicate is simply `true`. This file holds the two
things that sit either side of it.

**A grant is permission to ask; a policy is permission to receive.** On a real
project `anon` and `authenticated` arrive holding `ALL` on every table in
`public` — Supabase sets that before the first migration runs, and
`tools/supabase_stubs.sql` now models it so the migrations gate checks a
privilege change against a database that actually started with the privilege.
That arrangement is safe exactly as long as the policies are the only thing
standing between a grant and a row. Where a policy *cannot* express the
restriction, the grant has to go instead, and something has to say so.

**A function whose `search_path` resolves at call time can be pointed at a
schema the caller controls.** Migration 020 hardened `set_updated_at()` by hand
after Supabase's linter flagged it. A rule applied to the one function that
happened to exist when somebody wrote it is a convention, not a check — the
same argument `check-migrations.py` makes about its own idempotency set — so
the second test here generalises it to every function the schema defines.

Both are read out of the SQL. `migrations/checks/021_assignment_transitions.sql`
asserts the privilege half again against a real database, through the catalog;
the pairing is deliberate and is the one `test_readiness.py` describes: this
file checks the spelling, the gate checks the behaviour, and a spelling check
costs no Postgres and fails in the unit suite before a CI cycle is spent.
"""

from __future__ import annotations

import re
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

#: `public.assignments` and `assignments` are the same table.
_QUALIFIER = re.compile(r"^public\.", re.I)

#: Tables where no non-service role may hold UPDATE, and why not.
#:
#: Deliberately a list rather than a derivation. The rule is not "two-party
#: tables lose UPDATE" — it is that a restriction RLS cannot express has to be
#: enforced by the grant, and whether RLS can express a given restriction is a
#: judgement about that table. Each entry carries the judgement.
_NO_DIRECT_UPDATE = {
    "assignments": (
        "A teacher and a student are both the Postgres role `authenticated` — "
        "what separates them lives in `auth.uid()`, inside the policy "
        "predicate, not in the role. So a column-level GRANT cannot give the "
        "teacher `teacher_review_notes` while withholding it from the student, "
        "and RLS is row-level and cannot either. Migration 002 shipped a "
        "policy named `student update status on own assignments` that in fact "
        "let a student write every column of their own row, `status = "
        "'reviewed'` included. 022 revokes the grant — at table *and* column "
        "level, and from `PUBLIC` as well as by name, because a table REVOKE "
        "leaves column grants standing and a privilege held by `PUBLIC` is "
        "held by every role — and routes writes through the API, where the "
        "actor is known."
    ),
}


def _sql_by_file() -> dict[str, str]:
    files = sorted(MIGRATIONS.glob("*.sql"))
    assert files, f"no migrations found under {MIGRATIONS}"
    return {p.name: p.read_text(encoding="utf-8") for p in files}


def _sql() -> str:
    return "\n".join(_sql_by_file().values())


def test_tables_rls_cannot_protect_have_their_update_grant_revoked() -> None:
    sql = _sql()

    for table, reason in _NO_DIRECT_UPDATE.items():
        for role in ("PUBLIC", "anon", "authenticated"):
            revoked = re.search(
                rf"REVOKE\s+[^;]*\bUPDATE\b[^;]*\bON\s+(?:public\.)?{table}\b"
                rf"[^;]*\bFROM\s+[^;]*\b{role}\b",
                sql,
                re.I | re.S,
            )
            assert revoked, (
                f"no migration revokes UPDATE on `{table}` from `{role}`.\n\n"
                f"{reason}\n\n"
                "If a direct-from-client write is genuinely wanted, the answer "
                "is an endpoint, not a re-grant: the app's supabase-js client "
                "is auth-only today and nothing in `mobile/src/` calls "
                "`.from()` or `.table()` on a data table."
            )


def test_every_function_this_schema_defines_pins_its_search_path() -> None:
    """Generalised from 020, which hardened the one function that existed.

    A `SET search_path` on the `CREATE` counts, and so does a later
    `ALTER FUNCTION ... SET search_path` — which is how `set_updated_at()` is
    hardened, four hundred lines and nineteen migrations after it was written.
    What does not count is neither.

    Note what an empty path then requires of the body: nothing unqualified
    resolves, so a function that references a table must name its schema. 020's
    header is explicit that a function which *did* reference a table
    unqualified would break on an empty path — loudly, and at the worst
    moment — which is a reason to check the pinning, not to skip it.
    """
    by_file = _sql_by_file()
    everything = "\n".join(by_file.values())

    created: dict[str, str] = {}
    for name, path in _created_functions(by_file):
        created[name] = path

    assert created, (
        "no `CREATE FUNCTION` found in the migration set — the scan is looking "
        "in the wrong place, not at a schema that stopped defining functions"
    )

    unpinned = sorted(
        f"{name}() (created in {path})"
        for name, path in created.items()
        if not _pins_search_path(name, everything)
    )
    assert not unpinned, (
        "these functions resolve `search_path` at call time:\n  "
        + "\n  ".join(unpinned)
        + "\n\nA caller who can create a schema on that path can define their "
        "own `now()`\nand have the function run it. Add `SET search_path = ''` "
        "to the definition —\nand qualify every reference in the body, because "
        "nothing resolves on an empty\npath. See migration 020, which does "
        "this to `set_updated_at()` and explains why\n`''` rather than "
        "`pg_catalog, public`."
    )


def _created_functions(by_file: dict[str, str]) -> list[tuple[str, str]]:
    """Every function the migration set defines, as (bare name, file)."""
    pattern = re.compile(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][a-z_0-9.]*)\s*\(",
        re.I,
    )
    found: list[tuple[str, str]] = []
    for filename, sql in by_file.items():
        for match in pattern.findall(sql):
            bare = _QUALIFIER.sub("", match).lower()
            # `auth.uid()` and `storage.foldername()` are Supabase's own; only
            # the stub file defines them and it is not a migration.
            if "." in bare:
                continue
            found.append((bare, filename))
    return found


def _pins_search_path(name: str, sql: str) -> bool:
    inline = re.search(
        rf"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?{name}\s*\("
        rf".*?\bSET\s+search_path\s*=",
        sql,
        re.I | re.S,
    )
    if inline and _before_body(inline.group(0)):
        return True
    altered = re.search(
        rf"ALTER\s+FUNCTION\s+(?:public\.)?{name}\s*\([^)]*\)\s*"
        rf"SET\s+search_path\s*=",
        sql,
        re.I | re.S,
    )
    return altered is not None


def _before_body(fragment: str) -> bool:
    """`SET search_path` must be in the function's option list, not its body.

    A `$$ ... SET search_path = ... $$` inside plpgsql sets it for the call and
    is a different thing from pinning the function — the window in which the
    caller's path applies is exactly what the pin closes. So the match only
    counts if it lands before the body opens.
    """
    body = re.search(r"\bAS\s+(\$[a-z_]*\$|')", fragment, re.I)
    return body is None
