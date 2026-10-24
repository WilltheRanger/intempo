"""Build a small synthetic benchmark set: real pieces x labelled conditions.

JERA-571's deliverable #4: five real public-domain violin pieces (the
JERA-568 reference scores already staged in `intempo-eval-data/scores/`),
each rendered under five conditions — clean, rushed, out-of-tune,
accompanied, phone-mic — with full ground truth next to the audio.

Usage::

    tools/eval/.venv/bin/python tools/eval/build_benchmark_set.py

Writes to `intempo-eval-data/synthetic/<piece-id>/<condition>.{wav,json}` —
**outside this repository** (see `README.md`'s data-rights note); nothing
here ever writes under `tools/eval/` or any other path inside the repo.
Each piece is truncated to its first `MEASURE_CAP` measures so the set
stays "small" in render time and disk, not just in piece count — the
ground truth still carries the real piece's full metadata and licence.

Requires `fluidsynth` on `PATH` and `intempo-eval-data/` checked out next to
this repository; exits with a clear message and does nothing destructive if
either is missing.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

_TOOLS_EVAL = Path(__file__).resolve().parent
_BACKEND = _TOOLS_EVAL.parents[1] / "backend"
for p in (_TOOLS_EVAL, _BACKEND):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from synthetic_takes import (
    Accompaniment,
    Degradation,
    IntonationOffset,
    TakeConfig,
    TempoDrift,
    _load_score,
    build_ground_truth,
    render_take,
)

MEASURE_CAP = 24

#: The five JERA-568 reference pieces this benchmark covers — all IMSLP
#: public-domain works, MusicXML from Mutopia Project CC-BY-SA engravings
#: (ed. Andrew Buck); full provenance in
#: `intempo-eval-data/scores/INDEX.csv`.
PIECES = [
    {"id": "tUKPPRN-Y00", "name": "Paganini Caprice Op. 1 No. 1 in E major", "bpm": 100},
    {"id": "G01Y2DRCkYE", "name": "Paganini Caprice Op. 1 No. 2 in B minor", "bpm": 88},
    {"id": "cEHZC_Y3pYY", "name": "Paganini Caprice Op. 1 No. 3 in E minor", "bpm": 92},
    {"id": "CivvhZ0FN4c", "name": "Paganini Caprice Op. 1 No. 23 in E-flat major", "bpm": 84},
    {"id": "uALsg4aWKB0", "name": "Paganini Caprice Op. 1 No. 24 in A minor (theme)", "bpm": 110},
]

_EVAL_DATA = Path(__file__).resolve().parents[3] / "intempo-eval-data"
_SCORES_DIR = _EVAL_DATA / "scores"
_OUT_DIR = _EVAL_DATA / "synthetic"


def _condition_configs(bpm: float) -> dict[str, TakeConfig]:
    return {
        "clean": TakeConfig(target_bpm=bpm),
        "rushed": TakeConfig(target_bpm=bpm, errors=[TempoDrift(from_measure=2, pct_per_bar=2.5)]),
        "out_of_tune": TakeConfig(target_bpm=bpm, errors=[IntonationOffset(measure_number=1, cents=30)]),
        "accompanied": TakeConfig(
            target_bpm=bpm, errors=[Accompaniment(track="piano", level_db=-12.0)]
        ),
        "phone": TakeConfig(
            target_bpm=bpm,
            errors=[
                Degradation(
                    profile="phone_mic_room",
                    band_low_hz=300.0,
                    band_high_hz=3400.0,
                    noise_snr_db=18.0,
                    reverb_wet=0.18,
                    reverb_decay_s=0.3,
                    compression_ratio=4.0,
                    compression_threshold_db=-16.0,
                    seed=hash(("phone", bpm)) % (2**31),
                )
            ],
        ),
    }


def build_all() -> None:
    if shutil.which("fluidsynth") is None:
        print("fluidsynth not on PATH — nothing rendered.", file=sys.stderr)
        return
    if not _SCORES_DIR.exists():
        print(f"{_SCORES_DIR} not found — nothing rendered.", file=sys.stderr)
        return

    _OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, str]] = []

    for piece in PIECES:
        xml_path = _SCORES_DIR / piece["id"] / "reference.musicxml"
        if not xml_path.exists():
            print(f"skipping {piece['id']}: {xml_path} not found", file=sys.stderr)
            continue

        score = _load_score(xml_path)
        truncated = score.model_copy(update={"measures": score.measures[:MEASURE_CAP]})
        truncated_path = _OUT_DIR / f"_truncated_{piece['id']}.musicxml.json"
        truncated_path.write_text(json.dumps({"score": truncated.model_dump(mode="json")}))

        piece_dir = _OUT_DIR / piece["id"]
        piece_dir.mkdir(parents=True, exist_ok=True)

        for condition, config in _condition_configs(piece["bpm"]).items():
            out_wav = piece_dir / f"{condition}.wav"
            ok = render_take(truncated_path, config, out_wav)
            if not ok:
                print(f"skipping {piece['id']}/{condition}: render_take returned False", file=sys.stderr)
                continue
            ground_truth = build_ground_truth(truncated_path, config)
            ground_truth["piece_name"] = piece["name"]
            ground_truth["piece_id"] = piece["id"]
            ground_truth["condition"] = condition
            ground_truth["measure_cap"] = MEASURE_CAP
            ground_truth["source_score"] = str(xml_path)  # the real file, not the scratch truncation
            (piece_dir / f"{condition}.json").write_text(json.dumps(ground_truth, indent=2))
            out_wav.with_suffix(".mid").unlink(missing_ok=True)
            manifest.append(
                {
                    "piece_id": piece["id"],
                    "piece_name": piece["name"],
                    "condition": condition,
                    "wav": str(out_wav.relative_to(_EVAL_DATA)),
                    "ground_truth": str((piece_dir / f"{condition}.json").relative_to(_EVAL_DATA)),
                }
            )
            print(f"rendered {piece['id']}/{condition}.wav")

        truncated_path.unlink(missing_ok=True)

    (_OUT_DIR / "MANIFEST.json").write_text(json.dumps(manifest, indent=2))
    print(f"\n{len(manifest)} takes written under {_OUT_DIR}")


if __name__ == "__main__":
    build_all()
