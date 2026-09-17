"""Sweeping the scans the reader could not read.

A piece is written before its page is read, so a failed reading leaves a row
with a title, no notation and a photograph — and nothing ever removed one.
`pending_uploads` sweeps objects *nothing claimed*, and `POST /v1/scores` claims
the page as it writes the row, so the object ends up claimed by a row that is
finished with it and reachable by no cleanup at all. Measured on `intempo-dev`
on 2026-09-17: nine such rows, the oldest three weeks old, 31.7 MB between them.

These cases are about the sweep taking the right scans and — four times over —
about it not taking the wrong ones. The ordering case is the one that matters
most: an object deleted after its row is an object nobody can ever reach, which
is the hole this closes, reintroduced one level down.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services import score_archive
from app.services.score_archive import SWEEP_AFTER, sweep_unreadable_scans
from app.tests.fake_supabase import FakeSupabase

NOW = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)
USER = "30e66924-9577-459b-9c8b-f1118f39ec0a"
BUCKET = "score-images"


def _url(name: str) -> str:
    return (
        "https://stub.supabase.co/storage/v1/object/upload/sign/"
        f"{BUCKET}/{USER}/{name}?token=stub"
    )


def _long_ago() -> str:
    return (NOW - SWEEP_AFTER - timedelta(hours=1)).isoformat()


def _scan(
    score_id: str = "s1",
    *,
    status: str = "failed",
    updated_at: str | None = None,
    name: str = "page.jpg",
) -> dict:
    return {
        "id": score_id,
        "user_id": USER,
        "transcription_status": status,
        "updated_at": updated_at or _long_ago(),
        "source_image_url": _url(name),
        "source_image_urls": [_url(name)],
    }


def _seeded(rows: list[dict], *, objects: list[str] | None = None) -> FakeSupabase:
    fake = FakeSupabase()
    fake.seed("scores", rows)
    for key in objects or [f"{USER}/page.jpg"]:
        fake.put_object(BUCKET, key, b"photograph")
    return fake


def test_sweeps_an_old_unreadable_scan_and_its_photograph() -> None:
    fake = _seeded([_scan()])

    swept = sweep_unreadable_scans(client=fake, now=NOW)

    assert swept == 1
    assert fake.table("scores").rows == []
    assert fake.object_keys(BUCKET) == set()


def test_takes_the_display_copy_with_the_original() -> None:
    # `store_display_copy` writes a derivative beside the photograph, and its
    # key is derived rather than stored. A sweep that forgot it would leave
    # half a scan behind — invisibly, since nothing points at either.
    fake = _seeded(
        [_scan()],
        objects=[f"{USER}/page.jpg", f"{USER}/page.display.jpg"],
    )

    sweep_unreadable_scans(client=fake, now=NOW)

    assert fake.object_keys(BUCKET) == set()


def test_leaves_a_scan_inside_its_grace_period() -> None:
    # A musician who photographed a part an hour ago may be about to re-read it
    # from the shelf. The week is for the ones nobody goes back to.
    recent = (NOW - timedelta(days=1)).isoformat()
    fake = _seeded([_scan(updated_at=recent)])

    assert sweep_unreadable_scans(client=fake, now=NOW) == 0
    assert len(fake.table("scores").rows) == 1
    assert fake.object_keys(BUCKET) == {f"{USER}/page.jpg"}


def test_leaves_every_scan_that_did_not_fail() -> None:
    # Queued and reading are in flight; done is a piece with music in it. Only
    # `failed` describes a row whose page will never become notation on its own.
    for status in ("queued", "reading", "done"):
        fake = _seeded([_scan(status=status)])

        assert sweep_unreadable_scans(client=fake, now=NOW) == 0, status
        assert len(fake.table("scores").rows) == 1, status


def test_leaves_a_scan_something_still_points_at() -> None:
    # A scan can fail after a re-read that once worked, and the piece may have
    # been practised in between. `analyses` references `scores` with RESTRICT,
    # so this is a delete that would fail anyway — and a take whose piece
    # vanished would be the worse outcome if it ever stopped failing.
    fake = _seeded([_scan()])
    fake.seed("analyses", [{"id": "a1", "score_id": "s1", "user_id": USER}])

    assert sweep_unreadable_scans(client=fake, now=NOW) == 0
    assert len(fake.table("scores").rows) == 1
    assert fake.object_keys(BUCKET) == {f"{USER}/page.jpg"}


def test_leaves_a_scan_a_teacher_has_assigned() -> None:
    fake = _seeded([_scan()])
    fake.seed("assignments", [{"id": "x1", "score_id": "s1"}])

    assert sweep_unreadable_scans(client=fake, now=NOW) == 0
    assert len(fake.table("scores").rows) == 1


def test_keeps_the_row_when_the_photograph_cannot_be_removed() -> None:
    """The ordering rule, as a test: object first, then the row.

    A row deleted over a storage failure strands its photograph where no
    request can reach it — including the musician's own — which is precisely
    the bug this sweep exists to prevent, reintroduced one level down. The next
    pass tries again; an object that is already gone removes cleanly, so a
    repeated failure here means storage is unreachable rather than a bad key.
    """
    fake = _seeded([_scan()])

    def refuse(_keys: list[str]) -> None:
        raise RuntimeError("storage said no")

    fake.storage.from_(BUCKET).remove = refuse  # type: ignore[method-assign]

    assert sweep_unreadable_scans(client=fake, now=NOW) == 0
    assert len(fake.table("scores").rows) == 1, "the row must outlive its photograph"


def test_sweeps_a_row_whose_url_names_nothing_this_deployment_owns() -> None:
    # No key to delete is not a failure to delete: leaving it would hand the
    # row to every future pass for ever, which is the starvation the batch
    # limit describes.
    stray = _scan()
    stray["source_image_url"] = "https://elsewhere.test/not-ours.jpg"
    stray["source_image_urls"] = ["https://elsewhere.test/not-ours.jpg"]
    fake = _seeded([stray])

    assert sweep_unreadable_scans(client=fake, now=NOW) == 1
    assert fake.table("scores").rows == []
    assert fake.object_keys(BUCKET) == {f"{USER}/page.jpg"}, "someone else's object"


def test_a_listing_that_fails_costs_one_pass_and_nothing_else() -> None:
    class Broken:
        storage = None

        def table(self, _name: str):  # noqa: ANN202
            raise RuntimeError("supabase said no")

    assert sweep_unreadable_scans(client=Broken(), now=NOW) == 0


def test_does_nothing_without_a_service_client(monkeypatch) -> None:
    monkeypatch.setattr(score_archive, "get_service_client", lambda: None)

    assert sweep_unreadable_scans(now=NOW) == 0
