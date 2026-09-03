"""A table with RLS off is readable by anyone holding the anon key.

The anon key ships **inside the app bundle** — it is `EXPO_PUBLIC_SUPABASE_
ANON_KEY`, inlined into 3.3 MB of public JavaScript, and it is designed to be
public. What makes that safe is row-level security: every policy in this
schema is `auth.uid() = <owner column>`, so the key can only ever reach the
signed-in musician's own rows.

**A migration that creates a table and forgets `ENABLE ROW LEVEL SECURITY`
hands that key the whole table.** Not a subtle leak — every row, to anyone who
runs `strings` on the bundle. It is one missing line in a file that is applied
by hand against a live database, and nothing here checked for it.

Audited: 9 tables, 9 with RLS, no policy broader than its owner column. This
holds that.

**`pending_uploads` deliberately has RLS on and no policy at all**, which is
the safe direction — RLS with no policy denies everything to anon, and only
the service role touches that table. So this checks the `ENABLE`, never the
existence of a policy: requiring one would push somebody to write a permissive
policy to satisfy a test.
"""

from __future__ import annotations

import re
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

#: Tables this schema does not create and must not be asked to secure.
#: `storage.objects` is Supabase's own; 009 adds avatar policies to it.
_NOT_OURS = frozenset({"storage.objects", "objects"})

#: A floor, so a renamed directory fails instead of reporting a clean schema.
_MIN_TABLES = 8

_CREATE = re.compile(
    r"create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z_0-9.]*)", re.I
)
_ENABLE = re.compile(
    r"alter\s+table\s+([a-z_][a-z_0-9.]*)\s+enable\s+row\s+level\s+security", re.I
)
#: `USING (true)` / `WITH CHECK (true)` — a policy that checks nothing.
_WIDE_OPEN = re.compile(r"(?:using|with\s+check)\s*\(\s*true\s*\)", re.I)


def _sql() -> str:
    files = sorted(MIGRATIONS.glob("*.sql"))
    assert files, f"no migrations found under {MIGRATIONS}"
    return "\n".join(p.read_text(encoding="utf-8") for p in files)


def _bare(name: str) -> str:
    return name.lower().removeprefix("public.")


def test_every_table_this_schema_creates_has_row_level_security() -> None:
    sql = _sql()
    created = {_bare(m) for m in _CREATE.findall(sql)} - _NOT_OURS
    enabled = {_bare(m) for m in _ENABLE.findall(sql)} - _NOT_OURS

    assert len(created) >= _MIN_TABLES, (
        f"only {len(created)} tables found in {MIGRATIONS} — the scan is looking "
        "in the wrong place, not at a schema that stopped having tables"
    )

    missing = sorted(created - enabled)
    assert not missing, (
        "these tables are created without `ENABLE ROW LEVEL SECURITY`:\n  "
        + "\n  ".join(missing)
        + "\n\nThe anon key is inlined into the published app bundle. Without RLS "
        "it reads every\nrow of these tables. Add "
        "`ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` in the same\nmigration that "
        "creates the table — and a policy only if a signed-in musician is "
        "meant\nto reach it directly; no policy denies everything, which is the "
        "safe default."
    )


def test_no_policy_checks_nothing() -> None:
    """`USING (true)` is RLS enabled and doing nothing, which reads as secured.

    Worse than no policy, because `ENABLE ROW LEVEL SECURITY` is present and
    the table looks protected in every audit that greps for it — including the
    test above.
    """
    for path in sorted(MIGRATIONS.glob("*.sql")):
        wide = _WIDE_OPEN.findall(path.read_text(encoding="utf-8"))
        assert not wide, (
            f"{path.name} has a policy predicate that is simply `true`: {wide}. "
            "Scope it to the row's owner, or drop the policy — with RLS on and "
            "no policy, nothing reaches the table but the service role."
        )
