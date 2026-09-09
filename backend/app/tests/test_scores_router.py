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

from app import db as db_module
from app.main import app
from app.services.transcription_budget import EXHAUSTED_MESSAGE, MAX_RUNS_PER_PAGE
from app.routers import scores as scores_module
from app.services import display_urls
from app.tests.fake_supabase import FakeSupabase


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
    update_scoped = table.update.return_value.eq.return_value.eq.return_value
    update_scoped.execute.return_value = MagicMock(
        data=[returning_row] if returning_row else []
    )
    # update(...).eq(...).eq(...).in_(...).execute() — the compare-and-set the
    # re-read uses. Matches by default; `_lose_the_race` makes it match nothing.
    update_scoped.in_.return_value.execute.return_value = MagicMock(
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
    # One binding for the whole HTTP layer: `require_service_client` and the
    # display-URL memo both resolve the client on the `db` module.
    monkeypatch.setattr(db_module, "get_service_client", lambda: client)
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
    # The dispatcher, not the runner: where a page is *read* is a deployment
    # fact now — this host or a Modal container — and the router asks for the
    # work rather than naming the machine. `test_dispatch.py` is that choice's
    # subject; this file's is that the right score id is handed over.
    monkeypatch.setattr(
        scores_module,
        "start_transcription",
        lambda score_id: enqueued.append(score_id),
    )
    return enqueued


# ---- POST /v1/scores ------------------------------------------------------


def test_post_unauthenticated_returns_401(client: TestClient) -> None:
    res = client.post("/v1/scores", json={"image_url": "x", "title": "t"})
    assert res.status_code == 401


def test_the_first_reading_is_counted_against_the_ceiling(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """1, not the column's default of 0.

    Leaving the first reading uncounted would make the real ceiling one higher
    than `MAX_RUNS_PER_PAGE` says it is — the kind of off-by-one a limit is
    worst at carrying, because nothing ever contradicts it out loud.
    """
    user_id, score_id = uuid4(), uuid4()
    _stub_worker(monkeypatch)
    sb = _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))

    res = client.post(
        "/v1/scores",
        json={"image_url": _signed_url(user_id), "title": "Etude #1"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text
    assert sb.table.return_value.insert.call_args.args[0]["transcription_runs"] == 1


def test_a_hand_entered_piece_spends_no_reading(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """Nothing is read, so nothing is counted — and the day a photograph is
    attached to it, the full allowance is there."""
    user_id, score_id = uuid4(), uuid4()
    _stub_worker(monkeypatch)
    sb = _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))

    res = client.post(
        "/v1/scores",
        json={"title": "Etude #1", "clef": "treble", "time_signature": "4/4"},
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 201, res.text
    assert sb.table.return_value.insert.call_args.args[0]["transcription_runs"] == 0


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


def _unphotographed(user_id: UUID, **over: Any) -> dict[str, Any]:
    """A score row with no photograph, so nothing here touches storage.

    The listing signs page one of every row it returns; a row with no page
    signs nothing, which keeps these tests about ordering and paging rather
    than about the signer.
    """
    row = _row_for(uuid4(), user_id, source_image_url=None, source_image_urls=None)
    row.update(over)
    return row


def test_the_library_listing_is_newest_first(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """**Ordered since it was written, checked by nothing until now.**

    `_install_supabase` is a `MagicMock` chain: `.order()` and `.range()`
    return the next mock and hand back whatever `returning_rows` was seeded
    with, in that order. So the endpoint's ordering could have been removed
    entirely and every test in this file would still have passed —
    `FakeSupabase` sorts, which is what makes this a test rather than a
    restatement.

    It matters because the app pages: an offset into an unordered list is not
    a page of anything, and `listAllScores` walks the whole library by offset.
    """
    user_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [
            _unphotographed(user_id, title="middle", created_at="2026-05-01T00:00:00+00:00"),
            _unphotographed(user_id, title="newest", created_at="2026-09-01T00:00:00+00:00"),
            _unphotographed(user_id, title="oldest", created_at="2026-01-01T00:00:00+00:00"),
        ],
    )
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)

    res = client.get(
        "/v1/scores", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"}
    )

    assert res.status_code == 200, res.text
    assert [row["title"] for row in res.json()] == ["newest", "middle", "oldest"]


def test_the_library_pages_without_repeating_or_skipping_a_piece(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`range(offset, offset + limit - 1)` is inclusive at both ends.

    Off by one in either direction and the app's walk through the library
    either shows a piece twice or never shows it — and the second reads as a
    piece that has been lost, which is the bug `listAllScores` was written to
    fix in the first place.
    """
    user_id = uuid4()
    fake = FakeSupabase()
    fake.seed(
        "scores",
        [
            _unphotographed(
                user_id, title=f"piece {n:02d}", created_at=f"2026-01-{n:02d}T00:00:00+00:00"
            )
            for n in range(1, 11)
        ],
    )
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)
    headers = {"Authorization": f"Bearer {make_token(sub=user_id)}"}

    def page(offset: int, limit: int) -> list[str]:
        res = client.get(f"/v1/scores?limit={limit}&offset={offset}", headers=headers)
        assert res.status_code == 200, res.text
        return [row["title"] for row in res.json()]

    walked = page(0, 4) + page(4, 4) + page(8, 4)

    assert len(walked) == 10
    assert len(set(walked)) == 10, "a page repeated a piece"
    assert walked == sorted(walked, reverse=True), "the walk lost the ordering"


def test_a_page_past_the_end_of_the_library_is_empty_not_an_error(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`listAllScores` asks once more when the last page came back exactly
    full — that request must answer with nothing, not with a failure."""
    user_id = uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [_unphotographed(user_id) for _ in range(3)])
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)

    res = client.get(
        "/v1/scores?limit=3&offset=3",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    assert res.status_code == 200
    assert res.json() == []


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


def test_delete_cleanup_failure_is_retryable(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id = uuid4()
    score_id = uuid4()
    failure = RuntimeError("connection dropped during dependent cleanup")
    _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id),
        raise_on_delete=failure,
    )
    res = client.delete(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 503
    assert "try again" in res.json()["detail"].lower()



def test_delete_with_history_removes_dependents_then_owned_media(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """A practised piece is one deletion, including every row and byte."""
    user_id, score_id = uuid4(), uuid4()
    page_key = f"{user_id}/page.jpg"
    audio_key = f"{user_id}/take.wav"
    row = _row_for(
        score_id,
        user_id,
        source_image_url=(
            f"{PROJECT_HOST}/storage/v1/object/authenticated/"
            f"{scores_module.SCORE_BUCKET}/{page_key}"
        ),
    )
    analysis_row = {
        "audio_url": (
            f"{PROJECT_HOST}/storage/v1/object/authenticated/"
            f"{scores_module.AUDIO_BUCKET}/{audio_key}"
        )
    }

    sb = MagicMock()
    score_table = MagicMock(name="scores")
    analysis_table = MagicMock(name="analyses")
    assignment_table = MagicMock(name="assignments")
    tables = {
        "scores": score_table,
        "analyses": analysis_table,
        "assignments": assignment_table,
    }
    sb.table.side_effect = lambda name: tables[name]

    score_table.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[row]
    )
    analysis_table.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[analysis_row]
    )

    order: list[str] = []
    assignment_table.delete.return_value.eq.return_value.execute.side_effect = (
        lambda: (order.append("assignments"), MagicMock(data=[]))[1]
    )
    analysis_table.delete.return_value.eq.return_value.eq.return_value.execute.side_effect = (
        lambda: (order.append("analyses"), MagicMock(data=[analysis_row]))[1]
    )
    score_table.delete.return_value.eq.return_value.eq.return_value.execute.side_effect = (
        lambda: (order.append("score"), MagicMock(data=[row]))[1]
    )

    page_bucket = MagicMock(name="score-images")
    audio_bucket = MagicMock(name="audio")
    buckets = {
        scores_module.SCORE_BUCKET: page_bucket,
        scores_module.AUDIO_BUCKET: audio_bucket,
    }
    sb.storage.from_.side_effect = lambda name: buckets[name]
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = client.delete(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    assert res.status_code == 204, res.text
    assert order == ["assignments", "analyses", "score"]
    assignment_table.delete.return_value.eq.assert_called_once_with(
        "score_id", str(score_id)
    )
    analysis_table.delete.return_value.eq.return_value.eq.assert_called_once_with(
        "user_id", str(user_id)
    )
    audio_bucket.remove.assert_called_once_with([audio_key])
    page_bucket.remove.assert_called_once_with([page_key])


def test_delete_never_uses_a_foreign_audio_reference_as_storage_authority(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id, score_id = uuid4(), uuid4()
    other_user = uuid4()
    row = _row_for(score_id, user_id, source_image_url=None)

    sb = MagicMock()
    score_table = MagicMock(name="scores")
    analysis_table = MagicMock(name="analyses")
    assignment_table = MagicMock(name="assignments")
    sb.table.side_effect = lambda name: {
        "scores": score_table,
        "analyses": analysis_table,
        "assignments": assignment_table,
    }[name]
    score_table.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[row]
    )
    analysis_table.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"audio_url": f"{scores_module.AUDIO_BUCKET}/{other_user}/take.wav"}]
    )
    assignment_table.delete.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[]
    )
    analysis_table.delete.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[]
    )
    score_table.delete.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[row]
    )
    audio_bucket = MagicMock()
    sb.storage.from_.return_value = audio_bucket
    monkeypatch.setattr(db_module, "get_service_client", lambda: sb)

    res = client.delete(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    assert res.status_code == 204, res.text
    audio_bucket.remove.assert_not_called()


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


def test_a_discarded_photograph_is_not_signed(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """**The large empty box on an accepted piece.**

    Signing does not check that the object exists. A row whose page was deleted
    by `POST /:id/accept` kept its `source_image_url`, so it went on being handed
    a perfectly well-formed URL that 404s — and the app cannot tell that from a
    slow download. What a musician saw on a piece they had accepted was a large
    empty box where the photograph used to be and an "Original" tab that showed
    nothing.
    """
    user_id, score_id = uuid4(), uuid4()
    row = _row_for(
        score_id,
        user_id,
        transcription_accepted_at="2026-08-24T00:00:00+00:00",
        page_image_discarded_at="2026-08-24T00:00:00+00:00",
    )
    sb = _install_supabase(monkeypatch, returning_row=row)
    _install_storage(sb, signed=[])

    res = client.get(f"/v1/scores/{score_id}", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"})

    assert res.status_code == 200, res.text
    assert res.json()["image_url"] is None
    # Not merely null in the response — never asked for. Signing a key whose
    # object is gone is a round trip to be told nothing.
    sb.storage.from_.return_value.create_signed_urls.assert_not_called()


def test_a_photograph_that_is_still_there_is_signed(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The other half, so the guard above cannot pass by signing nothing ever."""
    user_id, score_id = uuid4(), uuid4()
    row = _row_for(score_id, user_id)
    sb = _install_supabase(monkeypatch, returning_row=row)
    _install_storage(sb, signed=[])

    res = client.get(f"/v1/scores/{score_id}", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"})

    assert res.status_code == 200, res.text
    sb.storage.from_.return_value.create_signed_urls.assert_called_once()


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


def test_a_page_read_to_its_ceiling_is_not_read_again(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """**The only refusal here that is about the bill rather than the row.**

    A reading is a vision-model call per page. Every other check on this
    endpoint is about state — already reading, photograph discarded — and none
    of them stops the same tap arriving a thousand times. The free tier does
    not reach this path either: it counts rows in `analyses`, and a re-read
    creates none.
    """
    user_id, score_id = uuid4(), uuid4()
    enqueued = _stub_worker(monkeypatch)
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(
            score_id,
            user_id,
            transcription_status="failed",
            transcription_runs=MAX_RUNS_PER_PAGE,
        ),
    )
    _install_storage(sb, signed=[])

    res = _retranscribe(client, score_id, make_token(sub=user_id))

    assert res.status_code == 409
    assert res.json()["detail"] == EXHAUSTED_MESSAGE
    # The refusal has to happen before the worker, or the ceiling costs a model
    # call to enforce and is not a ceiling.
    assert enqueued == []


def test_the_reading_that_starts_is_counted(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Written in the same patch as the status, so the count advances exactly
    when a worker is dispatched — never on a request that lost the race."""
    user_id, score_id = uuid4(), uuid4()
    _stub_worker(monkeypatch)
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(
            score_id, user_id, transcription_status="failed", transcription_runs=4
        ),
    )
    _install_storage(sb, signed=[])

    assert _retranscribe(client, score_id, make_token(sub=user_id)).status_code == 200

    patch = sb.table.return_value.update.call_args.args[0]
    assert patch["transcription_runs"] == 5


def test_the_last_allowed_reading_is_allowed(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The boundary in the direction that takes something away from a musician
    rather than the one that costs a model call."""
    user_id, score_id = uuid4(), uuid4()
    enqueued = _stub_worker(monkeypatch)
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(
            score_id,
            user_id,
            transcription_status="failed",
            transcription_runs=MAX_RUNS_PER_PAGE - 1,
        ),
    )
    _install_storage(sb, signed=[])

    assert _retranscribe(client, score_id, make_token(sub=user_id)).status_code == 200
    assert enqueued == [str(score_id)]
    assert (
        sb.table.return_value.update.call_args.args[0]["transcription_runs"]
        == MAX_RUNS_PER_PAGE
    )


def _lose_the_race(sb: MagicMock) -> None:
    """Make the conditional update match no rows — another request got there
    first and the row is no longer `done` or `failed`."""
    (
        sb.table.return_value.update.return_value.eq.return_value.eq.return_value.in_.return_value.execute.return_value
    ) = MagicMock(data=[])


def test_the_guard_is_on_the_write_not_only_the_read_before_it(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """It was a SELECT and then an unconditional UPDATE.

    That holds only if no second request arrives inside the round trip, and one
    does: the retry sits on `EmptyState`'s button, which has no `disabled` prop
    and stays pressable while the first request is in flight. Two taps both
    read `failed`, both passed the check above, both wrote `queued`, and both
    spawned a worker — one page read twice, in parallel, on two containers and
    two model bills, the two runs interleaving writes to the same row.
    """
    user_id, score_id = uuid4(), uuid4()
    _stub_worker(monkeypatch)
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id, transcription_status="failed"),
    )
    _install_storage(sb, signed=[])

    assert _retranscribe(client, score_id, make_token(sub=user_id)).status_code == 200

    scoped = sb.table.return_value.update.return_value.eq.return_value.eq.return_value
    assert scoped.in_.called, (
        "the update is unconditional, so the check above only narrows the "
        "window it loses in"
    )
    column, allowed = scoped.in_.call_args.args
    assert column == "transcription_status"
    # The complement of {queued, reading}, stated rather than negated: the
    # column is NOT NULL with a CHECK over exactly these four values
    # (migration 006), so there is no other state to fall through the filter.
    assert set(allowed) == {"done", "failed"}


def test_a_tap_that_loses_the_race_is_refused_rather_than_started(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The second of two taps, arriving after the first has queued the row.

    The worse ending is not the duplicated bill. Run A finishes `done` with
    good notes; run B hits a rate limit a minute later and `_fail` stamps the
    row `failed` — burying a reading that had worked, under a message telling
    the musician their page could not be read.
    """
    user_id, score_id = uuid4(), uuid4()
    enqueued = _stub_worker(monkeypatch)
    sb = _install_supabase(
        monkeypatch,
        returning_row=_row_for(score_id, user_id, transcription_status="failed"),
    )
    _install_storage(sb, signed=[])
    _lose_the_race(sb)

    res = _retranscribe(client, score_id, make_token(sub=user_id))
    assert res.status_code == 409
    # The same sentence the pre-check gives, because it is the same fact.
    assert "already being read" in res.json()["detail"]
    assert enqueued == [], "a second worker was started on a row already queued"


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


def test_notes_the_reading_could_not_write_reach_the_app_as_a_concern() -> None:
    """**The one fault that leaves the arithmetic clean by construction.**

    An unwritable tuplet keeps its length as rests, so the bar sums exactly and
    every other check here is silent. Without this the app has nothing to show
    and no way into `MeasureEditScreen` on the one bar that is missing notes.
    """
    lost = {
        "time_signature": "4/4", "key_signature": "C major", "clef": "bass",
        "ocr_confidence": 0.4,
        "measures": [
            {"measure_number": 1, "slurs": [],
             "notes": [{"pitch": "E2", "duration": "quarter"} for _ in range(4)]},
            {"measure_number": 2, "slurs": [], "unwritable_notes": 5,
             "notes": [{"pitch": "E2", "duration": "quarter"} for _ in range(4)]},
        ],
    }
    from app.routers.scores import _concerns_for

    (concern,) = _concerns_for(lost)
    assert (concern.kind, concern.measure_number) == ("unwritable", 2)
    assert "could not write" in concern.detail


def test_a_bar_that_lost_notes_and_runs_short_is_named_for_the_notes() -> None:
    """The missing notes are why it is short, so leading with `beats` would
    send a musician to count a bar whose count is not the problem."""
    both = {
        "time_signature": "4/4", "key_signature": "C major", "clef": "bass",
        "ocr_confidence": 0.4,
        "measures": [
            {"measure_number": 1, "slurs": [],
             "notes": [{"pitch": "E2", "duration": "quarter"} for _ in range(4)]},
            {"measure_number": 2, "slurs": [], "unwritable_notes": 1,
             "notes": [{"pitch": "E2", "duration": "quarter"} for _ in range(3)]},
        ],
    }
    from app.routers.scores import _concerns_for

    (concern,) = _concerns_for(both)
    assert concern.kind == "unwritable"
    assert "could not write" in concern.detail and "short" in concern.detail


def test_every_fault_a_measure_can_carry_has_its_own_concern_kind() -> None:
    """**A fault with no branch becomes `"beats"`, and `"beats"` is a promise.**

    The app prints `detail` verbatim for every kind except `"beats"`, which it
    is allowed to reword as "doesn't add up to the time signature". So a fault
    that falls past the ladder in `_concern_kind` does not go unreported — it
    gets reported as arithmetic.

    That happened. `out_of_line` is set **only where no metre could be read**,
    and it was sent as `"beats"`: a bar flagged for being out of step with the
    rest of the page, described to the musician as disagreeing with a time
    signature the server had just said it could not read.

    The field list is read off the dataclass rather than typed out, so a *new*
    flag fails here instead of silently joining `"beats"` — the same shape as
    `test_the_cases_exercise_every_flag_there_is` in `test_sandbox_parity.py`,
    and for the same reason: the last count written down by hand went stale.
    """
    from app.routers.scores import _concern_kind
    from app.services.ocr.validate import MeasureFinding
    from app.services.score_schema import BrokenTie, TupletFault

    #: What each fault field looks like when it is the only thing wrong.
    faults: dict[str, object] = {
        "broken_ties": (BrokenTie(1, 0, "C4", "E4"),),
        "tuplet_faults": (TupletFault(1, 0, 5, 4, "count", "holds 3 notes"),),
        "too_dense": True,
        "unwritable_notes": 1,
        "out_of_line": True,
    }
    #: Fields that describe the measure rather than accuse it.
    not_a_fault = {
        "measure_number",
        "verdict",
        "expected_beats",
        "actual_beats",
        "note_count",
        "meter_inferred",
    }

    fields = set(MeasureFinding.__dataclass_fields__)
    unclassified = fields - set(faults) - not_a_fault
    assert not unclassified, (
        f"MeasureFinding grew {sorted(unclassified)}. If it is a fault, give it "
        "a branch in `_concern_kind` and an entry above; if it is not, name it "
        "in `not_a_fault`."
    )

    kinds: dict[str, str] = {}
    for flag, value in faults.items():
        finding = MeasureFinding(
            measure_number=1,
            verdict="ok",
            expected_beats=4.0,
            actual_beats=4.0,
            note_count=4,
            **{flag: value},  # type: ignore[arg-type]
        )
        # Every one of these fires on a bar whose beats add up exactly, which
        # is the whole reason they are separate fields from `verdict`.
        assert finding.is_problem, flag
        kinds[flag] = _concern_kind(finding)

    beats = sorted(flag for flag, kind in kinds.items() if kind == "beats")
    assert not beats, (
        f"{beats} reach the app as \"beats\", which it may reword as "
        "\"doesn't add up to the time signature\" — a true sentence under a "
        "false heading"
    )
    assert len(set(kinds.values())) == len(kinds), (
        f"two faults share a name: {kinds}"
    )


def test_a_bar_out_of_step_on_a_page_with_no_metre_is_not_called_arithmetic() -> None:
    """The defect above, end to end through `_concerns_for`.

    No `time_signature` anywhere, so no metre can be read and `short`/`long`
    cannot be said; one bar far longer than its neighbours. The sentence the
    musician gets must be the server's own — which says the metre could not be
    read — and never the arithmetic wording.
    """
    from app.routers.scores import _concerns_for

    # **Every bar a different length, so nothing wins the metre vote.** Two
    # earlier fixtures here tested the wrong branch and one of them passed
    # anyway, because the `-k` filter I ran the mutation under did not select
    # this test by name:
    #
    #  - forty quarter notes in the odd bar tripped `too_dense` first, which is
    #    a different fault and is correctly called `"density"`;
    #  - four whole notes among quarters let `infer_beats_per_measure` succeed,
    #    which makes the bar plainly `long` — and `"beats"` is then the right
    #    word, not the bug.
    #
    # `out_of_line` is reachable only where no metre could be read at all, so
    # the page has to disagree with itself.
    def bar(number: int, notes: int) -> dict[str, object]:
        return {
            "measure_number": number,
            "slurs": [],
            "notes": [{"pitch": "E2", "duration": "quarter"} for _ in range(notes)],
        }

    no_metre = {
        "time_signature": None,
        "key_signature": None,
        "clef": "bass",
        "ocr_confidence": 0.9,
        "measures": [bar(n, n) for n in range(1, 7)] + [bar(7, 24)],
    }

    concerns = {c.measure_number: c for c in _concerns_for(no_metre)}
    assert 7 in concerns, "a bar six times the median length was not flagged at all"
    assert concerns[7].kind == "adrift"
    assert "metre could not be read" in concerns[7].detail
    # Not one of the wordings that would be false here. `"beats"` is the one
    # the app may reword as "doesn't add up to the time signature", on a page
    # whose time signature the server has just said it could not read.
    assert {c.kind for c in concerns.values()} == {"adrift"}


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


# ---- deleting a score used to leak its photograph forever -------------------
#
# The single storage deletion in this file is reached from `POST /:id/accept`,
# keyed off an existing row. So once the row was gone the object had no row, no
# accept path and no delete path — permanent and unreachable, in a bucket
# nobody was ever going to look in. That contradicts the rule this file states
# plainly: the photograph is discarded when a person is done with it, and
# deleting the piece is a person being done with it.


def _deleted_keys(sb: MagicMock) -> list[str]:
    """Every object key handed to storage.remove()."""
    return [
        call.args[0][0]
        for call in sb.storage.from_.return_value.remove.call_args_list
        if call.args and call.args[0]
    ]


def test_deleting_a_score_takes_its_photograph_with_it(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    user_id, score_id = uuid4(), uuid4()
    sb = _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))
    _install_storage(sb, signed=[])

    res = client.delete(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )
    assert res.status_code == 204, res.text

    removed = _deleted_keys(sb)
    assert removed, "the row went and the page image stayed in the bucket"
    assert removed[0].endswith(".jpg")


def test_the_key_is_read_before_the_row_is_deleted(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The row is the only thing that knows where the photograph is.

    Reading it afterwards finds nothing, and the object is then unreachable —
    which is the bug, arrived at by a different route.
    """
    user_id, score_id = uuid4(), uuid4()
    sb = _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))
    _install_storage(sb, signed=[])

    client.delete(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    # A select on `scores` happened, and it asked for the column that carries
    # the key. Without it there is nothing to delete from storage.
    selected = [c.args[0] for c in sb.table.return_value.select.call_args_list if c.args]
    assert any("source_image_url" in s or s == "*" for s in selected), (
        f"the page image's key was never read; selects were {selected}"
    )


def test_a_score_that_does_not_exist_deletes_nothing_from_storage(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """404 before anything is removed. Someone else's score id must not be a
    way to delete their photograph."""
    sb = _install_supabase(monkeypatch, returning_row=None)
    _install_storage(sb, signed=[])

    res = client.delete(
        f"/v1/scores/{uuid4()}",
        headers={"Authorization": f"Bearer {make_token(sub=uuid4())}"},
    )

    assert res.status_code == 404
    assert _deleted_keys(sb) == []


def test_storage_being_down_does_not_block_deleting_a_piece(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The row is what the app reads. A musician deleting a piece they no
    longer want must not be told no because a bucket is unreachable — the
    object is logged and left, which is no worse than the behaviour this
    replaces."""
    user_id, score_id = uuid4(), uuid4()
    sb = _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))
    _install_storage(sb, signed=[])
    sb.storage.from_.return_value.remove.side_effect = RuntimeError("storage unreachable")

    res = client.delete(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    assert res.status_code == 204


def test_a_hand_entered_piece_has_no_photograph_to_delete(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`source_image_url` is null for a piece typed in, and for one whose page
    was already discarded on acceptance. Neither is a key."""
    user_id, score_id = uuid4(), uuid4()
    sb = _install_supabase(
        monkeypatch, returning_row=_row_for(score_id, user_id, source_image_url=None)
    )
    _install_storage(sb, signed=[])

    res = client.delete(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    assert res.status_code == 204
    assert _deleted_keys(sb) == []


def test_nothing_is_removed_until_the_row_is_actually_gone(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """Removal strictly after the delete succeeded, not merely after it ran.

    The case that separates the two: the select finds a row and the delete
    matches none — a race with another request, or a filter that did not line
    up. Removing on the strength of the *read* would take the photograph away
    from a score that is still there, and then answer 404 as if nothing had
    happened. The row is what the app reads, so the object must never outlive
    it in the other direction either.

    The earlier 404 test cannot catch this: its select returns nothing, so
    there is no key to remove and the ordering is untested by it. A mutation
    moving the removal above the 404 check survived that test.
    """
    user_id, score_id = uuid4(), uuid4()
    sb = _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))
    _install_storage(sb, signed=[])
    # The select still finds the row; the delete matches nothing.
    sb.table.return_value.delete.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[]
    )

    res = client.delete(
        f"/v1/scores/{score_id}",
        headers={"Authorization": f"Bearer {make_token(sub=user_id)}"},
    )

    assert res.status_code == 404
    assert _deleted_keys(sb) == [], (
        "the photograph was removed for a score that was not deleted"
    )


# ---- Signed URLs are reused, not re-minted --------------------------------
#
# A fresh signature is a fresh `?token=`, and a fresh URL is a cache miss in
# every image cache there is — expo-image's, keyed on the URL, and the
# browser's alike. The screen that shows the photograph while a scan is being
# read polls every three seconds, so before the memo, watching one
# sixty-second read re-downloaded the photograph twenty times.


@pytest.fixture(autouse=True)
def _fresh_url_cache():
    display_urls.reset_cache()
    yield
    display_urls.reset_cache()


def _signed_for(user_id, name: str = "abc.jpg"):
    return [
        {
            "path": f"{user_id}/{name}",
            "signedUrl": f"https://cdn.example/{name}?token={uuid4().hex}",
        }
    ]


def test_the_same_image_is_signed_once_and_the_url_is_stable(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    user_id, score_id = uuid4(), uuid4()
    supabase = _install_supabase(monkeypatch, returning_rows=[_row_for(score_id, user_id)])
    _install_storage(supabase, signed=_signed_for(user_id))
    headers = {"Authorization": f"Bearer {make_token(sub=str(user_id))}"}

    first = client.get("/v1/scores", headers=headers).json()[0]
    second = client.get("/v1/scores", headers=headers).json()[0]

    assert first["image_url"] == second["image_url"]
    assert supabase.storage.from_.return_value.create_signed_urls.call_count == 1


def test_the_reported_expiry_is_the_reused_urls_not_a_fresh_promise(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """`image_url_expires_at` exists so a client can re-fetch rather than
    guess. Reporting `now + TTL` beside a reused URL would promise an hour the
    token does not have."""
    user_id, score_id = uuid4(), uuid4()
    supabase = _install_supabase(monkeypatch, returning_rows=[_row_for(score_id, user_id)])
    _install_storage(supabase, signed=_signed_for(user_id))
    headers = {"Authorization": f"Bearer {make_token(sub=str(user_id))}"}

    first = client.get("/v1/scores", headers=headers).json()[0]
    second = client.get("/v1/scores", headers=headers).json()[0]

    assert second["image_url_expires_at"] == first["image_url_expires_at"]


def test_a_url_near_the_end_of_its_life_is_signed_afresh(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """Reuse must stop while the URL still comfortably works: a list fetched
    and then stared at is still holding URLs that have to survive the stare."""
    from datetime import datetime, timedelta, timezone

    user_id, score_id = uuid4(), uuid4()
    supabase = _install_supabase(monkeypatch, returning_rows=[_row_for(score_id, user_id)])
    _install_storage(supabase, signed=_signed_for(user_id))
    headers = {"Authorization": f"Bearer {make_token(sub=str(user_id))}"}

    client.get("/v1/scores", headers=headers)
    # Age the memo entry to just inside the floor.
    with display_urls._lock:
        for key, (url, _) in list(display_urls._urls.items()):
            display_urls._urls[key] = (
                url,
                datetime.now(tz=timezone.utc) + timedelta(seconds=60),
            )

    client.get("/v1/scores", headers=headers)

    assert supabase.storage.from_.return_value.create_signed_urls.call_count == 2


def test_only_the_missing_keys_are_signed(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """The memo is per object, not per batch — a new piece added to a library
    of forty signs one key, not forty-one."""
    user_id = uuid4()
    first_score = _row_for(uuid4(), user_id)
    # Its own object, or there is nothing missing to sign: `_row_for` derives
    # the image key from the user alone, and two rows sharing one photograph
    # would make the second fetch a pure memo hit.
    second_score = _row_for(
        uuid4(),
        user_id,
        source_image_url=_signed_url(user_id).replace("abc.jpg", "second.jpg"),
    )
    supabase = _install_supabase(monkeypatch, returning_rows=[first_score])
    bucket = supabase.storage.from_.return_value
    bucket.create_signed_urls.return_value = _signed_for(user_id)
    headers = {"Authorization": f"Bearer {make_token(sub=str(user_id))}"}

    client.get("/v1/scores", headers=headers)

    supabase = _install_supabase(
        monkeypatch, returning_rows=[first_score, second_score]
    )
    bucket = supabase.storage.from_.return_value
    bucket.create_signed_urls.return_value = []
    client.get("/v1/scores", headers=headers)

    assert bucket.create_signed_urls.call_count == 1
    (signed_keys, _ttl) = bucket.create_signed_urls.call_args[0]
    assert signed_keys == [f"{user_id}/second.jpg"]


def test_a_request_mixing_a_memo_hit_and_a_miss_keeps_the_cached_url(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    make_token: Callable[..., str],
) -> None:
    """The path the other tests miss: `missing` non-empty AND `cached`
    non-empty in the same request. Returning only the fresh half would strip
    the thumbnail from every *old* piece the moment a new one is added."""
    user_id = uuid4()
    first_score = _row_for(uuid4(), user_id)
    second_score = _row_for(
        uuid4(),
        user_id,
        source_image_url=_signed_url(user_id).replace("abc.jpg", "second.jpg"),
    )
    supabase = _install_supabase(monkeypatch, returning_rows=[first_score])
    supabase.storage.from_.return_value.create_signed_urls.return_value = _signed_for(user_id)
    headers = {"Authorization": f"Bearer {make_token(sub=str(user_id))}"}

    cached_url = client.get("/v1/scores", headers=headers).json()[0]["image_url"]

    supabase = _install_supabase(monkeypatch, returning_rows=[first_score, second_score])
    supabase.storage.from_.return_value.create_signed_urls.return_value = _signed_for(
        user_id, "second.jpg"
    )
    body = client.get("/v1/scores", headers=headers).json()

    by_id = {row["id"]: row["image_url"] for row in body}
    assert by_id[first_score["id"]] == cached_url
    assert by_id[second_score["id"]].startswith("https://cdn.example/second.jpg")


def test_the_light_listing_loses_the_notation_and_nothing_else(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """`include_score=false` narrows the SQL projection, and a column left out
    of `_WITHOUT_SCORE` would come back as a field that quietly lost its value.

    That is the failure mode worth a test rather than the saving: a listing that
    is smaller *and* has forgotten every piece's composer is worse than the one
    it replaced, and nothing about the response shape would say so — `composer`
    is nullable, `movement` is nullable, `transcription_status` defaults to
    "done". Every one of them would 200.

    So this is a comparison rather than a list of column names. Every column
    carries a value it does not share with another, both listings are fetched,
    and the two responses must differ in exactly `score_json` and `concerns` —
    the notation, and the concerns computed from it.

    **Two rows, because one cannot exercise every column.** A row with a
    photograph is the only one that populates `page_count`, `image_url` and
    `image_urls`, all three built from `source_image_urls`; a row whose pages
    were discarded is the only one that populates
    `page_image_discarded_at` — and `_with_image_urls` skips signing exactly
    those, so no single row is both. With only the second, dropping
    `source_image_urls` from the projection emptied every thumbnail in the
    library and this test passed. It did, on its first run.
    """
    from datetime import datetime, timezone

    user_id = uuid4()

    # A bar that runs short of its metre, so `concerns` is non-empty and the
    # comparison below is between two populated lists rather than two empty
    # ones. `GOOD_PAYLOAD` is a clean reading and raises nothing.
    short_bar = {
        "time_signature": "4/4",
        "key_signature": "D major",
        "clef": "treble",
        "tempo_marking": None,
        "bpm_hint": None,
        "ocr_confidence": 0.9,
        "measures": [
            {
                "measure_number": number,
                "notes": [
                    {"pitch": "D3", "duration": "quarter"}
                    for _ in range(3 if number == 2 else 4)
                ],
                "slurs": [],
                "ties": [],
            }
            for number in (1, 2, 3)
        ],
    }

    photographed = _row_for(
        uuid4(),
        user_id,
        score_json=short_bar,
        composer="Wohlfahrt",
        movement="II. Adagio",
        source_image_url=_signed_url(user_id),
        source_image_urls=[_signed_url(user_id, ext=f"p{n}.jpg") for n in (1, 2, 3)],
        ocr_confidence=0.77,
        transcription_status="reading",
        transcription_stage="Reading the page",
        created_at="2026-05-02T00:00:00+00:00",
        updated_at="2026-05-03T00:00:00+00:00",
    )
    discarded = _row_for(
        uuid4(),
        user_id,
        score_json=short_bar,
        composer="Kreutzer",
        movement="No. 2",
        source_image_url=_signed_url(user_id),
        source_image_urls=[_signed_url(user_id, ext="only.jpg")],
        ocr_confidence=0.55,
        transcription_status="failed",
        transcription_error="the reader gave up",
        transcription_accepted_at="2026-05-05T00:00:00+00:00",
        page_image_discarded_at="2026-05-06T00:00:00+00:00",
        created_at="2026-05-01T00:00:00+00:00",
        updated_at="2026-05-04T00:00:00+00:00",
    )

    fake = FakeSupabase()
    fake.seed("scores", [photographed, discarded])
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)
    # Signing stands in for storage: the same key always signs to the same URL,
    # so the two listings are comparable and any difference is the projection's.
    monkeypatch.setattr(
        display_urls,
        "signed_display_urls",
        lambda keys: {
            key: (f"https://signed.test/{key}", datetime(2026, 6, 1, tzinfo=timezone.utc))
            for key in keys
        },
    )
    headers = {"Authorization": f"Bearer {make_token(sub=user_id)}"}

    full = client.get("/v1/scores", headers=headers)
    light = client.get("/v1/scores?include_score=false", headers=headers)
    assert full.status_code == 200, full.text
    assert light.status_code == 200, light.text
    assert len(full.json()) == len(light.json()) == 2

    # The rows have to actually exercise the fields, or this compares two sets
    # of defaults and passes on a projection of one column.
    heavy_pages, heavy_gone = full.json()
    assert heavy_pages["score_json"], "the seeded row has no notation to drop"
    assert heavy_pages["concerns"], "the seeded row raises no concerns to drop"
    assert heavy_pages["page_count"] == 3, "the photographed row has no pages to lose"
    assert heavy_pages["image_url"], "the photographed row has no thumbnail to lose"
    assert len(heavy_pages["image_urls"]) == 1, "the listing signs page one"
    assert heavy_gone["page_image_discarded_at"], "no discarded row to check"

    for heavy, thin in zip(full.json(), light.json(), strict=True):
        assert thin["score_json"] is None
        assert thin["concerns"] == []
        differing = {key for key in heavy if heavy[key] != thin[key]}
        assert differing == {"score_json", "concerns"}, (
            f"the light listing changed {differing - {'score_json', 'concerns'}}, "
            "which it has no business changing — a column is missing from "
            "_WITHOUT_SCORE"
        )


def test_the_library_listing_still_carries_the_notation_by_default(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, make_token: Callable[..., str]
) -> None:
    """The default is unchanged, so a client that never heard of the parameter
    keeps the response it has always had. Every installed build is one."""
    user_id = uuid4()
    fake = FakeSupabase()
    fake.seed("scores", [_unphotographed(user_id)])
    monkeypatch.setattr(db_module, "get_service_client", lambda: fake)

    res = client.get(
        "/v1/scores", headers={"Authorization": f"Bearer {make_token(sub=user_id)}"}
    )

    assert res.status_code == 200, res.text
    assert res.json()[0]["score_json"] == GOOD_PAYLOAD
