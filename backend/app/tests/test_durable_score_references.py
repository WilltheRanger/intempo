"""Durable page references between upload and score creation.

The upload permission expires after five minutes. It is valid for the PUT and
must never be the thing a musician has to race while naming a piece or sending
the later pages of a scan.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.tests.test_attach_score_pages import _manual_row
from app.tests.test_scores_router import (
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
    return {"Authorization": f"Bearer {make_token(sub=user_id)}"}


def test_an_object_key_is_accepted_and_stored_without_a_token(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, score_id = uuid4(), uuid4()
    key = f"{user_id}/{uuid4()}.jpg"
    client = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id)
    )
    _stub_worker(monkeypatch)

    response = api.post(
        "/v1/scores",
        json={"image_url": key, "title": "Slow movement"},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 201, response.text
    stored = client.table.return_value.insert.call_args.args[0]["source_image_url"]
    assert stored == (
        f"{PROJECT_HOST}/storage/v1/object/authenticated/score-images/{key}"
    )
    assert "token=" not in stored


def test_an_older_signed_upload_url_is_still_accepted_but_not_persisted(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, score_id = uuid4(), uuid4()
    client = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id)
    )
    _stub_worker(monkeypatch)

    response = api.post(
        "/v1/scores",
        json={"image_url": _signed_url(user_id), "title": "Legacy client"},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 201, response.text
    stored = client.table.return_value.insert.call_args.args[0]["source_image_url"]
    assert "/object/authenticated/" in stored
    assert "/object/upload/sign/" not in stored
    assert "token=" not in stored


def test_every_key_in_a_multi_page_scan_is_canonicalised_in_order(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, score_id = uuid4(), uuid4()
    keys = [f"{user_id}/{uuid4()}.jpg" for _ in range(3)]
    client = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id)
    )
    _stub_worker(monkeypatch)

    response = api.post(
        "/v1/scores",
        json={"image_urls": keys, "title": "Three pages"},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 201, response.text
    stored = client.table.return_value.insert.call_args.args[0]
    expected = [
        f"{PROJECT_HOST}/storage/v1/object/authenticated/score-images/{key}"
        for key in keys
    ]
    assert stored["source_image_urls"] == expected
    assert stored["source_image_url"] == expected[0]


def test_attaching_notation_uses_the_same_durable_reference(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, score_id = uuid4(), uuid4()
    key = f"{user_id}/{uuid4()}.png"
    client = _install_supabase(
        monkeypatch, returning_row=_manual_row(score_id, user_id)
    )
    _stub_worker(monkeypatch)

    response = api.post(
        f"/v1/scores/{score_id}/transcription",
        json={"image_url": key},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 200, response.text
    stored = client.table.return_value.update.call_args.args[0]
    assert stored["source_image_url"] == (
        f"{PROJECT_HOST}/storage/v1/object/authenticated/score-images/{key}"
    )
    assert stored["source_image_urls"] == [stored["source_image_url"]]


@pytest.mark.parametrize(
    "reference",
    [
        lambda owner: f"{uuid4()}/{uuid4()}.jpg",
        lambda owner: f"{owner}/nested/{uuid4()}.jpg",
        lambda owner: "https://example.com/not-storage/page.jpg",
        lambda owner: "../score-images/page.jpg",
    ],
)
def test_a_key_must_name_one_page_owned_by_the_caller(
    reference, api: TestClient, monkeypatch, make_token
) -> None:
    user_id = uuid4()
    client = _install_supabase(
        monkeypatch, returning_row=_row_for(uuid4(), user_id)
    )
    _stub_worker(monkeypatch)

    response = api.post(
        "/v1/scores",
        json={"image_url": reference(user_id), "title": "Not mine"},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code in {400, 403}
    client.table.return_value.insert.assert_not_called()
