"""Turn a list of `harness.TakeResult` into the markdown + JSON report
JERA-563 asks for, broken down by instrument, error type, tempo and
accompaniment level.

Every aggregate here is a **macro average**: the mean of each take's own
ratio, not a pooled count across takes. That is the honest choice for a
breakdown this small (synthetic takes are hand-curated scenarios, not a
random sample) — a pooled average would let the one scenario with the most
notes dominate every bucket it is in, while this means of means does not.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from harness import TakeResult


def _mean(values: list[float]) -> float | None:
    present = [v for v in values if v is not None]
    if not present:
        return None
    return sum(present) / len(present)


def _rate(values: list[bool | None]) -> float | None:
    present = [v for v in values if v is not None]
    if not present:
        return None
    return sum(1 for v in present if v) / len(present)


def _aggregate(results: list[TakeResult]) -> dict[str, Any]:
    if not results:
        return {"n_takes": 0}
    return {
        "n_takes": len(results),
        "refusal_rate": _rate([r.refused for r in results]),
        "onset_precision": _mean([r.onset.precision for r in results if r.onset]),
        "onset_recall": _mean([r.onset.recall for r in results if r.onset]),
        "onset_f1": _mean([r.onset.f1 for r in results if r.onset]),
        "alignment_accuracy": _mean([r.alignment_accuracy for r in results]),
        "timing_mae_ms": _mean([r.timing_mae_ms for r in results]),
        "verdict_agreement_rate": _rate([r.verdict_agrees for r in results]),
        "false_rush_drag_rate": _rate([r.false_rush_drag for r in results]),
        "intonation_mae_cents": _mean([r.intonation_mae_cents for r in results]),
        "intonation_pct_within_tight": _mean(
            [r.intonation_pct_within_tight for r in results]
        ),
        "intonation_pct_within_loose": _mean(
            [r.intonation_pct_within_loose for r in results]
        ),
        "wrong_note_precision": _mean([r.wrong_note.precision for r in results if r.wrong_note]),
        "wrong_note_recall": _mean([r.wrong_note.recall for r in results if r.wrong_note]),
        "missed_note_precision": _mean(
            [r.missed_note.precision for r in results if r.missed_note]
        ),
        "missed_note_recall": _mean([r.missed_note.recall for r in results if r.missed_note]),
    }


def _tempo_bucket(bpm: float) -> str:
    if bpm < 80:
        return "<80"
    if bpm < 110:
        return "80-109"
    if bpm < 140:
        return "110-139"
    return "140+"


def _group_by(results: list[TakeResult], key: Any) -> dict[str, dict[str, Any]]:
    groups: dict[str, list[TakeResult]] = {}
    for r in results:
        groups.setdefault(key(r), []).append(r)
    return {name: _aggregate(rows) for name, rows in sorted(groups.items())}


def build_report(results: list[TakeResult]) -> dict[str, Any]:
    datasets: dict[str, int] = {}
    for r in results:
        datasets[r.dataset] = datasets.get(r.dataset, 0) + 1
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_takes": len(results),
        "datasets": datasets,
        "overall": _aggregate(results),
        "by_dataset": _group_by(results, lambda r: r.dataset),
        "by_instrument": _group_by(results, lambda r: r.instrument),
        "by_error_type": _group_by(results, lambda r: r.error_type),
        "by_tempo_bucket": _group_by(results, lambda r: _tempo_bucket(r.target_bpm)),
        "by_accompaniment_level": _group_by(results, lambda r: r.accompaniment_level),
        "takes": [asdict(r) for r in results],
    }


def _fmt(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value)


_METRIC_ROWS: list[tuple[str, str]] = [
    ("n_takes", "takes"),
    ("refusal_rate", "refusal rate"),
    ("onset_precision", "onset precision"),
    ("onset_recall", "onset recall"),
    ("onset_f1", "onset F1"),
    ("alignment_accuracy", "alignment accuracy"),
    ("timing_mae_ms", "timing MAE (ms)"),
    ("verdict_agreement_rate", "verdict agreement rate"),
    ("false_rush_drag_rate", "false rush/drag rate (clean takes)"),
    ("intonation_mae_cents", "intonation MAE (cents)"),
    ("intonation_pct_within_tight", "intonation within tight band"),
    ("intonation_pct_within_loose", "intonation within loose band"),
    ("wrong_note_precision", "wrong-note precision"),
    ("wrong_note_recall", "wrong-note recall"),
    ("missed_note_precision", "missed-note precision"),
    ("missed_note_recall", "missed-note recall"),
]


def _table(groups: dict[str, dict[str, Any]]) -> list[str]:
    names = list(groups)
    lines = ["| metric | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    for key, label in _METRIC_ROWS:
        row = [_fmt(groups[name].get(key)) for name in names]
        lines.append(f"| {label} | " + " | ".join(row) + " |")
    return lines


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Evaluation harness report (JERA-563)",
        "",
        f"Generated {report['generated_at']}. {report['n_takes']} take(s) across "
        f"{len(report['datasets'])} dataset(s): "
        + ", ".join(f"{name} ({n})" for name, n in report["datasets"].items())
        + ".",
        "",
        "## Overall",
        "",
        *_table({"overall": report["overall"]}),
        "",
    ]
    for section_key, title in [
        ("by_dataset", "By dataset"),
        ("by_instrument", "By instrument"),
        ("by_error_type", "By error type"),
        ("by_tempo_bucket", "By tempo"),
        ("by_accompaniment_level", "By accompaniment level"),
    ]:
        groups = report[section_key]
        if len(groups) <= 1:
            continue
        lines += [f"## {title}", "", *_table(groups), ""]
    return "\n".join(lines)


def write_report(results: list[TakeResult], out_dir: Path) -> tuple[Path, Path]:
    report = build_report(results)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "report.json"
    md_path = out_dir / "report.md"
    json_path.write_text(json.dumps(report, indent=2, default=str))
    md_path.write_text(render_markdown(report))
    return json_path, md_path
