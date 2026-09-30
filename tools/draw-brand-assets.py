#!/usr/bin/env python3
"""Draw InTempo's identity — one mark, six assets, reproducibly.

    tools/draw-brand-assets.py [--check]

**A script rather than six exported PNGs**, for the reason everything else here
is a script: an icon that exists only as a binary cannot be adjusted without
whatever tool drew it, and nobody can see what it is made of. The mark's
geometry lives in `mobile/src/design/brandMark.json`, which the app's
`BrandMark` component draws from too, so the icon on the home screen and the
mark on the opening screen cannot drift apart. Re-running this reproduces the
files byte-for-byte.

**The mark: "Settle"** (the owner, 2026-09-30, over a metronome, a monogram and
a falling ball, after calling the half note and barline "generic"). A line
that swings — far above the band, below it, above, a little below — each swing
smaller than the last, and settles on the band's centre in a gold dot. It is the picture the app draws of a take: the tempo line over the
on-tempo band. Nothing else on a home screen looks like it, and it says what
the app is for.

**Ink ground, chosen deliberately.** The app's own page is warm ivory, and an
ivory icon disappears against a light wallpaper — the one place an icon has to
work. So the icon inverts the app: ink ground, ivory line, gold dot. Owner's
call, 2026-09-06, kept.

**Weight for the home screen, not the page.** At 29 points the mark is about
sixty pixels wide; the line is 6.5% of it so it stays a line there, and the
band and centre line are faint enough to recede at that size and still frame
the line at 1024.
"""

from __future__ import annotations

import json
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

from PIL import Image, ImageDraw  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "mobile"
#: The mark's geometry, shared with `mobile/src/components/brand/BrandMark.tsx`.
GEOMETRY = MOBILE / "src" / "design" / "brandMark.json"

#: From `mobile/src/design/colors.ts`. The only place these may be retyped.
INK = (0x14, 0x11, 0x0E)
IVORY = (0xF7, 0xF2, 0xE9)
GOLD = (0x9A, 0x7B, 0x4F)

#: Supersampling factor. Pillow has no vector pipeline, so everything is drawn
#: large and reduced with Lanczos.
SS = 4

#: Points per cubic segment when the curve is flattened into a polyline.
STEPS = 96


def _cubic(p0, p1, p2, p3, steps):
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        yield (
            u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
        )


def _curve_points(geometry: dict) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    here = tuple(geometry["curve"]["start"])
    for seg in geometry["curve"]["segments"]:
        c1, c2, end = (seg[0], seg[1]), (seg[2], seg[3]), (seg[4], seg[5])
        part = list(_cubic(here, c1, c2, end, STEPS))
        points.extend(part if not points else part[1:])
        here = end
    return points


def draw_mark(size: int, line: tuple[int, int, int], dot: tuple[int, int, int] | None,
              coverage: float, frame: bool = True) -> Image.Image:
    """The mark alone, on transparency, centred in a `size` square.

    `coverage` is the fraction of the square the mark's width occupies. It
    differs per asset: a favicon needs the mark bigger because there is no
    room for margin, an Android foreground needs it smaller because the
    launcher crops to a circle inside the middle two thirds. `frame` draws the
    band and its centre line; the themed Android icon is a single tint, where
    a faint band would only be a smudge.
    """
    geometry = json.loads(GEOMETRY.read_text())
    band = geometry["band"]
    big = size * SS
    # One design unit, from the band's width — the mark's widest part.
    unit = big * coverage / band["width"]
    offset = (big - geometry["viewBox"] * unit) / 2

    def at(x: float, y: float) -> tuple[float, float]:
        return (offset + x * unit, offset + y * unit)

    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))

    def layer(paint, colour: tuple[int, int, int], opacity: float = 1.0) -> None:
        mask = Image.new("L", (big, big), 0)
        paint(ImageDraw.Draw(mask))
        if opacity < 1.0:
            mask = mask.point(lambda v: round(v * opacity))
        tinted = Image.new("RGBA", (big, big), (*colour, 0))
        tinted.putalpha(mask)
        canvas.alpha_composite(tinted)

    if frame:
        x0, y0 = at(band["x"], band["y"])
        x1, y1 = at(band["x"] + band["width"], band["y"] + band["height"])
        layer(lambda pen: pen.rectangle([x0, y0, x1, y1], fill=255), line, band["opacity"])
        centre = geometry["centre"]
        cy = at(0, centre["y"])[1]
        half = centre["width"] * unit / 2
        layer(lambda pen: pen.rectangle([x0, cy - half, x1, cy + half], fill=255), line,
              centre["opacity"])

    width = geometry["curve"]["width"] * unit
    points = [at(x, y) for x, y in _curve_points(geometry)]

    def stroke(pen):
        # **A round brush stamped along the curve**, not `line(width=…)`:
        # Pillow draws a wide polyline as a quad per segment and the joins
        # leave hairline notches along every bend, visible on the 1024 icon.
        # Stamps a pixel apart make a clean round stroke, caps and all.
        r = width / 2
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            steps = max(1, int(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5))
            for k in range(steps):
                x = x0 + (x1 - x0) * k / steps
                y = y0 + (y1 - y0) * k / steps
                pen.ellipse([x - r, y - r, x + r, y + r], fill=255)
        x, y = points[-1]
        pen.ellipse([x - r, y - r, x + r, y + r], fill=255)

    layer(stroke, line)

    if dot is not None:
        spot = geometry["dot"]
        cx, cy = at(spot["x"], spot["y"])
        r = spot["r"] * unit
        layer(lambda pen: pen.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255), dot)

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
        MOBILE / "assets" / "icon.png": on_ink(1024, 0.66, opaque=True),
        # Byte-identical by construction, and a separate deliverable: this is
        # what a phone puts on the home screen when the web app is installed.
        MOBILE / "public" / "app-icon.png": on_ink(1024, 0.66, opaque=True),
        # 48px in a browser tab. Less margin, or the mark is four grey pixels.
        MOBILE / "assets" / "favicon.png": on_ink(48, 0.8, opaque=False),
        # Android crops the foreground to shapes inside the middle two thirds,
        # so the mark has to live well inside the safe zone.
        MOBILE / "assets" / "android-icon-foreground.png": draw_mark(512, IVORY, GOLD, 0.5),
        MOBILE / "assets" / "android-icon-background.png": Image.new(
            "RGBA", (512, 512), (*INK, 255)
        ),
        # The themed icon: Android tints the silhouette itself, so this is one
        # colour and the gold cannot survive. The dot stays as a shape, which
        # is what keeps the mark recognisable when the system recolours it; the
        # band goes, because a faint band under a tint is only a smudge.
        MOBILE / "assets" / "android-icon-monochrome.png": draw_mark(
            432, (255, 255, 255), (255, 255, 255), 0.5, frame=False
        ),
    }


def main() -> int:
    if not GEOMETRY.exists():
        print(f"The mark's geometry is not at {GEOMETRY}", file=sys.stderr)
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
            # the curve and its antialiasing, so a different version disagrees about art
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
