"""`/v1/assignments` — the six endpoints that give the teacher tier a way in.

The tables, indexes, status CHECKs and both sides' policies have existed since
`001` and `002`; `models/assignment.py` says no MVP endpoint touched them.
These hold the endpoints that now do.

Three rules are enforced twice on purpose — the status graph, a submitted take
belonging to the assignment's own student, and a take naming only its owner's
assignment. Migrations 022, 023 and 024 hold them in the database, where they
apply to the service-role connection every write uses; this router holds them
where the actor is known and a refusal can say which rule failed. These tests
are the router's half. `migrations/checks/022` and `checks/023` are the other.
"""

from __future__ import annotations

from typing import Any, Callable
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app import db as db_module
from app.main import app
from app.tests.fake_supabase import FakeSupabase


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _install(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabase) -> None:
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class World:
    """A studio with one teacher, one student, and the student's own piece."""

    def __init__(self) -> None:
        self.studio = uuid4()
        self.teacher = uuid4()
        self.student = uuid4()
        self.outsider = uuid4()
        self.score = uuid4()
        self.fake = FakeSupabase()
        self.fake.seed(
            "users",
            [
                {"id": str(self.teacher), "role": "teacher", "studio_id": str(self.studio)},
                {"id": str(self.student), "role": "student", "studio_id": str(self.studio)},
                {"id": str(self.outsider), "role": "student", "studio_id": None},
            ],
        )
        self.fake.seed(
            "scores", [{"id": str(self.score), "user_id": str(self.student)}]
        )

    def assignment(self, **over: Any) -> UUID:
        row_id = over.pop("id", uuid4())
        row = {
            "id": str(row_id),
            "studio_id": str(self.studio),
            "teacher_user_id": str(self.teacher),
            "student_user_id": str(self.student),
            "score_id": str(self.score),
            "target_bpm": 92.0,
            "status": "assigned",
            "due_at": None,
            "teacher_instructions": None,
            "submitted_analysis_id": None,
            "teacher_review_notes": None,
            "reviewed_at": None,
            "created_at": "2026-09-19T00:00:00+00:00",
            "updated_at": "2026-09-19T00:00:00+00:00",
        }
        row.update(over)
        self.fake.seed("assignments", [row])
        return row_id

    def take(self, **over: Any) -> UUID:
        row_id = over.pop("id", uuid4())
        row = {
            "id": str(row_id),
            "user_id": str(self.student),
            "score_id": str(self.score),
            "status": "done",
            "target_bpm": 92.0,
            "from_measure": None,
            "assignment_id": None,
            "created_at": "2026-09-19T01:00:00+00:00",
            "result_json": None,
        }
        row.update(over)
        self.fake.seed("analyses", [row])
        return row_id


@pytest.fixture()
def world(monkeypatch: pytest.MonkeyPatch) -> World:
    w = World()
    _install(monkeypatch, w.fake)
    return w


# ---- create ---------------------------------------------------------------


def test_a_student_cannot_assign_work(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    res = client.post(
        "/v1/assignments",
        headers=_auth(make_token(sub=world.student)),
        json={
            "student_user_id": str(world.student),
            "score_id": str(world.score),
            "target_bpm": 92,
        },
    )
    assert res.status_code == 403


def test_a_teacher_cannot_assign_outside_their_studio(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """One message for "no such person" and "not in your studio", so a teacher
    cannot enumerate accounts by assigning work to them."""
    res = client.post(
        "/v1/assignments",
        headers=_auth(make_token(sub=world.teacher)),
        json={
            "student_user_id": str(world.outsider),
            "score_id": str(world.score),
            "target_bpm": 92,
        },
    )
    assert res.status_code == 404
    assert "not in your studio" in res.json()["detail"]


def test_a_piece_the_student_does_not_own_is_refused(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`POST /v1/analyses` refuses a score the caller does not own, so an
    assignment on someone else's piece would be created successfully and be
    impossible to answer. Refused here instead of failing later."""
    res = client.post(
        "/v1/assignments",
        headers=_auth(make_token(sub=world.teacher)),
        json={
            "student_user_id": str(world.student),
            "score_id": str(uuid4()),
            "target_bpm": 92,
        },
    )
    assert res.status_code == 400
    assert "library" in res.json()["detail"]


def test_a_teacher_assigns_a_passage(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    res = client.post(
        "/v1/assignments",
        headers=_auth(make_token(sub=world.teacher)),
        json={
            "student_user_id": str(world.student),
            "score_id": str(world.score),
            "target_bpm": 92,
            "teacher_instructions": "Bars 40-48, dotted rhythm.",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "assigned"
    assert body["student_user_id"] == str(world.student)
    assert body["teacher_instructions"] == "Bars 40-48, dotted rhythm."
    assert body["submitted_analysis_id"] is None


def test_create_rejects_an_unknown_field(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`extra="forbid"`, so a client typo is a 422 rather than a silently
    dropped instruction."""
    res = client.post(
        "/v1/assignments",
        headers=_auth(make_token(sub=world.teacher)),
        json={
            "student_user_id": str(world.student),
            "score_id": str(world.score),
            "target_bpm": 92,
            "instructions": "typo for teacher_instructions",
        },
    )
    assert res.status_code == 422


# ---- list and get ---------------------------------------------------------


def test_both_parties_see_the_assignment_and_nobody_else_does(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    world.assignment()
    for who in (world.teacher, world.student):
        res = client.get("/v1/assignments", headers=_auth(make_token(sub=who)))
        assert res.status_code == 200
        assert len(res.json()) == 1
    res = client.get("/v1/assignments", headers=_auth(make_token(sub=world.outsider)))
    assert res.json() == []


def test_listing_filters_by_status(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    world.assignment(status="assigned")
    world.assignment(status="archived")
    res = client.get(
        "/v1/assignments?status=archived", headers=_auth(make_token(sub=world.teacher))
    )
    assert [a["status"] for a in res.json()] == ["archived"]


def test_a_teacher_who_is_also_a_student_sees_each_row_once(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Both sides are read with separate indexed queries, so a row matching
    both has to be de-duplicated — a teacher taking lessons themselves is an
    ordinary thing for a musician to be."""
    world.assignment(teacher_user_id=str(world.teacher), student_user_id=str(world.teacher))
    res = client.get("/v1/assignments", headers=_auth(make_token(sub=world.teacher)))
    assert len(res.json()) == 1


def test_a_third_party_gets_404_not_403_on_get(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """404, so an id cannot be used to confirm an assignment exists inside a
    studio the caller is not in."""
    assignment_id = world.assignment()
    res = client.get(
        f"/v1/assignments/{assignment_id}", headers=_auth(make_token(sub=world.outsider))
    )
    assert res.status_code == 404


# ---- submit ---------------------------------------------------------------


def test_a_student_submits_a_take(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    assignment_id = world.assignment()
    take_id = world.take()
    res = client.post(
        f"/v1/assignments/{assignment_id}/submit",
        headers=_auth(make_token(sub=world.student)),
        json={"analysis_id": str(take_id)},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "submitted"
    assert res.json()["submitted_analysis_id"] == str(take_id)


def test_a_reviewed_assignment_accepts_another_take(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The edge 022 refused and 024 restored. Without it a reviewed assignment
    had nowhere to go and the weekly loop was a one-shot — which is the whole
    product."""
    first = world.take()
    assignment_id = world.assignment(
        status="reviewed",
        submitted_analysis_id=str(first),
        reviewed_at="2026-09-19T02:00:00+00:00",
    )
    better = world.take()
    res = client.post(
        f"/v1/assignments/{assignment_id}/submit",
        headers=_auth(make_token(sub=world.student)),
        json={"analysis_id": str(better)},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "submitted"
    assert res.json()["submitted_analysis_id"] == str(better)


def test_a_teacher_cannot_submit(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    assignment_id = world.assignment()
    take_id = world.take()
    res = client.post(
        f"/v1/assignments/{assignment_id}/submit",
        headers=_auth(make_token(sub=world.teacher)),
        json={"analysis_id": str(take_id)},
    )
    assert res.status_code == 403


def test_another_accounts_take_cannot_be_submitted(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """022's trigger refuses this in the database too. Here it is a 404 rather
    than a 500 from the trigger, and it never reaches the write."""
    assignment_id = world.assignment()
    foreign = world.take(user_id=str(world.outsider))
    res = client.post(
        f"/v1/assignments/{assignment_id}/submit",
        headers=_auth(make_token(sub=world.student)),
        json={"analysis_id": str(foreign)},
    )
    assert res.status_code == 404


def test_a_take_of_a_different_piece_cannot_be_submitted(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    assignment_id = world.assignment()
    other = world.take(score_id=str(uuid4()))
    res = client.post(
        f"/v1/assignments/{assignment_id}/submit",
        headers=_auth(make_token(sub=world.student)),
        json={"analysis_id": str(other)},
    )
    assert res.status_code == 400
    assert "different piece" in res.json()["detail"]


def test_an_archived_assignment_cannot_be_submitted_to(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    assignment_id = world.assignment(status="archived")
    take_id = world.take()
    res = client.post(
        f"/v1/assignments/{assignment_id}/submit",
        headers=_auth(make_token(sub=world.student)),
        json={"analysis_id": str(take_id)},
    )
    assert res.status_code == 409


# ---- review ---------------------------------------------------------------


def test_a_teacher_reviews_a_submitted_take(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    take_id = world.take()
    assignment_id = world.assignment(status="submitted", submitted_analysis_id=str(take_id))
    res = client.post(
        f"/v1/assignments/{assignment_id}/review",
        headers=_auth(make_token(sub=world.teacher)),
        json={"teacher_review_notes": "Bar 44 is still rushing. Half tempo."},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "reviewed"
    assert body["teacher_review_notes"].startswith("Bar 44")
    # `001`'s CHECK refuses a reviewed row without it, so the endpoint writes
    # it with the status rather than leaving it to a second call.
    assert body["reviewed_at"] is not None


def test_a_student_cannot_review(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    take_id = world.take()
    assignment_id = world.assignment(status="submitted", submitted_analysis_id=str(take_id))
    res = client.post(
        f"/v1/assignments/{assignment_id}/review",
        headers=_auth(make_token(sub=world.student)),
        json={"teacher_review_notes": "looks great to me"},
    )
    assert res.status_code == 403


def test_there_is_nothing_to_review_before_a_submission(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A review is a review *of* a submission — the one edge 024 deliberately
    did not loosen, because `reviewed` with a null `submitted_analysis_id` is a
    row the teacher's screen cannot render."""
    assignment_id = world.assignment(status="assigned")
    res = client.post(
        f"/v1/assignments/{assignment_id}/review",
        headers=_auth(make_token(sub=world.teacher)),
        json={"teacher_review_notes": "x"},
    )
    assert res.status_code == 409


# ---- the delta view -------------------------------------------------------


def _result(key: str | None) -> dict[str, Any]:
    return {"comparison_key": key} if key else {}


def test_takes_are_grouped_by_the_stored_comparison_key(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """**Read from the row, never recomputed.** The worker stamps the key at
    analysis time, folding in the tuning config; computing it here would group
    an older take away from the key it actually carries, and the app decides
    comparability from the stored value."""
    assignment_id = world.assignment()
    same_a = world.take(assignment_id=str(assignment_id), result_json=_result("v1:aaa"))
    same_b = world.take(assignment_id=str(assignment_id), result_json=_result("v1:aaa"))
    different = world.take(assignment_id=str(assignment_id), result_json=_result("v1:bbb"))
    # Another take of the same piece that is not part of this assignment.
    world.take(result_json=_result("v1:aaa"))

    res = client.get(
        f"/v1/assignments/{assignment_id}/takes",
        headers=_auth(make_token(sub=world.teacher)),
    )
    assert res.status_code == 200, res.text
    groups = {g["comparison_key"]: g["takes"] for g in res.json()["groups"]}
    assert set(groups) == {"v1:aaa", "v1:bbb"}
    assert {t["id"] for t in groups["v1:aaa"]} == {str(same_a), str(same_b)}
    assert [t["id"] for t in groups["v1:bbb"]] == [str(different)]


def test_keyless_takes_are_grouped_last(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A queued or failed take has no key and no comparison to be part of, and
    a screen still has to say it exists."""
    assignment_id = world.assignment()
    world.take(assignment_id=str(assignment_id), result_json=_result("v1:aaa"))
    world.take(assignment_id=str(assignment_id), status="queued", result_json=None)

    res = client.get(
        f"/v1/assignments/{assignment_id}/takes",
        headers=_auth(make_token(sub=world.student)),
    )
    keys = [g["comparison_key"] for g in res.json()["groups"]]
    assert keys == ["v1:aaa", None]


def test_the_submitted_take_is_marked(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    take_id = world.take(result_json=_result("v1:aaa"))
    assignment_id = world.assignment(
        status="submitted", submitted_analysis_id=str(take_id)
    )
    world.fake.table("analyses").rows[0]["assignment_id"] = str(assignment_id)
    other = world.take(assignment_id=str(assignment_id), result_json=_result("v1:aaa"))

    res = client.get(
        f"/v1/assignments/{assignment_id}/takes",
        headers=_auth(make_token(sub=world.teacher)),
    )
    marked = {t["id"]: t["submitted"] for g in res.json()["groups"] for t in g["takes"]}
    assert marked[str(take_id)] is True
    assert marked[str(other)] is False


def test_a_third_party_cannot_read_the_takes(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    assignment_id = world.assignment()
    world.take(assignment_id=str(assignment_id), result_json=_result("v1:aaa"))
    res = client.get(
        f"/v1/assignments/{assignment_id}/takes",
        headers=_auth(make_token(sub=world.outsider)),
    )
    assert res.status_code == 404
