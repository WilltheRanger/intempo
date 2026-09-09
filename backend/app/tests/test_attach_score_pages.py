"""Attaching photographed notation to an existing hand-entered piece."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.services.transcription_budget import MAX_RUNS_PER_PAGE
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


def _manual_row(score_id, user_id, **overrides):
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
        **overrides,
    )


def test_attachment_requires_at_least_one_page() -> None:
    with pytest.raises(ValidationError, match="at least one page"):
        AttachScorePagesRequest()


def test_attachment_uses_the_same_page_ceiling_as_new_scans() -> None:
    urls = [_signed_url(uuid4()).replace("abc.", f"p{i}.") for i in range(MAX_PAGES + 1)]

    with pytest.raises(ValidationError, match=f"at most {MAX_PAGES}"):
        AttachScorePagesRequest(image_urls=urls)


def test_a_new_photograph_starts_the_reading_allowance_over(
    api: TestClient, monkeypatch, make_token
) -> None:
    """**Reset to 1, not incremented**, and the refusal at the ceiling is why.

    `transcription_budget` bounds readings of *one* photograph, and what it
    tells a musician at the ceiling is that a clearer picture will do more than
    another attempt at this one. A musician who takes that advice, photographs
    the page again, and is refused anyway has been told to do something that
    does not work — which is worse than not advising them at all.

    The exhausted row here is the one that makes the point: `MAX_RUNS_PER_PAGE`
    already spent, and the replacement still queues a read.
    """
    user_id, score_id = uuid4(), uuid4()
    client = _install_supabase(
        monkeypatch,
        returning_row=_manual_row(
            score_id, user_id, transcription_runs=MAX_RUNS_PER_PAGE
        ),
    )
    enqueued = _stub_worker(monkeypatch)

    response = api.post(
        f"/v1/scores/{score_id}/transcription",
        json={"image_urls": [_signed_url(user_id)]},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 200, response.text
    assert client.table.return_value.update.call_args.args[0]["transcription_runs"] == 1
    assert enqueued == [str(score_id)]


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


def test_new_photographs_replace_a_failed_first_read_without_a_duplicate(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, score_id = uuid4(), uuid4()
    old_page = _signed_url(user_id).replace("abc.jpg", "old.jpg")
    new_page = _signed_url(user_id).replace("abc.jpg", "new.jpg")
    row = _row_for(
        score_id,
        user_id,
        source_image_url=old_page,
        source_image_urls=[old_page],
        score_json={**GOOD_PAYLOAD, "measures": []},
        ocr_confidence=None,
        transcription_status="failed",
        transcription_error="The photograph was too blurred to read.",
    )
    client = _install_supabase(monkeypatch, returning_row=row)
    enqueued = _stub_worker(monkeypatch)

    expected_url = (
        f"{PROJECT_HOST}/storage/v1/object/authenticated/score-images/"
        f"{user_id}/new.jpg"
    )
    replaced = {
        **row,
        "source_image_url": expected_url,
        "source_image_urls": [expected_url],
        "score_json": {**row["score_json"], "measures": []},
        "transcription_status": "queued",
        "transcription_error": None,
    }
    # Replacement is compare-and-set on both the failed state and the page it
    # is replacing. Configure that deeper query separately from the ordinary
    # hand-entered attachment chain in `_install_supabase`.
    (
        client.table.return_value.update.return_value.eq.return_value.eq.return_value
        .eq.return_value.eq.return_value.execute.return_value
    ) = type("Result", (), {"data": [replaced]})()

    claimed: list[tuple[str, list[str]]] = []
    monkeypatch.setattr(
        "app.routers.scores.pending_uploads.claim",
        lambda bucket, keys: claimed.append((bucket, keys)),
    )

    response = api.post(
        f"/v1/scores/{score_id}/transcription",
        json={"image_url": new_page},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 200, response.text
    written = client.table.return_value.update.call_args.args[0]
    assert written["source_image_url"] == expected_url
    assert written["transcription_status"] == "queued"
    assert written["transcription_error"] is None
    assert claimed == [("score-images", [f"{user_id}/new.jpg"])]
    client.storage.from_.return_value.remove.assert_called_once_with(
        [f"{user_id}/old.jpg"]
    )
    assert enqueued == [str(score_id)]
    client.table.return_value.insert.assert_not_called()


def test_failed_replacement_keeps_old_page_until_compare_and_set_wins(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, score_id = uuid4(), uuid4()
    old_page = _signed_url(user_id).replace("abc.jpg", "old.jpg")
    row = _row_for(
        score_id,
        user_id,
        source_image_url=old_page,
        source_image_urls=[old_page],
        score_json={**GOOD_PAYLOAD, "measures": []},
        transcription_status="failed",
    )
    client = _install_supabase(monkeypatch, returning_row=row)
    enqueued = _stub_worker(monkeypatch)
    (
        client.table.return_value.update.return_value.eq.return_value.eq.return_value
        .eq.return_value.eq.return_value.execute.return_value
    ) = type("Result", (), {"data": []})()

    claimed: list[list[str]] = []
    monkeypatch.setattr(
        "app.routers.scores.pending_uploads.claim",
        lambda _bucket, keys: claimed.append(keys),
    )

    response = api.post(
        f"/v1/scores/{score_id}/transcription",
        json={"image_url": _signed_url(user_id).replace("abc.jpg", "new.jpg")},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 409, response.text
    assert "changed while" in response.text
    client.storage.from_.return_value.remove.assert_not_called()
    assert claimed == []
    assert enqueued == []


def test_new_photographs_never_erase_notes_from_a_failed_reread(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, score_id = uuid4(), uuid4()
    row = _row_for(
        score_id,
        user_id,
        transcription_status="failed",
        transcription_error="A later re-read failed.",
    )
    client = _install_supabase(monkeypatch, returning_row=row)
    enqueued = _stub_worker(monkeypatch)

    response = api.post(
        f"/v1/scores/{score_id}/transcription",
        json={"image_url": _signed_url(user_id).replace("abc.jpg", "new.jpg")},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 409, response.text
    assert "already has notation" in response.text
    client.table.return_value.update.assert_not_called()
    assert enqueued == []


def test_old_failed_page_is_swept_if_immediate_removal_is_unavailable(
    api: TestClient, monkeypatch, make_token
) -> None:
    user_id, score_id = uuid4(), uuid4()
    old_page = _signed_url(user_id).replace("abc.jpg", "old.jpg")
    row = _row_for(
        score_id,
        user_id,
        source_image_url=old_page,
        source_image_urls=[old_page],
        score_json={**GOOD_PAYLOAD, "measures": []},
        transcription_status="failed",
    )
    client = _install_supabase(monkeypatch, returning_row=row)
    _stub_worker(monkeypatch)
    new_page = _signed_url(user_id).replace("abc.jpg", "new.jpg")
    new_url = (
        f"{PROJECT_HOST}/storage/v1/object/authenticated/score-images/"
        f"{user_id}/new.jpg"
    )
    replaced = {
        **row,
        "source_image_url": new_url,
        "source_image_urls": [new_url],
        "transcription_status": "queued",
    }
    (
        client.table.return_value.update.return_value.eq.return_value.eq.return_value
        .eq.return_value.eq.return_value.execute.return_value
    ) = type("Result", (), {"data": [replaced]})()
    client.storage.from_.return_value.remove.side_effect = RuntimeError("storage down")

    deferred: list[tuple[object, str, str]] = []
    monkeypatch.setattr(
        "app.routers.scores.pending_uploads.claim", lambda *_args: None
    )
    monkeypatch.setattr(
        "app.routers.scores.pending_uploads.record",
        lambda owner, bucket, key: deferred.append((owner, bucket, key)),
    )

    response = api.post(
        f"/v1/scores/{score_id}/transcription",
        json={"image_url": new_page},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 200, response.text
    assert deferred == [(user_id, "score-images", f"{user_id}/old.jpg")]
