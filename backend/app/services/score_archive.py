"""What happens to a scan the reader could not read.

**A piece is written before its page is read**, deliberately — `POST /v1/scores`
returns a row and `transcription_runner` fills the notes in, so a musician can
leave the screen while it works. When the reading fails, what is left is a row
with a title, no notation, and a photograph: on the shelf it was a blank tile
that said nothing and offered nothing, and the only way out of it was two
screens down.

Nothing ever removed one. `pending_uploads` sweeps objects *nothing claimed*,
and `POST /v1/scores` claims the page as it writes the row — correctly, and
permanently. So a failed scan and its photograph stayed until the musician
deleted the piece by hand, and nine of them sat in the owner's library for
three weeks at 3–5 MB apiece (measured on `intempo-dev`, 2026-09-17: **31.7 MB**
across nine rows, on a tier where 1 GB is about four musicians).

The shelf now offers *try again* and *discard* on the tile itself, which is the
half a musician can act on. This is the other half: the ones they never come
back to.

**Why a delete rather than a mark.** `take_archive` marks a reclaimed take,
because the row outlives its audio and something has to stop the next pass
finding it again. Here the row *is* the thing being removed, so it cannot be
found twice — and that removes the need for a column, a migration, and a
readiness check.

**Object before row**, the ordering rule this project has learned twice:
`pending_uploads.sweep_unclaimed` states it and `take_archive` repeats it. A row
deleted first strands its photograph where no request can reach it, including
the musician's own, which is the exact hole being closed.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db import get_service_client
from app.services.buckets import SCORE_BUCKET
from app.services.score_pages import display_keys, page_keys, select_with_pages

log = logging.getLogger("intempo.scores")

#: How long an unreadable scan is kept before it is swept.
#:
#: Seven days, where a take gets one. The two are waiting for different things:
#: `take_archive`'s day is how long a musician might want to hear a recording
#: whose analysis failed, and they are looking at that screen when it happens.
#: A failed scan is discovered later — you photograph a part, put the phone
#: down, and find the blank tile when you next open the library — and the thing
#: it is holding is a photograph of a page that may no longer be in front of
#: you. A week covers "I will re-shoot it at the weekend"; a day does not.
#:
#: The tile's own *discard* is the fast path. This is only for the scans nobody
#: goes back to.
SWEEP_AFTER = timedelta(days=7)

#: How many to sweep per pass. The same reasoning as `take_archive`'s batch:
#: a pass runs beside three other sweeps on one timer, and a bounded pass that
#: repeats in five minutes is better than an unbounded one that holds the loop.
SWEEP_BATCH = 100


def sweep_unreadable_scans(
    client: Any | None = None,
    now: datetime | None = None,
) -> int:
    """Remove failed scans older than `SWEEP_AFTER`, photographs first.

    **Only rows nothing else points at.** `analyses` and `assignments`
    reference `scores` with RESTRICT, so a row with either would refuse to
    delete and cost a pass; and a failed scan with practice history against it
    is not the thing this describes. Both are checked rather than assumed —
    a scan can fail *after* a re-read that once worked, and the piece may have
    been practised in between.

    Nothing raises. This runs on a timer beside three other sweeps, and one bad
    pass has to cost one pass.
    """
    client = client or get_service_client()
    if client is None:
        return 0

    cutoff = ((now or datetime.now(tz=timezone.utc)) - SWEEP_AFTER).isoformat()
    try:
        rows = select_with_pages(
            lambda columns: (
                client.table("scores")
                .select(columns)
                .eq("transcription_status", "failed")
                .lt("updated_at", cutoff)
                .limit(SWEEP_BATCH)
                .execute()
            ),
            "id",
        ).data or []
    except Exception:  # noqa: BLE001 — the loop outlives any one failure
        log.warning("could not list unreadable scans to sweep", exc_info=True)
        return 0

    swept = 0
    for row in rows:
        score_id = row.get("id")
        if not score_id:
            continue
        if _has_dependents(client, str(score_id)):
            continue
        if not _remove_pages(client, str(score_id), row):
            continue
        try:
            client.table("scores").delete().eq("id", str(score_id)).execute()
        except Exception:  # noqa: BLE001
            # The photographs are gone and the row is not. It is now a failed
            # scan with no page, which the shelf already draws correctly — it
            # offers discard and withholds try-again — and the next pass
            # removes it.
            log.warning(
                "score %s: swept its pages but could not remove the row",
                score_id,
                exc_info=True,
            )
            continue
        swept += 1

    if swept:
        log.info("swept %d unreadable scan(s)", swept)
    return swept


def _has_dependents(client: Any, score_id: str) -> bool:
    """Whether anything references this score. A failed lookup means yes.

    Refusing to sweep because a count could not be read costs one photograph
    staying another five minutes. Sweeping because a count could not be read
    costs a delete that fails against RESTRICT, or — worse, if the schema ever
    loosens — a musician's practice history.
    """
    for table in ("analyses", "assignments"):
        try:
            found = (
                client.table(table)
                .select("id")
                .eq("score_id", score_id)
                .limit(1)
                .execute()
            ).data or []
        except Exception:  # noqa: BLE001
            log.warning(
                "score %s: could not check %s before sweeping",
                score_id,
                table,
                exc_info=True,
            )
            return True
        if found:
            return True
    return False


def _remove_pages(client: Any, score_id: str, row: dict[str, Any]) -> bool:
    """Delete the photographs and their display copies. True when it is safe
    to remove the row.

    A scan with no recoverable key is *not* a failure: the row owns nothing
    this deployment can name, and leaving it would hand it to every future pass
    forever — the starvation `SWEEP_BATCH` describes.

    The display copies go with the originals and their absence is not an error.
    `store_display_copy` only writes one for a page that was read far enough to
    need one, so a scan that failed early has none, and storage removes a key
    that was never there without complaint.
    """
    keys = page_keys(row) + display_keys(row)
    if not keys:
        return True
    try:
        client.storage.from_(SCORE_BUCKET).remove(keys)
    except Exception:  # noqa: BLE001
        # Left whole on purpose: the next pass tries again. An object that no
        # longer exists removes cleanly, so a repeated failure here means
        # storage is unreachable rather than a bad key.
        log.warning("score %s: could not sweep its pages", score_id, exc_info=True)
        return False
    return True


__all__ = ["SWEEP_AFTER", "SWEEP_BATCH", "sweep_unreadable_scans"]
