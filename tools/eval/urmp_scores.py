#!/usr/bin/env python3
"""URMP's score MIDI files, as one MusicXML file per part, for `real_takes.py`.

    pip install music21              # any Python: the backend does not need it
    tools/eval/urmp_scores.py DATA

`DATA` is the directory `urmp_yourmt3_16k.tar.gz` was unpacked in (see
`real_takes.py` for where it comes from). Each piece's `Sco_*.mid` becomes
`DATA/xml/<piece>_P<part>.musicxml`, part `n` being the track `AuSep_n_*`
recorded — URMP numbers its tracks in score order. The app then reads each one
through its own importer (`ocr.musicxml.score_json_from_musicxml`), exactly as
it reads a MusicXML file a musician uploads.

**The double bass parts are written an octave up.** URMP's MIDI holds every
part at sounding pitch, and the app reads a bass part as written, an octave
above where it sounds — so a bass part converted as it stands is a page the
app hears an octave below what it says, and pairs with almost nothing (18 of
162 notes on `35_Rondeau`, 2026-11-13).

Nothing this writes is committed: the scores are derived from real pieces
(see this directory's README).
"""

from __future__ import annotations

import argparse
import sys
import warnings
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("data", type=Path, help="where urmp_yourmt3_16k.tar.gz was unpacked")
    args = parser.parse_args()
    try:
        import music21 as m21
    except ImportError:
        print("needs music21: pip install music21", file=sys.stderr)
        return 2
    warnings.filterwarnings("ignore")
    pieces = args.data / "urmp_yourmt3_16k"
    out = args.data / "xml"
    out.mkdir(exist_ok=True)
    written = 0
    for piece in sorted(p for p in pieces.iterdir() if p.is_dir()):
        mids = sorted(piece.glob("Sco_*.mid"))
        if not mids:
            continue
        # "35_Rondeau_vn_vn_va_db": the instruments, in track order.
        kinds = piece.name.split("_")[2:]
        score = m21.converter.parse(str(mids[0]), quantizePost=True, quarterLengthDivisors=(4, 3))
        for number, part in enumerate(score.parts, start=1):
            if number <= len(kinds) and kinds[number - 1] == "db":
                part = part.transpose(12)
            single = m21.stream.Score()
            single.insert(0, part)
            single.write("musicxml", fp=str(out / f"{piece.name}_P{number}.musicxml"))
            written += 1
    print(f"wrote {written} parts to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
