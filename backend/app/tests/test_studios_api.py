"""`/v1/studios` — the endpoints that make the teacher tier reachable at all.

`assignments.py`'s `_teacher_or_403` needs `users.role = 'teacher'` and a
`users.studio_id`. Before these four, nothing set either and nothing created a
`studios` row, so the six assignment endpoints were complete, tested and
impossible to call.

Two rules here are worth more than the endpoints: **joining raises only a
`free` account**, because overwriting `pro` would take away a subscription the
musician is still paying for; and **leaving gives back only what joining
granted**, because `student_via_teacher` is in `UNLIMITED_TIERS` and a student
who joined and left would otherwise keep unlimited analyses for ever on an
account nobody pays for.
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


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class World:
    def __init__(self) -> None:
        self.fake = FakeSupabase()

    def user(self, **over: Any) -> UUID:
        user_id = over.pop("id", uuid4())
        row = {
            "id": str(user_id),
            "role": "student",
            "tier": "free",
            "studio_id": None,
        }
        row.update(over)
        self.fake.seed("users", [row])
        return user_id

    def studio(self, owner: UUID, **over: Any) -> dict[str, Any]:
        studio_id = over.pop("id", uuid4())
        row = {
            "id": str(studio_id),
            "owner_user_id": str(owner),
            "name": "Sunrise Strings",
            "seat_limit": 25,
            "invite_code": "ABC234",
            "created_at": "2026-09-19T00:00:00+00:00",
            "updated_at": "2026-09-19T00:00:00+00:00",
        }
        row.update(over)
        self.fake.seed("studios", [row])
        return row

    def row_for(self, user_id: UUID) -> dict[str, Any]:
        return next(
            r for r in self.fake.table("users").rows if r["id"] == str(user_id)
        )


@pytest.fixture()
def world(monkeypatch: pytest.MonkeyPatch) -> World:
    w = World()
    monkeypatch.setattr(db_module, "get_service_client", lambda: w.fake)
    return w


# ---- create ---------------------------------------------------------------


def test_creating_a_studio_promotes_the_caller_in_one_write(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`001`'s CHECK refuses every intermediate state — `role <> 'teacher' OR
    (tier = 'teacher' AND studio_id IS NOT NULL)` — so all three columns move
    together or not at all."""
    me = world.user()
    res = client.post(
        "/v1/studios",
        headers=_auth(make_token(sub=me)),
        json={"name": "Sunrise Strings"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["role"] == "teacher"
    assert body["seat_limit"] == 25
    assert body["seats_used"] == 0
    assert len(body["invite_code"]) == 6

    row = world.row_for(me)
    assert (row["role"], row["tier"]) == ("teacher", "teacher")
    assert row["studio_id"] == body["id"]


def test_the_invite_code_avoids_characters_people_mistype(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Read off one screen and typed into another, often by a child. `I`, `L`,
    `O`, `0` and `1` are the pairs that generate support mail."""
    codes = set()
    for _ in range(12):
        me = world.user()
        res = client.post(
            "/v1/studios", headers=_auth(make_token(sub=me)), json={"name": "S"}
        )
        codes.add(res.json()["invite_code"])
    joined = "".join(codes)
    assert not set("ILO01") & set(joined), joined
    assert all(len(code) == 6 for code in codes)


def test_a_second_studio_is_refused(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    me = world.user()
    studio = world.studio(owner=me)
    world.row_for(me)["studio_id"] = studio["id"]
    res = client.post(
        "/v1/studios", headers=_auth(make_token(sub=me)), json={"name": "Another"}
    )
    assert res.status_code == 409


@pytest.mark.parametrize(
    "payload",
    [
        {"name": ""},
        {"name": "x" * 81},
        {"name": "S", "seat_limit": 0},
        {"name": "S", "seat_limit": 501},
        {"name": "S", "seats": 10},
    ],
    ids=["empty name", "name too long", "no seats", "too many seats", "unknown field"],
)
def test_create_validates_its_body(
    world: World,
    client: TestClient,
    make_token: Callable[..., str],
    payload: dict[str, Any],
) -> None:
    """Bounds mirrored from `001` so an out-of-range value is a 422 naming the
    field rather than a 500 out of a CHECK."""
    me = world.user()
    res = client.post("/v1/studios", headers=_auth(make_token(sub=me)), json=payload)
    assert res.status_code == 422


# ---- mine -----------------------------------------------------------------


def test_the_owner_sees_the_code_and_the_student_does_not(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A student who could read the code could enrol strangers into their
    teacher's studio, spending seats the teacher pays for."""
    teacher = world.user(role="teacher", tier="teacher")
    studio = world.studio(owner=teacher)
    world.row_for(teacher)["studio_id"] = studio["id"]
    student = world.user(tier="student_via_teacher", studio_id=studio["id"])

    as_teacher = client.get("/v1/studios/mine", headers=_auth(make_token(sub=teacher)))
    assert as_teacher.json()["invite_code"] == "ABC234"
    assert as_teacher.json()["role"] == "teacher"

    as_student = client.get("/v1/studios/mine", headers=_auth(make_token(sub=student)))
    assert as_student.json()["invite_code"] is None
    assert as_student.json()["role"] == "student"


def test_seats_used_does_not_count_the_teacher(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    teacher = world.user(role="teacher", tier="teacher")
    studio = world.studio(owner=teacher)
    world.row_for(teacher)["studio_id"] = studio["id"]
    for _ in range(3):
        world.user(studio_id=studio["id"])

    res = client.get("/v1/studios/mine", headers=_auth(make_token(sub=teacher)))
    assert res.json()["seats_used"] == 3


def test_no_studio_is_a_404(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    me = world.user()
    res = client.get("/v1/studios/mine", headers=_auth(make_token(sub=me)))
    assert res.status_code == 404


# ---- join -----------------------------------------------------------------


def test_joining_raises_a_free_account(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`UNLIMITED_TIERS` already covers the tier; the grant is what stops a
    studio student meeting `FREE_MONTHLY_ANALYSES = 3` in week two."""
    teacher = world.user(role="teacher", tier="teacher")
    studio = world.studio(owner=teacher)
    world.row_for(teacher)["studio_id"] = studio["id"]
    student = world.user()

    res = client.post(
        "/v1/studios/join",
        headers=_auth(make_token(sub=student)),
        json={"invite_code": "ABC234"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["seats_used"] == 1
    assert res.json()["invite_code"] is None
    row = world.row_for(student)
    assert row["tier"] == "student_via_teacher"
    assert row["studio_id"] == studio["id"]


def test_joining_does_not_overwrite_a_paid_tier(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`pro` is already unlimited **and paid for**. Overwriting it would take
    away a subscription the musician is still being billed for."""
    teacher = world.user(role="teacher", tier="teacher")
    studio = world.studio(owner=teacher)
    world.row_for(teacher)["studio_id"] = studio["id"]
    subscriber = world.user(tier="pro")

    client.post(
        "/v1/studios/join",
        headers=_auth(make_token(sub=subscriber)),
        json={"invite_code": "ABC234"},
    )
    row = world.row_for(subscriber)
    assert row["tier"] == "pro"
    assert row["studio_id"] == studio["id"]


def test_the_code_is_case_insensitive(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The alphabet is upper case and a phone will offer a lower-case keyboard."""
    teacher = world.user(role="teacher", tier="teacher")
    studio = world.studio(owner=teacher)
    world.row_for(teacher)["studio_id"] = studio["id"]
    student = world.user()
    res = client.post(
        "/v1/studios/join",
        headers=_auth(make_token(sub=student)),
        json={"invite_code": "abc234"},
    )
    assert res.status_code == 200, res.text


def test_an_unknown_code_is_a_404(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    student = world.user()
    res = client.post(
        "/v1/studios/join",
        headers=_auth(make_token(sub=student)),
        json={"invite_code": "ZZZZZZ"},
    )
    assert res.status_code == 404


def test_a_full_studio_is_refused_and_says_whose_problem_it_is(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    teacher = world.user(role="teacher", tier="teacher")
    studio = world.studio(owner=teacher, seat_limit=2)
    world.row_for(teacher)["studio_id"] = studio["id"]
    for _ in range(2):
        world.user(studio_id=studio["id"])
    latecomer = world.user()

    res = client.post(
        "/v1/studios/join",
        headers=_auth(make_token(sub=latecomer)),
        json={"invite_code": "ABC234"},
    )
    assert res.status_code == 409
    assert "ask your teacher" in res.json()["detail"]
    assert world.row_for(latecomer)["studio_id"] is None


def test_joining_twice_is_refused(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    teacher = world.user(role="teacher", tier="teacher")
    studio = world.studio(owner=teacher)
    world.row_for(teacher)["studio_id"] = studio["id"]
    student = world.user(studio_id=studio["id"])
    res = client.post(
        "/v1/studios/join",
        headers=_auth(make_token(sub=student)),
        json={"invite_code": "ABC234"},
    )
    assert res.status_code == 409


# ---- leave ----------------------------------------------------------------


def test_leaving_gives_back_the_free_tier_it_granted(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Without this, `student_via_teacher` outlives the studio and the account
    keeps unlimited analyses for ever with nobody paying for them."""
    teacher = world.user(role="teacher", tier="teacher")
    studio = world.studio(owner=teacher)
    world.row_for(teacher)["studio_id"] = studio["id"]
    student = world.user(tier="student_via_teacher", studio_id=studio["id"])

    res = client.post("/v1/studios/leave", headers=_auth(make_token(sub=student)))
    assert res.status_code == 200, res.text
    assert res.json()["tier"] == "free"
    row = world.row_for(student)
    assert row["studio_id"] is None
    assert row["tier"] == "free"


def test_leaving_does_not_take_away_a_paid_tier(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Joining never changed it, so leaving must not either."""
    teacher = world.user(role="teacher", tier="teacher")
    studio = world.studio(owner=teacher)
    world.row_for(teacher)["studio_id"] = studio["id"]
    subscriber = world.user(tier="pro", studio_id=studio["id"])

    res = client.post("/v1/studios/leave", headers=_auth(make_token(sub=subscriber)))
    assert res.json()["tier"] == "pro"
    assert world.row_for(subscriber)["tier"] == "pro"


def test_the_owner_cannot_walk_out_of_their_own_studio(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The refusal `me.py` already gives for deleting the account: `001`
    RESTRICTs removing a studio owner, and losing the studio would take its
    students' assignments with it."""
    teacher = world.user(role="teacher", tier="teacher")
    studio = world.studio(owner=teacher)
    world.row_for(teacher)["studio_id"] = studio["id"]

    res = client.post("/v1/studios/leave", headers=_auth(make_token(sub=teacher)))
    assert res.status_code == 409
    assert world.row_for(teacher)["studio_id"] == studio["id"]


def test_leaving_nothing_is_a_404(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    me = world.user()
    res = client.post("/v1/studios/leave", headers=_auth(make_token(sub=me)))
    assert res.status_code == 404


def test_creating_a_studio_twice_finishes_the_first_attempt(
    world: World, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Two writes with no transaction between them, so the second call has to
    complete the first rather than start another.

    Staged as the state a failed promotion leaves behind: the studio row
    exists, its owner is still `studio_id`-less. Before this, the emptiness of
    `studio_id` let the guard pass and a retry made a *second* studio, with the
    first orphaned and nothing pointing at it — the same shape as the
    take-retry defect in `analyses.create_analysis`.
    """
    me = world.user()
    stranded = world.studio(owner=me, name="First Attempt", invite_code="QRS789")

    res = client.post(
        "/v1/studios", headers=_auth(make_token(sub=me)), json={"name": "Second Try"}
    )
    assert res.status_code == 201, res.text
    assert res.json()["id"] == stranded["id"]
    assert res.json()["name"] == "First Attempt"
    assert res.json()["invite_code"] == "QRS789"
    assert len(world.fake.table("studios").rows) == 1

    row = world.row_for(me)
    assert (row["role"], row["tier"]) == ("teacher", "teacher")
    assert row["studio_id"] == stranded["id"]
