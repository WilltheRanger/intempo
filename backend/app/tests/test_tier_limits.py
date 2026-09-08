"""Free-tier quota: counting, and the refusal.

Uses the stateful fake rather than a chain of MagicMocks, because the thing
worth testing is that N inserted rows produce a count of N and the (N+1)th
request is refused. A mock that returns whatever it's told proves only that the
code reads its own arrangement back.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Callable
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app import db as db_module
from app.main import app
from app.routers import analyses as analyses_module
from app.services.tier_limits import (
    FREE_MONTHLY_ANALYSES,
    count_analyses_this_month,
    month_bounds,
    tier_of,
    usage_for,
)
from app.tests.fake_supabase import FakeSupabase

PROJECT_HOST = "https://test.supabase.invalid"


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _audio_url(user_id: UUID) -> str:
    return f"{PROJECT_HOST}/storage/v1/object/sign/audio-uploads/{user_id}/take.wav?token=x"


def _seed(fake: FakeSupabase, user_id: UUID, *, tier: str = "free", analyses: int = 0,
          score_id: UUID | None = None, created_at: str | None = None) -> UUID:
    score_id = score_id or uuid4()
    fake.table("users").rows.append({"id": str(user_id), "email": "m@example.com", "tier": tier})
    fake.table("scores").rows.append({"id": str(score_id), "user_id": str(user_id)})
    for _ in range(analyses):
        row = {
            "id": str(uuid4()),
            "user_id": str(user_id),
            "score_id": str(score_id),
            "status": "done",
        }
        if created_at:
            row["created_at"] = created_at
        fake.table("analyses").rows.append(row)
    return score_id


def _submit(client: TestClient, make_token, user_id: UUID, score_id: UUID):
    return client.post(
        "/v1/analyses",
        json={
            "score_id": str(score_id),
            "audio_url": _audio_url(user_id),
            "target_bpm": 96,
            "bpm_source": "manual",
            "metronome_mode": "off",
        },
        headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"},
    )


# ---- counting -------------------------------------------------------------


class TestMonthBounds:
    def test_spans_the_calendar_month(self):
        start, end = month_bounds(datetime(2026, 8, 16, 13, 45, tzinfo=timezone.utc))
        assert start == datetime(2026, 8, 1, tzinfo=timezone.utc)
        assert end == datetime(2026, 9, 1, tzinfo=timezone.utc)

    def test_december_rolls_the_year(self):
        start, end = month_bounds(datetime(2026, 12, 31, 23, 59, tzinfo=timezone.utc))
        assert start == datetime(2026, 12, 1, tzinfo=timezone.utc)
        assert end == datetime(2027, 1, 1, tzinfo=timezone.utc)

    def test_february_in_a_leap_year(self):
        start, end = month_bounds(datetime(2024, 2, 29, tzinfo=timezone.utc))
        assert start == datetime(2024, 2, 1, tzinfo=timezone.utc)
        assert end == datetime(2024, 3, 1, tzinfo=timezone.utc)


def test_counts_only_this_month():
    """Last month's analyses are not this month's problem."""
    fake = FakeSupabase()
    user_id = uuid4()
    now = datetime(2026, 8, 16, tzinfo=timezone.utc)

    _seed(fake, user_id, analyses=2, created_at=now.isoformat())
    for _ in range(5):
        fake.table("analyses").rows.append(
            {
                "id": str(uuid4()),
                "user_id": str(user_id),
                "created_at": (now - timedelta(days=40)).isoformat(),
            }
        )

    assert count_analyses_this_month(fake, user_id, now) == 2


def test_counts_only_this_user():
    fake = FakeSupabase()
    mine, theirs = uuid4(), uuid4()
    now = datetime(2026, 8, 16, tzinfo=timezone.utc)
    _seed(fake, mine, analyses=1, created_at=now.isoformat())
    _seed(fake, theirs, analyses=3, created_at=now.isoformat())

    assert count_analyses_this_month(fake, mine, now) == 1


def test_paid_tiers_are_not_counted_at_all():
    """No query on the path of every analysis a paying user runs."""
    fake = FakeSupabase()
    user_id = uuid4()
    _seed(fake, user_id, tier="pro", analyses=99, created_at=datetime.now(tz=timezone.utc).isoformat())

    usage = usage_for(fake, user_id, "pro")
    assert usage.unlimited
    assert usage.limit is None
    assert usage.remaining is None
    assert not usage.exhausted


def test_student_via_teacher_is_unlimited():
    """Their teacher is paying. Limiting them bills the studio twice."""
    assert usage_for(FakeSupabase(), uuid4(), "student_via_teacher").unlimited


def test_tier_defaults_to_free_when_the_row_is_missing():
    """The safe direction: a late row must not hand out unlimited analyses."""
    assert tier_of(FakeSupabase(), uuid4()) == "free"


# ---- enforcement ----------------------------------------------------------


def test_free_user_can_submit_up_to_the_limit(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    fake = FakeSupabase()
    user_id = uuid4()
    score_id = _seed(fake, user_id, analyses=FREE_MONTHLY_ANALYSES - 1,
                     created_at=datetime.now(tz=timezone.utc).isoformat())
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)
    monkeypatch.setattr(analyses_module, "start_analysis", lambda *_a, **_k: None)

    assert _submit(client, make_token, user_id, score_id).status_code == 202


def test_the_fourth_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    fake = FakeSupabase()
    user_id = uuid4()
    score_id = _seed(fake, user_id, analyses=FREE_MONTHLY_ANALYSES,
                     created_at=datetime.now(tz=timezone.utc).isoformat())
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)
    monkeypatch.setattr(analyses_module, "start_analysis", lambda *_a, **_k: None)

    res = _submit(client, make_token, user_id, score_id)

    assert res.status_code == 403
    detail = res.json()["detail"]
    # Structured, because the client has to act on it — parsing a sentence to
    # decide whether to show a paywall is how copy changes become bugs.
    assert detail["code"] == "tier_limit"
    assert detail["limit"] == FREE_MONTHLY_ANALYSES
    assert detail["used"] == FREE_MONTHLY_ANALYSES
    assert detail["tier"] == "free"
    assert detail["resets_at"]


def test_a_refused_analysis_leaves_no_row(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Checked before the insert, so being refused doesn't itself count."""
    fake = FakeSupabase()
    user_id = uuid4()
    score_id = _seed(fake, user_id, analyses=FREE_MONTHLY_ANALYSES,
                     created_at=datetime.now(tz=timezone.utc).isoformat())
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)
    monkeypatch.setattr(analyses_module, "start_analysis", lambda *_a, **_k: None)

    before = len(fake.table("analyses").rows)
    _submit(client, make_token, user_id, score_id)
    assert len(fake.table("analyses").rows) == before


def test_a_pro_user_is_never_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    fake = FakeSupabase()
    user_id = uuid4()
    score_id = _seed(fake, user_id, tier="pro", analyses=50,
                     created_at=datetime.now(tz=timezone.utc).isoformat())
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)
    monkeypatch.setattr(analyses_module, "start_analysis", lambda *_a, **_k: None)

    assert _submit(client, make_token, user_id, score_id).status_code == 202


def test_last_months_analyses_do_not_block_this_month(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    fake = FakeSupabase()
    user_id = uuid4()
    old = (datetime.now(tz=timezone.utc) - timedelta(days=45)).isoformat()
    score_id = _seed(fake, user_id, analyses=10, created_at=old)
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)
    monkeypatch.setattr(analyses_module, "start_analysis", lambda *_a, **_k: None)

    assert _submit(client, make_token, user_id, score_id).status_code == 202
