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

from app.config import settings
from app.main import app
from app.services import readiness
from app.services.readiness import Check, Readiness

client = TestClient(app)


@pytest.fixture
def unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")


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
        monkeypatch.setattr(settings, name, value)

    body = repr(readiness.check().as_dict())
    for name, value in secrets.items():
        assert value not in body, f"{name}'s value leaked into /v1/ready"


def test_one_stale_model_name_does_not_stop_the_others(
    monkeypatch: pytest.MonkeyPatch, unconfigured
) -> None:
    """The bug this was written for: the shipped chain named two models from
    the previous Claude generation, `_default_chain()` raised, and no page could
    be read at all even though a usable model was configured."""
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "present")
    monkeypatch.setattr(
        settings, "OCR_PROVIDER_CHAIN", "claude-sonnet-4-6,claude-sonnet-5"
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
    monkeypatch.setattr(settings, "OCR_PROVIDER_CHAIN", "not-a-model,also-not")
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
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "present")

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
