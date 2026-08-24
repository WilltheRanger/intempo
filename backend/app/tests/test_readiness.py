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
    assert "model key" in joined


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


def test_both_buckets_are_checked() -> None:
    """The same mismatch is possible for photographs.

    `score-images` is 10 MB and `MAX_IMAGE_BYTES` is 12 — the *safe* direction,
    with a comment saying so, which is how it should have been on the audio
    side and was not. Checking only the bucket that happened to be broken
    would leave the correct one free to drift into being the broken one.
    """
    from app.services.readiness import _storage_checks

    class _Bucket:
        file_size_limit = 10 * 1024 * 1024

    class _Storage:
        def get_bucket(self, _name):
            return _Bucket()

    class _Client:
        storage = _Storage()

    names = {c.name for c in _storage_checks(_Client())}
    assert names == {"storage:audio-uploads", "storage:score-images"}
    assert all(c.ok for c in _storage_checks(_Client()))


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
