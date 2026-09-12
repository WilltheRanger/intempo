"""Which fields a person supplies and OCR overwrites, discovered rather than listed.

`_MANUAL_FIELDS` names them once and two behaviours read it:

  * **Rejection.** `CreateScoreRequest._one_provenance` refuses any of them
    alongside an image. Its own comment says why — *"overwriting what OCR read
    with what they guessed is the worse outcome"* — and the refusal is what
    makes the two provenances exclusive rather than merged.
  * **Preservation.** `attach_score_pages` copies them into the placeholder
    score while the worker reads, so a hand-entered piece that is later
    photographed does not lose its tempo from Today for the length of the scan.

The second used to be **the same three names typed again**, which is the shape
this repository has now paid for four times: `REQUIRED_COLUMNS`,
`_FAILURE_REASONS`, the column vocabularies and `_HUMAN_STAGES`. It reads the
constant now, so the two behaviours cannot drift from each other.

What is still hand-written is the constant against **the model**, and that is
what this file holds. A field added to `CreateScoreRequest` and not to
`_MANUAL_FIELDS` is accepted beside an `image_url` and then quietly overwritten
by the reading — a musician's stated answer replaced by a guessed one, with a
201 and no complaint anywhere.

Discovered from `model_fields`, so the *new* field is the one that fails.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.routers.scores import _MANUAL_FIELDS, CreateScoreRequest

#: Fields that mean the same thing whichever way the piece arrived, with why.
#:
#: Checked in both directions, the way `NOT_WIRED` is: an entry for a field the
#: model no longer has fails, and so does one that has since become manual-only.
BOTH_PROVENANCES: dict[str, str] = {
    "title": "A person names the piece however it arrived. OCR does not read it.",
    "composer": "As above — a name off the top of the page is not what this is.",
    "movement": "As above.",
    "image_url": "The provenance itself, not a field about the music.",
    "image_urls": "The multi-page form of the same.",
}

#: A page reference that passes the model's own length rules.
A_PAGE = "scores/11111111-1111-1111-1111-111111111111/page.jpg"

#: One valid value per manual field, so the refusal can be provoked field by
#: field. Read from the model would be nicer and is not possible: the
#: constraints are types, and a `Clef` is not guessable from `str | None`.
A_VALUE: dict[str, object] = {
    "clef": "treble",
    "time_signature": "4/4",
    "bpm_hint": 60,
}


def test_every_manual_field_has_a_value_to_test_with() -> None:
    """The corpus below is hand-written; this is what stops it going stale.

    A manual field with no entry in `A_VALUE` would silently not be exercised
    by the refusal case, which is the whole point of the file.
    """
    missing = sorted(name for name in _MANUAL_FIELDS if name not in A_VALUE)

    assert not missing, f"add a valid value for these to A_VALUE: {missing}"


@pytest.mark.parametrize("field", sorted(_MANUAL_FIELDS), ids=sorted(_MANUAL_FIELDS))
def test_a_manual_field_is_refused_beside_a_photograph(field: str) -> None:
    with pytest.raises(ValidationError) as raised:
        CreateScoreRequest(title="Study", image_url=A_PAGE, **{field: A_VALUE[field]})

    # The message names the field, because a caller sending three of them
    # should be told which three rather than which one.
    assert field in str(raised.value)


def test_every_field_the_model_has_is_manual_or_excused() -> None:
    """The discovery half.

    A field added to `CreateScoreRequest` is either something OCR reads off the
    page — in which case it belongs in `_MANUAL_FIELDS`, or a caller can send
    their guess beside a photograph and have it overwritten without a word — or
    it means the same thing either way and belongs in `BOTH_PROVENANCES` with
    a reason.
    """
    unclassified = sorted(
        name
        for name in CreateScoreRequest.model_fields
        if name not in _MANUAL_FIELDS and name not in BOTH_PROVENANCES
    )

    assert not unclassified, (
        "these are neither refused beside a photograph nor excused as meaning "
        "the same thing either way. Add them to `_MANUAL_FIELDS` if OCR reads "
        f"them off the page, or to `BOTH_PROVENANCES` with a reason: {unclassified}"
    )


def test_no_excuse_outlives_its_field() -> None:
    """The other direction. A reason kept for a field the model no longer has
    reads as live coverage of nothing — which is what
    `fixtures/timeline/parity.json`'s exclusion list was."""
    gone = sorted(
        name for name in BOTH_PROVENANCES if name not in CreateScoreRequest.model_fields
    )
    both = sorted(name for name in BOTH_PROVENANCES if name in _MANUAL_FIELDS)

    assert not gone, f"CreateScoreRequest has no such fields any more: {gone}"
    assert not both, f"these are excused and also manual-only: {both}"


def test_no_manual_field_has_left_the_model() -> None:
    """And the third direction, which is the one that fails quietly.

    A name in `_MANUAL_FIELDS` that the model has dropped makes
    `_one_provenance`'s `getattr` raise on **every** create — but the constant
    is also read by `attach_score_pages`, where a stale name writes a key into
    the placeholder score that `ScoreJson` does not have.
    """
    gone = sorted(
        name for name in _MANUAL_FIELDS if name not in CreateScoreRequest.model_fields
    )

    assert not gone, f"CreateScoreRequest has no such fields any more: {gone}"
