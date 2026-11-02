"""Loads real violin takes from URMP — eval-only, never committed.

See `tools/eval/fetch_urmp.py` for provenance (CC BY 4.0, source URL) and
how `intempo-eval-data/urmp/` gets populated. This module only reads it.

Expects, per piece directory: `Sco_<piece>.mid` (the written score, every
instrument on its own track), and for each violin part, `AuSep_<n>_vn_
<stem>.wav` (the separated audio) and `Notes_<n>_vn_<stem>.txt` (the
manually-corrected ground truth — one row per performed note: onset_s,
f0_hz, duration_s).

Best-effort like every other dataset here: no directory, or a directory
with nothing usable in it, returns no takes rather than raising. A session
without network access, or one that has not yet run `fetch_urmp.py`, still
runs the synthetic suite.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from pathlib import Path

import librosa
import numpy as np

_BACKEND = Path(__file__).resolve().parents[3] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services.score_schema import ScoreJson

from .base import Take
from .midi_score import parse_midi, to_score_json

log = logging.getLogger("intempo.eval")

#: Eval data lives outside the repository — see the program's ground rules:
#: never committed, kept at `intempo-eval-data/`. Overridable so a session
#: whose workspace root differs still finds it.
DATA_ROOT = (
    Path(os.environ.get("INTEMPO_EVAL_DATA", "/paperclip/workspaces/intempo-eval-data"))
    / "urmp"
)

SOURCE_URL = "https://www.ece.rochester.edu/projects/air/projects/URMP.html"
LICENSE = "CC BY 4.0"

_NOTES_RE = re.compile(r"^Notes_(\d+)_vn_")


def _parse_notes_file(path: Path) -> list[dict[str, float]]:
    """`onset_s  f0_hz  duration_s`, tab-separated, one performed note per
    line — URMP's own `Notes_*.txt` format."""
    rows = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        onset_s, hz, duration_s = line.split()
        rows.append(
            {"onset_s": float(onset_s), "hz": float(hz), "duration_s": float(duration_s)}
        )
    return rows


def _reference_tuning(performed_notes: list[dict[str, float]]) -> tuple[float | None, float | None]:
    """Median cents-from-nearest-semitone (tuning) and the typical spread
    around it, read straight off the manually-corrected pitch labels — a
    reference to check `intonation.py`'s own numbers against, computed
    independently of anything it does.
    """
    if not performed_notes:
        return None, None
    offsets = []
    for note in performed_notes:
        semitones_from_a4 = 12.0 * np.log2(note["hz"] / 440.0)
        offsets.append(float((semitones_from_a4 - round(semitones_from_a4)) * 100.0))
    tuning = float(np.median(offsets))
    spread = float(np.median([abs(o - tuning) for o in offsets]))
    return tuning, spread


def _violin_parts(piece_dir: Path) -> list[tuple[int, Path, Path]]:
    """`(instrument_number, AuSep wav, Notes txt)` for every violin part a
    piece folder has — a two-violin duet contributes two."""
    out = []
    for notes_path in sorted(piece_dir.glob("Notes_*_vn_*.txt")):
        m = _NOTES_RE.match(notes_path.name)
        if not m:
            continue
        n = int(m.group(1))
        wavs = list(piece_dir.glob(f"AuSep_{n}_vn_*.wav"))
        if wavs:
            out.append((n, wavs[0], notes_path))
    return out


class UrmpDataset:
    name = "urmp"

    def load(self) -> list[Take]:
        if not DATA_ROOT.is_dir():
            log.info(
                "eval: no URMP data at %s — run tools/eval/fetch_urmp.py first; "
                "skipping this dataset.",
                DATA_ROOT,
            )
            return []

        takes: list[Take] = []
        for piece_dir in sorted(p for p in DATA_ROOT.iterdir() if p.is_dir()):
            sco_paths = list(piece_dir.glob("Sco_*.mid"))
            parts = _violin_parts(piece_dir)
            if not sco_paths or not parts:
                continue
            for instrument_number, wav_path, notes_path in parts:
                try:
                    takes.append(
                        self._load_take(piece_dir, sco_paths[0], wav_path, notes_path, instrument_number)
                    )
                except Exception:
                    log.exception("eval: failed to load URMP take %s", wav_path)
        if not takes:
            log.info("eval: %s has no usable violin takes yet", DATA_ROOT)
        return takes

    def _load_take(
        self,
        piece_dir: Path,
        sco_path: Path,
        wav_path: Path,
        notes_path: Path,
        instrument_number: int,
    ) -> Take:
        parsed = parse_midi(sco_path, note_track=instrument_number)
        score = ScoreJson.model_validate(to_score_json(parsed))
        performed_notes = _parse_notes_file(notes_path)
        tuning_cents, spread_cents = _reference_tuning(performed_notes)

        audio, sr = librosa.load(str(wav_path), sr=None, mono=True)

        return Take(
            take_id=f"urmp/{wav_path.stem}",
            audio=(audio, sr),
            score=score,
            target_bpm=parsed.tempo_bpm,
            instrument="violin",
            ground_truth={
                "kind": "urmp_v1",
                "piece": piece_dir.name,
                "source_url": SOURCE_URL,
                "license": LICENSE,
                "performed_notes": performed_notes,
                "reference_tuning_cents": tuning_cents,
                "reference_spread_cents": spread_cents,
            },
            error_type="clean",
            accompaniment_level="none",
            meta={"source_file": str(wav_path)},
        )
