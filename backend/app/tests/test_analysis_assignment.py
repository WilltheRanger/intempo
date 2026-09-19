"""`assignment_id` on enqueue — the field that makes the weekly loop visible.

`001` created `analyses.assignment_id` and its partial index, and nothing ever
wrote either. `002`'s `"teacher reads assignment analyses"` is the only route
by which a teacher sees a student's take, and it keys off exactly that column,
so until now it matched no row: every take in the system was invisible from the
teacher's side by construction, not by policy.

These hold the three refusals and — the part worth the file on its own — the
**retry path**. One uploaded object is one take, so a POST whose response was
lost is answered from the row already written. That answer predated this field:
a first attempt without an assignment and a retry with one returned the
untouched row and left the take unattached. Silent, and only on the retry, so
a musician would meet it as "some of my takes reach my teacher and some do
not".

Migration 023 holds the same ownership rules in the database. Both exist for
the reason 023's header gives: the router is where the rule belongs and also
where a wrong `.eq()` lives.
"""

from __future__ import annotations

from typing import Any, Callable
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app import db as db_module
from app.main import app
from app.tests.fake_supabase import FakeSupabase
from app.workers import analysis_runner

PROJECT_HOST = "https://test.supabase.invalid"

SCORE_JSON: dict[str, Any] = {
    "clef": "treble",
    "time_signature": "4/4",
    "key_signature": None,
    "tempo_marking": None,
    "bpm_hint": None,
    "measures": [
        {"measure_number": 1, "notes": [], "slurs": []},
        {"measure_number": 2, "notes": [], "slurs": []},
    ],
    "repeats": [],
    "ocr_confidence": 0.9,
    "notes_to_human": "",
}


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _audio_url(user_id: UUID, name: str | None = None) -> str:
    return (
        f"{PROJECT_HOST}/storage/v1/object/sign/audio-uploads/"
        f"{user_id}/{name or uuid4()}.wav?token=x"
    )


def _install(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabase) -> None:
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)
    monkeypatch.setattr(analysis_runner, "get_service_client", lambda: fake)
    # The analysis itself is not what these assert on; every other test file
    # that enqueues does the same.
    monkeypatch.setattr(analysis_runner, "run_analysis", lambda _id: None)


def _world(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[FakeSupabase, UUID, UUID, UUID]:
    """A student with one piece and one open assignment on it."""
    student = uuid4()
    score_id = uuid4()
    assignment_id = uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [{"id": str(score_id), "user_id": str(student), "score_json": SCORE_JSON}])
    fake.seed(
        "assignments",
        [
            {
                "id": str(assignment_id),
                "student_user_id": str(student),
                "teacher_user_id": str(uuid4()),
                "score_id": str(score_id),
                "status": "assigned",
            }
        ],
    )
    _install(monkeypatch, fake)
    return fake, student, score_id, assignment_id


def _post(
    client: TestClient,
    token: str,
    *,
    score_id: UUID,
    audio_url: str,
    assignment_id: UUID | None = None,
    omit_assignment: bool = False,
):
    body: dict[str, Any] = {
        "score_id": str(score_id),
        "audio_url": audio_url,
        "target_bpm": 92,
        "bpm_source": "manual",
    }
    if not omit_assignment:
        body["assignment_id"] = str(assignment_id) if assignment_id else None
    return client.post(
        "/v1/analyses", headers={"Authorization": f"Bearer {token}"}, json=body
    )


# ---- the accepted case ----------------------------------------------------


def test_an_assigned_take_is_stored_against_its_assignment(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    fake, student, score_id, assignment_id = _world(monkeypatch)
    res = _post(
        client,
        make_token(sub=student),
        score_id=score_id,
        audio_url=_audio_url(student),
        assignment_id=assignment_id,
    )
    assert res.status_code == 202, res.text
    row = fake.table("analyses").rows[0]
    assert row["assignment_id"] == str(assignment_id)


def test_the_assignment_is_visible_on_the_polled_analysis(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A client that cannot tell an assigned take from a personal one cannot
    show the difference. `_WITHOUT_RESULT` is derived from the response model,
    so the light projection carries it with no second edit — this is what holds
    that."""
    fake, student, score_id, assignment_id = _world(monkeypatch)
    token = make_token(sub=student)
    created = _post(
        client,
        token,
        score_id=score_id,
        audio_url=_audio_url(student),
        assignment_id=assignment_id,
    )
    analysis_id = created.json()["analysis_id"]

    one = client.get(
        f"/v1/analyses/{analysis_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert one.status_code == 200
    assert one.json()["assignment_id"] == str(assignment_id)

    listed = client.get("/v1/analyses", headers={"Authorization": f"Bearer {token}"})
    assert listed.status_code == 200
    assert listed.json()[0]["assignment_id"] == str(assignment_id)


def test_a_personal_take_stores_no_assignment(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Every take the app has ever submitted. The column stays absent rather
    than being written null, which is the shape `from_measure` established."""
    fake, student, score_id, _assignment = _world(monkeypatch)
    res = _post(
        client,
        make_token(sub=student),
        score_id=score_id,
        audio_url=_audio_url(student),
        omit_assignment=True,
    )
    assert res.status_code == 202, res.text
    assert "assignment_id" not in fake.table("analyses").rows[0]


# ---- the three refusals ---------------------------------------------------


def test_another_students_assignment_is_not_found(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """404 rather than 403, so an id cannot be used to confirm that an
    assignment exists in a studio the caller is not in."""
    fake, student, score_id, assignment_id = _world(monkeypatch)
    fake.table("assignments").rows[0]["student_user_id"] = str(uuid4())
    res = _post(
        client,
        make_token(sub=student),
        score_id=score_id,
        audio_url=_audio_url(student),
        assignment_id=assignment_id,
    )
    assert res.status_code == 404
    assert fake.table("analyses").rows == []


def test_an_unknown_assignment_is_not_found(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    fake, student, score_id, _assignment = _world(monkeypatch)
    res = _post(
        client,
        make_token(sub=student),
        score_id=score_id,
        audio_url=_audio_url(student),
        assignment_id=uuid4(),
    )
    assert res.status_code == 404
    assert fake.table("analyses").rows == []


def test_an_assignment_for_a_different_piece_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Otherwise the delta view groups takes of two pieces under one assignment
    and calls it progress — `comparison_key()` folds `score_id` in."""
    fake, student, score_id, assignment_id = _world(monkeypatch)
    fake.table("assignments").rows[0]["score_id"] = str(uuid4())
    res = _post(
        client,
        make_token(sub=student),
        score_id=score_id,
        audio_url=_audio_url(student),
        assignment_id=assignment_id,
    )
    assert res.status_code == 400
    assert "different piece" in res.json()["detail"]
    assert fake.table("analyses").rows == []


def test_an_archived_assignment_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """022 made `archived` terminal on the assignment side; a take attaching to
    one would reach the same state through a different door."""
    fake, student, score_id, assignment_id = _world(monkeypatch)
    fake.table("assignments").rows[0]["status"] = "archived"
    res = _post(
        client,
        make_token(sub=student),
        score_id=score_id,
        audio_url=_audio_url(student),
        assignment_id=assignment_id,
    )
    assert res.status_code == 409
    assert fake.table("analyses").rows == []


# ---- the retry path, which is where the defect was ------------------------


def test_a_retry_attaches_a_take_the_first_attempt_left_unattached(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The defect this file exists for.

    Same uploaded object, so the second POST is answered from the row already
    written. Before the backfill that answer ignored the assignment entirely
    and the take stayed invisible to the teacher — on the retry only, which is
    the hardest kind of bug to be told about.
    """
    fake, student, score_id, assignment_id = _world(monkeypatch)
    token = make_token(sub=student)
    url = _audio_url(student, name="same-object")

    first = _post(
        client, token, score_id=score_id, audio_url=url, omit_assignment=True
    )
    assert first.status_code == 202
    assert "assignment_id" not in fake.table("analyses").rows[0]

    second = _post(
        client, token, score_id=score_id, audio_url=url, assignment_id=assignment_id
    )
    assert second.status_code == 202
    assert second.json()["analysis_id"] == first.json()["analysis_id"]
    assert len(fake.table("analyses").rows) == 1
    assert fake.table("analyses").rows[0]["assignment_id"] == str(assignment_id)


def test_a_retry_carrying_a_different_assignment_is_a_conflict(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """One recording answering two assignments is not a retry. Returning the
    first attachment quietly would hide it, and guessing is not the client's to
    do, so it is named."""
    fake, student, score_id, assignment_id = _world(monkeypatch)
    other = uuid4()
    fake.table("assignments").rows.append(
        {
            "id": str(other),
            "student_user_id": str(student),
            "teacher_user_id": str(uuid4()),
            "score_id": str(score_id),
            "status": "assigned",
        }
    )
    token = make_token(sub=student)
    url = _audio_url(student, name="same-object")

    _post(client, token, score_id=score_id, audio_url=url, assignment_id=assignment_id)
    clash = _post(client, token, score_id=score_id, audio_url=url, assignment_id=other)

    assert clash.status_code == 409
    assert fake.table("analyses").rows[0]["assignment_id"] == str(assignment_id)


def test_a_retry_without_an_assignment_does_not_detach_the_take(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """An older client retrying must not clear an attachment a newer one made."""
    fake, student, score_id, assignment_id = _world(monkeypatch)
    token = make_token(sub=student)
    url = _audio_url(student, name="same-object")

    _post(client, token, score_id=score_id, audio_url=url, assignment_id=assignment_id)
    again = _post(client, token, score_id=score_id, audio_url=url, omit_assignment=True)

    assert again.status_code == 202
    assert fake.table("analyses").rows[0]["assignment_id"] == str(assignment_id)
