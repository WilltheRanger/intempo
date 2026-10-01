#!/usr/bin/env python3
"""Build `mobile/assets/fonts/Accidentals.ttf`: ♭ ♮ ♯ ♩ 𝄫 𝄪 set to sit in a line of text.

    python3 tools/subset-accidentals.py path/to/NotoMusic-Regular.ttf

**Why the app needs a font for four characters.** Neither text face has ever
had them — Inter and Newsreader stop at `#` — so every "B♭" the app printed
fell back to whatever the device had. On an iPhone that is a symbol font with
its own spacing and baseline, and "Your low B♭s run sharp" came out as
"B ♭ s" (the owner's screenshot, 2026-10-01). `check-font-coverage.py` had
been reporting the fallback since it was written, as something no change here
could fix. A font of four glyphs is the change.

**Noto Music, SIL OFL 1.1**, from `google/fonts` (`ofl/notomusic`). It is drawn
for text, unlike Bravura, whose em is four staff spaces.

**Re-set, not just subset, and that is the point of the script.** A music
font draws a sharp and a natural centred on a staff line, hanging well below
the baseline, and its flat a little short of a capital. Beside "F" or "B" in
Inter that reads as a subscript. Each glyph is scaled and lifted here so it
stands on the baseline and reaches the text's cap height — measured against
Inter's 0.728 em — the way a text face that drew accidentals would have drawn
them. Doing it in the font means no screen has to nudge a character, and the
same file works on iOS, Android and the web.

**The vertical metrics are a text font's**, not the source's 1.389 em ascent:
a fallback-sized line box is what would make a line holding "B♭" taller than
the line beside it.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "mobile" / "assets" / "fonts" / "Accidentals.ttf"

#: Where each glyph should sit, in em: (bottom, top). Inter's cap height is
#: 0.728. The flat stands on the baseline; the sharp and natural dip just
#: under it, as they do in a text face, rather than hanging a quarter em down.
TARGET = {
    0x266D: (-0.01, 0.73),  # ♭
    0x266E: (-0.04, 0.75),  # ♮
    0x266F: (-0.04, 0.75),  # ♯
    0x2669: (-0.02, 0.73),  # ♩
    0x1D12B: (-0.01, 0.73),  # 𝄫, as tall as the flat it doubles
    0x1D12A: (0.08, 0.50),  # 𝄪, an x-height cross, as a double sharp is printed
}
#: Breathing room either side, in em, so "B♭" is one word and not two.
SIDE_BEARING = 0.03

FAMILY = "Accidentals"


def build(source: Path) -> None:
    font = TTFont(source)
    options = Options()
    options.layout_features = []
    options.name_IDs = ["*"]
    options.notdef_outline = True
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=list(TARGET))
    subsetter.subset(font)

    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    glyf = font["glyf"]
    glyphs = font.getGlyphSet()
    for codepoint, (bottom, top) in TARGET.items():
        name = cmap[codepoint]
        bounds_pen = BoundsPen(glyphs)
        glyphs[name].draw(bounds_pen)
        x_min, y_min, x_max, y_max = bounds_pen.bounds
        scale = (top - bottom) * upm / (y_max - y_min)
        dy = bottom * upm - y_min * scale
        dx = SIDE_BEARING * upm - x_min * scale
        pen = TTGlyphPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, scale, dx, dy)))
        glyf[name] = pen.glyph()
        advance = round((x_max - x_min) * scale + 2 * SIDE_BEARING * upm)
        font["hmtx"][name] = (advance, round(SIDE_BEARING * upm))

    # A text font's line, so the accidentals never make a line taller.
    ascent, descent = round(0.95 * upm), round(-0.25 * upm)
    font["hhea"].ascent, font["hhea"].descent, font["hhea"].lineGap = ascent, descent, 0
    os2 = font["OS/2"]
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ascent, descent, 0
    os2.usWinAscent, os2.usWinDescent = ascent, -descent

    names = font["name"]
    for record in list(names.names):
        if record.nameID in (1, 4, 16, 21):
            record.string = FAMILY
        elif record.nameID == 6:
            record.string = FAMILY
        elif record.nameID == 3:
            record.string = f"{FAMILY}: re-set from Noto Music"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, {len(TARGET)} glyphs)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__.split("\n\n", 2)[1])
    build(Path(sys.argv[1]))
