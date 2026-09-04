"""What the app will send, against what the bucket will take.

A signed upload URL goes **straight to storage**, so the bucket's own
`file_size_limit` is the last word — the API is not in the path and cannot
soften it. Migration 016 says what those limits are:

    score-images    10485760   (10 MiB)
    audio-uploads   52428800   (50 MiB)

and the app carries its own copy of each, by different names and for different
reasons:

    lib/scan/uploadPage.ts   MAX_PAGE_BYTES     "This is the bucket's,
                                                because the bucket is what
                                                answers 413."
    lib/audio/types.ts       MAX_UPLOAD_BYTES   "which is the `audio-uploads`
                                                bucket's `file_size_limit`"

Both docstrings **state** the correspondence. Neither was checked, and until
016 landed on 2026-09-03 neither could be: the two oldest buckets existed in no
migration at all, so their limits lived only in a dashboard.

**What a drift costs is not symmetric.** A page cap set too high wastes an
upload and shows a musician a storage error about a photograph. A take cap set
too high loses the take — discovered after they have stopped playing, and the
playing is the one part that cannot be repeated. `MAX_UPLOAD_BYTES`'s own
comment says exactly that, one line above the constant this compares.

The app's number may be **lower** than the bucket's; that is a client refusing
early, which is the right direction. It may never be higher.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
MOBILE_SRC = REPO / "mobile" / "src"
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "016_storage_buckets.sql"

#: (bucket, file under `mobile/src`, the constant the app enforces, why).
CAPS: tuple[tuple[str, str, str, str], ...] = (
    (
        "score-images",
        "lib/scan/uploadPage.ts",
        "MAX_PAGE_BYTES",
        "a page refused by storage after the upload has already run",
    ),
    (
        "audio-uploads",
        "lib/audio/types.ts",
        "MAX_UPLOAD_BYTES",
        "a take lost after the musician has stopped playing",
    ),
)

#: `('audio-uploads', 'audio-uploads', false, 52428800),`
_BUCKET_ROW = re.compile(r"\('([a-z-]+)',\s*'[a-z-]+',\s*(?:false|true),\s*(\d+)\)")

#: `export const MAX_PAGE_BYTES = 10 * 1024 * 1024;` — digits and `*` only.
_ARITHMETIC = re.compile(r"^[\d\s*]+$")


def _bucket_limits() -> dict[str, int]:
    """The limits as the migration sets them.

    Read from the file rather than from a running database, for the reason
    `test_column_vocabularies.py` gives: this has to fail in CI, where there is
    no database, and the files are what a deployment is applied from.
    """
    found = {
        name: int(size) for name, size in _BUCKET_ROW.findall(MIGRATION.read_text())
    }
    assert found, "016_storage_buckets no longer sets any file_size_limit"
    return found


def _app_constant(relative: str, name: str) -> int:
    """A `const NAME = <arithmetic>;` from the app's source, evaluated.

    Only digits, whitespace and `*` are accepted, so this reads `10 * 1024 *
    1024` and refuses anything it would have to interpret.
    """
    source = (MOBILE_SRC / relative).read_text()
    match = re.search(rf"const {name} = ([^;]+);", source)
    assert match, f"{relative} no longer declares {name}"
    expression = match.group(1).strip()
    assert _ARITHMETIC.match(expression), (
        f"{name} is now {expression!r}, which this cannot evaluate — "
        "if it has become a computed value, compare it another way rather "
        "than deleting the check"
    )
    return eval(expression)  # noqa: S307 — guarded to digits and `*` above


LIMITS = _bucket_limits()


@pytest.mark.parametrize(
    ("bucket", "relative", "constant", "cost"),
    CAPS,
    ids=[bucket for bucket, _, _, _ in CAPS],
)
def test_the_app_never_offers_more_than_the_bucket_takes(
    bucket: str, relative: str, constant: str, cost: str
) -> None:
    limit = LIMITS.get(bucket)
    assert limit is not None, f"016 no longer sets a limit for {bucket}"

    proposed = _app_constant(relative, constant)

    assert proposed <= limit, (
        f"{relative} allows {proposed} bytes and the {bucket} bucket takes "
        f"{limit}. A signed URL goes straight to storage, so this is {cost}."
    )


@pytest.mark.parametrize(
    ("bucket", "relative", "constant", "_cost"),
    CAPS,
    ids=[bucket for bucket, _, _, _ in CAPS],
)
def test_the_app_is_not_refusing_far_more_than_it_needs_to(
    bucket: str, relative: str, constant: str, _cost: str
) -> None:
    """The other direction, which costs a musician a file that would have fitted.

    Not equality: a client cap below the bucket's is legitimate — `uploadPage`
    re-encodes down to `MAX_PAGE_BYTES` rather than refusing, and refusing early
    beats a wasted upload. But a cap an order of magnitude under the bucket's is
    a copy that has drifted rather than a decision, so this fails at half.

    Both are exact today, and that is the state worth defending.
    """
    limit = LIMITS[bucket]
    proposed = _app_constant(relative, constant)

    assert proposed * 2 >= limit, (
        f"{relative} allows {proposed} bytes where the {bucket} bucket would "
        f"take {limit}; a page or take that fits is being turned away"
    )


def test_every_bucket_the_migration_limits_has_a_client_cap_or_is_named() -> None:
    """Discovered, so a *new* limited bucket is the thing that fails.

    `avatars` is deliberately absent from 016 — measured on `intempo-dev`, its
    `file_size_limit` is null, which CLAUDE.md carries as an open item for the
    owner. It is not in this file because there is nothing to compare against;
    the moment 016 gives it a limit, this fails and asks for the app's side.
    """
    unheld = sorted(
        bucket for bucket in LIMITS if bucket not in {name for name, _, _, _ in CAPS}
    )

    assert not unheld, (
        "016 limits these buckets and nothing compares the limit with what the "
        f"app will send to them: {unheld}"
    )
