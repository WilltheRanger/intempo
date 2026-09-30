"""The server's half of the app's field limits (`mobile/src/lib/fieldLimits.ts`).

The app stops a field taking characters at the length the server would refuse,
because a refused length used to come back as a 422 the app could not put into
words — "Something went wrong at our end" about the musician's own input, on a
save that failed identically every time.

`fieldLimits.test.ts` holds the app to these models. This holds the models to
the app, so a limit changed here fails in this suite, which CI runs whenever
the backend changes — the app's suite runs only when the app does.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from pydantic import BaseModel

from app.models.user import UpdateMeRequest
from app.routers.scores import (
    CreateScoreRequest,
    ImportScoreRequest,
    UpdateScoreRequest,
)
from app.services.score_schema import TempoChange

REPO = Path(__file__).resolve().parents[3]
FIELD_LIMITS_TS = REPO / "mobile" / "src" / "lib" / "fieldLimits.ts"

#: Each app limit, and every request field it guards.
GUARDED: dict[str, list[tuple[type[BaseModel], str]]] = {
    "displayName": [(UpdateMeRequest, "display_name")],
    "pieceTitle": [
        (CreateScoreRequest, "title"),
        (ImportScoreRequest, "title"),
        (UpdateScoreRequest, "title"),
    ],
    "composer": [
        (CreateScoreRequest, "composer"),
        (ImportScoreRequest, "composer"),
        (UpdateScoreRequest, "composer"),
    ],
    "movement": [
        (CreateScoreRequest, "movement"),
        (ImportScoreRequest, "movement"),
        (UpdateScoreRequest, "movement"),
    ],
    "timeSignature": [(CreateScoreRequest, "time_signature")],
    "printedTempo": [(TempoChange, "text")],
}


def _app_limits() -> dict[str, int]:
    source = FIELD_LIMITS_TS.read_text()
    return {
        name: int(value)
        for name, value in re.findall(r"^\s*(\w+): (\d+),$", source, re.M)
    }


def _max_length(model: type[BaseModel], field: str) -> int | None:
    # Pydantic keeps `Field(max_length=...)` as a constraint object in the
    # field's metadata; read it by name rather than importing its type, which
    # belongs to a dependency of pydantic's and not of this project.
    for constraint in model.model_fields[field].metadata:
        limit = getattr(constraint, "max_length", None)
        if limit is not None:
            return int(limit)
    return None


def test_the_app_limits_every_field_this_file_knows_and_no_other() -> None:
    assert set(_app_limits()) == set(GUARDED)


@pytest.mark.parametrize("name", sorted(GUARDED))
def test_each_request_field_refuses_exactly_where_the_app_stops(name: str) -> None:
    app_limit = _app_limits()[name]
    for model, field in GUARDED[name]:
        assert _max_length(model, field) == app_limit, (
            f"{model.__name__}.{field} no longer agrees with fieldLimits.ts {name} = {app_limit}"
        )
