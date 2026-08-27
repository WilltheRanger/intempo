"""The largest page, declared in two languages that cannot import each other.

The app refuses to send a page over `MAX_PAGE_BYTES`; the worker refuses to
fetch one over `MAX_IMAGE_BYTES`; and the bucket has a cap of its own. Three
numbers on one photograph, in three places, and only one pair was ever
compared — `readiness.py` checks the bucket against the worker at runtime, and
says why:

    Two numbers in two systems, and nothing ever compared them. The worker's
    cap was 25 MB against a bucket that accepts 50, so a six-minute take
    uploaded, sat in storage, and was refused by the thing meant to read it —
    reported as `audio_unavailable`, which was not true.

**The app's number is the one that pair does not cover**, and it is the one a
musician meets first. Raising it is a one-line change in a TypeScript file that
mentions neither Python nor storage.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.services.page_image import MAX_IMAGE_BYTES

UPLOAD_TS = (
    Path(__file__).resolve().parents[3]
    / "mobile" / "src" / "lib" / "scan" / "uploadPage.ts"
)


def _constant(name: str) -> int:
    """`export const NAME = 10 * 1024 * 1024;` as an integer."""
    source = UPLOAD_TS.read_text()
    match = re.search(rf"export const {name}\s*=\s*([0-9*\s]+);", source)
    assert match, f"{name} is not declared in {UPLOAD_TS.name} in the expected form"
    return eval(match.group(1).strip())  # noqa: S307 — arithmetic on digits only


def test_the_app_never_sends_a_page_the_worker_will_not_fetch() -> None:
    """**The direction that matters.**

    If the app's cap were the larger, a page would pass the check on the
    phone, upload in full over somebody's data, sit in storage — and then be
    refused by the worker with *"The photograph could not be fetched from
    storage"*, which is not what happened and gives the musician nothing to
    act on. The photograph would be spent and the scan would fail for a reason
    the app had every opportunity to state before sending a byte.
    """
    app_cap = _constant("MAX_PAGE_BYTES")

    assert app_cap <= MAX_IMAGE_BYTES, (
        f"the app will send up to {app_cap} bytes and the worker refuses over "
        f"{MAX_IMAGE_BYTES}. A page between the two uploads and then fails, "
        f"reported as a storage fault."
    )


def test_the_gap_between_them_is_not_so_wide_the_app_is_the_only_limit() -> None:
    """The other direction is harmless and still worth saying, in the words
    `readiness.py` uses about the same shape: it means the worker would happily
    fetch something the musician can never send in the first place, so the real
    limit is somewhere the code does not mention.

    Held to a factor of two, which the current 10 MB against 12 MB satisfies
    comfortably. This is not a tuned number — it is the point at which the two
    constants have stopped being about the same photograph.
    """
    app_cap = _constant("MAX_PAGE_BYTES")

    assert MAX_IMAGE_BYTES <= app_cap * 2, (
        f"the worker accepts {MAX_IMAGE_BYTES} bytes and the app never sends "
        f"more than {app_cap}. The worker's cap is no longer the limit anyone "
        f"meets, so the number a musician is held to lives only in the app."
    )


@pytest.mark.parametrize("name", ["MAX_PAGE_BYTES"])
def test_the_constant_is_still_where_this_test_looks(name: str) -> None:
    """A cross-language check reads source, so it fails open if the declaration
    is renamed or reformatted — silently agreeing with whatever is there.
    Asserting it was actually found is what stops that."""
    assert _constant(name) > 0
