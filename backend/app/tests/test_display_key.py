"""The pairing between a page and its display copy.

One rule, and it is load-bearing for **row-level security** rather than for
looks: migration 016 gives `score-images` four owner-scoped policies of the
form `foldername[1] = auth.uid()`, so a key whose first path segment is not the
owner's id is a key that account can neither read, write nor delete. A
derivative under a `display/` prefix — the obvious shape — would be exactly
that: written by the service role, invisible to its owner, and undeletable by
every path in `routers/scores.py`.
"""

from __future__ import annotations

import pytest

from app.services.page_image import (
    DISPLAY_SUFFIX,
    display_key_for,
    is_display_key,
)

USER = "11111111-1111-1111-1111-111111111111"


@pytest.mark.parametrize(
    "key",
    [
        f"{USER}/abc.jpg",
        f"{USER}/abc.heic",
        f"{USER}/abc.PNG",
        f"{USER}/no-extension",
        f"{USER}/dotted.name.jpg",
    ],
)
def test_the_owner_stays_the_first_path_segment(key: str) -> None:
    """The RLS property, asserted directly. Breaking it does not fail loudly —
    it produces an object the owner cannot delete."""
    assert display_key_for(key).split("/")[0] == key.split("/")[0]


def test_a_derivative_is_recognisable_as_one() -> None:
    assert is_display_key(display_key_for(f"{USER}/abc.heic"))
    assert not is_display_key(f"{USER}/abc.heic")
    assert not is_display_key(f"{USER}/abc.jpg")


def test_pairing_a_derivative_again_is_a_no_op() -> None:
    """Otherwise a caller holding a derivative mints `<id>.display.display.jpg`
    — a key nothing looks for and nothing deletes."""
    once = display_key_for(f"{USER}/abc.heic")

    assert display_key_for(once) == once
    assert once.count(DISPLAY_SUFFIX) == 1


def test_every_source_format_lands_on_jpeg() -> None:
    """`prepare_for_model` always emits JPEG on success and the derivative is
    exactly what it emitted, so the extension is not a guess about the input."""
    for key in (f"{USER}/a.heic", f"{USER}/a.png", f"{USER}/a"):
        assert display_key_for(key).endswith(".jpg")


def test_the_source_extension_is_dropped_and_that_is_safe() -> None:
    """`a.jpg` and `a.heic` **do** map to one derivative, and that can never
    bite: `_build_object_key` in `routers/upload.py` names every page
    `<user_id>/<uuid4>.<ext>`, so two uploads never share a stem and a
    collision has no way to arise. Written down because the mapping is
    many-to-one and that looks like a bug until you know where the stems come
    from — the alternative, keeping the source extension, would give the same
    photograph two derivative keys if it were ever re-uploaded as another
    format, which is the direction that actually strands objects."""
    assert display_key_for(f"{USER}/a.jpg") == display_key_for(f"{USER}/a.heic")
    assert display_key_for(f"{USER}/b.jpg") != display_key_for(f"{USER}/a.jpg")


def test_a_copy_that_is_not_smaller_is_not_stored(monkeypatch) -> None:
    """Measured before this guard existed: this repository's own page fixtures
    are 1200px wide, under `MODEL_MAX_EDGE`, so `prepare_for_model` does not
    resize them — it only re-encodes, and every one came out 4-5% *larger*.
    Storing those would pay for storage in order to serve more bytes.

    At the size a phone camera actually produces — 5712x4284 — the same
    function gives 1568x1176 and about an eighth of the bytes, which is the
    case this whole change is for.
    """
    from app.services import page_image

    calls: list[str] = []
    monkeypatch.setattr(
        page_image,
        "get_service_client",
        lambda: (_ for _ in ()).throw(AssertionError("storage must not be touched")),
    )

    assert page_image.store_display_copy(f"{USER}/a.jpg", b"x" * 100, b"y" * 100) is False
    assert page_image.store_display_copy(f"{USER}/a.jpg", b"x" * 101, b"y" * 100) is False
    assert calls == []
