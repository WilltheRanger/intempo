"""Attaching photographed notation to an existing hand-entered piece."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.routers.scores import AttachScorePagesRequest, MAX_PAGES
from app.tests.test_scores_router import (
    GOOD_PAYLOAD,
    PROJECT_HOST,
    _install_supabase,
    _row_for,
    _signed_url,
    _stub_worker,
)


@pytest.fixture()
def api() -> TestClient:
    return TestClient(app)


def _auth(make_token, user_id):
    return {"Authorization": f"Bearer {make_token(sub=str(user_id))}"}


def _manual_row(score_id, user_id):
    return _row_for(
        score_id,
        user_id,
        source_image_url=None,
        source_image_urls=None,
        score_json={
            **GOOD_PAYLOAD,
            "clef": "bass",
            "time_signature": "3/4",
            "bpm_hint": 88,
            "measures": [],
        },
        ocr_confidence=None,
        transcription_status="done",
    )


def test_attachment_requires_at_least_one_page() -> None:
    with pytest.raises(ValidationError, match="at least one page"):
        AttachScorePagesRequest()


def test_attachment_uses_the_same_page_ceiling_as_new_scans() -> None:
    urls = [_signed_url(uuid4()).replace("abc.", f"p{i}.") for i in range(MAX_PAGES + 1)]

    with pytest.raises(ValidationError, match=f"at most {MAX_PAGES}"):
        AttachScorePagesRequest(image_urls=urls)


def test_attaching_pages_reuses_the_piece_and_queues_a_read(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, score_id = uuid4(), uuid4()
    pages = [
        _signed_url(user_id).replace("abc.", "p1."),
        _signed_url(user_id).replace("abc.", "p2."),
    ]
    client = _install_supabase(
        monkeypatch, returning_row=_manual_row(score_id, user_id)
    )
    enqueued = _stub_worker(monkeypatch)

    response = api.post(
        f"/v1/scores/{score_id}/transcription",
        json={"image_urls": pages},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 200, response.text
    written = client.table.return_value.update.call_args.args[0]
    expected = [
        (
            f"{PROJECT_HOST}/storage/v1/object/authenticated/score-images/"
            f"{user_id}/p{position}.jpg"
        )
        for position in (1, 2)
    ]
    assert written["source_image_url"] == expected[0]
    assert written["source_image_urls"] == expected
    assert all("token=" not in page for page in expected)
    assert written["score_json"]["measures"] == []
    assert written["score_json"]["clef"] == "bass"
    assert written["score_json"]["time_signature"] == "3/4"
    assert written["score_json"]["bpm_hint"] == 88
    assert written["transcription_status"] == "queued"
    assert enqueued == [str(score_id)]
    client.table.return_value.insert.assert_not_called()


def test_attachment_checks_every_page_before_touching_the_piece(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, other_id, score_id = uuid4(), uuid4(), uuid4()
    pages = [_signed_url(user_id), _signed_url(other_id)]
    client = _install_supabase(
        monkeypatch, returning_row=_manual_row(score_id, user_id)
    )
    enqueued = _stub_worker(monkeypatch)

    response = api.post(
        f"/v1/scores/{score_id}/transcription",
        json={"image_urls": pages},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 403, response.text
    client.table.return_value.update.assert_not_called()
    assert enqueued == []


def test_attachment_refuses_to_replace_existing_notation(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, score_id = uuid4(), uuid4()
    row = _row_for(score_id, user_id, transcription_status="done")
    client = _install_supabase(monkeypatch, returning_row=row)
    enqueued = _stub_worker(monkeypatch)

    response = api.post(
        f"/v1/scores/{score_id}/transcription",
        json={"image_url": _signed_url(user_id)},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 409, response.text
    assert "already has notation" in response.text
    client.table.return_value.update.assert_not_called()
    assert enqueued == []


def test_attachment_refuses_a_second_read_while_one_is_running(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, score_id = uuid4(), uuid4()
    row = _manual_row(score_id, user_id)
    row["transcription_status"] = "reading"
    client = _install_supabase(monkeypatch, returning_row=row)
    enqueued = _stub_worker(monkeypatch)

    response = api.post(
        f"/v1/scores/{score_id}/transcription",
        json={"image_url": _signed_url(user_id)},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 409, response.text
    assert "already being read" in response.text
    client.table.return_value.update.assert_not_called()
    assert enqueued == []
