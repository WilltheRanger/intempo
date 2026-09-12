"""`POST /v1/scores` with several pages, and discarding all of them.

The two properties worth the most here are the ones that lose a musician's
work if they are wrong: **every** page is checked for ownership before the row
is written, and **every** page is removed when a scan is accepted or deleted.
The second is the orphaned-upload hole this repository already documents once,
and a multi-page scan is the same hole multiplied by the length of the part.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.routers.scores import MAX_PAGES, CreateScoreRequest, _page_keys


#: The shape `object_key_from` recognises — one of `STORAGE_PREFIXES`, then the
#: bucket, then `<user_id>/<uuid>.<ext>`. Written out rather than built from
#: the constants so that a change to either is a visible test failure here.
def _urls(n: int) -> list[str]:
    return [
        "https://x.supabase.co/storage/v1/object/upload/sign/"
        f"score-images/u/p{i}.jpg"
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# What the request means
# ---------------------------------------------------------------------------


def test_a_scan_of_three_pages_is_three_pages() -> None:
    body = CreateScoreRequest(title="Part", image_urls=_urls(3))

    assert body.pages() == _urls(3)


def test_the_single_page_form_still_works() -> None:
    """The app that is already installed sends `image_url`. A build of the
    server that stopped accepting it would break every phone that has not
    updated."""
    body = CreateScoreRequest(title="Part", image_url=_urls(1)[0])

    assert body.pages() == _urls(1)


def test_sending_both_forms_is_refused_rather_than_merged() -> None:
    """The same stance this model already takes on `clef` alongside
    `image_url`. Picking one silently means the dropped pages are discovered
    later, by a musician, on a piece missing half its music."""
    with pytest.raises(ValidationError, match="cannot both be given"):
        CreateScoreRequest(title="Part", image_url=_urls(1)[0], image_urls=_urls(2))


def test_an_empty_list_is_not_a_hand_entered_piece() -> None:
    """`image_urls: []` is a client bug — a scan with no pages. Treating it as
    hand entry would write a piece with no notes and no photograph and call it
    finished."""
    with pytest.raises(ValidationError, match="cannot be empty"):
        CreateScoreRequest(title="Part", image_urls=[])


def test_a_part_longer_than_the_ceiling_is_refused_at_the_request() -> None:
    with pytest.raises(ValidationError, match=f"at most {MAX_PAGES}"):
        CreateScoreRequest(title="Part", image_urls=_urls(MAX_PAGES + 1))


def test_a_hand_entered_piece_still_needs_a_clef() -> None:
    """Unchanged, and worth pinning while `pages()` is what decides that a
    piece is hand-entered: the check used to key on `image_url is None`."""
    with pytest.raises(ValidationError, match="needs a clef"):
        CreateScoreRequest(title="Part")

    assert CreateScoreRequest(title="Part", clef="bass").pages() == []


# ---------------------------------------------------------------------------
# What gets discarded
# ---------------------------------------------------------------------------


def test_every_page_of_a_scan_is_a_key_to_remove() -> None:
    """Accepting a three-page scan used to discard page one and leave pages
    two and three in the bucket with no row naming them, no accept path and no
    delete path — unreachable forever."""
    keys = _page_keys({"source_image_url": _urls(3)[0], "source_image_urls": _urls(3)})

    assert len(keys) == 3


def test_a_row_from_before_the_migration_still_gives_up_its_one_page() -> None:
    keys = _page_keys({"source_image_url": _urls(1)[0]})

    assert len(keys) == 1


def test_a_piece_entered_by_hand_has_nothing_to_remove() -> None:
    assert _page_keys({"source_image_url": None, "source_image_urls": None}) == []


def test_a_url_this_deployment_cannot_place_is_skipped_not_guessed() -> None:
    """`_object_key_from` returns None for a URL it does not recognise, and
    deleting a guessed key is worse than leaking one — it deletes somebody
    else's object."""
    keys = _page_keys(
        {"source_image_urls": [_urls(1)[0], "https://elsewhere.example/thing.jpg"]}
    )

    assert len(keys) == 1


# ---------------------------------------------------------------------------
# The handlers themselves, not the functions they call
# ---------------------------------------------------------------------------
#
# The tests above cover `CreateScoreRequest` and `_page_keys` in isolation, and
# five mutations of the *handlers* survived them: ownership checked on page one
# only, the pages never written, accept and delete discarding page one only,
# and accept nulling the row after a partial discard. Every one of those loses
# a musician's pages while every isolated test passes. Same lesson as
# `_read_one_page` — a rule is only tested where it actually runs.

from unittest.mock import MagicMock  # noqa: E402

import pytest  # noqa: E402,F811
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.tests.test_scores_router import (  # noqa: E402
    PROJECT_HOST,
    _install_supabase,
    _row_for,
    _signed_url,
    _stub_worker,
)


@pytest.fixture()
def api() -> TestClient:
    return TestClient(app)


def _pages_for(user_id, n: int) -> list[str]:
    return [_signed_url(user_id).replace("abc.", f"p{i}.") for i in range(n)]


def _auth(make_token, user_id):
    return {"Authorization": f"Bearer {make_token(sub=str(user_id))}"}


def test_posting_three_pages_writes_all_three_to_the_row(
    api: TestClient, monkeypatch, make_token
) -> None:
    from uuid import uuid4

    user_id, score_id = uuid4(), uuid4()
    pages = _pages_for(user_id, 3)
    client = _install_supabase(monkeypatch, returning_row=_row_for(score_id, user_id))
    _stub_worker(monkeypatch)

    response = api.post(
        "/v1/scores",
        json={"title": "Part", "image_urls": pages},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 201, response.text
    written = client.table.return_value.insert.call_args[0][0]
    expected = [
        (
            f"{PROJECT_HOST}/storage/v1/object/authenticated/score-images/"
            f"{user_id}/p{position}.jpg"
        )
        for position in range(3)
    ]
    assert written["source_image_urls"] == expected
    assert all("token=" not in page for page in expected)
    # Page one into the old column as well, so a worker or reader from before
    # migration 011 still finds a photograph rather than a piece with no scan.
    assert written["source_image_url"] == expected[0]


def test_a_page_that_is_not_yours_is_refused_even_at_position_three(
    api: TestClient, monkeypatch, make_token
) -> None:
    """**Every page, not the first.** Checking only page one would let a scan
    carry somebody else's page into a read — and the row would already be
    written by the time a worker found out."""
    from uuid import uuid4

    user_id, other = uuid4(), uuid4()
    pages = _pages_for(user_id, 2) + [_signed_url(other)]
    client = _install_supabase(monkeypatch, returning_row=_row_for(uuid4(), user_id))
    _stub_worker(monkeypatch)

    response = api.post(
        "/v1/scores",
        json={"title": "Part", "image_urls": pages},
        headers=_auth(make_token, user_id),
    )

    assert response.status_code == 403, response.text
    assert not client.table.return_value.insert.called, (
        "the row was written before the pages were checked"
    )


def _accept_row(user_id, score_id, pages: list[str]) -> dict:
    return _row_for(
        score_id,
        user_id,
        source_image_url=pages[0],
        source_image_urls=pages,
        transcription_status="done",
    )


def test_accepting_a_three_page_scan_discards_all_three(
    api: TestClient, monkeypatch, make_token
) -> None:
    """The orphaned-upload hole, multiplied by the length of the part: pages
    two and three would be left in the bucket with no row naming them, no
    accept path and no delete path."""
    from uuid import uuid4

    user_id, score_id = uuid4(), uuid4()
    pages = _pages_for(user_id, 3)
    client = _install_supabase(
        monkeypatch, returning_row=_accept_row(user_id, score_id, pages)
    )
    removed: list[str] = []
    client.storage.from_.return_value.remove.side_effect = (
        lambda keys: removed.extend(keys) or MagicMock()
    )

    response = api.post(f"/v1/scores/{score_id}/accept", headers=_auth(make_token, user_id))

    assert response.status_code == 200, response.text
    assert len(removed) == 3, f"only {len(removed)} of 3 pages were removed"


def test_a_page_storage_refuses_leaves_the_row_naming_every_page(
    api: TestClient, monkeypatch, make_token
) -> None:
    """**`all`, and only after every one of them went.**

    Nulling the columns after a partial discard strands whatever storage
    refused, in exactly the way this is meant to prevent. Leaving the row
    intact keeps every remaining page reachable by `DELETE /:id`, which is the
    one path that can still clean them up.
    """
    from uuid import uuid4

    user_id, score_id = uuid4(), uuid4()
    pages = _pages_for(user_id, 3)
    client = _install_supabase(
        monkeypatch, returning_row=_accept_row(user_id, score_id, pages)
    )
    client.storage.from_.return_value.remove.side_effect = RuntimeError("storage down")

    response = api.post(f"/v1/scores/{score_id}/accept", headers=_auth(make_token, user_id))

    assert response.status_code == 200, response.text
    patch = client.table.return_value.update.call_args[0][0]
    assert "source_image_url" not in patch, patch
    assert "page_image_discarded_at" not in patch, patch


def test_deleting_a_three_page_scan_removes_all_three(
    api: TestClient, monkeypatch, make_token
) -> None:
    from uuid import uuid4

    user_id, score_id = uuid4(), uuid4()
    pages = _pages_for(user_id, 3)
    client = _install_supabase(
        monkeypatch, returning_row=_accept_row(user_id, score_id, pages)
    )
    removed: list[str] = []
    client.storage.from_.return_value.remove.side_effect = (
        lambda keys: removed.extend(keys) or MagicMock()
    )

    response = api.delete(f"/v1/scores/{score_id}", headers=_auth(make_token, user_id))

    assert response.status_code == 204, response.text
    assert len(removed) == 3, f"only {len(removed)} of 3 pages were removed"


# ---------------------------------------------------------------------------
# Reading a multi-page scan back
# ---------------------------------------------------------------------------

from datetime import datetime, timezone  # noqa: E402

_EXPIRY = datetime(2026, 9, 2, 12, 0, tzinfo=timezone.utc)


def _signed_rows(rows, *, all_pages):
    """`_with_image_urls` over a stub signer, so the assertions are about which
    keys were asked for rather than about Supabase."""
    from app.routers import scores as scores_module
    from app.services import display_urls as display_urls_module

    asked: list[list[str]] = []

    def _sign(keys):
        asked.append(list(keys))
        return {
            key: (f"https://signed.example/{key}?token=t", _EXPIRY) for key in keys
        }

    original = display_urls_module.signed_display_urls
    display_urls_module.signed_display_urls = _sign
    try:
        return scores_module._with_image_urls(rows, all_pages=all_pages), asked
    finally:
        display_urls_module.signed_display_urls = original


def _three_page_row(user_id, score_id) -> dict:
    row = _row_for(score_id, user_id)
    pages = _pages_for(user_id, 3)
    row["source_image_url"] = pages[0]
    row["source_image_urls"] = pages
    return row


def test_reading_one_piece_signs_every_page_in_order() -> None:
    """**The row says "The pages this piece was read from" and showed one.**

    A musician who photographed a four-page part could not look at the bar
    flagged on page three: `page_count` said it existed and no URL reached it.
    """
    from uuid import uuid4

    user_id, score_id = uuid4(), uuid4()
    [out], asked = _signed_rows([_three_page_row(user_id, score_id)], all_pages=True)

    assert out.page_count == 3
    assert len(out.image_urls) == 3
    assert [url.split("/p")[1][0] for url in out.image_urls] == ["0", "1", "2"]
    # `image_url` is still page one, so every listing and thumbnail is unchanged.
    assert out.image_url == out.image_urls[0]
    # And still **one** signing call, which is what makes this affordable.
    assert len(asked) == 1


def test_the_library_listing_still_signs_only_page_one() -> None:
    """Forty rows of four pages is forty extra URLs in a payload whose screen
    draws thumbnails. The call costs the same; the bytes do not."""
    from uuid import uuid4

    user_id, score_id = uuid4(), uuid4()
    [out], _ = _signed_rows([_three_page_row(user_id, score_id)], all_pages=False)

    assert out.page_count == 3, "the count still tells a client there is more"
    assert len(out.image_urls) == 1
    assert out.image_url == out.image_urls[0]


def test_a_discarded_photograph_signs_nothing_at_all() -> None:
    """Accepting a reading spends the pages. Signing does not check that an
    object exists, so without this the response hands back well-formed URLs
    that 404."""
    from uuid import uuid4

    user_id, score_id = uuid4(), uuid4()
    row = _three_page_row(user_id, score_id)
    row["page_image_discarded_at"] = "2026-09-02T00:00:00Z"

    [out], _ = _signed_rows([row], all_pages=True)

    assert out.image_urls == []
    assert out.image_url is None
    assert out.image_url_expires_at is None
