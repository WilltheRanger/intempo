"""JERA-563: run the real `analyze()` over every take a dataset contributes,
and score each one against its ground truth.

`report.py` turns a list of `TakeResult` into the markdown/JSON the issue
asks for; `run_gate.py` is the fast subset `tools/preflight.py` runs on every
push. Neither of them calls `analyze()` directly — this module is the only
one that does, so there is one place that decides what "scored" means.

Two ground-truth shapes are handled, picked by `ground_truth["kind"]`:

- `"synthetic_v1"` — `synthetic_takes.build_ground_truth`'s own schema
  (`SCHEMA.md`): every expected note's `global_index`, what was actually
  played there, and the injected-error labels. Everything in the issue's
  metric list can be scored against it, because the generator recorded
  exactly what it did.
- `"urmp_v1"` — `datasets/urmp.py`'s shape: a flat, unindexed list of
  manually-corrected performed notes (onset, Hz, duration) with no
  per-note correspondence to this pipeline's own written-score alignment.
  A real player does not attack notes at the written score's global
  indices, so onset accuracy is scored by *time* against the independent
  labels (exactly the comparison Lens's JERA-560 research recommends),
  and the rest of `AnalysisResult` is read as a real pipeline run rather
  than matched note-by-note.
"""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import tomllib

ROOT = Path(__file__).resolve().parents[2]
_EVAL = Path(__file__).resolve().parent
_BACKEND = ROOT / "backend"
for _p in (_EVAL, _BACKEND):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from app.services.analysis import AnalysisResult, analyze
from app.services.classification import Direction
from datasets.base import Dataset, Take
from metrics import (
    PRF1,
    alignment_accuracy,
    match_onsets_by_time,
    mean_absolute_error,
    pct_within,
    precision_recall_f1,
)

log = logging.getLogger("intempo.eval")

CONFIG_PATH = _EVAL / "eval_config.toml"


def load_eval_config() -> dict[str, Any]:
    return tomllib.loads(CONFIG_PATH.read_text())


@dataclass
class TakeResult:
    """One take's scored outcome — the report's and the gate's only input."""

    take_id: str
    dataset: str
    instrument: str
    error_type: str
    accompaniment_level: str
    target_bpm: float
    status: str
    verdict: str
    #: The take should have produced a judgeable result (every take this
    #: harness builds should) and did not.
    refused: bool
    onset: PRF1 | None = None
    alignment_accuracy: float | None = None
    timing_mae_ms: float | None = None
    #: Only set on a take with a ground-truth tempo error (`tempo_drift` /
    #: `timing_offset`) or a clean take — the two cases "did the verdict's
    #: rush/drag direction agree with the injected error" has an answer for.
    verdict_agrees: bool | None = None
    intonation_mae_cents: float | None = None
    intonation_pct_within_tight: float | None = None
    intonation_pct_within_loose: float | None = None
    wrong_note: PRF1 | None = None
    missed_note: PRF1 | None = None
    #: True only for a *clean* take (no injected timing/tempo error):
    #: whether the verdict wrongly called it rushed or dragged.
    false_rush_drag: bool | None = None


def run_datasets(
    datasets: list[Dataset], config: dict[str, Any] | None = None
) -> list[TakeResult]:
    cfg = config or load_eval_config()
    results: list[TakeResult] = []
    for dataset in datasets:
        takes = dataset.load()
        log.info("eval: %s contributed %d take(s)", dataset.name, len(takes))
        for take in takes:
            try:
                results.append(score_take(dataset.name, take, cfg))
            except Exception:
                log.exception("eval: failed to score %s", take.take_id)
    return results


def score_take(dataset_name: str, take: Take, config: dict[str, Any]) -> TakeResult:
    trace: dict[str, Any] = {}
    result = analyze(
        take.audio, take.score, take.target_bpm, instrument=take.instrument, trace=trace
    )
    kind = take.ground_truth.get("kind", "synthetic_v1")
    base = TakeResult(
        take_id=take.take_id,
        dataset=dataset_name,
        instrument=take.instrument,
        error_type=take.error_type,
        accompaniment_level=take.accompaniment_level,
        target_bpm=take.target_bpm,
        status=result.status,
        verdict=result.verdict,
        refused=result.status != "ok",
    )
    if kind == "urmp_v1":
        _score_urmp(base, take, result, trace, config)
    else:
        _score_synthetic(base, take, result, trace, config)
    return base


def _onset_metrics(
    expected_s: list[float], detected_s: list[float], config: dict[str, Any]
) -> PRF1:
    tolerance_s = float(config["onset"]["tolerance_ms"]) / 1000.0
    matched, fp, fn = match_onsets_by_time(expected_s, detected_s, tolerance_s)
    return precision_recall_f1(true_positives=matched, false_positives=fp, false_negatives=fn)


def _score_synthetic(
    base: TakeResult,
    take: Take,
    result: AnalysisResult,
    trace: dict[str, Any],
    config: dict[str, Any],
) -> None:
    gt = take.ground_truth
    notes = gt["notes"]

    expected_s = [n["expected_onset_s"] for n in notes]
    detected_s = trace.get("detected_s", [])
    base.onset = _onset_metrics(expected_s, detected_s, config)

    matched_indices = {d.global_index for d in result.per_note}
    missed_in_gt = {n["global_index"] for n in notes if "missed_note" in n["error_labels"]}
    correctly_aligned = sum(
        1
        for n in notes
        if (n["global_index"] in missed_in_gt) == (n["global_index"] not in matched_indices)
    )
    base.alignment_accuracy = alignment_accuracy(correctly_aligned, len(notes))

    timed_deltas = [d.delta_ms for d in result.per_note if d.timed]
    base.timing_mae_ms = mean_absolute_error(timed_deltas)

    base.missed_note = _missed_note_prf1(notes, matched_indices)
    base.wrong_note = _wrong_note_prf1(gt, result)

    cents_errors = _intonation_errors(notes, result)
    base.intonation_mae_cents = mean_absolute_error(cents_errors)
    tight = float(config["intonation"]["tight_cents"])
    loose = float(config["intonation"]["loose_cents"])
    base.intonation_pct_within_tight = pct_within(cents_errors, tight)
    base.intonation_pct_within_loose = pct_within(cents_errors, loose)

    has_tempo_error = any(
        e["type"] in ("timing_offset", "tempo_drift") for e in gt["injected_errors"]
    )
    expected_direction = _expected_direction(gt["injected_errors"])
    if expected_direction is not None:
        base.verdict_agrees = result.verdict_direction == expected_direction
    if not has_tempo_error:
        base.false_rush_drag = result.verdict_direction != Direction.on


def _missed_note_prf1(notes: list[dict[str, Any]], matched_indices: set[int]) -> PRF1:
    tp = fp = fn = 0
    for note in notes:
        gt_missed = "missed_note" in note["error_labels"]
        detected_missed = note["global_index"] not in matched_indices
        if gt_missed and detected_missed:
            tp += 1
        elif detected_missed and not gt_missed:
            fp += 1
        elif gt_missed and not detected_missed:
            fn += 1
    return precision_recall_f1(true_positives=tp, false_positives=fp, false_negatives=fn)


def _wrong_note_prf1(gt: dict[str, Any], result: AnalysisResult) -> PRF1:
    """Matched by measure number alone (`WrongNoteOut` carries no
    `global_index`) — exact for every scenario this harness builds today,
    since none injects two wrong notes in the same measure."""
    injected = {n["measure_number"] for n in gt["notes"] if "wrong_note" in n["error_labels"]}
    detected = {w.measure_number for w in result.wrong_notes}
    tp = len(injected & detected)
    fp = len(detected - injected)
    fn = len(injected - detected)
    return precision_recall_f1(true_positives=tp, false_positives=fp, false_negatives=fn)


def _intonation_errors(notes: list[dict[str, Any]], result: AnalysisResult) -> list[float]:
    """Ground-truth `cents_offset` against the pipeline's own read of how
    this take sat against its tuning, per written pitch class.

    Approximate by design: `IntonationSummary.by_note` groups every reading
    of a written pitch together, so a note deliberately mistuned once and
    correct everywhere else is diluted by its own clean repeats. Good
    enough for a baseline; a true per-note comparison needs `per_note` to
    carry a pitch deviation, which it does not yet.
    """
    if result.intonation is None:
        return []
    by_pitch = {n.pitch: n.cents for n in result.intonation.by_note}
    errors = []
    for note in notes:
        if note["played_pitch"] is None or not note.get("cents_offset"):
            continue
        measured = by_pitch.get(note["played_pitch"])
        if measured is not None:
            errors.append(measured - note["cents_offset"])
    return errors


def _expected_direction(injected_errors: list[dict[str, Any]]) -> Direction | None:
    """What the verdict's overall direction should be, from the injected
    tempo errors alone — `None` when nothing here has a clear answer
    (a single-note `timing_offset` is too local to move the take's overall
    direction one way or the other)."""
    drifts = [e for e in injected_errors if e["type"] == "tempo_drift"]
    if not drifts:
        return Direction.on if not injected_errors else None
    pct = drifts[0]["pct_per_bar"]
    return Direction.rush if pct > 0 else Direction.drag


def _score_urmp(
    base: TakeResult,
    take: Take,
    result: AnalysisResult,
    trace: dict[str, Any],
    config: dict[str, Any],
) -> None:
    gt = take.ground_truth
    expected_s = [n["onset_s"] for n in gt["performed_notes"]]
    detected_s = trace.get("detected_s", [])
    base.onset = _onset_metrics(expected_s, detected_s, config)

    reference_tuning = gt.get("reference_tuning_cents")
    if reference_tuning is not None and result.intonation is not None:
        base.intonation_mae_cents = abs(result.intonation.tuning_cents - reference_tuning)

    # URMP's players are not playing to a metronome, so a rush/drag verdict
    # here is not compared against a ground-truth direction (see
    # `tools/eval/README.md`): only onset/alignment/intonation are scored.
