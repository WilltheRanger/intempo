"""What a `scores` row means by "its pages", in one place.

The worker asks so it knows what to read; the router asks so it knows what to
delete and what to discard. They must agree — a router that discards one page
of a three-page scan leaves two photographs in the bucket that nothing can ever
reach again, which is the orphaned-upload hole this project already has once
and does not need twice.
"""

from __future__ import annotations

#: Selected in order, most complete first.
#:
#: **PostgREST validates the column list, so asking for a column the database
#: does not have fails the whole request.** Migrations here are applied by hand
#: in the Supabase editor — nothing auto-applies `app/migrations/*.sql` — while
#: Render deploys from `main` automatically, so there is always a window where
#: this code is live and `011` is not. During it every one of these endpoints
#: has to keep working on page one rather than 500.
#:
#: `/v1/ready` reports the missing column separately and loudly. This is what
#: keeps the app usable in the meantime.
PAGE_COLUMNS = ("source_image_url, source_image_urls", "source_image_url")


def pages_of(row: dict) -> list[str]:
    """The pages of this scan, in page order.

    **Three shapes have to come back right, and only one of them is new.**
    `source_image_urls` (011) is the answer where it exists; a row written
    before that migration, or by a deployment that has not applied it, has only
    `source_image_url`; and a piece entered by hand has neither.

    The array is read *first* and the single column is the fallback rather than
    the other way round, because a deployment mid-rollout writes both — page
    one into the old column so an older worker still finds something, and every
    page into the new one. Preferring the old column would read page one of a
    three-page part on a database that holds all three.

    An empty array is treated as no pages at all: `011` writes NULL rather than
    `\'{}\'` for a piece with no scan, so an empty array is a row somebody built
    by hand, and reading it as "a scan with no pages" is the only honest
    reading of it.
    """
    many = row.get("source_image_urls")
    if isinstance(many, list):
        pages = [url for url in many if url]
        if pages:
            return pages
    one = row.get("source_image_url")
    return [one] if one else []


def select_with_pages(query_for, columns: str):
    """Run a select that asks for the page array, narrowing if it is refused.

    `query_for` is handed a column list and returns the executed result. It is
    called at most twice: once with the array included and, if PostgREST
    rejects that, once without.
    """
    last: Exception | None = None
    for index, pages in enumerate(PAGE_COLUMNS):
        try:
            return query_for(f"{columns}, {pages}" if columns else pages)
        except Exception as exc:  # noqa: BLE001 — try the narrower shape first
            last = exc
            if index == len(PAGE_COLUMNS) - 1:
                raise
    raise last  # pragma: no cover — the loop either returns or raises


def page_keys(row: dict) -> list[str]:
    """Every storage object this row owns, in page order.

    One place, so accept, delete and the unreadable-scan sweep cannot disagree
    about how much of a scan there is. A key that cannot be recovered from its
    URL is skipped rather than guessed — `object_key_from` returns None for a
    URL this deployment does not recognise, and deleting a guessed key is worse
    than leaking one.

    **Lives here rather than in `routers/scores`, where it was written.** It
    moved on 2026-09-17 when `score_archive` became the third caller: a private
    copy in a router is a copy, and this module exists precisely so that what a
    row means by "its pages" has one answer.
    """
    from app.services.page_image import object_key_from

    keys = []
    for url in pages_of(row):
        key = object_key_from(url or "")
        if key is not None:
            keys.append(key)
    return keys


def display_keys(row: dict) -> list[str]:
    """The display-size copies of this row's pages, for deletion only.

    **Separate from `page_keys` rather than folded into it**, and the reason is
    that five callers read that list as "the pages": the first element is the
    `page_image_key` a training correction is filed under, another compares it
    against what a re-scan replaced. Returning photographs and derivatives
    interleaved would have left every one of them subtly wrong while `keys[0]`
    still happened to be a photograph — the worst kind of change, since nothing
    would have failed.

    Derived rather than stored, so this cannot fall out of step with what
    `store_display_copy` writes: both go through `display_key_for`.
    """
    from app.services.page_image import display_key_for

    return [display_key_for(key) for key in page_keys(row)]
