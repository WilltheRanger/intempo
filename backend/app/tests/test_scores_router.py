"""End-to-end tests for /v1/scores with mocked OCR + Supabase.

The autouse `_stub_jwks` fixture (in conftest) keeps the production
auth decoder happy with `make_token`. OCR is stubbed via monkeypatch
on `parse_sheet_music`. Supabase is mocked via the chained
`client.table(...).select(...).eq(...)...execute()` shape.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Callable
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import scores as scores_module


GOOD_PAYLOAD = {
    "time_signature": "4/4",
    "key_signature": "D major",
    "tempo_marking": None,
    "bpm_hint": None,
    "clef": "treble",
    "measures": [
        {
            "measure_number": 1,
            "notes": [
                {
                    "pitch": "D3",
                    "duration": "quarter",
                    "articulation": None,
                    "tied_to_next": False,
                    "dynamics": None,
                }
            ],
            "slurs": [],
        }
    ],
    "repeats": [],
    "ocr_confidence": 0.9,
    "notes_to_human": "",
}

PROJECT_HOST = "https://test.supabase.invalid"


def _signed_url(user_id: UUID, ext: str = "jpg") -> str:
    return (
        f"{PROJECT_HOST}/storage/v1/object/sign/score-images/{user_id}/abc.{ext}"
        f"?token=eyJfake"
    )


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _row_for(score_id: UUID, user_id: UUID, **overrides: Any) -> dict[str, Any]:
    base = {
        "id": str(score_id),
        "user_id": str(user_id),
        "title": "Etude #1",
        "composer": None,
        "movement": None,
        "source_image_url": _signed_url(user_id),
        "score_json": GOOD_PAYLOAD,
        "shared_with_studio": None,
        "ocr_confidence": GOOD_PAYLOAD["ocr_confidence"],
        "created_at": "2026-04-26T20:00:00+00:00",
        "updated_at": "2026-04-26T20:00:00+00:00",
    }
    base.update(overrides)
    return base


def _install_supabase(monkeypatch: pytest.MonkeyPatch, *, returning_row: dict | None = None,
                     returning_rows: list[dict] | None = None,
                     raise_on_delete: Exception | None = None) -> MagicMock:
    """Build a chain mock matching the supabase-py call shape used by scores.py."""
    client = MagicMock()
    table = client.table.return_value
    # select(...).eq(...).eq(...).limit(1).execute() — single
    select_chain = table.select.return_value
    select_eq = select_chain.eq.return_value
    select_eq2 = select_eq.eq.return_value
    select_eq2.limit.return_value.execute.return_value = MagicMock(
        data=[returning_row] if returning_row else []
    )
    # select(...).eq(...).order(...).range(...).execute() — list
    select_eq.order.return_value.range.return_value.execute.return_value = MagicMock(
        data=returning_rows or []
    )
    # insert(...).execute()
    table.insert.return_value.execute.return_value = MagicMock(
        data=[returning_row] if returning_row else []
    )
    # update(...).eq(...).eq(...).execute()
    table.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[returning_row] if returning_row else []
    )
    # delete(...).eq(...).eq(...).execute()
    delete_chain = table.delete.return_value.eq.return_value.eq.return_value
    if raise_on_delete is not None:
        delete_chain.execute.side_effect = raise_on_delete
    else:
        delete_chain.execute.return_value = MagicMock(
            data=[returning_row] if returning_row else []
        )
    monkeypatch.setattr(scores_module, "get_service_client", lambda: client)
    return client


def _stub_worker(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Catch the enqueued transcription instead of running it.

    `TestClient` runs a `BackgroundTask` for real once the response is sent, so
    without this every POST in this file would try to fetch a URL and call a
    vision model. The returned list records the score ids handed to the worker,
    which is the thing worth asserting here — what the worker then *does* with
    one is `test_transcription_runner.py`'s subject.
    """
    enqueued: list[str] = []
    monkeypatch.setattr(scores_module, "run_transcription", enqueued.append)
    return enqueued


# ---- POST /v1/scores ------------------------------------------------------


def test_post_unauthenticated_returns_401(client: TestClient) -> None:
    res = client.post("/v1/scores", json={"image_url": "x", "title": "t"})
    assert res.status_code == 401


def test_post_creates_score(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """The row exists immediately, with the reading still to come.

    OCR used to run inside this request and the assertions used to be about its
    result. They cannot be any more, and that is the point of the change: the
    piece is real and openable the moment this returns, and the notes arrive in
    the same row a minute later.
    """
    user_id = uuid4()
    score_id = uuid4()
    enqueued = _stub_worker(monkeypatch)
    sb = _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))

    res = client.post(
        "/v1/scores",
        json={
            "image_url": _signed_url(user_id),
            "title": "Etude #1",
        },
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["id"] == str(score_id)
    assert body["user_id"] == str(user_id)

    sb.table.return_value.insert.assert_called_once()
    payload = sb.table.return_value.insert.call_args.args[0]
    assert payload["user_id"] == str(user_id)
    assert payload["transcription_status"] == "queued"
    # No notes yet, and no claim about how well any were read.
    assert payload["score_json"]["measures"] == []
    assert payload["ocr_confidence"] is None
    # And the work was actually handed on — a queued row nobody reads is worse
    # than the inline version it replaced.
    assert enqueued == [str(score_id)]


def test_post_creates_hand_entered_score_without_touching_ocr(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """A piece typed in by hand: no image, no download, no OCR call.

    OCR is deliberately left unstubbed. If the manual path ever reaches it,
    this test fails by trying to call a real provider rather than passing
    against a mock that hides the regression.
    """
    user_id = uuid4()
    score_id = uuid4()
    row = _row_for(
        score_id,
        user_id,
        title="Suite No. 1 in G major",
        composer="J. S. Bach",
        source_image_url=None,
        ocr_confidence=None,
        score_json={**GOOD_PAYLOAD, "clef": "bass", "measures": [], "ocr_confidence": 0.0},
    )
    sb = _install_supabase(monkeypatch, returning_row=row)

    res = client.post(
        "/v1/scores",
        json={
            "title": "Suite No. 1 in G major",
            "composer": "J. S. Bach",
            "clef": "bass",
            "time_signature": "4/4",
            "bpm_hint": 88,
        },
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["source_image_url"] is None
    assert body["image_url"] is None
    assert body["ocr_confidence"] is None

    payload = sb.table.return_value.insert.call_args.args[0]
    assert payload["source_image_url"] is None
    # Null, not 0: the column says how well OCR read the page, and it never
    # read one.
    assert payload["ocr_confidence"] is None
    assert payload["score_json"]["clef"] == "bass"
    assert payload["score_json"]["time_signature"] == "4/4"
    assert payload["score_json"]["bpm_hint"] == 88
    assert payload["score_json"]["measures"] == []


def test_post_without_image_url_requires_a_clef(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))

    res = client.post(
        "/v1/scores",
        json={"title": "Untitled"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 422
    assert "clef" in res.text


def test_post_rejects_manual_fields_alongside_an_image(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """Both provenances at once is a caller bug, not something to reconcile."""
    user_id = uuid4()
    _stub_worker(monkeypatch)
    _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))

    res = client.post(
        "/v1/scores",
        json={
            "image_url": _signed_url(user_id),
            "title": "Etude #1",
            "clef": "treble",
            "bpm_hint": 120,
        },
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 422
    # Names the offending fields, so the caller doesn't have to bisect.
    assert "clef" in res.text and "bpm_hint" in res.text


def test_post_rejects_url_outside_user_prefix(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    other_user = uuid4()
    _stub_worker(monkeypatch)
    _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))

    # Signed URL points at *another* user's prefix — should be 403 before download.
    bad_url = _signed_url(other_user)
    res = client.post(
        "/v1/scores",
        json={"image_url": bad_url, "title": "sneaky"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 403


def test_post_rejects_arbitrary_external_url(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    _stub_worker(monkeypatch)
    _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))

    res = client.post(
        "/v1/scores",
        json={
            "image_url": "https://evil.example.com/payload.jpg",
            "title": "etude",
        },
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 403


def test_a_bad_url_is_refused_before_a_row_is_written(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """The ownership check stays in the request, and this is why.

    A URL that is not this caller's object can never be transcribed, so
    creating a row to discover that in a worker would leave the musician a
    library entry that was doomed before it was written. OCR moved to the
    background; the guard did not.
    """
    user_id = uuid4()
    enqueued = _stub_worker(monkeypatch)
    sb = _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))

    res = client.post(
        "/v1/scores",
        json={"image_url": _signed_url(uuid4()), "title": "sneaky"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 403
    sb.table.return_value.insert.assert_not_called()
    assert enqueued == []


# ---- GET /v1/scores -------------------------------------------------------


def test_list_returns_owner_scores(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    rows = [_row_for(uuid4(), user_id, title=f"row {i}") for i in range(3)]
    _install_supabase(monkeypatch, returning_rows=rows)

    res = client.get(
        "/v1/scores",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 3
    assert [r["title"] for r in body] == ["row 0", "row 1", "row 2"]


# ---- GET /v1/scores/:id ---------------------------------------------------


def test_get_own_score_returns_200(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))

    res = client.get(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200
    assert res.json()["id"] == str(score_id)


def test_get_unknown_score_returns_404(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=None)

    res = client.get(
        f"/v1/scores/{uuid4()}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 404


def test_get_other_users_score_returns_404(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """Service-role read filters by user_id, so another user's row is invisible
    even though the underlying table has it. RLS-on-the-API-layer parity."""
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=None)

    res = client.get(
        f"/v1/scores/{uuid4()}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 404


# ---- PATCH /v1/scores/:id -------------------------------------------------


def test_patch_replaces_score_json(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    new_payload = {**GOOD_PAYLOAD, "ocr_confidence": 0.95, "key_signature": "G major"}
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id, score_json=new_payload, ocr_confidence=0.95),
    )

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={"score_json": new_payload},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["score_json"]["key_signature"] == "G major"
    sb.table.return_value.update.assert_called_once()
    update_payload = sb.table.return_value.update.call_args.args[0]
    assert update_payload["ocr_confidence"] == 0.95


def test_movement_round_trips_through_create_and_read(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """Which movement of a work this is — the reason two Wohlfahrt studies in a
    library are no longer two identical rows."""
    user_id = uuid4()
    score_id = uuid4()
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id, movement="I. Adagio"),
    )

    res = client.post(
        "/v1/scores",
        json={
            "title": "Sonata No. 1 in G minor, BWV 1001",
            "composer": "J. S. Bach",
            "movement": "I. Adagio",
            "clef": "treble",
        },
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["movement"] == "I. Adagio"
    assert sb.table.return_value.insert.call_args.args[0]["movement"] == "I. Adagio"


def test_patch_can_clear_a_movement(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """An explicit null clears it — music that turned out to have no movements."""
    user_id = uuid4()
    score_id = uuid4()
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id, movement=None)
    )

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={"movement": None},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text
    assert sb.table.return_value.update.call_args.args[0] == {"movement": None}


def test_patch_omitting_movement_leaves_it_alone(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id, movement="II. Fuga")
    )

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={"title": "Renamed"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text
    assert "movement" not in sb.table.return_value.update.call_args.args[0]


def test_patch_can_clear_a_composer(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """An explicit null clears the field; it is not read as "unchanged".

    The distinction is the feature. With an `is not None` check there is no way
    to remove a composer at all — the request 200s with the old value still in
    place.
    """
    user_id = uuid4()
    score_id = uuid4()
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id, composer=None)
    )

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={"composer": None},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["composer"] is None
    update = sb.table.return_value.update.call_args.args[0]
    assert update == {"composer": None}


def test_patch_omitting_composer_leaves_it_alone(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """The other half of the same distinction: absent means untouched."""
    user_id = uuid4()
    score_id = uuid4()
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id, composer="Eccles")
    )

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={"title": "Renamed"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text
    update = sb.table.return_value.update.call_args.args[0]
    assert "composer" not in update


def test_patch_rejects_a_null_title(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """Null is meaningful for a composer, not for a title — so it is refused."""
    user_id = uuid4()
    score_id = uuid4()
    _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={"title": None},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 400
    assert "title cannot be null" in res.text


def test_patch_empty_body_returns_400(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))
    res = client.patch(
        f"/v1/scores/{uuid4()}",
        json={},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 400


def test_patch_unknown_id_returns_404(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=None)
    res = client.patch(
        f"/v1/scores/{uuid4()}",
        json={"title": "renamed"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 404


# ---- DELETE /v1/scores/:id ------------------------------------------------


def test_delete_owner_returns_204(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))
    res = client.delete(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 204


def test_delete_unknown_returns_404(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=None)
    res = client.delete(
        f"/v1/scores/{uuid4()}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 404


def test_delete_with_dependent_analyses_returns_409(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    fk_violation = RuntimeError(
        "update or delete on table scores violates foreign key constraint analyses_score_id_fkey"
    )
    _install_supabase(monkeypatch, raise_on_delete=fk_violation)
    res = client.delete(
        f"/v1/scores/{uuid4()}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 409
    assert "analyses" in res.json()["detail"]



# ---- Signed download URLs -------------------------------------------------
#
# `scores.source_image_url` holds the signed *upload* URL, which stops working
# minutes after the upload. A stored score therefore has no displayable image
# until one is signed fresh on read — which is why every thumbnail in the app
# is still fixture artwork.


def _install_storage(client: MagicMock, *, signed=None, raises: bool = False) -> MagicMock:
    """Attach storage behaviour to a client already built by `_install_supabase`."""
    bucket = client.storage.from_.return_value
    if raises:
        bucket.create_signed_urls.side_effect = RuntimeError("storage unreachable")
    else:
        bucket.create_signed_urls.return_value = signed if signed is not None else []
    return client


def test_object_key_recovered_from_every_url_shape() -> None:
    """Signing needs the object key, and the key only exists inside the URL."""
    key = "11111111-1111-1111-1111-111111111111/abc.jpg"
    for prefix in (
        "/storage/v1/object/sign/",
        "/storage/v1/object/upload/sign/",
        "/storage/v1/object/authenticated/",
        "/storage/v1/object/public/",
    ):
        url = f"{PROJECT_HOST}{prefix}score-images/{key}?token=eyJfake"
        assert scores_module._object_key_from(url) == key, prefix


def test_object_key_is_none_for_a_foreign_url() -> None:
    assert scores_module._object_key_from("https://evil.example.com/page.jpg") is None
    assert scores_module._object_key_from(
        f"{PROJECT_HOST}/storage/v1/object/sign/other-bucket/x/abc.jpg"
    ) is None
    assert scores_module._object_key_from("") is None


def test_list_returns_a_display_url(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id, score_id = uuid4(), uuid4()
    row = _row_for(score_id, user_id)
    supabase = _install_supabase(monkeypatch, returning_rows=[row])
    _install_storage(
        supabase,
        signed=[{"path": f"{user_id}/abc.jpg", "signedUrl": "https://cdn.example/abc.jpg?token=t"}],
    )

    res = client.get("/v1/scores", headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"})

    assert res.status_code == 200
    body = res.json()[0]
    assert body["image_url"] == "https://cdn.example/abc.jpg?token=t"
    assert body["image_url_expires_at"] is not None
    # The stored upload URL is still reported, unchanged and still unusable.
    assert body["source_image_url"] == row["source_image_url"]
    supabase.storage.from_.assert_called_with("score-images")


def test_list_signs_the_whole_page_in_one_storage_call(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """Forty scores must not be forty round trips."""
    user_id = uuid4()
    rows = [_row_for(uuid4(), user_id) for _ in range(40)]
    supabase = _install_supabase(monkeypatch, returning_rows=rows)
    _install_storage(supabase, signed=[])

    client.get("/v1/scores", headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"})

    assert supabase.storage.from_.return_value.create_signed_urls.call_count == 1


def test_signing_failure_degrades_to_no_image(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """A library with no thumbnails is a usable screen. A 500 is not."""
    user_id, score_id = uuid4(), uuid4()
    supabase = _install_supabase(monkeypatch, returning_rows=[_row_for(score_id, user_id)])
    _install_storage(supabase, raises=True)

    res = client.get("/v1/scores", headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"})

    assert res.status_code == 200
    assert res.json()[0]["image_url"] is None
    assert res.json()[0]["image_url_expires_at"] is None


def test_get_one_score_signs_too(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id, score_id = uuid4(), uuid4()
    supabase = _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))
    _install_storage(
        supabase,
        # Supabase sometimes echoes the bucket back on `path`; that must not
        # stop the URL matching the key we asked for.
        signed=[{"path": f"score-images/{user_id}/abc.jpg", "signedUrl": "https://cdn.example/one.jpg"}],
    )

    res = client.get(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"},
    )

    assert res.status_code == 200
    assert res.json()["image_url"] == "https://cdn.example/one.jpg"


def test_an_entry_reporting_an_error_is_skipped(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id, score_id = uuid4(), uuid4()
    supabase = _install_supabase(monkeypatch, returning_rows=[_row_for(score_id, user_id)])
    _install_storage(
        supabase,
        signed=[{"path": f"{user_id}/abc.jpg", "error": "Object not found", "signedUrl": None}],
    )

    res = client.get("/v1/scores", headers={"Authorization": f"Bearer {make_token(sub=str(user_id))}"})

    assert res.status_code == 200
    assert res.json()[0]["image_url"] is None


# ---- POST /v1/scores/:id/accept -------------------------------------------
#
# The musician says the reading is right, and the photograph is discarded. The
# delete is irreversible, so most of what follows is about the states where it
# must NOT happen.


def _accept(client: TestClient, score_id: UUID, token: str):
    return client.post(
        f"/v1/scores/{score_id}/accept", headers={"Authorization": f"Bearer {token}"}
    )


def test_accepting_discards_the_photograph(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id, score_id = uuid4(), uuid4()
    row = _row_for(score_id, user_id, transcription_status="done")
    sb = _install_supabase(monkeypatch, returning_row=row)
    _install_storage(sb, signed=[])

    res = _accept(client, score_id, make_token(sub=user_id))
    assert res.status_code == 200, res.text

    # The object actually removed, by key rather than by URL.
    sb.storage.from_.assert_called_with("score-images")
    sb.storage.from_.return_value.remove.assert_called_once_with([f"{user_id}/abc.jpg"])

    patch = sb.table.return_value.update.call_args.args[0]
    assert patch["transcription_accepted_at"]
    assert patch["page_image_discarded_at"]
    # Nulled together with the timestamp, never apart: a row still naming a
    # deleted object would sign download URLs for a file that 404s.
    assert patch["source_image_url"] is None


def test_a_page_still_being_read_cannot_be_accepted(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """There is nothing to accept, and the photograph is about to be needed."""
    user_id, score_id = uuid4(), uuid4()
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id, transcription_status="reading"),
    )
    _install_storage(sb, signed=[])

    res = _accept(client, score_id, make_token(sub=user_id))
    assert res.status_code == 409
    assert "still being read" in res.json()["detail"]
    sb.storage.from_.return_value.remove.assert_not_called()


def test_a_failed_reading_keeps_its_photograph(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The one case where the photograph is the *only* record of the page.

    There is no transcription to replace it with, so discarding it would lose
    the music rather than compress it.
    """
    user_id, score_id = uuid4(), uuid4()
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id, transcription_status="failed"),
    )
    _install_storage(sb, signed=[])

    res = _accept(client, score_id, make_token(sub=user_id))
    assert res.status_code == 409
    assert "only record" in res.json()["detail"]
    sb.storage.from_.return_value.remove.assert_not_called()


def test_a_storage_failure_records_the_acceptance_but_not_the_discard(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Accepted-but-still-there is a real state, and has to be recorded as one.

    The decision is the musician's and stands either way. What must not happen
    is the row claiming a file was discarded that is still in the bucket — the
    object is then still there to remove on a later attempt.
    """
    user_id, score_id = uuid4(), uuid4()
    sb = _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))
    _install_storage(sb, signed=[])
    sb.storage.from_.return_value.remove.side_effect = RuntimeError("storage unreachable")

    res = _accept(client, score_id, make_token(sub=user_id))
    assert res.status_code == 200, res.text

    patch = sb.table.return_value.update.call_args.args[0]
    assert patch["transcription_accepted_at"]
    assert "page_image_discarded_at" not in patch
    assert "source_image_url" not in patch


def test_accepting_twice_is_not_an_error(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A double tap or a retried request, not a mistake to report."""
    user_id, score_id = uuid4(), uuid4()
    row = _row_for(
        score_id,
        user_id,
        source_image_url=None,
        transcription_accepted_at="2026-08-24T00:00:00+00:00",
        page_image_discarded_at="2026-08-24T00:00:00+00:00",
    )
    sb = _install_supabase(monkeypatch, returning_row=row)
    _install_storage(sb, signed=[])

    assert _accept(client, score_id, make_token(sub=user_id)).status_code == 200
    # Nothing left to remove — the key comes from a URL that is already gone.
    sb.storage.from_.return_value.remove.assert_not_called()


def test_accepting_someone_elses_score_is_404(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    sb = _install_supabase(monkeypatch, returning_row=None)
    _install_storage(sb, signed=[])
    res = _accept(client, uuid4(), make_token(sub=uuid4()))
    assert res.status_code == 404
    sb.storage.from_.return_value.remove.assert_not_called()


def test_accepting_unauthenticated_is_401(client: TestClient) -> None:
    assert client.post(f"/v1/scores/{uuid4()}/accept").status_code == 401


def test_a_corrected_score_can_be_saved(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The endpoint the correction screen writes through.

    It has existed since Batch 1 and nothing has ever called it: the spec lists
    "user must be able to correct without re-shooting" as an MVP feature
    (intempo-combined.md:447) and the app shipped without the screen, so every
    misread duration was terminal. This holds the wire it now depends on.
    """
    user_id, score_id = uuid4(), uuid4()
    fixed = {
        **GOOD_PAYLOAD,
        "measures": [
            {
                "measure_number": 2,
                "notes": [
                    {"pitch": "A4", "duration": "eighth"},
                    {"pitch": "G4", "duration": "eighth"},
                ],
                "slurs": [],
            }
        ],
    }
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id, score_json=fixed)
    )
    _install_storage(sb, signed=[])

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={"score_json": fixed},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text
    saved = sb.table.return_value.update.call_args.args[0]["score_json"]
    assert [n["duration"] for n in saved["measures"][0]["notes"]] == ["eighth", "eighth"]


def test_a_correction_that_is_not_a_valid_score_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The schema is the guard. A duration the analysis cannot price would
    reach `alignment.py`'s beat table and silently score as zero beats."""
    user_id, score_id = uuid4(), uuid4()
    _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={
            "score_json": {
                **GOOD_PAYLOAD,
                "measures": [
                    {
                        "measure_number": 1,
                        "notes": [{"pitch": "A4", "duration": "quaver"}],
                        "slurs": [],
                    }
                ],
            }
        },
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 422


# ---- POST /v1/scores/:id/transcribe ----------------------------------------
#
# A failed reading had no way back but the camera. The photograph was still in
# storage and still perfectly good — the failure was a rate limit, a truncated
# response, a model having a bad minute — and the only remedy on offer was
# re-uploading several megabytes to solve a problem the megabytes never caused.


def _retranscribe(client: TestClient, score_id: UUID, token: str):
    return client.post(
        f"/v1/scores/{score_id}/transcribe",
        headers={"Authorization": f"Bearer {token}"},
    )


def test_a_failed_page_can_be_read_again(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id, score_id = uuid4(), uuid4()
    enqueued = _stub_worker(monkeypatch)
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(
            score_id, user_id, transcription_status="failed",
            transcription_error="The notation could not be read.",
        ),
    )
    _install_storage(sb, signed=[])

    res = _retranscribe(client, score_id, make_token(sub=user_id))
    assert res.status_code == 200, res.text

    patch = sb.table.return_value.update.call_args.args[0]
    assert patch["transcription_status"] == "queued"
    # Cleared, not left behind: a stale reason under a page being re-read would
    # be shown as a warning about a reading that no longer exists.
    assert patch["transcription_error"] is None
    assert enqueued == [str(score_id)]


def test_a_successful_reading_can_also_be_re_read(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A musician looking at a transcription they can see is wrong should not
    have to make it fail first to ask for another go."""
    user_id, score_id = uuid4(), uuid4()
    enqueued = _stub_worker(monkeypatch)
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id, transcription_status="done")
    )
    _install_storage(sb, signed=[])

    assert _retranscribe(client, score_id, make_token(sub=user_id)).status_code == 200
    assert enqueued == [str(score_id)]


def test_a_page_already_being_read_is_not_started_twice(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Two workers on one row both write to it and the last one home wins."""
    user_id, score_id = uuid4(), uuid4()
    enqueued = _stub_worker(monkeypatch)
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id, transcription_status="reading"),
    )
    _install_storage(sb, signed=[])

    res = _retranscribe(client, score_id, make_token(sub=user_id))
    assert res.status_code == 409
    assert "already being read" in res.json()["detail"]
    assert enqueued == []


def test_a_discarded_photograph_cannot_be_read_again(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Accepting the reading deletes the page. Saying so beats queueing a
    worker that will fail with "there was no photograph to read"."""
    user_id, score_id = uuid4(), uuid4()
    enqueued = _stub_worker(monkeypatch)
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id, source_image_url=None),
    )
    _install_storage(sb, signed=[])

    res = _retranscribe(client, score_id, make_token(sub=user_id))
    assert res.status_code == 409
    assert "discarded" in res.json()["detail"]
    assert enqueued == []


def test_re_reading_someone_elses_score_is_404(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    enqueued = _stub_worker(monkeypatch)
    sb = _install_supabase(monkeypatch, returning_row=None)
    _install_storage(sb, signed=[])
    assert _retranscribe(client, uuid4(), make_token(sub=uuid4())).status_code == 404
    assert enqueued == []


# ---- POST /v1/scores/import ------------------------------------------------
#
# The third provenance, beside the camera and typing it in. A MusicXML file
# states the durations rather than being read for them, so there is no OCR, no
# model, no cost and no variance — which matters because `alignment.py` builds
# its whole timeline from durations.

_MXL = """<score-partwise><part-list>
<score-part id="P1"><part-name>Violoncello</part-name></score-part>
</part-list><part id="P1"><measure number="1">
<attributes><time><beats>4</beats><beat-type>4</beat-type></time>
<clef><sign>F</sign></clef></attributes>
<note><pitch><step>C</step><octave>3</octave></pitch><type>quarter</type></note>
<note><pitch><step>D</step><octave>3</octave></pitch><type>quarter</type></note>
<note><pitch><step>E</step><octave>3</octave></pitch><type>half</type></note>
</measure></part></score-partwise>"""


def test_a_musicxml_file_becomes_a_piece(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id, score_id = uuid4(), uuid4()
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id, source_image_url=None)
    )
    _install_storage(sb, signed=[])

    res = client.post(
        "/v1/scores/import",
        json={"title": "Suite No. 1", "composer": "J. S. Bach", "musicxml": _MXL},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text

    payload = sb.table.return_value.insert.call_args.args[0]
    assert payload["transcription_status"] == "done", "nothing to wait for"
    assert payload["source_image_url"] is None
    durations = [n["duration"] for n in payload["score_json"]["measures"][0]["notes"]]
    assert durations == ["quarter", "quarter", "half"]


def test_an_imported_score_claims_no_confidence(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Null, not 1.0.

    Every "we don't know" mechanism in this app keys off `ocr_confidence` — the
    caveat lines, the accept-before-discard rule. A file is not *confident*, it
    is *stated*, and writing 1.0 would quietly convert a system that admits
    uncertainty into one claiming certainty it was never asked about.
    """
    user_id = uuid4()
    sb = _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))
    _install_storage(sb, signed=[])

    client.post(
        "/v1/scores/import",
        json={"title": "x", "musicxml": _MXL},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert sb.table.return_value.insert.call_args.args[0]["ocr_confidence"] is None


def test_a_multi_part_file_is_refused_with_the_parts_named(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A downloaded orchestral score's first part is usually the piccolo. The
    error names the options so the client can offer them."""
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))
    two_parts = _MXL.replace(
        "</part-list>",
        '<score-part id="P2"><part-name>Piccolo</part-name></score-part></part-list>',
    ).replace("</score-partwise>", '<part id="P2"><measure number="1"/></part></score-partwise>')

    res = client.post(
        "/v1/scores/import",
        json={"title": "x", "musicxml": two_parts},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 422
    assert "Piccolo" in res.json()["detail"] and "Violoncello" in res.json()["detail"]


def test_a_part_can_be_chosen_on_import(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    sb = _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))
    _install_storage(sb, signed=[])

    res = client.post(
        "/v1/scores/import",
        json={"title": "x", "musicxml": _MXL, "part": "cello"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text


def test_a_file_that_is_not_musicxml_is_refused(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id = uuid4()
    _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))
    res = client.post(
        "/v1/scores/import",
        json={"title": "x", "musicxml": "this is not xml at all"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 422


def test_importing_unauthenticated_is_401(client: TestClient) -> None:
    assert client.post("/v1/scores/import", json={"title": "x", "musicxml": _MXL}).status_code == 401


def test_a_score_carries_the_measures_it_cannot_vouch_for() -> None:
    """The server does the arithmetic once and says what it found.

    The app had its own beat-sum check, which was enough while beat sums were
    the only test. Three more have since been added, and each can fire on a
    measure whose beats add up **exactly** — a slur written as a tie sums to
    4.0 — so whole categories of fault were invisible in the app and offered no
    way to reach the editor. Porting them would have been a fifth copy of a
    validator that has drifted three times in a week.
    """
    from app.routers.scores import _concerns_for

    clean = {
        "time_signature": "4/4", "key_signature": "C major", "clef": "bass",
        "ocr_confidence": 0.9,
        "measures": [{
            "measure_number": 1,
            "notes": [{"pitch": "E2", "duration": "quarter"} for _ in range(4)],
            "slurs": [],
        }],
    }
    assert _concerns_for(clean) == []

    tied_to_a_different_pitch = {
        **clean,
        "measures": [{
            "measure_number": 1,
            "slurs": [],
            "notes": [
                {"pitch": "E2", "duration": "quarter", "tied_to_next": True},
                {"pitch": "G2", "duration": "quarter"},
                {"pitch": "E2", "duration": "quarter"},
                {"pitch": "E2", "duration": "quarter"},
            ],
        }],
    }
    (concern,) = _concerns_for(tied_to_a_different_pitch)
    assert concern.kind == "tie"
    assert concern.measure_number == 1
    assert "tie joins one pitch to itself" in concern.detail


def test_a_short_measure_is_reported_as_a_beat_concern() -> None:
    short = {
        "time_signature": "4/4", "key_signature": "C major", "clef": "bass",
        "ocr_confidence": 0.9,
        "measures": [
            {"measure_number": 1, "slurs": [],
             "notes": [{"pitch": "E2", "duration": "quarter"} for _ in range(4)]},
            {"measure_number": 2, "slurs": [],
             "notes": [{"pitch": "E2", "duration": "quarter"} for _ in range(3)]},
        ],
    }
    from app.routers.scores import _concerns_for
    (concern,) = _concerns_for(short)
    assert (concern.kind, concern.measure_number) == ("beats", 2)


def test_an_unreadable_score_column_has_no_concerns_rather_than_raising() -> None:
    """A listing of the whole library must not fail because one row predates a
    schema change."""
    from app.routers.scores import _concerns_for

    assert _concerns_for(None) == []
    assert _concerns_for({}) == []
    assert _concerns_for({"measures": "not a list"}) == []


# ---- naming the clef when the source has it wrong -------------------------


#: A file that states its clef **readably** — `<sign>F</sign><line>4</line>`.
#:
#: `_MXL` writes `<sign>F</sign>` with no `<line>`, which
#: `_CLEF_BY_SIGN_LINE` cannot place, so the file names no clef this importer
#: can use. Passing `clef` against *that* file exercises the fallback and the
#: override identically, and the first version of the test below could not fail.
_MXL_BASS = _MXL.replace("<clef><sign>F</sign></clef>", "<clef><sign>F</sign><line>4</line></clef>")


def test_a_clef_given_on_import_beats_what_the_file_says(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The person holding the page outranks the file.

    The case, exactly: a double bass **solo** part is written in *treble*, and
    a part exported from an engine or another program can simply carry the
    wrong clef. `clef_fallback` alone only fills a gap; this is for a file that
    states the wrong thing.
    """
    user_id = uuid4()
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(uuid4(), user_id, source_image_url=None)
    )
    _install_storage(sb, signed=[])

    res = client.post(
        "/v1/scores/import",
        json={"title": "Solo", "musicxml": _MXL_BASS, "clef": "treble"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text
    assert sb.table.return_value.insert.call_args.args[0]["score_json"]["clef"] == "treble"


def test_a_file_that_states_its_clef_is_believed_when_nothing_overrides_it(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The other direction. The override is optional, and without it the file
    is authoritative — a bass part stays bass."""
    user_id = uuid4()
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(uuid4(), user_id, source_image_url=None)
    )
    _install_storage(sb, signed=[])

    res = client.post(
        "/v1/scores/import",
        json={"title": "Excerpt", "musicxml": _MXL_BASS},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text
    assert sb.table.return_value.insert.call_args.args[0]["score_json"]["clef"] == "bass"


def test_a_file_that_names_no_clef_is_unlabelled_rather_than_guessed(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """No clef given and none in the file means `null`. It used to mean treble,
    which is a label a musician reads and believes."""
    user_id = uuid4()
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(uuid4(), user_id, source_image_url=None)
    )
    _install_storage(sb, signed=[])
    without_clef = _MXL.replace("<clef>", "<ignored>").replace("</clef>", "</ignored>")

    res = client.post(
        "/v1/scores/import",
        json={"title": "Unlabelled", "musicxml": without_clef},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text
    assert sb.table.return_value.insert.call_args.args[0]["score_json"]["clef"] is None


def test_the_clef_can_be_corrected_without_resending_the_whole_score(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """A double bass **solo** part is written in treble, and a bass or cello
    part goes into tenor for a high passage — so neither the engine nor the
    instrument settles this and the player does.

    One field, not the whole transcription: sending the score back to change a
    word means writing hundreds of notes and losing every concurrent edit in
    between.
    """
    user_id, score_id = uuid4(), uuid4()
    stored = {**GOOD_PAYLOAD, "clef": "bass"}
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id, score_json={**stored, "clef": "treble"}),
    )
    sb.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = SimpleNamespace(  # noqa: E501
        data=[{"score_json": stored}]
    )

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={"clef": "treble"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text

    written = sb.table.return_value.update.call_args.args[0]["score_json"]
    assert written["clef"] == "treble"
    assert written["measures"] == stored["measures"], "the notes were rewritten too"


def test_the_clef_can_be_cleared(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`null` is a real answer, not a missing one: unlabelled beats mislabelled,
    which is the whole reason `ScoreJson.clef` is nullable."""
    user_id, score_id = uuid4(), uuid4()
    stored = {**GOOD_PAYLOAD, "clef": "bass"}
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id, score_json={**stored, "clef": None}),
    )
    sb.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = SimpleNamespace(  # noqa: E501
        data=[{"score_json": stored}]
    )

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={"clef": None},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text
    assert sb.table.return_value.update.call_args.args[0]["score_json"]["clef"] is None


def test_a_whole_score_sent_with_a_clef_keeps_its_own(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Two sources for one field is how they disagree.

    A caller sending a whole `score_json` has already put a clef in it. The
    shortcut is for changing that one field *without* the round trip, so when
    both arrive the score wins and no read-modify-write happens at all.
    """
    user_id, score_id = uuid4(), uuid4()
    sent = {**GOOD_PAYLOAD, "clef": "alto"}
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id, score_json=sent)
    )

    res = client.patch(
        f"/v1/scores/{score_id}",
        json={"score_json": sent, "clef": "treble"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 200, res.text
    assert sb.table.return_value.update.call_args.args[0]["score_json"]["clef"] == "alto"
