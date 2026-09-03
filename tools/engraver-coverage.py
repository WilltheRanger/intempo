#!/usr/bin/env python3
"""How much of a real page the app can actually put on a stave.

    python tools/engraver-coverage.py

**Why this exists.** A musician photographed a String Bass part — theme and
variations, runs of sixteenths, dotted rhythms, multi-bar rests — and the piece
screen rendered the title, the photograph, and nothing else. At the time
`engrave.ts` drew four note values and no rests, `staveScoreFor` dropped
everything else, and every note on that page was dropped.

The screen now says so. The question this answers is the next one: **is the
engraver's range a real problem or a rare one**, and which values would buy the
most if it were widened.

The uncomfortable part of the answer is what it says about the corpus. Every
fixture here is a page somebody chose in order to check something. The first
part out of a real orchestral folder rendered as nothing at all, and no test in
this repository could have predicted that, because nothing in this repository
looks like one.

So the number to watch is not the average. It is the **worst page**, and the
corpus does not contain a bad one — which is why this now prints a second
table that does not depend on the corpus at all: **every duration the schema
can send**, drawable or not. The corpus reached 100% while four of the
schema's forty-six values had no glyph, because not one fixture page contains
a note shorter than a sixteenth.

**The tool has twice measured the wrong thing**, which is worth keeping in
view given what it is for:

  - It kept its own copy of `DRAWABLE` and went on reporting 13% after the
    engraver learned sixteenths. Now it reads the app's tables.
  - It counted **every rest as a note it could not draw**. The "worst page"
    it reported for weeks, 71%, was five notes out of seven items where the
    two missing were *whole rests* — which the app has drawn correctly since
    rests existed. Rests have their own table and it now reads that too.
"""

from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
# Started with the wrong interpreter, this dies on `import pydantic` before it
# reads a fixture. `backend_python` re-execs under `backend/.venv` so the
# command in the docstring above is one that works — see its own header.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend_python import use_backend_python  # noqa: E402

use_backend_python()

sys.path.insert(0, str(REPO / "backend"))

#: What the app can actually draw, **read from the app** rather than copied.
#:
#: This was a hand-kept set — `{"whole", "half", "quarter", "eighth"}` — with a
#: comment saying it mirrored `DRAWABLE` in `fromScore.ts`. It stopped
#: mirroring it the moment the engraver learned sixteenths and dots, and the
#: tool went on reporting 13% of the corpus as undrawable when the real figure
#: had changed. A measuring instrument that keeps its own copy of what it is
#: measuring will eventually measure the copy.
#:
#: Parsed rather than imported because there is no TypeScript runtime here, and
#: it is one regex against a literal this project writes by hand anyway.
def _table(name: str) -> set[str]:
    source = (REPO / "mobile" / "src" / "lib" / "notation" / "fromScore.ts").read_text()
    start = source.index(f"const {name}:")
    body = source[start : source.index("};", start)]
    names = set(re.findall(r"^\s*([a-z_]+):\s*\{", body, re.M))
    if not names:
        raise SystemExit(
            f"could not read {name} out of fromScore.ts — the shape changed, "
            "and guessing here would report a coverage figure for an engraver "
            "that does not exist"
        )
    return names


def _drawable() -> set[str]:
    return _table("DRAWABLE")


#: The tuplet prefixes `fromScore.tupletOf` strips before looking a value up.
#:
#: Read from the app for the same reason `DRAWABLE` is. Tuplets do not appear in
#: `DRAWABLE` — they are a base value plus a bracket, resolved separately — so a
#: tool that only knew `DRAWABLE` went on reporting twelve undrawable notes
#: after they became drawable. Which is the failure this file's own docstring
#: warns about, arriving by a second route.
def _tuplet_prefixes() -> set[str]:
    source = (REPO / "mobile" / "src" / "lib" / "notation" / "fromScore.ts").read_text()
    start = source.index("const TUPLET_FAMILIES")
    body = source[start : source.index("];", start)]
    names = set(re.findall(r"prefix: '([a-z_]+)'", body))
    if not names:
        raise SystemExit(
            "could not read TUPLET_FAMILIES out of fromScore.ts — the shape "
            "changed, and guessing here would report a coverage figure for an "
            "engraver that does not exist"
        )
    return names


DRAWABLE = _drawable()

#: Rests have their own table and always have — `Stave` draws a different shape
#: for each, and the two sets are not the same size.
#:
#: **This tool did not know that**, and counted every rest as a note it could
#: not draw. The "worst page" it reported for months, 71%, was five notes out
#: of seven items where the missing two were *whole rests* — which the app has
#: drawn correctly since rests were added at all. The headline that mattered
#: was wrong in the reassuring direction's opposite: it under-reported.
DRAWABLE_RESTS = _table("DRAWABLE_RESTS")
TUPLET_PREFIXES = _tuplet_prefixes()


def _drawn(pitch: str | None, duration: str | None) -> bool:
    """Whether the app can put this item on a stave."""
    if not duration:
        return False
    table = DRAWABLE_RESTS if pitch == "rest" else DRAWABLE
    if duration in table:
        return True
    for prefix in TUPLET_PREFIXES:
        if duration.startswith(prefix):
            return duration[len(prefix):] in table
    return False


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

    for path in sorted((REPO / "fixtures" / "scores").glob("*.json")):
        raw = json.loads(path.read_text())
        score = raw["score"]
        yield path.name, [
            (n.get("pitch"), n.get("duration"))
            for m in score.get("measures", [])
            for n in m.get("notes", [])
        ]

    from app.services.ocr.musicxml import score_json_from_musicxml

    import xml.etree.ElementTree as ET

    from app.services.ocr.musicxml import _part_names

    for path in sorted((REPO / "fixtures" / "musicxml").glob("*.musicxml")):
        xml = path.read_text()
        # **Every part, not one.** The importer refuses a multi-part file with no
        # part chosen, and is right to: a cellist handed the piccolo line would
        # get a verdict that is wrong in a way that looks right. That refusal is
        # about *which instrument a musician plays*, and this tool is not asking
        # that — it is asking which note values the engraver can draw, where the
        # instrument is irrelevant and every part is more material.
        #
        # Until a two-part fixture existed the corpus was silently all
        # single-part, so this read one part per file and would have skipped any
        # real orchestral score outright, reporting it as a parse failure.
        try:
            parts = list(_part_names(ET.fromstring(xml)))
        except ET.ParseError as exc:
            print(f"  {path.name}: not parseable as XML ({exc})")
            continue
        wanted: list[str | None] = list(parts) if len(parts) > 1 else [None]

        for choice in wanted:
            try:
                score = score_json_from_musicxml(xml, part=choice)
            except Exception as exc:  # noqa: BLE001 — a fixture that no longer parses is news
                print(f"  {path.name}: could not parse ({type(exc).__name__}: {exc})")
                continue
            label = path.name if choice is None else f"{path.name} [{choice}]"
            yield label, [(n.pitch, n.duration) for m in score.measures for n in m.notes]


def _schema_coverage() -> None:
    """What the app can draw of everything the backend is allowed to send.

    The corpus answers "how much of these ten pages", which flatters the
    engraver by exactly as much as the corpus is unrepresentative. This answers
    "how much of the vocabulary", which no choice of fixtures can flatter.
    """
    from app.services.score_schema import DURATION_BEATS

    undrawn = [
        duration
        for duration in sorted(DURATION_BEATS)
        if not (_drawn("note", duration) and _drawn("rest", duration))
    ]
    total = len(DURATION_BEATS)
    print(f"\nof the schema's {total} durations, {total - len(undrawn)} draw.")
    for duration in undrawn:
        print(f"  {duration:26}    <- no glyph")


def main() -> int:
    grand: collections.Counter[tuple[str | None, str | None]] = collections.Counter()
    # Starts empty rather than at 100: when every page is fully drawable
    # nothing beats the initial value, and the tool printed `worst page: at
    # 100%` — a blank where the name should be, which reads as a bug in the
    # measurement rather than as the good news it is.
    worst: tuple[float, str] | None = None
    rows = []

    for name, notes in _pages():
        if not notes:
            continue
        # Keyed on *whether it is a rest*, not on the pitch — a value can be
        # drawable as a rest and not as a note, and keying on the pitch itself
        # would make almost every entry unique and the tally useless.
        grand.update(
            ("rest" if pitch == "rest" else "note", duration) for pitch, duration in notes
        )
        drawn = sum(1 for pitch, duration in notes if _drawn(pitch, duration))
        share = 100 * drawn / len(notes)
        rows.append((name, len(notes), drawn, share))
        worst = (share, name) if worst is None else min(worst, (share, name))

    print(f"{'page':32} {'notes':>6} {'on the stave':>13}")
    for name, count, drawn, share in rows:
        print(f"{name:32} {count:6} {drawn:8} = {share:3.0f}%")

    print("\nevery duration in the corpus:")
    for (kind, duration), count in grand.most_common():
        what = f"{'rest ' if kind == 'rest' else ''}{duration}"
        print(f"  {what:26} {count:5}{'' if _drawn(kind, duration) else '   <- no glyph'}")

    missing = sum(count for key, count in grand.items() if not _drawn(*key))
    everything = sum(grand.values())
    print(f"\n{missing} of {everything} notes have no glyph ({100 * missing / everything:.0f}%)")
    if worst:
        print(f"worst page: {worst[1]} at {worst[0]:.0f}% drawn")
    _schema_coverage()
    print(
        "\nRead the worst page, not the average — and read what this corpus is."
        "\nEvery fixture in it is a page somebody chose to check something with."
        "\nThe first real orchestral part photographed scored 0%, and nothing"
        "\nhere could have predicted that, because nothing here looked like one."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
