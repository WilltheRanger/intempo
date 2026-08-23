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
