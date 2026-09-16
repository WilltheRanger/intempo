#!/usr/bin/env python3
"""Draw InTempo's identity — one mark, six assets, reproducibly.

    tools/draw-brand-assets.py [--check]

Every icon this project ships was the Expo starter's blue chevron until now.
`check-brand-assets.py` is the guard that says so; this is the thing that
answers it.

**A script rather than six exported PNGs**, for the reason everything else here
is a script: an icon that exists only as a binary cannot be adjusted without
whatever tool drew it, and nobody can see what it is made of. Here the mark is
~30 lines of geometry, the palette is read from the design tokens' own values,
and re-running it reproduces the files byte-for-byte.

**The mark.** A half note, set in Bravura — the same SMuFL font the app
engraves real scores with, so the icon is drawn from the product rather than
about it — followed by a gold barline. The barline is not decoration: without
it the mark is a tall shape in the left half of a square and the eye reads the
empty right half as a mistake. It also says what the app is for, which is a
note measured against a bar rather than a note on its own.

**It was a small gold square first, and that was a bug.** A dot to the right of
a notehead, level with it, is not a beat mark — it is an augmentation dot, and
the icon read "dotted half note" to anyone who reads music. It also vanished at
29 points. A barline is the same compositional job, is unambiguous, and is the
one part of the mark that still holds together on a home screen.

**Ink ground, chosen deliberately.** The app's own page is warm ivory, and an
ivory icon disappears against a light wallpaper — the one place an icon has to
work. So the icon inverts the app: ink ground, ivory mark. Owner's call,
2026-09-06.

**Engraving proportions are bent on purpose.** A real stem is 3.5 staff spaces
and hair-thin; at 29 points on a home screen it vanishes. The stem here is 2.6
spaces and about a third thicker. Everything else — the notehead's angle, its
1.18:1 width, the way the stem meets its right edge — is what Bravura draws.
"""

from __future__ import annotations

import sys
from pathlib import Path

# **Pillow is a backend dependency, and this is the only tool outside
# `backend/` that needs it.** `backend/pyproject.toml` asks for it; nothing
# installs it into the system interpreter, so `python3 tools/draw-brand-
# assets.py` died on the import below — and `check-brand-assets.py` runs this
# with `sys.executable`, so `tools/preflight.py` reported the brand gate as
# FAIL on every machine whose `python3` is not the backend's. The art was
# never wrong; nothing had looked at it, which is the failure that check's own
# docstring was written about. Same re-exec the benches use, for the same
# reason: make the documented command true rather than document a longer one.
#
# Silent on CI, where there is no `backend/.venv` and the workflow installs
# the pinned Pillow into the interpreter itself — so the byte-for-byte
# comparison still runs under the version `ci.yml` names.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend_python import use_backend_python  # noqa: E402

use_backend_python()

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "mobile"
BRAVURA = MOBILE / "assets" / "fonts" / "Bravura.otf"

#: From `mobile/src/design/colors.ts`. The only place these may be retyped.
INK = (0x14, 0x11, 0x0E)
IVORY = (0xF7, 0xF2, 0xE9)
GOLD = (0x9A, 0x7B, 0x4F)

#: U+E0A3 noteheadHalf. The hollow head, which is what an engraver draws for a
#: note held longer than a beat — and it stays readable at 29pt because the
#: counter is a third of its width, not a hairline.
NOTEHEAD_HALF = ""

#: Supersampling factor. Bravura is an outline font and Pillow has no vector
#: pipeline, so everything is drawn large and reduced with Lanczos.
SS = 4

# Geometry, in staff spaces — the unit engraving is measured in.
STEM_LENGTH = 2.6
STEM_WIDTH = 0.19
BARLINE_WIDTH = 0.19
BARLINE_GAP = 1.05


def draw_mark(size: int, fill: tuple[int, int, int], rule: tuple[int, int, int] | None,
              coverage: float) -> Image.Image:
    """The mark alone, on transparency, optically centred in a `size` square.

    `coverage` is the fraction of the square the mark's longer side occupies.
    It differs per asset: a favicon needs the mark bigger because there is no
    room for margin, an Android foreground needs it smaller because the
    launcher crops to a circle inside the middle two thirds.
    """
    big = size * SS
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))

    # One staff space, solved from the composition's own height so the mark
    # fills `coverage` of the square however the geometry above is retuned.
    mark_h = STEM_LENGTH + 0.5
    mark_w = 1.18 + BARLINE_GAP + BARLINE_WIDTH
    space = (big * coverage) / max(mark_h, mark_w)

    # Bravura's em is four staff spaces, so a glyph asked for at `space * 4`
    # should draw one space tall. "Should" is not a thing to build on: the head
    # is measured at a probe size and the font resized by the ratio, so the
    # notehead is exactly one staff space whatever the font's own metrics say.
    probe_size = max(8, int(space * 4))
    probe_font = ImageFont.truetype(str(BRAVURA), probe_size)
    probe = Image.new("L", (probe_size * 3, probe_size * 3), 0)
    ImageDraw.Draw(probe).text(
        (probe_size * 1.5, probe_size * 1.5),
        NOTEHEAD_HALF,
        font=probe_font,
        fill=255,
        anchor="mm",
    )
    box = probe.getbbox()
    font = ImageFont.truetype(str(BRAVURA), max(8, round(probe_size * space / (box[3] - box[1]))))

    head = Image.new("L", (int(space * 8), int(space * 8)), 0)
    ImageDraw.Draw(head).text(
        (int(space * 4), int(space * 4)), NOTEHEAD_HALF, font=font, fill=255, anchor="mm"
    )
    box = head.getbbox()
    head = head.crop(box)
    head_w, head_h = head.size

    stem_w = max(1, round(space * STEM_WIDTH))
    stem_h = round(space * STEM_LENGTH)
    rule_px = max(1, round(space * BARLINE_WIDTH))
    gap_px = round(space * BARLINE_GAP)

    total_w = head_w + gap_px + rule_px
    total_h = stem_h + head_h // 2
    left = (big - total_w) // 2
    top = (big - total_h) // 2

    # The head sits at the foot of the stem; the stem rises off its right edge,
    # which is where a stem goes on a note below the middle line.
    head_x = left
    head_y = top + stem_h - head_h // 2
    layer = Image.new("L", (big, big), 0)
    layer.paste(head, (head_x, head_y), head)

    pen = ImageDraw.Draw(layer)
    stem_x = head_x + head_w - stem_w
    pen.rectangle(
        [stem_x, top, stem_x + stem_w - 1, head_y + head_h // 2],
        fill=255,
    )

    coloured = Image.new("RGBA", (big, big), (*fill, 0))
    coloured.putalpha(layer)
    canvas.alpha_composite(coloured)

    if rule is not None:
        # Top of the stem to the foot of the notehead — the height the note
        # itself occupies, so the two read as one measure rather than as a mark
        # and a stripe.
        rule_layer = Image.new("L", (big, big), 0)
        rule_x = head_x + head_w + gap_px
        ImageDraw.Draw(rule_layer).rectangle(
            [rule_x, top, rule_x + rule_px - 1, head_y + head_h - 1], fill=255
        )
        tinted = Image.new("RGBA", (big, big), (*rule, 0))
        tinted.putalpha(rule_layer)
        canvas.alpha_composite(tinted)

    return canvas.resize((size, size), Image.LANCZOS)


def on_ink(size: int, coverage: float, opaque: bool) -> Image.Image:
    """The mark on the ink ground — the icon as a phone shows it."""
    ground = Image.new("RGBA", (size, size), (*INK, 255))
    ground.alpha_composite(draw_mark(size, IVORY, GOLD, coverage))
    # App Store Connect rejects an icon with an alpha channel.
    return ground.convert("RGB") if opaque else ground


#: Every asset, and what decides its size and margin.
def build() -> dict[Path, Image.Image]:
    return {
        # The App Store icon. iOS applies its own mask, so it is drawn square
        # and full-bleed; RGB because Connect refuses alpha.
        MOBILE / "assets" / "icon.png": on_ink(1024, 0.60, opaque=True),
        # Byte-identical by construction, and a separate deliverable: this is
        # what a phone puts on the home screen when the web app is installed.
        MOBILE / "public" / "app-icon.png": on_ink(1024, 0.60, opaque=True),
        # 48px in a browser tab. Less margin, or the mark is four grey pixels.
        MOBILE / "assets" / "favicon.png": on_ink(48, 0.76, opaque=False),
        # Android crops the foreground to shapes inside the middle two thirds,
        # so the mark has to live well inside the safe zone.
        MOBILE / "assets" / "android-icon-foreground.png": draw_mark(512, IVORY, GOLD, 0.42),
        MOBILE / "assets" / "android-icon-background.png": Image.new(
            "RGBA", (512, 512), (*INK, 255)
        ),
        # The themed icon: Android tints the silhouette itself, so this is one
        # colour and the gold cannot survive. The barline stays as a shape,
        # which is what keeps the mark recognisable when the system recolours
        # it — dropping it here would make the themed icon a different mark.
        MOBILE / "assets" / "android-icon-monochrome.png": draw_mark(
            432, (255, 255, 255), (255, 255, 255), 0.42
        ),
    }


def main() -> int:
    if not BRAVURA.exists():
        print(f"Bravura is not at {BRAVURA}", file=sys.stderr)
        return 1

    check = "--check" in sys.argv
    drifted: list[str] = []
    for path, image in build().items():
        relative = path.relative_to(ROOT)
        if check:
            import io

            buffer = io.BytesIO()
            image.save(buffer, "PNG")
            if not path.exists() or path.read_bytes() != buffer.getvalue():
                drifted.append(str(relative))
            continue
        image.save(path, "PNG")
        print(f"  drew {relative} {image.size[0]}x{image.size[1]} {image.mode}")

    if check:
        if drifted:
            print("Brand assets no longer match what this script draws:")
            for one in drifted:
                print(f"  {one}")
            # **Which Pillow drew it, because that is the other way this
            # fails.** The comparison is byte-for-byte and Pillow rasterises
            # the Bravura glyph, so a different version disagrees about art
            # nobody has touched — `ci.yml` pins 12.3.0 for exactly that
            # reason while `backend/pyproject.toml` only asks for `>=`. Named
            # here so version skew reads as version skew instead of sending
            # someone to look at the icon.
            import PIL

            print(f"\nDrawn here by Pillow {PIL.__version__}; CI pins 12.3.0.")
            print("Re-run tools/draw-brand-assets.py, or update the script first.")
            return 1
        print("Brand assets match the script that draws them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
