"""`/v1/ready` — what this deployment can do, and what is stopping it.

`/v1/health` returned 200 on a deployment with no service-role key, no model
key, and a database missing a column the code writes to. Render therefore
reported the service **live** while every write returned 500, and a musician
who could not sign in had no way to tell a missing key from a bug.

These tests hold the two properties that make the answer worth reading: it
names what is wrong in the musician's terms, and it never names a value.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import config as app_config
from app.main import app
from app.services import readiness
from app.services.readiness import Check, Readiness


def _settings():
    """The settings object the code will actually read, fetched now.

    Not a module-level binding. `test_cors.py` rebuilds the CORS middleware by
    reloading `app.config`, which replaces this object — so a test holding the
    old one patches something nothing reads, and passes or fails depending on
    which file ran first. It did: three tests here were green alone and red in
    the suite.

    Imported as `app_config` because `from app.main import app` shadows the
    package — `app.config` then resolves to an attribute of the FastAPI
    instance, which is a very confusing AttributeError to read.
    """
    return app_config.settings

client = TestClient(app)


@pytest.fixture
def unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_settings(), "SUPABASE_URL", "")
    monkeypatch.setattr(_settings(), "SUPABASE_KEY", "")
    monkeypatch.setattr(_settings(), "SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setattr(_settings(), "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(_settings(), "GEMINI_API_KEY", "")


def test_a_bare_deployment_is_not_ready_and_says_why(unconfigured) -> None:
    result = readiness.check()
    assert result.ready is False
    joined = " ".join(result.blocking)
    assert "SUPABASE_SERVICE_ROLE_KEY" in joined
    assert "sheet-music reader" in joined


def test_it_never_reports_a_value(monkeypatch: pytest.MonkeyPatch) -> None:
    """The whole point is that this can be opened on a phone and pasted into a
    chat. A check that leaks the key it is checking for would be worse than no
    check at all."""
    secrets = {
        "SUPABASE_URL": "https://project.supabase.co",
        "SUPABASE_KEY": "anon-key-vvvvvvvvvvvvvvvvvvvv",
        "SUPABASE_SERVICE_ROLE_KEY": "service-role-wwwwwwwwwwwwwwww",
        "ANTHROPIC_API_KEY": "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx",
        "GEMINI_API_KEY": "AIza-yyyyyyyyyyyyyyyyyyyyyyyy",
    }
    for name, value in secrets.items():
        monkeypatch.setattr(_settings(), name, value)

    body = repr(readiness.check().as_dict())
    for name, value in secrets.items():
        assert value not in body, f"{name}'s value leaked into /v1/ready"


def test_one_stale_model_name_does_not_stop_the_others(
    monkeypatch: pytest.MonkeyPatch, unconfigured
) -> None:
    """The bug this was written for: the shipped chain named two models from
    the previous Claude generation, `_default_chain()` raised, and no page could
    be read at all even though a usable model was configured."""
    monkeypatch.setattr(_settings(), "ANTHROPIC_API_KEY", "present")
    monkeypatch.setattr(_settings(), "OCR_PROVIDER_CHAIN", "claude-sonnet-4-6,claude-sonnet-5"
    )

    result = readiness.check()
    names = {c.name: c for c in result.checks}

    assert names["sheet_music_reading"].ok, "a usable model was configured"
    stale = names["ocr_provider_chain"]
    assert stale.ok is False
    assert "claude-sonnet-4-6" in stale.detail
    assert stale.blocking is False, "a renamed model costs that model, not the feature"


def test_a_chain_with_nothing_usable_is_reported_not_raised(
    monkeypatch: pytest.MonkeyPatch, unconfigured
) -> None:
    monkeypatch.setattr(_settings(), "OCR_PROVIDER_CHAIN", "not-a-model,also-not")
    result = readiness.check()
    assert result.ready is False
    assert any("OCR_PROVIDER_CHAIN" in b for b in result.blocking)


def test_a_missing_migration_names_the_file_to_apply(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Migrations are applied by hand, so shipping code and applying its schema
    are two acts with an invisible gap between them. `analyses.instrument` went
    live in code before the column existed; every take submission would have
    failed with something that reads like a server bug."""

    class _Missing:
        def table(self, name):
            return self

        def select(self, *cols, **kw):
            if "instrument" in cols:
                raise RuntimeError("column analyses.instrument does not exist")
            return self

        def limit(self, _n):
            return self

        def execute(self):
            return None

    monkeypatch.setattr(readiness, "get_service_client", lambda: _Missing())
    monkeypatch.setattr(_settings(), "SUPABASE_SERVICE_ROLE_KEY", "present")

    result = readiness.check()
    failed = [c for c in result.checks if c.name == "schema:analyses.instrument"]
    assert failed and failed[0].ok is False
    assert "008" in failed[0].detail, "say which migration to apply"
    assert result.ready is False


def test_ready_answers_503_when_something_blocking_is_missing(unconfigured) -> None:
    res = client.get("/v1/ready")
    assert res.status_code == 503
    assert res.json()["ready"] is False


def test_health_stays_trivial_and_green(unconfigured) -> None:
    """Render's health check points at `/v1/health`. A deployment missing its
    keys must stay up and say so on `/v1/ready`, not crash-loop and say
    nothing."""
    res = client.get("/v1/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_readiness_is_ready_when_every_blocking_check_passes() -> None:
    result = Readiness(
        checks=[
            Check(name="a", ok=True, detail=""),
            Check(name="b", ok=False, detail="degraded", blocking=False),
        ]
    )
    assert result.ready is True
    assert result.blocking == []


class TestTheOneMisconfigurationThatNamesNothing:
    """CORS is the only setting in this list whose failure is silent everywhere.

    A missing key produces a 500 with a message. A missing column produces a
    column-not-found. A stale provider name is logged. A browser refused by
    CORS never sends the request at all — there is no server log, no status
    code, and the only thing the client can report is "Failed to fetch".

    So it is named here, and deliberately **not** blocking: unset is correct
    for a local server and for a deployment serving only the native app, and a
    503 on a working API would teach whoever reads this endpoint to stop
    reading it.
    """

    def test_it_is_reported_when_unset(self, monkeypatch) -> None:
        from app.services.readiness import _configuration_checks


        monkeypatch.setattr(_settings(), "CORS_ALLOWED_ORIGINS", "", raising=False)
        check = next(
            c for c in _configuration_checks() if c.name == "cors_allowed_origins"
        )

        assert check.ok is False
        assert "Failed to fetch" in check.detail, (
            "the detail has to name the symptom, because nothing else will"
        )

    def test_it_does_not_stop_a_deployment_being_ready(self, monkeypatch) -> None:
        from app.services.readiness import _configuration_checks


        monkeypatch.setattr(_settings(), "CORS_ALLOWED_ORIGINS", "", raising=False)
        check = next(
            c for c in _configuration_checks() if c.name == "cors_allowed_origins"
        )

        assert check.blocking is False

    def test_it_passes_once_an_origin_is_named(self, monkeypatch) -> None:
        from app.services.readiness import _configuration_checks


        monkeypatch.setattr(_settings(), "CORS_ALLOWED_ORIGINS", "https://intempo.pages.dev", raising=False
        )
        check = next(
            c for c in _configuration_checks() if c.name == "cors_allowed_origins"
        )

        assert check.ok is True

    def test_it_still_reports_no_value(self, monkeypatch) -> None:
        """The endpoint's standing promise, and an origin list is not a secret —
        but the rule is that nothing here echoes a setting, and one exception
        is how that stops being true."""
        from app.services.readiness import _configuration_checks


        monkeypatch.setattr(_settings(),
            "CORS_ALLOWED_ORIGINS",
            "https://something-identifiable.example",
            raising=False,
        )
        rendered = " ".join(
            c.detail + c.name for c in _configuration_checks()
        )

        assert "something-identifiable" not in rendered


def test_every_column_migration_has_a_readiness_check() -> None:
    """The list goes stale silently, and it already had.

    `REQUIRED_COLUMNS` carries the instruction "add a row here whenever a
    migration adds a column the code depends on" — and 005 added
    `scores.movement`, which `PATCH /v1/scores/:id` writes, and never got one.
    A deployment missing it would 500 on any edit that touches a movement, and
    `/v1/ready` would have said it was fine.

    So the tree is the source of truth rather than the comment. A migration
    that adds a column needs a row here; one that does something else does not,
    and 004 — which drops a NOT NULL — is named as the exception it is.
    """
    import re
    from pathlib import Path

    from app.services.readiness import REQUIRED_COLUMNS

    migrations = Path(__file__).resolve().parents[1] / "migrations"
    checked = {number for _, _, number in REQUIRED_COLUMNS}

    missing: list[str] = []
    for path in sorted(migrations.glob("*.sql")):
        number = path.name.split("_", 1)[0]
        adds_column = re.search(r"ADD\s+COLUMN", path.read_text(), re.IGNORECASE)
        if adds_column and number not in checked:
            missing.append(path.name)

    # 001 creates the tables outright; a database without it fails the
    # `database` check long before any column is looked for.
    missing = [name for name in missing if not name.startswith("001")]

    assert missing == [], (
        f"{missing} add columns with no entry in REQUIRED_COLUMNS — a "
        f"deployment missing them would 500 while /v1/ready reported ready"
    )


def test_a_missing_post_initial_table_names_its_migration() -> None:
    """Cleanup and consent tables are not covered by column probes.

    The pending-upload registry was missing from production while readiness
    checked every score column and reported no fact about abandoned uploads.
    """

    class _MissingTable:
        current = ""

        def table(self, name):
            self.current = name
            return self

        def select(self, *_columns):
            if self.current == "pending_uploads":
                raise RuntimeError("relation pending_uploads does not exist")
            return self

        def limit(self, _count):
            return self

        def execute(self):
            return None

    checks = {
        check.name: check
        for check in readiness._schema_checks(_MissingTable())
    }

    missing = checks["schema:pending_uploads"]
    assert missing.ok is False
    assert "014" in missing.detail
    assert checks["schema:training_corrections"].ok is True


def test_every_post_initial_table_migration_has_a_readiness_check() -> None:
    """A new CREATE TABLE cannot silently outgrow `/v1/ready`."""
    import re
    from pathlib import Path

    from app.services.readiness import REQUIRED_TABLES

    migrations = Path(__file__).resolve().parents[1] / "migrations"
    checked = {number for _, number in REQUIRED_TABLES}
    missing: list[str] = []
    for path in sorted(migrations.glob("*.sql")):
        number = path.name.split("_", 1)[0]
        creates_table = re.search(
            r"CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+",
            path.read_text(),
            re.IGNORECASE,
        )
        if creates_table and number != "001" and number not in checked:
            missing.append(path.name)

    assert missing == [], (
        f"{missing} create tables with no entry in REQUIRED_TABLES — a "
        "deployment missing them would look ready"
    )


#: The first migration written under the rule that a migration may be run twice.
#:
#: 001 and 005-011 predate it and are left alone deliberately: they have run
#: everywhere they need to, and rewriting applied history to satisfy a test is a
#: worse trade than recording where the rule starts. Re-running one of those is
#: an error rather than damage — `ADD COLUMN` on an existing column simply
#: fails — so the cost of the exemption is a confusing message to an operator,
#: not a broken database.
FIRST_IDEMPOTENT_MIGRATION = 13


def test_migrations_written_under_the_rule_are_safe_to_run_again() -> None:
    """The SQL editor is manual; uncertainty must not make retry dangerous.

    **Generalised from a test that named 013 and 014 by hand.** Those two were
    checked statement by statement and nothing covered 015, or anything after
    it — so the rule was enforced for the two files that happened to exist when
    it was written, which is the shape of a convention rather than a check.
    Applying migrations is a manual act against a production database, and the
    operator's guess about whether one already ran is exactly what the guards
    exist to make free.

    `ADD CONSTRAINT` is called out separately because Postgres has no
    `IF NOT EXISTS` form for it. The only safe spelling is to drop it first,
    which 015 does, and a reader copying the surrounding style would not know
    that from the other statements.
    """
    import re
    from pathlib import Path

    migrations = Path(__file__).resolve().parents[1] / "migrations"

    #: Statement, and the spelling that makes re-running it a no-op.
    GUARDED = (
        (r"ADD\s+COLUMN\b", r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b"),
        (r"CREATE\s+TABLE\b", r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b"),
        (r"CREATE\s+INDEX\b", r"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b"),
        (r"CREATE\s+POLICY\b", r"IF\s+NOT\s+EXISTS\s*\("),
    )

    unguarded: list[str] = []
    for path in sorted(migrations.glob("*.sql")):
        number = path.name.split("_", 1)[0]
        if not number.isdigit() or int(number) < FIRST_IDEMPOTENT_MIGRATION:
            continue
        sql = path.read_text()
        for statement, guard in GUARDED:
            bare = len(re.findall(statement, sql, re.IGNORECASE))
            safe = len(re.findall(guard, sql, re.IGNORECASE))
            if bare > safe:
                unguarded.append(f"{path.name}: {bare - safe}x {statement}")
        # No `IF NOT EXISTS` exists for this one, so the guard is a prior drop.
        adds = len(re.findall(r"ADD\s+CONSTRAINT\b", sql, re.IGNORECASE))
        drops = len(re.findall(r"DROP\s+CONSTRAINT\s+IF\s+EXISTS\b", sql, re.IGNORECASE))
        if adds > drops:
            unguarded.append(
                f"{path.name}: {adds - drops}x ADD CONSTRAINT with no DROP ... IF EXISTS before it"
            )

    assert unguarded == [], (
        f"{unguarded} cannot be run twice. Migrations are applied by hand in "
        "the Supabase SQL editor, where an operator unsure whether one already "
        "ran must be free to run it again."
    )


def test_the_idempotency_rule_still_covers_the_migrations_it_was_written_for() -> None:
    """The generalised check must not have gone vacuous.

    A rule that skips every file is a passing test that guards nothing, which
    is how a cut-off constant fails. 013, 014 and 015 were verified by hand and
    are the floor: whatever else changes, those three stay in scope.
    """
    from pathlib import Path

    migrations = Path(__file__).resolve().parents[1] / "migrations"
    covered = sorted(
        path.name.split("_", 1)[0]
        for path in migrations.glob("*.sql")
        if path.name.split("_", 1)[0].isdigit()
        and int(path.name.split("_", 1)[0]) >= FIRST_IDEMPOTENT_MIGRATION
    )
    assert {"013", "014", "015"} <= set(covered), covered


class TestTheWorkerWillFetchWhatStorageAccepted:
    """Two numbers in two systems, and nothing ever compared them.

    The worker's download cap was **25 MB**, with a comment describing a client
    that no longer exists — "~2 MB AAC / ~10 MB WAV". The app records
    uncompressed WAV now, so 25 MB is 4.6 minutes, while the `audio-uploads`
    bucket accepts 50. A six-minute take uploaded successfully, sat in storage,
    and was refused by the thing meant to read it — reported to the musician as
    `audio_unavailable`, which was not true. The audio was fine and reachable.
    """

    class _Bucket:
        def __init__(self, limit):
            self.file_size_limit = limit

    class _Storage:
        def __init__(self, limit, raises=False):
            self._limit, self._raises = limit, raises

        def get_bucket(self, _name):
            if self._raises:
                raise RuntimeError("nope")
            return TestTheWorkerWillFetchWhatStorageAccepted._Bucket(self._limit)

    class _Client:
        def __init__(self, limit, raises=False):
            self.storage = TestTheWorkerWillFetchWhatStorageAccepted._Storage(
                limit, raises
            )

    @staticmethod
    def _check(client):
        """The audio bucket's check. There is one per bucket now — the same
        mismatch is possible for photographs, and `score-images` is 10 MB."""
        from app.services.readiness import _storage_checks

        return next(
            c for c in _storage_checks(client) if c.name.endswith("audio-uploads")
        )

    def test_the_real_bucket_limit_is_covered(self) -> None:
        """50 MB is what the project is actually configured with."""
        assert self._check(self._Client(50 * 1024 * 1024)).ok is True

    def test_a_bucket_bigger_than_the_worker_is_reported(self) -> None:
        check = self._check(self._Client(200 * 1024 * 1024))

        assert check.ok is False
        assert "200 MB" in check.detail
        assert "uploads and is then reported as unavailable" in check.detail

    def test_no_limit_set_is_not_a_failure(self) -> None:
        """A bucket with no explicit limit takes the project default, which
        this cannot see. Guessing would be worse than saying nothing."""
        assert self._check(self._Client(None)).ok is True

    def test_a_bucket_that_cannot_be_read_is_a_failure(self) -> None:
        """If the bucket is unreachable, a recording may not be storable at
        all — which is worth saying before a musician finds out by recording."""
        check = self._check(self._Client(None, raises=True))

        assert check.ok is False
        assert "could not be read" in check.detail

    def test_the_cap_covers_the_longest_take_the_app_will_record(self) -> None:
        """The chain has three limits and the smallest one binds.

        The recorder caps by bytes at the bucket's 50 MB; the bucket holds 50;
        this must fetch 50. A number here below either of those is a hole with
        a wrong error message in it.
        """
        from app.workers.analysis_runner import MAX_AUDIO_BYTES

        assert MAX_AUDIO_BYTES >= 50 * 1024 * 1024


def _bucket_client(limit: int | None = 10 * 1024 * 1024, missing: set[str] | None = None):
    """A storage client whose buckets report `limit`, and which raises for any
    bucket named in `missing`."""

    class _Bucket:
        file_size_limit = limit

    class _Storage:
        def get_bucket(self, name):
            if missing and name in missing:
                raise RuntimeError("Bucket not found")
            return _Bucket()

    class _Client:
        storage = _Storage()

    return _Client()


def test_every_bucket_the_app_writes_to_is_checked() -> None:
    """The same mismatch is possible for photographs.

    `score-images` is 10 MB and `MAX_IMAGE_BYTES` is 12 — the *safe* direction,
    with a comment saying so, which is how it should have been on the audio
    side and was not. Checking only the bucket that happened to be broken
    would leave the correct one free to drift into being the broken one.

    `avatars` joined them with migration 009. It has no reader and therefore no
    cap to compare against, which is exactly why it was missed: the check was
    written as a size-mismatch check and a bucket with no size looks like
    nothing to check. What it still has is existence.
    """
    from app.services.readiness import _storage_checks

    names = {c.name for c in _storage_checks(_bucket_client())}
    assert names == {
        "storage:audio-uploads",
        "storage:score-images",
        "storage:avatars",
    }
    assert all(c.ok for c in _storage_checks(_bucket_client()))


def test_a_bucket_that_does_not_exist_is_reported() -> None:
    """Migration 009 adds four columns *and* a bucket. The columns have their
    own `schema:` checks, so a deployment that applied the column half and not
    the bucket half reported entirely ready — and every onboarding attempt died
    at the upload with nothing anywhere saying why.
    """
    from app.services.readiness import _storage_checks

    checks = {c.name: c for c in _storage_checks(_bucket_client(missing={"avatars"}))}

    assert checks["storage:avatars"].ok is False
    assert "profile picture" in checks["storage:avatars"].detail
    # And only that one. A single missing bucket is not a broken storage layer.
    assert checks["storage:score-images"].ok is True


def test_a_bucket_with_no_reader_is_not_judged_on_its_size() -> None:
    """`avatars` has no cap of its own to disagree with — the picture goes from
    storage straight to an `<img>`. A limit-comparison branch reached with no
    limit to compare would either invent one or read `None` as zero."""
    from app.services.readiness import _storage_checks

    for limit in (1, 10 * 1024 * 1024, 500 * 1024 * 1024, None):
        checks = {c.name: c for c in _storage_checks(_bucket_client(limit=limit))}
        assert checks["storage:avatars"].ok is True, limit


# ---------------------------------------------------------------------------
# Where the analysis runs
#
# The dispatcher falls back to in-process when Modal refuses, on purpose: a
# musician who has just finished playing should not lose the take to a
# deployment setting. The cost is that "it fell back" and "it worked" look
# identical from outside, and a deployment quietly analysing everything on the
# 512 MB web box looks perfectly healthy until two people record at once.
# ---------------------------------------------------------------------------


def _runtime_checks(monkeypatch, *, runtime: str) -> dict[str, Check]:
    from app.workers import dispatch

    monkeypatch.setattr(dispatch, "ANALYSIS_RUNTIME", runtime)
    return {c.name: c for c in readiness._analysis_runtime_checks()}


def test_in_process_is_reported_without_reaching_for_modal(monkeypatch) -> None:
    """The default has nothing to check and must not pay for checking it —
    importing modal costs ~39 MB on a box with 512."""
    import builtins

    real = builtins.__import__

    def _watch(name, *args, **kwargs):
        assert name != "modal", "the in-process path must not import modal"
        return real(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _watch)

    checks = _runtime_checks(monkeypatch, runtime="inprocess")

    assert "analysis_runtime:inprocess" in checks
    assert checks["analysis_runtime:inprocess"].ok


def test_asking_for_modal_without_the_package_is_reported(monkeypatch) -> None:
    """The state this shipped in.

    `modal` was in no `pyproject.toml` anywhere, so `ANALYSIS_RUNTIME=modal` on
    Render meant `ImportError` on every take, a fallback, and an app that
    worked — on the box the setting existed to get the work off.
    """
    import builtins

    real = builtins.__import__

    def _no_modal(name, *args, **kwargs):
        if name == "modal":
            raise ImportError("no modal here")
        return real(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _no_modal)

    check = _runtime_checks(monkeypatch, runtime="modal")["analysis_runtime:modal"]

    assert not check.ok
    assert "falls back" in check.detail
    assert not check.blocking, "the app still works; it just works in the wrong place"


def test_modal_without_credentials_is_reported(monkeypatch) -> None:
    """Easy to miss, because the container's own secret is a *different* thing
    set up on a different dashboard. This host does not run the analysis under
    `ANALYSIS_RUNTIME=modal` — it asks Modal to, and asking needs a token."""
    monkeypatch.delenv("MODAL_TOKEN_ID", raising=False)
    monkeypatch.delenv("MODAL_TOKEN_SECRET", raising=False)

    check = _runtime_checks(monkeypatch, runtime="modal")["modal_credentials"]

    assert not check.ok
    assert "MODAL_TOKEN_ID" in check.detail
    assert not check.blocking


def test_half_a_token_is_not_a_token(monkeypatch) -> None:
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-something")
    monkeypatch.delenv("MODAL_TOKEN_SECRET", raising=False)

    assert not _runtime_checks(monkeypatch, runtime="modal")["modal_credentials"].ok


def test_a_token_with_a_trailing_newline_is_reported(monkeypatch) -> None:
    """The check that could not fail.

    It tested the tokens for presence, and a value ending in `\n` is present.
    Modal sends both halves as gRPC metadata, which rejects a newline, so every
    `spawn` raised while this reported the credentials fine — for as long as it
    took someone to notice that pages were being read by the wrong thing.

    Not blocking, because `clean_modal_credentials` trims the value before it
    is used, so nothing is broken by the time anything spawns. It is reported
    because the next value pasted into that dashboard field will have the same
    newline.
    """
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-something\n")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-something")

    check = _runtime_checks(monkeypatch, runtime="modal")["modal_credentials"]

    assert not check.ok
    assert "MODAL_TOKEN_ID" in check.detail
    assert "whitespace" in check.detail or "newline" in check.detail
    assert "as-something" not in check.detail and "ak-something" not in check.detail, (
        "a readiness detail is shown in a browser; it must not carry the credential"
    )
    assert not check.blocking


def test_a_clean_token_does_not_trip_the_whitespace_check(monkeypatch) -> None:
    """It has to be able to pass, or it is the same broken check the other way
    round."""
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-something")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-something")

    checks = _runtime_checks(monkeypatch, runtime="modal")
    credentials = checks.get("modal_credentials")
    assert credentials is None or credentials.ok, (
        f"a well-formed token pair was reported as a problem: "
        f"{credentials.detail if credentials else ''}"
    )


def test_an_undeployed_function_is_reported_by_name(monkeypatch) -> None:
    """`Function.from_name` is documented as lazy — it defers the lookup until
    first use — so a check that only called it would pass against an account
    with nothing deployed at all. `hydrate()` is the part that asks."""
    import sys
    import types

    from app.workers import dispatch

    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-something")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-something")

    hydrated: list[bool] = []

    class _Handle:
        def hydrate(self):
            hydrated.append(True)
            raise RuntimeError("app not found")

    fake = types.ModuleType("modal")
    fake.Function = type("Function", (), {"from_name": staticmethod(lambda *a, **k: _Handle())})
    monkeypatch.setitem(sys.modules, "modal", fake)

    check = _runtime_checks(monkeypatch, runtime="modal")["analysis_runtime:modal"]

    assert hydrated, "from_name alone proves nothing; the lookup has to be forced"
    assert not check.ok
    assert dispatch.MODAL_APP_NAME in check.detail
    assert dispatch.MODAL_FUNCTION_NAME in check.detail


def test_a_working_modal_deployment_says_nothing(monkeypatch) -> None:
    import sys
    import types

    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-something")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-something")

    fake = types.ModuleType("modal")
    fake.Function = type(
        "Function",
        (),
        {"from_name": staticmethod(lambda *a, **k: type("H", (), {"hydrate": lambda self: None})())},
    )
    monkeypatch.setitem(sys.modules, "modal", fake)

    check = _runtime_checks(monkeypatch, runtime="modal")["analysis_runtime:modal"]

    assert check.ok
    assert check.detail == "", "a passing check says nothing; there is nothing to say"


def test_nothing_about_the_runtime_blocks_readiness(monkeypatch) -> None:
    """A deployment that fell back to in-process is degraded, not broken. If
    these blocked, `/v1/ready` would answer 503 on an app a musician can use
    perfectly well — and a 503 that does not mean "unusable" stops being read.
    """
    import builtins

    real = builtins.__import__

    def _no_modal(name, *args, **kwargs):
        if name == "modal":
            raise ImportError("no modal here")
        return real(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _no_modal)

    checks = list(_runtime_checks(monkeypatch, runtime="modal").values())

    assert checks
    assert not any(c.blocking for c in checks)


def test_the_api_declares_the_package_its_own_dispatcher_imports() -> None:
    """Nothing imports `modal` at module level, so it reads as an unused
    dependency to anybody tidying `pyproject.toml` — and removing it does not
    break a single test, because every test that touches the Modal path fakes
    the module. It breaks one thing: `ANALYSIS_RUNTIME=modal` in production,
    silently, into a fallback.
    """
    from pathlib import Path

    pyproject = (Path(__file__).resolve().parents[2] / "pyproject.toml").read_text()

    assert '"modal>=' in pyproject, (
        "app/workers/dispatch.py imports modal at spawn time; the API host has "
        "to have it or ANALYSIS_RUNTIME=modal quietly does nothing"
    )


def test_a_build_without_its_thresholds_is_reported_as_unready(monkeypatch) -> None:
    """The failure the API image actually shipped with.

    `config.toml` was not in `backend/Dockerfile`. The container booted, passed
    its health check, signed people in and read photographed pages — the config
    is read lazily, inside the pipeline — and then failed every analysis with
    `internal_error` the moment somebody finished playing.

    Blocking, unlike the runtime checks: a deployment that cannot analyse a
    take cannot do the thing the app is for.
    """
    from pathlib import Path

    from app.services import audio_config

    monkeypatch.setattr(audio_config, "CONFIG_PATH", Path("/nowhere/config.toml"))
    audio_config.load_audio_config.cache_clear()

    check = readiness._tuning_config_check()

    assert not check.ok
    assert check.blocking, "an app that cannot analyse a take is not ready"
    assert "/nowhere/config.toml" in check.detail, "say which file is missing"

    audio_config.load_audio_config.cache_clear()


def test_a_malformed_config_is_reported_differently_from_a_missing_one(monkeypatch, tmp_path) -> None:
    """Two different fixes. "Nothing is at this path" sends you to the
    Dockerfile; "could not be parsed" sends you to the file."""
    from app.services import audio_config

    broken = tmp_path / "config.toml"
    broken.write_text("[onset]\nsr = 22050\n")  # valid TOML, missing everything else
    monkeypatch.setattr(audio_config, "CONFIG_PATH", broken)
    audio_config.load_audio_config.cache_clear()

    check = readiness._tuning_config_check()

    assert not check.ok
    assert "could not be parsed" in check.detail
    assert "missing from this build" not in check.detail

    audio_config.load_audio_config.cache_clear()


def test_a_present_config_says_nothing() -> None:
    check = readiness._tuning_config_check()

    assert check.ok
    assert check.detail == ""


def test_a_passing_check_says_nothing_in_the_response() -> None:
    """Found by reading a real deployment's answer as a table.

        name           ok     detail
        supabase_url   True   SUPABASE_URL is not set — there is no project…

    Every word of that is wrong except the name. `detail` describes the
    *failure*, so printing it beside a passing check states the opposite of the
    truth — and it did so on every row, which means the rows that were
    genuinely broken looked exactly like the ones that were not.
    """
    passing = Check(name="x", ok=True, detail="X is not set, so nothing works.")
    failing = Check(name="y", ok=False, detail="Y is not set, so nothing works.")

    assert passing.as_dict()["detail"] == ""
    assert failing.as_dict()["detail"] == "Y is not set, so nothing works."


def test_the_endpoint_only_explains_what_is_wrong(monkeypatch, unconfigured) -> None:
    """End to end, because `as_dict` is not what anybody reads — the JSON is."""
    res = client.get("/v1/ready")
    body = res.json()

    for check in body["checks"]:
        if check["ok"]:
            assert check["detail"] == "", (
                f"{check['name']} passed and still explained a failure: "
                f"{check['detail']!r}"
            )

    assert any(not c["ok"] for c in body["checks"]), (
        "this deployment has nothing wrong with it, so the assertion above "
        "checked nothing"
    )


def test_an_engine_is_asked_whether_it_is_installed_not_for_a_key(monkeypatch) -> None:
    """homr is the odd one out in the chain and needs a different question.

    Every other provider is usable when an API key is set. homr is an engine
    that lives *in this container* — asking for its key reported `ocr:homr`
    unusable, with an empty setting name in the message, on a container where it
    was working.
    """
    from app.services import readiness
    from app.services.ocr import homr_provider as module
    from app.services.ocr import pipeline

    # Patched on `pipeline`, not on `readiness`: the import happens inside the
    # function, so a name bound on the caller is never looked at.
    monkeypatch.setattr(pipeline, "_default_chain", lambda: [module.homr_provider])
    monkeypatch.setattr(module, "homr_available", lambda: True)
    monkeypatch.setattr(module.HomrProvider, "available", lambda self: True)

    checks = {c.name: c for c in readiness._configuration_checks()}

    assert checks["ocr:homr"].ok is True
    assert "is not set" not in checks["ocr:homr"].detail
    assert checks["sheet_music_reading"].ok is True, (
        "an installed engine does not count as being able to read a page"
    )


def test_an_engine_that_is_not_installed_is_reported_rather_than_assumed(
    monkeypatch,
) -> None:
    """The failure this prevents is quiet: a chain naming `homr` on a host
    without it falls through to the vision models and reads every page the
    slower, worse way, while appearing to work."""
    from app.services import readiness
    from app.services.ocr import homr_provider as module
    from app.services.ocr import pipeline

    # Patched on `pipeline`, not on `readiness`: the import happens inside the
    # function, so a name bound on the caller is never looked at.
    monkeypatch.setattr(pipeline, "_default_chain", lambda: [module.homr_provider])
    monkeypatch.setattr(module.HomrProvider, "available", lambda self: False)

    checks = {c.name: c for c in readiness._configuration_checks()}

    assert checks["ocr:homr"].ok is False
    assert "not installed in this container" in checks["ocr:homr"].detail
    # And it must not promise a fallback: the shipped chain is homr alone, so
    # naming "the models in the chain" described a rescue that no longer exists.
    assert "will be read by the models" not in checks["ocr:homr"].detail
    assert "Modal" in checks["ocr:homr"].detail, "it does not say where it does run"


# ---- whether the configured page runtime exists -----------------------------


def _page_runtime_checks(monkeypatch, *, runtime="modal") -> dict[str, Check]:
    from app.workers import dispatch

    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", runtime)
    return {c.name: c for c in readiness._transcription_runtime_checks()}


def test_modal_counts_as_the_reader_when_homr_is_deliberately_remote(
    monkeypatch,
) -> None:
    """The production false alarm: homr is absent from Render by design.

    A selected remote runtime satisfies the capability check; the runtime check
    below is responsible for proving that selection is reachable.
    """
    from app.services.ocr import homr_provider as module
    from app.services.ocr import pipeline
    from app.workers import dispatch

    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", "modal")
    monkeypatch.setattr(pipeline, "_default_chain", lambda: [module.homr_provider])
    monkeypatch.setattr(module.HomrProvider, "available", lambda self: False)

    checks = {c.name: c for c in readiness._configuration_checks()}

    assert checks["ocr:homr"].ok is False
    assert checks["sheet_music_reading"].ok is True


def test_modal_page_runtime_without_credentials_is_blocking(monkeypatch) -> None:
    """With the homr-only chain there is no useful local fallback."""
    import sys
    import types

    monkeypatch.setitem(sys.modules, "modal", types.ModuleType("modal"))
    monkeypatch.delenv("MODAL_TOKEN_ID", raising=False)
    monkeypatch.delenv("MODAL_TOKEN_SECRET", raising=False)

    check = _page_runtime_checks(monkeypatch)["transcription_runtime:modal"]

    assert not check.ok
    assert check.blocking
    assert "MODAL_TOKEN_ID" in check.detail


def test_page_runtime_hydrates_the_transcription_function(monkeypatch) -> None:
    """Looking up the analysis function proves nothing about page reading."""
    import sys
    import types

    from app.workers import dispatch

    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-something")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-something")
    looked_up: list[tuple[str, str]] = []
    hydrated: list[bool] = []

    class _Handle:
        def hydrate(self):
            hydrated.append(True)

    class _Function:
        @staticmethod
        def from_name(app_name, function_name):
            looked_up.append((app_name, function_name))
            return _Handle()

    fake = types.ModuleType("modal")
    fake.Function = _Function
    monkeypatch.setitem(sys.modules, "modal", fake)

    check = _page_runtime_checks(monkeypatch)["transcription_runtime:modal"]

    assert looked_up == [
        (dispatch.MODAL_APP_NAME, dispatch.MODAL_TRANSCRIBE_FUNCTION_NAME)
    ]
    assert hydrated, "from_name is lazy; hydrate is the actual lookup"
    assert check.ok
    assert check.detail == ""


def test_missing_modal_transcription_function_is_named(monkeypatch) -> None:
    import sys
    import types

    from app.workers import dispatch

    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-something")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-something")

    class _Handle:
        def hydrate(self):
            raise RuntimeError("not deployed")

    fake = types.ModuleType("modal")
    fake.Function = type(
        "Function",
        (),
        {"from_name": staticmethod(lambda *args, **kwargs: _Handle())},
    )
    monkeypatch.setitem(sys.modules, "modal", fake)

    check = _page_runtime_checks(monkeypatch)["transcription_runtime:modal"]

    assert not check.ok
    assert check.blocking
    assert dispatch.MODAL_TRANSCRIBE_FUNCTION_NAME in check.detail
    assert "Deploy Modal" in check.detail


# ---- what actually happened to the pages ------------------------------------


def _dispatch_check(monkeypatch, *, runtime="modal", to_modal=0, fell_back=0, failure=None):
    from app.services import readiness as readiness_module
    from app.workers import dispatch

    monkeypatch.setattr(dispatch, "TRANSCRIPTION_RUNTIME", runtime)
    monkeypatch.setattr(dispatch.transcription_dispatches, "to_modal", to_modal)
    monkeypatch.setattr(dispatch.transcription_dispatches, "fell_back", fell_back)
    monkeypatch.setattr(dispatch.transcription_dispatches, "last_failure_type", failure)
    return readiness_module._transcription_dispatch_check()


def test_pages_read_here_while_configured_for_modal_are_reported(monkeypatch) -> None:
    """The check that would have caught the whole thing on the first scan.

    Every *configuration* check passed: a token with a trailing newline is
    present, and it names a function that is deployed. What nobody could see
    was that `fn.spawn()` raised on every call and the pages were being read
    here, without homr — one of them coming back as invented notes the app
    displayed as a transcription.
    """
    (check,) = _dispatch_check(monkeypatch, fell_back=3, failure="ValueError")

    assert not check.ok
    assert "3" in check.detail
    assert "homr" in check.detail
    # Not blocking: the fallback is a real reading and the app works.
    assert not check.blocking


def test_the_report_names_the_failure_type_and_never_its_message(monkeypatch) -> None:
    """`grpclib` puts the credential in the message. A readiness detail is
    served over HTTP and read in a browser."""
    (check,) = _dispatch_check(monkeypatch, fell_back=1, failure="ValueError")

    assert "ValueError" in check.detail
    assert "Invalid metadata value" not in check.detail
    assert "ak-" not in check.detail


def test_a_deployment_that_is_reaching_modal_is_quiet(monkeypatch) -> None:
    """It has to be able to pass, or it is a warning nobody reads."""
    (check,) = _dispatch_check(monkeypatch, to_modal=5)

    assert check.ok


def test_nothing_is_claimed_before_a_page_has_been_handed_over(monkeypatch) -> None:
    """A fresh process genuinely does not know. Saying so beats reporting
    healthy on the strength of no evidence."""
    (check,) = _dispatch_check(monkeypatch)

    assert check.ok
    assert "nothing to report" in check.detail.lower()


def test_an_in_process_deployment_is_not_asked_the_question(monkeypatch) -> None:
    """Reading here is not a fallback when here is where it was meant to run."""
    assert _dispatch_check(monkeypatch, runtime="inprocess") == []


def test_it_is_wired_into_the_readiness_report() -> None:
    """A check nobody calls reports nothing — which is the failure mode this
    whole entry is about."""
    import re
    from pathlib import Path

    from app.services import readiness as readiness_module

    source = Path(readiness_module.__file__).read_text()
    code = re.sub(r"#[^\n]*", "", source)
    assert "_transcription_dispatch_check()" in code.split("def readiness(")[-1] or (
        "_transcription_dispatch_check()" in code
    )
    # Specifically: extended into the result, not merely defined.
    assert "checks.extend(_transcription_dispatch_check())" in code
    assert "checks.extend(_transcription_runtime_checks())" in code
