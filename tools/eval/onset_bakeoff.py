#!/usr/bin/env python3
"""What the flux detector misses, and whether the pitch finds it (JERA-565).

    tools/eval/onset_bakeoff.py
    tools/eval/onset_bakeoff.py --min-semitones 0.8 --steady-frames 4

URMP's `Notes_*.txt` label every performed note's onset by hand, so "which
attacks did `audio.detect_onsets` not report" is answerable here and is not
answerable on the synthetic takes, where every attack is as loud as every
other. The soft bowed attack this is about — a slur, or a détaché in the
middle of a phrase — changes the spectrum's shape and not its energy, which is
the one thing a flux detector cannot see.

Three counts per take, against the labels:

* what the detector reports today (precision/recall at a tolerance);
* which labelled onsets it misses, and of those, how many have a pitch change
  within the tolerance — the **ceiling** on what `pitch_change_times` could
  add, not what adding it would achieve;
* how many pitch changes land nowhere near a labelled onset — what it would
  cost in phantoms if it were used as a detector rather than, as
  `onset_recovery` is used, a second look inside a window the score chose.
  That last number is why this is not wired into the pipeline yet; see
  `TUNING_LOG.md`, 2026-11-02.

Read-only on the pipeline, and nothing is adopted by running it.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np

_EVAL = Path(__file__).resolve().parent
if str(_EVAL) not in sys.path:
    sys.path.insert(0, str(_EVAL))
_BACKEND = _EVAL.parents[1] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services import audio as audio_svc
from app.services import pitch_evidence
from app.services.onset_recovery import pitch_change_times
from datasets.urmp import UrmpDataset
from pitch_bakeoff import FMAX_HZ, FMIN_HZ

log = logging.getLogger("intempo.eval")


def match(detected: np.ndarray, labelled: np.ndarray, tolerance_s: float):
    """Nearest pairing within the tolerance, each side used once — the rule
    `metrics.py` applies, so the numbers here and in the harness report mean
    the same thing."""
    used: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for e, t in enumerate(labelled):
        best, best_gap = None, tolerance_s
        for d, at in enumerate(detected):
            if d in used:
                continue
            gap = abs(at - t)
            if gap <= best_gap:
                best, best_gap = d, gap
        if best is not None:
            used.add(best)
            pairs.append((best, e))
    return pairs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tolerance-ms", type=float, default=50.0)
    # The sweep's best on both axes — it reaches the most misses *and* lands
    # off-label least often. See TUNING_LOG.md, 2026-11-02, for the grid.
    parser.add_argument("--min-semitones", type=float, default=1.0)
    parser.add_argument("--steady-frames", type=int, default=3)
    parser.add_argument("--out", type=Path, default=_EVAL / ".report")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING)

    takes = UrmpDataset().load()
    if not takes:
        print("onset-bakeoff: no URMP takes", file=sys.stderr)
        return 1

    tolerance_s = args.tolerance_ms / 1000.0
    labelled_total = detected_total = matched_total = 0
    changes_total = recoverable = changes_off_label = 0
    per_take = []

    for take in takes:
        y, sr = take.audio
        labelled = np.array(
            sorted(n["onset_s"] for n in take.ground_truth["performed_notes"]),
            dtype=float,
        )
        detected = audio_svc.detect_onsets(
            audio_svc.pre_emphasis(y), sr, instrument="violin"
        )
        pairs = match(detected, labelled, tolerance_s)
        hit = {e for _, e in pairs}
        missed = [labelled[e] for e in range(labelled.size) if e not in hit]

        track = pitch_evidence.pitch_track(y, sr, fmin=FMIN_HZ, fmax=FMAX_HZ)
        changes = pitch_change_times(
            track,
            hop_length=pitch_evidence.HOP,
            sr=sr,
            min_semitones=args.min_semitones,
            steady_frames=args.steady_frames,
        )
        found_missed = sum(
            1
            for t in missed
            if changes.size and float(np.min(np.abs(changes - t))) <= tolerance_s
        )
        off_label = sum(
            1
            for c in changes
            if labelled.size and float(np.min(np.abs(labelled - c))) > tolerance_s
        )

        labelled_total += int(labelled.size)
        detected_total += int(detected.size)
        matched_total += len(pairs)
        changes_total += int(changes.size)
        recoverable += found_missed
        changes_off_label += off_label
        per_take.append(
            {
                "take": take.take_id,
                "labelled": int(labelled.size),
                "detected": int(detected.size),
                "matched": len(pairs),
                "missed": len(missed),
                "missed_with_a_pitch_change": found_missed,
                "pitch_changes": int(changes.size),
                "pitch_changes_off_label": off_label,
            }
        )
        log.info("onset-bakeoff: %s", per_take[-1])

    missed_total = labelled_total - matched_total
    summary = {
        "tolerance_ms": args.tolerance_ms,
        "min_semitones": args.min_semitones,
        "steady_frames": args.steady_frames,
        "labelled_onsets": labelled_total,
        "detected_onsets": detected_total,
        "onset_precision": matched_total / detected_total if detected_total else None,
        "onset_recall": matched_total / labelled_total if labelled_total else None,
        "missed_onsets": missed_total,
        "missed_with_a_pitch_change": recoverable,
        "share_of_misses_a_pitch_change_reaches": (
            recoverable / missed_total if missed_total else None
        ),
        "pitch_changes": changes_total,
        "pitch_changes_off_label": changes_off_label,
        "pitch_change_off_label_rate": (
            changes_off_label / changes_total if changes_total else None
        ),
    }

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "onset_bakeoff.json").write_text(
        json.dumps({"summary": summary, "per_take": per_take}, indent=2) + "\n"
    )
    for key, value in summary.items():
        print(f"{key}: {round(value, 4) if isinstance(value, float) else value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
