"""Reading a Supabase signing response — the three spellings and the two shapes.

This was three `or` chains in three modules that did not agree with each other:
two absolutised a path and one did not, and none of them tried the keys in the
same order. The order does not matter and never did — a response carries one of
them — but three chances to miss a spelling does.
"""

from __future__ import annotations

import pytest

from app.config import settings
from app.services.signed_urls import absolute, signed_url_in


@pytest.mark.parametrize("key", ["signedURL", "signedUrl", "signed_url"])
def test_every_spelling_supabase_uses_is_read(key: str) -> None:
    assert signed_url_in({key: "https://cdn.example/a.jpg?token=t"}) == (
        "https://cdn.example/a.jpg?token=t"
    )


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"error": "not found"},
        {"signedUrl": ""},
        {"path": "u/a.jpg"},
        None,
        "https://cdn.example/a.jpg",
        ["https://cdn.example/a.jpg"],
    ],
)
def test_anything_without_a_url_reads_as_no_url(payload: object) -> None:
    """Including the shapes that are not a mapping at all: an SDK that starts
    returning an object must not become an `AttributeError` inside a batch."""
    assert signed_url_in(payload) is None


def test_the_url_is_returned_as_a_string() -> None:
    """Some SDK versions hand back a URL object rather than a `str`."""

    class _Url:
        def __str__(self) -> str:
            return "https://cdn.example/a.jpg"

    assert signed_url_in({"signedUrl": _Url()}) == "https://cdn.example/a.jpg"


def test_an_absolute_url_is_left_alone() -> None:
    assert absolute("https://cdn.example/a.jpg") == "https://cdn.example/a.jpg"


def test_a_path_is_given_the_project_host() -> None:
    """The other shape Supabase returns for the same call."""
    assert absolute("/object/sign/score-images/u/a.jpg?token=t") == (
        f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1"
        "/object/sign/score-images/u/a.jpg?token=t"
    )
