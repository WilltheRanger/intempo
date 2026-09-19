"""Static guard for migration 021's deployment security probe."""

from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "021_restrict_client_updates.sql"
)


def test_client_grant_probe_covers_every_column_on_both_protected_tables() -> None:
    """A new writable column must not sit outside the readiness answer."""
    sql = MIGRATION.read_text(encoding="utf-8")

    for role in ("anon", "authenticated"):
        for table in ("users", "assignments"):
            call = (
                f"has_any_column_privilege('{role}', "
                f"'public.{table}', 'UPDATE')"
            )
            assert sql.count(call) >= 2, (
                f"{role} UPDATE grants on {table} are not checked both while "
                "applying migration 021 and by its live readiness RPC"
            )
