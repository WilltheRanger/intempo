"""The lifecycle that stops an upload becoming unreachable.

Every one of these is an ordering. The feature is three lines of Supabase
calls; what makes it correct is *when* each runs relative to the row it
depends on, and every ordering has a way of being wrong that leaks a
photograph silently — which is the bug being fixed, so getting it wrong here
would be the bug reintroduced one level down.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.services import pending_uploads


def _client(rows: list[dict] | None = None) -> MagicMock:
    client = MagicMock()
    table = client.table.return_value
    chain = table.select.return_value.lt.return_value.limit.return_value
    chain.execute.return_value = MagicMock(data=rows or [])
    return client


def _install(monkeypatch: pytest.MonkeyPatch, client: MagicMock | None) -> None:
    monkeypatch.setattr(pending_uploads, "get_service_client", lambda: client)


def test_recording_a_pending_upload_writes_the_bucket_and_the_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client()
    _install(monkeypatch, client)

    pending_uploads.record(
        "11111111-1111-1111-1111-111111111111", "score-images", "u/abc.jpg"
    )

    written = client.table.return_value.insert.call_args.args[0]
    assert written["bucket"] == "score-images"
    assert written["object_key"] == "u/abc.jpg"


def test_recording_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """**Bookkeeping must not cost a musician their page.**

    Failing to record costs a swept object later; failing the *upload* because
    the bookkeeping failed costs the photograph, which is the thing the
    bookkeeping exists to protect.
    """
    client = _client()
    client.table.return_value.insert.side_effect = RuntimeError("no database")
    _install(monkeypatch, client)

    pending_uploads.record("1" * 8, "score-images", "u/abc.jpg")


def test_claiming_nothing_asks_the_database_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A hand-entered piece has no objects. A query to delete none of them is a
    # round trip to be told so.
    client = _client()
    _install(monkeypatch, client)

    pending_uploads.claim("score-images", [])

    client.table.assert_not_called()


def test_sweeping_removes_the_object_before_the_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """**The ordering that is the whole of the error handling.**

    A row deleted before its object leaks the object permanently and
    silently — which is exactly the bug this module exists to fix,
    reintroduced one level down. A row that outlives a failed object deletion
    is swept again next pass and costs one wasted request.
    """
    client = _client([{"id": "row-1", "bucket": "score-images", "object_key": "u/a.jpg"}])
    _install(monkeypatch, client)
    order: list[str] = []
    client.storage.from_.return_value.remove.side_effect = lambda keys: order.append(
        "object"
    )
    client.table.return_value.delete.return_value.eq.return_value.execute.side_effect = (
        lambda: order.append("row")
    )

    assert pending_uploads.sweep_unclaimed() == 1
    assert order == ["object", "row"]


def test_a_row_whose_object_will_not_delete_is_kept_for_the_next_sweep(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Storage being unreachable is a reason to try again, not a reason to
    # forget the object exists.
    client = _client([{"id": "row-1", "bucket": "score-images", "object_key": "u/a.jpg"}])
    _install(monkeypatch, client)
    client.storage.from_.return_value.remove.side_effect = RuntimeError("storage down")

    assert pending_uploads.sweep_unclaimed() == 0
    client.table.return_value.delete.assert_not_called()


def test_sweeping_only_looks_at_uploads_old_enough_that_nothing_is_coming(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The gap between minting a key and creating the row is seconds. A cutoff
    # measured in minutes would race a slow upload and delete a page somebody
    # is still using.
    client = _client([])
    _install(monkeypatch, client)
    now = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)

    pending_uploads.sweep_unclaimed(now=now)

    cutoff = client.table.return_value.select.return_value.lt.call_args.args[1]
    assert datetime.fromisoformat(cutoff) == now - timedelta(hours=24)


def test_sweeping_without_a_database_is_a_no_op(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(monkeypatch, None)

    assert pending_uploads.sweep_unclaimed() == 0
