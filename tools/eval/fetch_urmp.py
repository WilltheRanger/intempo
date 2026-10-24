#!/usr/bin/env python3
"""Populate `intempo-eval-data/urmp/` with a handful of URMP violin pieces.

**Source and license.** URMP (University of Rochester Multi-Modal Music
Performance dataset) is released under **CC BY 4.0** — see
<https://www.ece.rochester.edu/projects/air/projects/URMP.html>. The
official release (12.5 GB, every piece, audio + video + annotations) is
gated behind a Google Form on that page rather than a plain URL, which this
tool does not fill in on anyone's behalf — see `README.md`'s "Getting the
data" section for why that is a human step, not an automation gap.

What this script actually downloads is the same CC-BY-4.0-licensed files,
piece by piece, from a long-standing third-party mirror
(`huggingface.co/datasets/Eredis02/URMP`, 25k+ downloads at the time this
was written) that reproduces the official release's per-piece layout
exactly: `AuSep_<n>_<inst>_<piece>.wav` (one instrument's separated audio),
`Notes_<n>_<inst>_<piece>.txt` (the manually-corrected ground truth:
onset_s, f0_hz, duration_s, one row per performed note) and
`Sco_<piece>.mid` (the written score, every part on its own track). It never
fetches `Vid_*.mp4` (the videos) or any non-violin instrument's audio — this
pipeline only ever grades a violin part, and the videos alone are the
majority of the dataset's size.

Only the pieces in `PIECES` below are fetched, by design: enough for a first
baseline across a few tempi and ensemble sizes, not the full 44-piece
corpus. Add to the list and re-run to grow it; nothing here commits
anything — `datasets/urmp.py` reads straight from
`intempo-eval-data/urmp/`, which is gitignored at the workspace root per the
program's ground rules.
"""

from __future__ import annotations

import os
import sys
import urllib.request
from pathlib import Path

MIRROR = "https://huggingface.co/datasets/Eredis02/URMP/resolve/main"

#: `(piece_dir, violin_instrument_numbers)` — a piece can have more than one
#: violin part (duets). Picked for a spread of tempo and ensemble size: a
#: violin/cello duet, a two-violin duet, and two quartets.
PIECES: list[tuple[str, list[int]]] = [
    ("01_Jupiter_vn_vc", [1]),
    ("02_Sonata_vn_vn", [1, 2]),
    ("12_Spring_vn_vn_vc", [1, 2]),
    ("24_Pirates_vn_vn_va_vc", [1, 2]),
]

DATA_ROOT = Path(
    os.environ.get("INTEMPO_EVAL_DATA", "/paperclip/workspaces/intempo-eval-data")
) / "urmp"


def _fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  {url} -> {dest}")
    urllib.request.urlretrieve(url, dest)


def fetch_piece(piece: str, violin_numbers: list[int]) -> None:
    piece_dir = DATA_ROOT / piece
    # URMP's own per-part filenames drop the instrument-letter suffix from
    # the piece directory name: `01_Jupiter_vn_vc/AuSep_1_vn_01_Jupiter.wav`,
    # not `..._01_Jupiter_vn_vc.wav` — the stem is just the leading number
    # and title.
    stem = "_".join(piece.split("_")[:2])
    files = [f"Sco_{piece}.mid"]
    for n in violin_numbers:
        files += [f"AuSep_{n}_vn_{stem}.wav", f"Notes_{n}_vn_{stem}.txt"]

    for name in files:
        dest = piece_dir / name
        if dest.exists():
            print(f"  {dest} already present, skipping")
            continue
        _fetch(f"{MIRROR}/{piece}/{name}", dest)


def main() -> int:
    print(f"eval: fetching {len(PIECES)} URMP piece(s) into {DATA_ROOT}")
    print("Source: https://www.ece.rochester.edu/projects/air/projects/URMP.html (CC BY 4.0)")
    for piece, violin_numbers in PIECES:
        fetch_piece(piece, violin_numbers)
    print("eval: done. Run tools/eval/run.py --urmp to score these takes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
