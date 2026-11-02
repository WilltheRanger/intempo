"""The loader interface `harness.py` runs against.

A `Take` is one labelled recording: audio `analyze()` can run on, the score
it was played against, and the ground truth to grade the result by — the
same shape `synthetic_takes.build_ground_truth` produces, per
`tools/eval/SCHEMA.md`. A `Dataset` is anything that can hand back a list
of these; `datasets/synthetic.py` renders them in-process from
`synthetic_takes`, `datasets/urmp.py` reads them off disk. `harness.py`
only ever talks to this interface, so adding a third real dataset is a
third module here, not a change to the harness.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import numpy as np

_BACKEND = Path(__file__).resolve().parents[3] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services.score_schema import ScoreJson


@dataclass
class Take:
    #: A short, stable identifier used in the report's per-take breakdown.
    take_id: str
    #: Decoded mono audio and its sample rate — what `analyze()` accepts
    #: directly, so no dataset has to write a temp file.
    audio: tuple[np.ndarray, int]
    score: ScoreJson
    target_bpm: float
    instrument: str
    #: The take's ground truth, in the `SCHEMA.md` shape (`notes`,
    #: `extra_notes`, `injected_errors`, ...).
    ground_truth: dict[str, Any]
    #: Breakdown dimensions the report groups by, beyond instrument/tempo
    #: (which come from the fields above): the dominant injected error type
    #: ("clean" when there is none) and how much accompaniment was mixed in.
    error_type: str = "clean"
    accompaniment_level: str = "none"
    #: Free-form provenance, e.g. source piece/file for a real dataset.
    meta: dict[str, Any] = field(default_factory=dict)


class Dataset(Protocol):
    name: str

    def load(self) -> list[Take]:
        """Return every take this dataset contributes to a harness run."""
        ...
