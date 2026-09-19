"""The readiness probe for migration 021, and the migration's own text.

**Why there is a test on the SQL as well as on the probe.** The probe asks the
database a question, so it is only as good as the function the migration
installs — and the one thing a Python test cannot do here is apply the
migration to a real Postgres and read the catalog back. That belongs to
`tools/check-migrations.py`, which does exactly that on every push. What is
left for this file is the half that *is* knowable from the checkout: that the
migration still names all three roles and both levels, because a revoke that
quietly stops naming `PUBLIC` or stops looping over columns reads as a working
fix and is not one.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.readiness import _client_write_grants_check

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "021_restrict_client_updates.sql"
)


class _Response:
    def __init__(self, data):
        self.data = data


class _Client:
    """The two calls the probe makes, and nothing else."""

    def __init__(self, data=None, raises: Exception | None = None):
        self._data = data
        self._raises = raises
        self.called_with: tuple | None = None

    def rpc(self, name, params):
        self.called_with = (name, params)
        return self

    def execute(self):
        if self._raises is not None:
            raise self._raises
        return _Response(self._data)


def test_closed_grants_pass_and_say_nothing():
    check = _client_write_grants_check(_Client(data=True))

    assert check.ok is True
    # A passing check has nothing to say — see `Check.as_dict`.
    assert check.as_dict()["detail"] == ""


def test_open_grants_block_the_deployment():
    check = _client_write_grants_check(_Client(data=False))

    assert check.ok is False
    assert check.blocking is True


def test_an_open_grant_is_described_as_the_paywall_it_is():
    """The detail has to say what it costs, not name a catalog view.

    Somebody reading `/v1/ready` on a phone needs to know this one is revenue
    rather than a missing column, because the two are fixed by different people
    at different speeds.
    """
    detail = _client_write_grants_check(_Client(data=False)).detail

    assert "tier" in detail
    assert "021" in detail


def test_a_database_without_the_function_is_not_reported_as_closed():
    """The only database where the function is missing is one where 021 has
    not been applied — which is the state this check exists to name. Reporting
    an exception as "cannot say" and then passing would invert it."""
    check = _client_write_grants_check(_Client(raises=RuntimeError("404")))

    assert check.ok is False
    assert "021" in check.detail


def test_a_client_that_answers_something_else_is_not_trusted():
    """`data` is whatever PostgREST returned. Anything that is not exactly
    `True` — None from a stubbed client, a dict, an empty list — means the
    question was not answered, and an unanswered question is not a yes."""
    for answer in (None, [], {}, "true", 1):
        assert _client_write_grants_check(_Client(data=answer)).ok is False


def test_the_probe_asks_for_the_function_the_migration_installs():
    client = _Client(data=True)
    _client_write_grants_check(client)

    assert client.called_with == ("client_write_grants_closed", {})
    assert "client_write_grants_closed" in MIGRATION.read_text()


@pytest.mark.parametrize("role", ["anon", "authenticated", "PUBLIC"])
def test_the_migration_revokes_from_every_client_role(role):
    """**`PUBLIC` is the one that gets dropped.** A privilege granted to
    `PUBLIC` is held by every role including the other two, so a revoke that
    names only `anon` and `authenticated` leaves it standing while reading as
    complete."""
    assert role in MIGRATION.read_text()


@pytest.mark.parametrize(
    "privilege", ["UPDATE", "INSERT", "DELETE", "TRUNCATE"]
)
def test_the_migration_revokes_every_write_privilege(privilege):
    assert privilege in MIGRATION.read_text()


def test_the_migration_revokes_at_column_level_as_well_as_table_level():
    """Table privileges and column privileges are separate entries in Postgres.
    The live project held both on `users`, so a table-only revoke would have
    left `tier` writable while passing every static check."""
    sql = MIGRATION.read_text()

    assert "column_privileges" in sql
    assert "role_table_grants" in sql


def _statements() -> list[str]:
    """The migration's executable lines, with `--` comments stripped.

    **Written because the first version of the test below did not do this and
    failed on its own file.** It looked for `REVOKE` and `SELECT` on one line
    across the raw text, and matched the header prose, and `COMMENT ON TABLE`
    — whose body says "Clients hold SELECT only" and "revoked", so uppercasing
    turns a description of the fix into evidence against it. A scanner that
    reads comments as code says nothing about the code. `test_readiness.py`
    carries the same lesson from the other direction.

    Not a SQL parser: string literals spanning lines would still get through,
    which is why what it feeds is a narrow question rather than a broad one.
    """
    return [
        line.split("--", 1)[0].strip()
        for line in MIGRATION.read_text().splitlines()
        if line.split("--", 1)[0].strip()
    ]


def test_the_migration_keeps_client_reads():
    """SELECT is deliberately kept — the revoke is worth making where it
    removes a reachable write, and the read policies already scope every table
    to its owner. A migration that started revoking SELECT would break reads
    nothing has asked to break."""
    revoking = [
        line
        for line in _statements()
        if line.upper().startswith("REVOKE") and "SELECT" in line.upper()
    ]

    assert revoking == []


def test_neither_loop_sweeps_up_select():
    """The revokes are driven by `privilege_type IN (...)` filters rather than
    written out, so the filters are where SELECT would be swept in — one word
    added to a list, in a file whose whole subject is removing privileges."""
    filters = [
        line for line in _statements() if "privilege_type IN" in line
    ]

    assert len(filters) >= 2, "expected a privilege filter in each revoke loop"
    for line in filters:
        assert "SELECT" not in line.upper()


def test_the_probe_function_pins_its_search_path():
    """`SECURITY DEFINER` without a pinned `search_path` is the hazard
    migration 020 hardened `set_updated_at` against, and this function is the
    only new one since."""
    sql = MIGRATION.read_text()

    assert "SECURITY DEFINER" in sql
    assert "SET search_path = ''" in sql


def test_the_probe_function_is_not_executable_by_clients():
    """It reports the state of the database's privileges. That is an
    operator's question, and PostgREST exposes every function it can reach."""
    sql = MIGRATION.read_text()

    assert "REVOKE EXECUTE ON FUNCTION public.client_write_grants_closed() FROM PUBLIC" in sql
    assert "GRANT EXECUTE ON FUNCTION public.client_write_grants_closed() TO service_role" in sql
