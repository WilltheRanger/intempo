"""Loading the tuning corpus, and applying one-parameter overrides to it.

Two jobs, both small. Reading `fixtures/audio/manifest.json` into something the
dashboard can render, and building an `AudioConfig` with a single value
replaced so three candidates can be compared without editing `config.toml`.

The override is deliberately ephemeral — it lives in the URL and nothing here
writes it back. A threshold that survives comparison gets moved into
`config.toml` by hand, with a `TUNING_LOG.md` entry, because that is the record
of *why* it changed and a query string isn't.
"""

from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.services.audio_config import AudioConfig, load_audio_config
from app.services.score_schema import ScoreJson

REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS_DIR = REPO_ROOT / "fixtures" / "audio"
MANIFEST = CORPUS_DIR / "manifest.json"


@dataclass(frozen=True)
class Clip:
    id: str
    label: str
    target_bpm: float
    double_bass: bool
    expect: str
    score: ScoreJson
    path: Path | None
    """Where the audio is, or None when neither a real nor a synthetic file exists."""
    synthetic: bool

    @property
    def available(self) -> bool:
        return self.path is not None


def load_corpus() -> list[Clip]:
    """Every clip in the manifest, real recording preferred over stand-in."""
    if not MANIFEST.exists():
        return []

    manifest = json.loads(MANIFEST.read_text())
    clips: list[Clip] = []

    for entry in manifest.get("clips", []):
        real = CORPUS_DIR / entry["file"]
        synthetic = CORPUS_DIR / f"{entry['id']}.synthetic.wav"

        if real.exists():
            path, is_synthetic = real, False
        elif synthetic.exists():
            path, is_synthetic = synthetic, True
        else:
            path, is_synthetic = None, False

        clips.append(
            Clip(
                id=entry["id"],
                label=entry.get("label", entry["id"]),
                target_bpm=float(entry["target_bpm"]),
                double_bass=bool(entry.get("double_bass", False)),
                expect=entry.get("expect", ""),
                score=ScoreJson.model_validate(entry["score"]),
                path=path,
                synthetic=is_synthetic,
            )
        )
    return clips


# Every value the appendix names as tunable, addressed as "section.field" so a
# URL can carry one. Anything not on this list cannot be overridden — a typo in
# a query string should be an error, not a silently ignored parameter that
# makes you think you tested something you didn't.
TUNABLE: dict[str, type] = {
    "onset.delta": float,
    "onset.pre_max": int,
    "onset.post_max": int,
    "onset.wait_ms": int,
    "onset.pre_emphasis_coef": float,
    "onset.double_bass_delta": float,
    "onset.double_bass_highpass_hz": float,
    "tolerance.rushing_inner_pct": float,
    "tolerance.rushing_mid_pct": float,
    "tolerance.rushing_outer_pct": float,
    "tolerance.dragging_inner_pct": float,
    "tolerance.dragging_mid_pct": float,
    "tolerance.dragging_outer_pct": float,
    "trend.window": int,
    "alignment.warn_quality": float,
    "alignment.broken_quality": float,
    "alignment.sakoe_chiba_band": float,
    "alignment.slur_tolerance_pct": float,
}


class UnknownParameter(ValueError):
    pass


def config_with(overrides: dict[str, str]) -> tuple[AudioConfig, dict[str, Any]]:
    """`config.toml`, with named fields replaced. Returns the config and what changed."""
    cfg = load_audio_config()
    applied: dict[str, Any] = {}

    for key, raw in overrides.items():
        if key not in TUNABLE:
            raise UnknownParameter(key)
        if raw is None or raw == "":
            continue

        section, field = key.split(".", 1)
        value = TUNABLE[key](raw)
        cfg = dataclasses.replace(cfg, **{section: dataclasses.replace(getattr(cfg, section), **{field: value})})
        applied[key] = value

    return cfg, applied


def current_values(cfg: AudioConfig) -> dict[str, Any]:
    """Every tunable's value under this config, for the sidebar."""
    out: dict[str, Any] = {}
    for key in TUNABLE:
        section, field = key.split(".", 1)
        out[key] = getattr(getattr(cfg, section), field)
    return out
