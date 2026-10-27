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

**The mirror has been checked against the official release, and every file
this fetches is in the baseline (JERA-578, 2026-10-27).** All 18 files were
byte-identical — `sha256`, not just size — to the same members of the
authors' own archival deposit of URMP (Zenodo record 5034983, mirroring
Dryad `doi:10.5061/dryad.ng3r749`), whose published md5 for the whole
12,097,672,571-byte `Dataset.tar.gz` matched what was downloaded. So the
Google Form is still the official route and still a human step, but the
mirror is not an unverified one: nothing here is held out of the harness's
numbers. The per-file hashes are `urmp_checksums.txt`, and
`verify_fetched()` below checks every file against it on every run, so a
mirror that changes under us fails the fetch rather than quietly moving a
baseline. A file this tool fetches that is *not* in that manifest (a piece
newly added to `PIECES`) is reported as unverified and is the one case where
`README.md`'s rule bites: keep it out of the baseline until someone extends
the manifest the same way.

One note on the license, since the two sources state it differently: the
project page says CC BY 4.0, the Zenodo/Dryad deposit of the same data says
CC0 1.0. Either permits the eval-only use here; attribution is recorded
anyway, per the program's data-rights rule.

The official release carries two things this does not fetch and that are
worth knowing about: `F0s_<n>_<inst>_<piece>.txt`, a frame-level f0 track
(~10 ms hop) alongside the note-level `Notes_*`, and `Sco_<piece>.pdf`, the
engraved score. See `README.md` for why neither is wired in yet.
"""

from __future__ import annotations

import os
import sys
import urllib.request
from pathlib import Path

_EVAL = Path(__file__).resolve().parent
if str(_EVAL) not in sys.path:
    sys.path.insert(0, str(_EVAL))

from urmp_integrity import Integrity, check_file, load_checksums

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


def fetch_piece(piece: str, violin_numbers: list[int]) -> list[str]:
    """Fetch (or leave in place) one piece's files; returns their paths
    relative to `DATA_ROOT`, for `verify_fetched()` to check."""
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

    return [f"{piece}/{name}" for name in files]


def verify_fetched(relative_paths: list[str]) -> tuple[list[str], list[str]]:
    """Hash every fetched file against `urmp_checksums.txt` — the official
    release's hashes, not the mirror's. Prints a line per file and returns
    `(mismatched, unverified)`; see JERA-578 and `urmp_integrity.py`.
    """
    expected = load_checksums()
    mismatched, unverified = [], []
    for relative_path in relative_paths:
        check = check_file(DATA_ROOT / relative_path, relative_path, expected)
        print(f"  {check.status.value:<10} {relative_path}")
        if check.status is Integrity.MISMATCH:
            mismatched.append(relative_path)
            print(f"    expected sha256 {check.expected_sha256}")
            print(f"    actual   sha256 {check.actual_sha256}")
        elif check.status is not Integrity.VERIFIED:
            unverified.append(relative_path)
    return mismatched, unverified


def main() -> int:
    print(f"eval: fetching {len(PIECES)} URMP piece(s) into {DATA_ROOT}")
    print("Source: https://www.ece.rochester.edu/projects/air/projects/URMP.html (CC BY 4.0)")
    fetched: list[str] = []
    for piece, violin_numbers in PIECES:
        fetched += fetch_piece(piece, violin_numbers)

    print("eval: verifying against the official release (urmp_checksums.txt)")
    mismatched, unverified = verify_fetched(fetched)
    if mismatched:
        # A mirror that has changed under us is the whole reason the manifest
        # exists: stop, rather than let a baseline move quietly.
        print(
            f"eval: FAILED — {len(mismatched)} file(s) do not match the official "
            "release. Delete them and re-run; if the mirror itself has changed, "
            "get the data from the project page's Google Form instead.",
            file=sys.stderr,
        )
        return 1
    if unverified:
        print(
            f"eval: {len(unverified)} file(s) are not in urmp_checksums.txt, so "
            "they are unverified and the harness will leave them out of its "
            "numbers. Extend the manifest the way its header describes.",
            file=sys.stderr,
        )

    print("eval: done. Run tools/eval/run.py --urmp to score these takes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
