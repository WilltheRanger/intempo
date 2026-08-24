#!/usr/bin/env python3
"""How much of a real page the app can actually put on a stave.

    python tools/engraver-coverage.py

**Why this exists.** A musician photographed a String Bass part — theme and
variations, runs of sixteenths, dotted rhythms, multi-bar rests — and the piece
screen rendered the title, the photograph, and nothing else. `engrave.ts` draws
four note values and no rests, `staveScoreFor` drops everything else, and every
note on that page was dropped.

The screen now says so. The question this answers is the next one: **is the
engraver's range a real problem or a rare one**, and which values would buy the
most if it were widened.

The uncomfortable part of the answer is what it says about the corpus. Run
against everything checked in, the engraver looks fine — 4–6% of notes have no
glyph, no page loses more than a third. Every fixture here is a simple
exercise-book page. The first part out of a real orchestral folder rendered as
nothing at all, and no test in this repository could have predicted that,
because nothing in this repository looks like one.

So the number to watch is not the average. It is the **worst page**, and the
corpus does not contain a bad one.
"""

from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

#: Mirrors `DRAWABLE` in `mobile/src/lib/notation/fromScore.ts`.
#:
#: Absent by design rather than oversight: `dotted_*` needs a dot, `sixteenth`
#: and below need a second beam or flag. Widening it means adding glyphs to
#: `engrave.ts`, not entries here.
DRAWABLE = {"whole", "half", "quarter", "eighth"}


def _pages():
    """(name, notes) for every score checked into `fixtures/`."""
    for path in sorted((REPO / "fixtures" / "ocr_responses").glob("*.json")):
        raw = json.loads(path.read_text())
        score = raw["ocr_response"]["score"]
        notes = [
            (n.get("pitch"), n.get("duration"))
            for m in score.get("measures", [])
            for n in m.get("notes", [])
        ]
        yield raw["fixture_filename"], notes

    from app.services.ocr.musicxml import score_json_from_musicxml

    for path in sorted((REPO / "fixtures" / "musicxml").glob("*.musicxml")):
        try:
            score = score_json_from_musicxml(path.read_text())
        except Exception as exc:  # noqa: BLE001 — a fixture that no longer parses is news
            print(f"  {path.name}: could not parse ({type(exc).__name__}: {exc})")
            continue
        yield path.name, [(n.pitch, n.duration) for m in score.measures for n in m.notes]


def main() -> int:
    grand: collections.Counter[str] = collections.Counter()
    worst = (100.0, "")
    rows = []

    for name, notes in _pages():
        if not notes:
            continue
        grand.update(duration for _pitch, duration in notes)
        drawn = sum(
            1 for pitch, duration in notes if pitch != "rest" and duration in DRAWABLE
        )
        share = 100 * drawn / len(notes)
        rows.append((name, len(notes), drawn, share))
        worst = min(worst, (share, name))

    print(f"{'page':32} {'notes':>6} {'on the stave':>13}")
    for name, count, drawn, share in rows:
        print(f"{name:32} {count:6} {drawn:8} = {share:3.0f}%")

    print("\nevery duration in the corpus:")
    for duration, count in grand.most_common():
        print(f"  {duration:20} {count:5}{'' if duration in DRAWABLE else '   <- no glyph'}")

    missing = sum(count for d, count in grand.items() if d not in DRAWABLE)
    everything = sum(grand.values())
    print(f"\n{missing} of {everything} notes have no glyph ({100 * missing / everything:.0f}%)")
    print(f"worst page: {worst[1]} at {worst[0]:.0f}% drawn")
    print(
        "\nRead the worst page, not the average. The page that started this "
        "would score 0%,\nand nothing in this corpus resembles it."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
