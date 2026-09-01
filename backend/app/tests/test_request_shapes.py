"""What the app sends, against what the API will accept.

Every request model in `routers/scores.py` and `routers/analyses.py` is
`extra="forbid"`. That is the right setting — a body with a field nobody reads
is a caller believing something that is not true — but it makes the app's
TypeScript request types a **contract**, not a convenience: one field the API
does not declare and the request is a flat 422.

The failures are lopsided. A field the app sends that the API refuses is a 422
on the one request a musician makes after photographing a page or finishing a
take, and the message names a field rather than a fix. A field the API
*requires* that the app has no way to send is the same 422 for a different
reason. Neither is visible from either side alone: the app compiles, the API
starts, and the two only meet over the wire.

Read out of the TypeScript by name. That file is what every screen is compiled
against, so it is the honest thing to compare.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from pydantic import BaseModel

from app.routers.analyses import CreateAnalysisRequest
from app.routers.scores import (
    AttachScorePagesRequest,
    CreateScoreRequest,
    ImportScoreRequest,
    UpdateScoreRequest,
)

MOBILE = Path(__file__).resolve().parents[3] / "mobile" / "src" / "data" / "api"


def _interface(path: Path, name: str) -> dict[str, bool]:
    """Field name -> whether it is required, from `export interface <name>`."""
    source = path.read_text()
    match = re.search(rf"export interface {name}\s*\{{(.*?)\n\}}", source, re.DOTALL)
    assert match, f"{path.name} no longer declares {name}"

    fields: dict[str, bool] = {}
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith(("//", "*", "/*")):
            continue
        declared = re.match(r"([A-Za-z_][A-Za-z0-9_]*)(\??)\s*:", line)
        if declared:
            fields[declared.group(1)] = declared.group(2) != "?"
    return fields


def _model_fields(model: type[BaseModel]) -> tuple[set[str], set[str]]:
    """(every field, the required ones)."""
    every = set(model.model_fields)
    required = {n for n, f in model.model_fields.items() if f.is_required()}
    return every, required


CASES = [
    # (python model, ts file, ts interfaces that together make one body)
    (CreateScoreRequest, "scores.ts", ["TranscribedScoreInput", "HandEnteredScoreInput"]),
    (AttachScorePagesRequest, "scores.ts", ["AttachScorePagesInput"]),
    (ImportScoreRequest, "scores.ts", ["ImportScoreInput"]),
    (UpdateScoreRequest, "scores.ts", ["UpdateScoreInput"]),
    (CreateAnalysisRequest, "analyses.ts", ["CreateAnalysisInput"]),
]


@pytest.mark.parametrize("model, file, interfaces", CASES, ids=lambda v: getattr(v, "__name__", str(v)))
def test_the_app_sends_nothing_the_api_forbids(
    model: type[BaseModel], file: str, interfaces: list[str]
) -> None:
    """`extra="forbid"` turns an unknown field into a 422, not a no-op."""
    accepted, _ = _model_fields(model)
    sent: set[str] = set()
    for name in interfaces:
        sent |= set(_interface(MOBILE / file, name))

    assert sent <= accepted, (
        f"{model.__name__} forbids extras, and the app sends "
        f"{sorted(sent - accepted)} — every one of those is a 422"
    )


@pytest.mark.parametrize("model, file, interfaces", CASES, ids=lambda v: getattr(v, "__name__", str(v)))
def test_the_app_can_send_everything_the_api_demands(
    model: type[BaseModel], file: str, interfaces: list[str]
) -> None:
    """A required field with nowhere in the client to come from.

    Checked against the union of the interfaces, because a body assembled from
    a union of shapes only has to satisfy the API from *one* of them.
    """
    _, required = _model_fields(model)
    sendable: set[str] = set()
    for name in interfaces:
        sendable |= set(_interface(MOBILE / file, name))

    assert required <= sendable, (
        f"{model.__name__} requires {sorted(required - sendable)}, and the "
        "app's request type has no field for it"
    )


def test_a_required_field_is_required_on_at_least_one_side_of_a_union() -> None:
    """The photograph and hand-entered shapes are separate for a reason.

    `CreateScoreRequest` requires `title` whatever the provenance. If neither
    TypeScript shape made it mandatory, the app would compile a body without
    one and the musician would lose the piece at the last step.
    """
    _, required = _model_fields(CreateScoreRequest)
    shapes = [
        _interface(MOBILE / "scores.ts", "TranscribedScoreInput"),
        _interface(MOBILE / "scores.ts", "HandEnteredScoreInput"),
    ]

    for field in required:
        assert all(shape.get(field) for shape in shapes), (
            f"{field!r} is required by the API but optional in one of the "
            "client's create shapes"
        )


def test_the_reader_notices_an_interface_that_stopped_existing() -> None:
    """Every test above compares two sets, and two empty sets are equal.

    A regex that quietly matched nothing would make this whole file pass while
    checking nothing — the failure it exists to prevent, wearing it as a
    disguise.
    """
    with pytest.raises(AssertionError, match="no longer declares"):
        _interface(MOBILE / "scores.ts", "NoSuchInterface")

    assert len(_interface(MOBILE / "scores.ts", "ImportScoreInput")) >= 4
