"""Every request handler that touches a musician's rows must know whose they are.

**The service-role key bypasses RLS.** Nothing in the database stops a query
made with it from returning or changing another account's rows — the owner
filter in the handler is the only thing that does. There are 54 such queries
across this API, and the audit that established they are all scoped was done by
reading them.

That is the shape of every defect this repository keeps finding: true today,
guarded by nobody. A handler added next month that reads

    client.table("scores").update(patch).eq("id", body.score_id).execute()

is a cross-account write. It passes every other test here, and it looks exactly
like the code around it, because most of that code is correct for a reason the
query itself does not show — the owner check happened on the `select` above it.

**What this checks, exactly.** Every function in `app/routers/` carrying a
route decorator, whose body queries a user-owned table, must mention `user_id`
somewhere in that body. Measured when written: **17 such handlers, 0 without
it.**

**What it does not check, said plainly rather than left to be discovered.** It
is awareness, not correctness — a handler that mentions `user_id` and filters
on the wrong thing passes. And 16 of the 41 chains live in module-level helpers
like `discard_pages_of`, which are handed a row someone else already scoped;
a helper cannot tell whose row it was given, so nothing here can check it.
Those are the two places to look first when reviewing a new endpoint by hand.

Coarse on purpose. The failure it catches is the one that actually happens: a
handler written with no notion of ownership at all.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

ROUTERS = Path(__file__).resolve().parents[1] / "routers"

#: Tables whose rows belong to one musician. A query on any of these that is
#: not owner-scoped can cross accounts.
#:
#: Listed rather than derived because the schema is in SQL migrations, not in
#: Python — and getting a name *wrong* here weakens the check silently, so the
#: vacuity guard below is what stops that from passing unnoticed.
USER_TABLES = frozenset(
    {
        "analyses",
        "scores",
        "users",
        "pending_uploads",
        "training_corrections",
        "verdict_corrections",
    }
)

_ROUTE_METHODS = frozenset({"get", "post", "put", "patch", "delete"})

#: A floor. If a rename or a refactor stops this finding handlers, it must fail
#: rather than report a clean API.
_MIN_HANDLERS = 12


def _is_route_handler(node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    """`@router.post(...)` and friends, however the router object is named."""
    for decorator in node.decorator_list:
        target = decorator.func if isinstance(decorator, ast.Call) else decorator
        if isinstance(target, ast.Attribute) and target.attr in _ROUTE_METHODS:
            return True
    return False


def _handlers_touching_user_tables() -> list[tuple[str, str, set[str], str]]:
    """(file, handler, tables it queries, its source) for each one."""
    found: list[tuple[str, str, set[str], str]] = []
    for path in sorted(ROUTERS.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        lines = source.split("\n")
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not _is_route_handler(node):
                continue
            body = "\n".join(lines[node.lineno - 1 : node.end_lineno])
            tables = set(re.findall(r'\.table\(\s*"(\w+)"\s*\)', body)) & USER_TABLES
            if tables:
                found.append((path.name, node.name, tables, body))
    return found


def test_there_are_handlers_to_check() -> None:
    """A guard against the whole file passing because it found nothing.

    The table names above are hand-written, and a typo in one of them would
    silently shrink what is checked. So would a rename of `app/routers/`. Both
    show up here as a count that fell.
    """
    handlers = _handlers_touching_user_tables()
    assert len(handlers) >= _MIN_HANDLERS, (
        f"only {len(handlers)} route handlers found touching {sorted(USER_TABLES)} "
        f"under {ROUTERS} — the scan is looking in the wrong place, not at an "
        "API that stopped using the database"
    )


def test_no_handler_touches_a_musicians_rows_without_knowing_whose() -> None:
    blind = [
        f"{file}:{handler}() queries {sorted(tables)}"
        for file, handler, tables, body in _handlers_touching_user_tables()
        if "user_id" not in body
    ]
    assert not blind, (
        "these handlers query a user-owned table with no mention of `user_id`:\n  "
        + "\n  ".join(blind)
        + "\n\nThe service-role key bypasses RLS, so the filter in the handler is "
        "the only thing\nbetween one musician and another's rows. Scope the "
        "query with the `user_id` from\n`current_user_id`, or — if the row was "
        "already owner-scoped by a call above — say so\nwhere a reader can see "
        "it."
    )
