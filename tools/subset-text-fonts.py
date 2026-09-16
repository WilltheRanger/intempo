#!/usr/bin/env python3
"""Rebuild the app's four text fonts from the upstream `@expo-google-fonts` TTFs.

    python3 tools/subset-text-fonts.py

**Measured before doing it, on the shipped build (2026-09-13).** Five font
files load before the first screen, and the four text faces were **345 KB of an
860 KB boot** — 40% of it, second only to the JavaScript at 481 KB, and the
largest thing cuttable without restructuring the app.
Inter alone ships **2,849 glyphs and the subset keeps 335** —
enough for every accented composer name, which is the widest text here. 88% of
it is alphabets the app never renders.

    Inter 400        334.4 KB  ->   92.1 KB    (124.9 -> 34.5 KB brotli)
    Inter 500        334.9 KB  ->   92.1 KB    (128.0 -> 35.2 KB brotli)
    Newsreader 400   113.7 KB  ->   71.3 KB    ( 44.5 -> 30.6 KB brotli)
    Newsreader 500   115.7 KB  ->   71.7 KB    ( 47.5 -> 32.3 KB brotli)
    ----------------------------------------------------------------
    total            898.6 KB  ->  327.2 KB    (344.9 -> 132.6 KB brotli)

Over the wire is the number that matters, and it is **212 KB**. Across the
whole boot set — the document, its scripts and these five files — 860 KB
becomes 648 KB.

**TTF, not WOFF2, and that is a measurement rather than a preference.**
Subsetting to WOFF2 gives 30.1 KB against subset-TTF's 38.1 KB brotli — eight
kilobytes a file, because Cloudflare already brotli-compresses TTF and WOFF2 is
brotli internally. Eight kilobytes does not buy a second font pipeline: WOFF2
does not work on iOS or Android, so it would mean platform-split font loading
for a web-only gain. One format, both platforms, ~90% of the win.

**The same argument as `tools/subset-bravura.py`**, which did this for the
notation font, and the same reason it is a script: a checked-in binary nobody
can regenerate is a binary nobody can update. Run it after a font bump.

**What a missing glyph does, so the range below is read with that in mind.**
Nothing breaks loudly. Browsers and both mobile platforms fall back per
character, so a title typed in Greek renders in the system font beside Inter
text — visibly different, not missing. `tools/check-font-coverage.py` is the
guard for the case that *is* a defect: a character this repository's own copy
uses that the subset dropped.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from fontTools.subset import Options, Subsetter
    from fontTools.ttLib import TTFont
except ImportError:  # pragma: no cover - a dev machine without the tool
    sys.exit("fontTools is required: pip install 'fonttools[woff]'")

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = ROOT / "mobile" / "node_modules" / "@expo-google-fonts"
OUT = ROOT / "mobile" / "assets" / "fonts"

#: Every codepoint the app may set in one of these faces.
#:
#: Latin-1 Supplement and Latin Extended-A are the whole point of the range
#: being this wide: composer names are the app's most multilingual text and
#: they are European. Dvořák needs `ř` (U+0159) and Fauré needs `é`; both are
#: in here, and neither is in a bare ASCII subset.
COVERAGE: list[tuple[int, int]] = [
    (0x0020, 0x007E),  # ASCII printable
    (0x00A0, 0x017F),  # Latin-1 Supplement + Latin Extended-A
    # **The tuplet labels, and a lesson about where Unicode put the digits.**
    # `reading.ts` writes 'Quarter ³', 'Quarter ⁵' and 'Quarter ⁷'. Only
    # ¹²³ live in Latin-1 above; ⁰ and ⁴-⁹ are in this block, so the
    # first subset kept the triplets by accident and dropped the quintuplets
    # and septuplets. A range rather than the two codepoints in use today,
    # for the same reason Latin Extended-A is a range: the next one added
    # should not be a second bug.
    (0x2070, 0x2079),  # Superscripts
]

#: Marks used in copy that sit outside those blocks.
EXTRA: set[int] = {
    0x2018, 0x2019,  # ' '  — apostrophes in body copy
    0x201C, 0x201D,  # " "
    0x2013, 0x2014,  # – —  — the em dash this project writes with
    0x2026,          # …
    0x2022,          # •  — the separator between the account screens' points
    0x00B7, 0x2219,  # · ∙  — the metadata separator
    0x266D, 0x266F, 0x266E,  # ♭ ♯ ♮ — keys and accidentals named in prose
    0x2192, 0x2190,  # → ←
    0x00D7,          # ×
    # **Added 2026-09-16 with the pre-flight screen, which shipped them a
    # commit before they were in here** — `check-font-coverage.py` caught it,
    # which is what it is for. The single angle quote is the "opens something"
    # mark on a row's remedy, and the check mark is a settled pre-flight
    # reading. Both are set in Inter; `›` is in Newsreader too because the
    # coverage check tests every face a string could land in.
    0x203A, 0x2039,  # › ‹
    0x2713,          # ✓
}

FACES = [
    ("inter", "400Regular", "Inter_400Regular"),
    ("inter", "500Medium", "Inter_500Medium"),
    ("newsreader", "400Regular", "Newsreader_400Regular"),
    ("newsreader", "500Medium", "Newsreader_500Medium"),
]


def wanted() -> set[int]:
    points = set(EXTRA)
    for first, last in COVERAGE:
        points.update(range(first, last + 1))
    return points


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    keep = wanted()
    before = after = 0

    for package, weight, name in FACES:
        src = PACKAGES / package / weight / f"{name}.ttf"
        if not src.exists():
            sys.exit(f"missing {src} — run `npm install` in mobile/ first")

        font = TTFont(src)
        have = set(font.getBestCmap())
        missing = sorted(keep - have)
        # Not an error: Newsreader has no `∙`, and asking a subsetter for a
        # glyph a font does not have is how you get a confusing crash rather
        # than a smaller font.
        options = Options()
        options.layout_features = ["*"]
        options.notdef_outline = True
        subsetter = Subsetter(options=options)
        subsetter.populate(unicodes=keep & have)
        subsetter.subset(font)

        out = OUT / f"{name}.ttf"
        font.save(out)
        a, b = src.stat().st_size, out.stat().st_size
        before += a
        after += b
        note = f"  ({len(missing)} requested points absent upstream)" if missing else ""
        print(
            f"{name:24} {a / 1024:7.1f} KB -> {b / 1024:6.1f} KB "
            f"({len(have)} glyphs -> {len(keep & have)}){note}"
        )

    print(
        f"\n{'total':24} {before / 1024:7.1f} KB -> {after / 1024:6.1f} KB "
        f"({100 * (1 - after / before):.1f}% smaller)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
