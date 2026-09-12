"""The two legibility checks, on the same pages.

There are two measurements of how far apart a page's staff lines are, and
there have to be. `page_image.staff_space_px` is the one that decides — it runs
on the photograph as downloaded and refuses a page nothing could be read from.
`mobile/src/lib/scan/legibility.ts` is a coarser copy that runs at the shutter,
so a musician still holding the music hears "move in" now rather than after the
upload, the queue and the worker.

The app's module note states the rule the copy lives under, in its own words:

    it may never refuse a page the server would accept.

**That rule was held by nothing.** What was asserted was `CLIENT_FLOOR <
SERVER_FLOOR` — an ordering of two constants — and a set of synthetic ruled
pages that only the app ever measured. Neither touches the rule. Two different
algorithms can order their thresholds correctly and still disagree about a
photograph, and on 2026-09-04 they did, on three of the five real pages in this
repository: the app read a period of 3 px off pages the server measures at 9
and 11, and told the musician to move closer to music it would have read
perfectly. Nothing was red. Nothing could have been, because neither suite had
ever shown the other's code a page.

`fixtures/legibility/` is the artefact they meet on, and it has two halves.
This file holds the half the server owns: that the stored samples really are
what the app's `pageSamples.web.ts` would produce from these pages, and that
the server's verdicts recorded beside them are still the server's verdicts.
`mobile/src/lib/scan/legibility.contract.test.ts` holds the other half — the
rule itself — by running the app's real check over these samples.

Splitting it this way is what makes the fixture safe to trust. A fixture the
app alone reads is a record of what the app was once told; recomputing it here
from the JPEGs means it cannot quietly become a record of a page that is no
longer in the repository, or of a crop rule the app no longer uses.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
FIXTURES = REPO / "fixtures" / "legibility"
PARITY = FIXTURES / "parity.json"

sys.path.insert(0, str(REPO / "tools"))
from legibility_fixture import app_samples  # noqa: E402

from app.services.page_image import staff_space_px, too_small_to_read  # noqa: E402

CONTRACT = json.loads(PARITY.read_text())
PAGES = CONTRACT["pages"]
IDS = [page["name"] for page in PAGES]


def _stored_samples(page: dict) -> bytes:
    packed = json.loads((FIXTURES / page["samples"]).read_text())["gzip_b64"]
    return gzip.decompress(base64.b64decode(packed))


@pytest.mark.parametrize("page", PAGES, ids=IDS)
def test_the_stored_samples_are_what_the_app_would_measure(page: dict) -> None:
    """Recomputed from the JPEG, not merely read back.

    The samples are the only part of this contract the app cannot check for
    itself — it has no JPEG decoder in its test environment, which is why they
    are stored at all. So the check that they still correspond to a real page
    has to live here. Without it, a fixture generated once from a page later
    cropped, replaced or deleted goes on asserting a rule about an image nobody
    has.
    """
    gray, width, height = app_samples((REPO / page["source"]).read_bytes())

    assert (width, height) == (page["width"], page["height"])
    assert hashlib.sha256(gray).hexdigest() == page["sha256"]
    assert _stored_samples(page) == gray


@pytest.mark.parametrize("page", PAGES, ids=IDS)
def test_the_servers_answer_is_still_the_servers_answer(page: dict) -> None:
    """The other thing the app is being held against.

    The rule the app obeys is stated in terms of what the *server* does with a
    page, and the app cannot run the server. So the server's verdict travels in
    the fixture, and this is what stops it going stale: change
    `staff_space_px`, and the numbers the app is being judged against change
    with it or this goes red.
    """
    image_bytes = (REPO / page["source"]).read_bytes()

    assert staff_space_px(image_bytes) == page["server_staff_space_px"]
    assert (too_small_to_read(image_bytes) is not None) == page["server_refuses"]


def test_the_fixture_lists_every_sample_file_it_ships() -> None:
    """No orphans in either direction.

    A samples file with no entry is dead weight nothing reads; an entry with no
    file fails on load. The first is the one worth a test, because it is the
    one that stays quiet.
    """
    on_disk = {path.name for path in FIXTURES.glob("*.samples.json")}
    listed = {page["samples"] for page in PAGES}

    assert on_disk == listed


def test_the_pages_are_not_all_one_answer() -> None:
    """A fixture set the server accepts wholesale proves nothing about refusing.

    The rule is one-directional — the app may warn about a page the server
    refuses, and may not about one it reads — so a set with only accepted pages
    would let a check that never speaks pass, and a set with only refused ones
    would let a check that always does.
    """
    refused = [page["server_refuses"] for page in PAGES]

    assert any(refused)
    assert not all(refused)
