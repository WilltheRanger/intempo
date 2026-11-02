"""The harness's always-available dataset: synthetic takes rendered from
`synthetic_takes.py` over the two score fixtures this tool has
(`fixtures/eval/tiny_phrase.json`, `fixtures/scores/orchestral_part.json`),
each at `synth_audio.render_take_to_array`'s plain-tone resolution.

Deliberately varied rather than minimal: one scenario per error type
`synthetic_takes.ErrorType` names, plus a couple of clean takes and one
mixed-error take, so a harness run always exercises every metric in
`metrics.py` without needing any real recording. `datasets/urmp.py` is the
dataset that checks the pipeline against audio nobody here engineered; this
one checks that the harness's own grading arithmetic, and the pipeline's
response to a *known* mistake, are both doing what they claim to.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from synth_audio import render_take_to_array
from synthetic_takes import (
    ExtraNote,
    IntonationOffset,
    MissedNote,
    Restart,
    TakeConfig,
    TempoDrift,
    TimingOffset,
    WrongNote,
    build_ground_truth,
)

from .base import Take

_TINY = ROOT / "fixtures" / "eval" / "tiny_phrase.json"
_ORCHESTRAL = ROOT / "fixtures" / "scores" / "orchestral_part.json"

#: `(take_id, score_path, config, error_type, accompaniment_level)`. Every
#: `error_type` here is one `synthetic_takes.ErrorType` name, except
#: "clean", which is this harness's own label (`eval_config.toml`'s
#: `[verdict] clean_rush_drag_bands`) for a take with no injected error.
_SCENARIOS: list[tuple[str, Path, TakeConfig, str, str]] = [
    ("clean_tiny", _TINY, TakeConfig(target_bpm=90.0), "clean", "none"),
    ("clean_orchestral", _ORCHESTRAL, TakeConfig(target_bpm=96.0), "clean", "none"),
    (
        "timing_offset_tiny",
        _TINY,
        TakeConfig(target_bpm=90.0, errors=[TimingOffset(global_index=4, ms=70)]),
        "timing_offset",
        "none",
    ),
    (
        "tempo_drift_rush_orchestral",
        _ORCHESTRAL,
        TakeConfig(target_bpm=96.0, errors=[TempoDrift(from_measure=5, pct_per_bar=3.0)]),
        "tempo_drift",
        "none",
    ),
    (
        "tempo_drift_drag_orchestral",
        _ORCHESTRAL,
        TakeConfig(target_bpm=96.0, errors=[TempoDrift(from_measure=5, pct_per_bar=-3.0)]),
        "tempo_drift",
        "none",
    ),
    (
        "intonation_sharp_tiny",
        _TINY,
        TakeConfig(target_bpm=90.0, errors=[IntonationOffset(global_index=2, cents=35)]),
        "intonation_offset",
        "none",
    ),
    (
        "intonation_flat_orchestral",
        _ORCHESTRAL,
        TakeConfig(target_bpm=96.0, errors=[IntonationOffset(measure_number=8, cents=-25)]),
        "intonation_offset",
        "none",
    ),
    (
        "wrong_note_tiny",
        _TINY,
        TakeConfig(target_bpm=90.0, errors=[WrongNote(global_index=1, heard="D5")]),
        "wrong_note",
        "none",
    ),
    (
        "missed_note_orchestral",
        _ORCHESTRAL,
        TakeConfig(target_bpm=96.0, errors=[MissedNote(global_index=20)]),
        "missed_note",
        "none",
    ),
    (
        "extra_note_tiny",
        _TINY,
        TakeConfig(target_bpm=90.0, errors=[ExtraNote(after_global_index=5, pitch="A4")]),
        "extra_note",
        "none",
    ),
    (
        "restart_orchestral",
        _ORCHESTRAL,
        TakeConfig(target_bpm=96.0, errors=[Restart(at_global_index=30)]),
        "restart",
        "none",
    ),
    (
        "mixed_orchestral",
        _ORCHESTRAL,
        TakeConfig(
            target_bpm=96.0,
            errors=[
                TimingOffset(global_index=10, ms=60),
                IntonationOffset(global_index=25, cents=-30),
                WrongNote(global_index=40, heard="C4"),
            ],
        ),
        "mixed",
        "none",
    ),
]


class SyntheticDataset:
    name = "synthetic"

    def load(self) -> list[Take]:
        takes: list[Take] = []
        for take_id, score_path, config, error_type, accompaniment_level in _SCENARIOS:
            ground_truth = build_ground_truth(score_path, config)
            audio = render_take_to_array(ground_truth)
            score = _score_json(score_path)
            takes.append(
                Take(
                    take_id=f"synthetic/{take_id}",
                    audio=audio,
                    score=score,
                    target_bpm=config.target_bpm,
                    instrument=config.instrument,
                    ground_truth=ground_truth,
                    error_type=error_type,
                    accompaniment_level=accompaniment_level,
                    meta={"source_score": str(score_path)},
                )
            )
        return takes


def _score_json(score_path: Path):
    import json

    from app.services.score_schema import ScoreJson

    payload = json.loads(score_path.read_text())
    return ScoreJson.model_validate(payload["score"])
