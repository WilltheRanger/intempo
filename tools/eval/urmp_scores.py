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

**Transposing parts are written where the player reads them.** URMP's MIDI
holds every part at sounding pitch, and the app reads a part as written: a
double bass an octave above where it sounds, an alto saxophone a major sixth
above (`WRITTEN_ABOVE`). A bass part converted as it stands is a page the app
hears an octave below what it says, and pairs with almost nothing (18 of 162
notes on `35_Rondeau`, 2026-11-13).

Nothing this writes is committed: the scores are derived from real pieces
(see this directory's README).
"""

from __future__ import annotations

import argparse
import sys
import warnings
from pathlib import Path

#: Semitones a part is written above where it sounds, for URMP's
#: transposing instruments. URMP's MIDI holds every part at sounding pitch;
#: the app reads a part as written (`analysis._TRANSPOSE`).
#: - "db": the double bass, an octave.
#: - "sax": an alto saxophone, a major sixth. URMP does not say which
#:   saxophone, but its eleven tracks span sounding MIDI 50–81, which is an
#:   alto's range: a tenor stops near 75.
WRITTEN_ABOVE = {"db": 12, "sax": 9}


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
            kind = kinds[number - 1] if number <= len(kinds) else ""
            if kind in WRITTEN_ABOVE:
                part = part.transpose(WRITTEN_ABOVE[kind])
            single = m21.stream.Score()
            single.insert(0, part)
            single.write("musicxml", fp=str(out / f"{piece.name}_P{number}.musicxml"))
            written += 1
    print(f"wrote {written} parts to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
