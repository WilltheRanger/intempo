#!/usr/bin/env python3
"""Rebuild `mobile/assets/fonts/Bravura.otf` from the upstream font.

    python tools/subset-bravura.py path/to/Bravura.otf

**Why the app bundles a font at all.** Notation is not typography with an
unusual alphabet — a treble clef, a quarter rest and a sharp are drawings with
centuries of settled proportion, and hand-approximating them is the first thing
a musician notices and the last thing they forgive. `engrave.ts` says so, which
is why it drew no clef at all rather than a bad one. MuseScore and flat.io look
the way they do because they use a SMuFL font; Bravura *is* the reference SMuFL
font, and it is SIL OFL 1.1, so it can be shipped.

**Why a subset.** The full Bravura is 889 KB and holds a few thousand glyphs for
everything from tablature to early notation. This app draws clefs, time
signatures, accidentals, noteheads, rests, flags and an augmentation dot. The
subset is **22 KB** — the same drawings, forty of them instead of thousands.

Kept as a script rather than a note in a commit message because a checked-in
binary nobody can regenerate is a binary nobody can update. Run it against a
newer Bravura and the app gets the newer drawings.

Needs `fonttools`: `pip install fonttools`.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "mobile" / "assets" / "fonts" / "Bravura.otf"

#: The SMuFL codepoints this app draws, and nothing else.
#:
#: Ranges rather than a list where the whole range is used: all ten time
#: signature digits, the five accidentals, the four flags. `E030-E043` is the
#: barline and repeat-dot set, included because a final barline drawn as a
#: rectangle is the one part of a page that always looks hand-made.
RANGES = [
    "E050",  # gClef
    "E062",  # fClef
    "E05C",  # cClef
    "E080-E089",  # timeSig0..9
    "E260-E264",  # flat, natural, sharp, double sharp, double flat
    "E0A2-E0A4",  # noteheadWhole, noteheadHalf, noteheadBlack
    "E4E3-E4E7",  # restWhole, restHalf, restQuarter, rest8th, rest16th
    "E4EE",  # restHBar — the multi-bar rest
    "E240-E243",  # flag8thUp/Down, flag16thUp/Down
    "E1E7",  # augmentationDot
    "E030-E043",  # barlines and repeat dots
]


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    source = Path(argv[1])
    if not source.exists():
        print(f"no such font: {source}")
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "fontTools.subset",
            str(source),
            f"--unicodes={','.join(RANGES)}",
            f"--output-file={OUT}",
            # Hinting is for small text on low-DPI screens; these are drawings
            # rendered at forty pixels and up.
            "--no-hinting",
            "--desubroutinize",
        ],
        check=True,
    )
    print(f"{OUT.relative_to(REPO)}  {OUT.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
