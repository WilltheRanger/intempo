"""The tempo range, in the four places that have to agree about it.

`target_bpm` is the number the whole verdict is measured against. It was
written out three times in this backend — `Analysis`, `Assignment`,
`CreateAnalysisRequest` — and mirrored a fourth time in
`mobile/src/data/practiceTempo.ts`, whose comment says "the range the backend
accepts, mirrored so the UI can't offer an invalid one". Nothing pointed at
anything else.

They agree today. The two ways they could stop:

- **The app allows more than the API.** A stepper that reaches 310 produces a
  422 on the one request a musician makes after playing, and the message names
  a field rather than a fix.
- **The app allows less.** A tempo the analysis would have handled cannot be
  chosen, and nothing anywhere reports that — it is simply a number the app
  will not go to.

Distinct from `config.toml [calibration] bpm_min/bpm_max`, which is the range
the tempo *detector* searches when nobody has typed a number. Narrower on
purpose, and a different question; the last test here says so, because the two
look alike enough to be "unified" by a well-meaning reader.
"""

from __future__ import annotations

import re
from pathlib import Path

from pydantic import BaseModel

from app.models.analysis import MAX_TARGET_BPM, MIN_TARGET_BPM, Analysis
from app.models.assignment import Assignment
from app.routers.analyses import CreateAnalysisRequest

REPO = Path(__file__).resolve().parents[3]
PRACTICE_TEMPO_TS = REPO / "mobile" / "src" / "data" / "practiceTempo.ts"
#: Where the fallback tempo is *defined*. `practiceTempo` re-exports it: the
#: pure module owns it because anything may import that one, and this file has
#: to read the definition rather than the re-export.
SCHEDULE_TS = REPO / "mobile" / "src" / "lib" / "score" / "schedule.ts"


def _bounds(model: type[BaseModel], field: str) -> tuple[float, float]:
    """The `ge`/`le` pydantic will actually enforce, read off the model."""
    metadata = model.model_fields[field].metadata
    low = next(m.ge for m in metadata if hasattr(m, "ge"))
    high = next(m.le for m in metadata if hasattr(m, "le"))
    return low, high


def test_every_model_enforces_the_one_range() -> None:
    """Read off the built models, not out of the source.

    A `Field(ge=..., le=...)` that imported the constant and then overrode it,
    or a model that never got the edit, is invisible to a grep and obvious
    here.
    """
    for model, field in (
        (Analysis, "target_bpm"),
        (Assignment, "target_bpm"),
        (CreateAnalysisRequest, "target_bpm"),
    ):
        assert _bounds(model, field) == (MIN_TARGET_BPM, MAX_TARGET_BPM), model.__name__


def test_the_app_offers_exactly_what_the_api_accepts() -> None:
    """The fourth copy, in TypeScript.

    Its own comment calls itself a mirror. This is the thing that makes that
    true rather than aspirational.
    """
    source = PRACTICE_TEMPO_TS.read_text()
    found = {
        name: float(value)
        for name, value in re.findall(
            r"export const (MIN_BPM|MAX_BPM)\s*=\s*(-?\d+(?:\.\d+)?)", source
        )
    }

    assert found == {"MIN_BPM": MIN_TARGET_BPM, "MAX_BPM": MAX_TARGET_BPM}, (
        f"the app offers {found} and the API accepts "
        f"{MIN_TARGET_BPM}–{MAX_TARGET_BPM}. Wider means a 422 on the one "
        "request a musician makes after playing; narrower means a tempo the "
        "analysis would have handled cannot be chosen, silently."
    )


def test_the_app_falls_back_inside_the_range() -> None:
    """A piece whose tempo OCR never found still has to start somewhere, and
    that somewhere has to be a tempo the API will take."""
    source = SCHEDULE_TS.read_text()
    match = re.search(r"export const FALLBACK_BPM\s*=\s*(-?\d+(?:\.\d+)?)", source)

    assert match, (
        f"no `export const FALLBACK_BPM = <number>` in {SCHEDULE_TS.name}. It "
        "moved there from `practiceTempo.ts`, which now re-exports it; if it "
        "has moved again, follow it rather than deleting this check — a "
        "fallback outside the API's range is a 422 on the one request a "
        "musician makes after playing."
    )
    assert MIN_TARGET_BPM <= float(match.group(1)) <= MAX_TARGET_BPM


def test_the_detector_searches_inside_what_the_api_accepts() -> None:
    """The calibration range is narrower, and must stay a subset.

    These are different questions — what a musician may *ask* for, and where
    the detector *looks* when nobody asked — which is why they are allowed to
    differ. What they cannot do is have the detector return a tempo the API
    would then refuse.
    """
    from app.services.audio_config import load_audio_config

    calibration = load_audio_config().calibration

    assert MIN_TARGET_BPM <= calibration.bpm_min
    assert calibration.bpm_max <= MAX_TARGET_BPM
    assert calibration.bpm_min < calibration.bpm_max
