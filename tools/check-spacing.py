#!/usr/bin/env python3
"""Every margin, padding and gap the app types is a step of its spacing scale.

    python3 tools/check-spacing.py

**The scale existed and nothing held it.** `mobile/src/design/spacing.ts` has
said since the design system was locked that every margin, padding and gap
resolves to one of its steps, and that a layout needing another value is a
wrong layout. The UI review on 2026-11-12 counted **89** that did not: 10, 6,
14, 18 and 26 most often, each a reasonable guess where it was typed — 26
under one title, 22 under another, 30 under a third — and together no rhythm.
A rule in a comment is a rule nothing checks, so this is the check.

**What it reads.** Every `.ts` and `.tsx` file under `mobile/src` (tests
excluded), comments out, for a spacing property — `margin*`, `padding*`,
`gap`, `rowGap`, `columnGap` — set to a **bare number**. The steps come from
`spacing.ts` itself, so adding one there (with the design decision its own
comment asks for) is the only way to widen what passes.

**What passes.**

- A step of the scale, or zero.
- A step negated: an outset by a step, which is still the rhythm.
- **Anything that is not a bare number**: `spacing.lg`, a sum of steps, or a
  constant computed from what it depends on — `-(MIN_TOUCH_TARGET -
  ICON_SIZE.lg) / 2` for a glyph's target given back to the gutter. Those are
  the honest form of the values that were never spacing in the first place:
  a hit area's outset, a centring offset, a line's leading. Named and derived,
  they say what they are; typed as 10 or 13.5, they read as a gap somebody
  chose and invite the next person to choose 11.

**What it does not try to do.** It does not chase a number through a
variable: `const GAP = 14` used as `gap: GAP` passes. That is deliberate — a
named constant carries a reason beside it, or should, and the place to argue
about it is the review of that line. A literal in a style is the thing that
got typed without one, eighty-nine times.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "mobile" / "src"
SCALE_FILE = SRC / "design" / "spacing.ts"

#: The properties that are spacing. `top`/`left` and friends position a thing
#: rather than space it, and widths and heights size it; neither is here.
SPACING_PROPERTY = (
    r"\b(?:(?:margin|padding)(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?"
    r"|gap|rowGap|columnGap)\b"
)

#: A bare number as the whole value: followed by the end of the property, not
#: by an operator, so `spacing.lg * 2` and `-THUMB / 2` are never read as one.
ASSIGNMENT = re.compile(
    SPACING_PROPERTY + r"\s*:\s*(-?\d+(?:\.\d+)?)(?=\s*(?:,|\}|$))",
    re.MULTILINE,
)


def scale() -> set[float]:
    """The steps, read from the file that defines them."""
    text = SCALE_FILE.read_text(encoding="utf-8")
    body = re.search(r"export const spacing = \{(.*?)\}\s*as const", text, re.S)
    if body is None:
        sys.exit(f"check-spacing: could not find the scale in {SCALE_FILE}")
    steps = {
        float(value)
        for value in re.findall(r"^\s*(?:'[^']+'|\w+)\s*:\s*(\d+(?:\.\d+)?)\s*,", strip_comments(body.group(1)), re.M)
    }
    if len(steps) < 4:
        sys.exit(f"check-spacing: read only {sorted(steps)} from {SCALE_FILE}")
    return steps | {0.0}


def strip_comments(source: str) -> str:
    """Block and line comments out, keeping line numbers where they were.

    A line comment starts at `//` after whitespace or at the start of a line,
    so a URL inside a string ("https://…") is not taken for one.
    """
    source = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), source, flags=re.S)
    return re.sub(r"(^|\s)//[^\n]*", r"\1", source, flags=re.M)


def nearest(value: float, steps: set[float]) -> str:
    magnitude = abs(value)
    best = min(steps, key=lambda step: (abs(step - magnitude), step))
    sign = "-" if value < 0 and best else ""
    return f"{sign}{best:g}"


def main() -> int:
    steps = scale()
    files = sorted(
        path
        for pattern in ("*.ts", "*.tsx")
        for path in SRC.rglob(pattern)
        if ".test." not in path.name and "node_modules" not in path.parts
    )
    if len(files) < 100:
        # A glob that matched nothing would pass every file it did not read.
        print(f"check-spacing: read only {len(files)} files under {SRC}", file=sys.stderr)
        return 1

    offences: list[str] = []
    for path in files:
        text = strip_comments(path.read_text(encoding="utf-8"))
        for match in ASSIGNMENT.finditer(text):
            value = float(match.group(1))
            if abs(value) in steps:
                continue
            line = text.count("\n", 0, match.start()) + 1
            offences.append(
                f"  {path.relative_to(ROOT)}:{line}: {match.group(0).strip()}"
                f"  (nearest step: {nearest(value, steps)})"
            )

    shown = ", ".join(f"{step:g}" for step in sorted(steps))
    if offences:
        print(f"check-spacing: {len(offences)} spacing value(s) off the scale ({shown}):\n")
        print("\n".join(offences))
        print(
            "\nUse the step (`spacing.*`). A value that is genuinely not a step is not"
            "\nspacing: name it for what it is and compute it from what it depends on"
            "\n(see this file's docstring and `mobile/src/design/spacing.ts`)."
        )
        return 1

    print(f"check-spacing: {len(files)} files, every margin, padding and gap on the scale ({shown}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
