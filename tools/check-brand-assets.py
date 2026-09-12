#!/usr/bin/env python3
"""Keep InTempo's identity drawn, and the Expo starter's art out.

    tools/check-brand-assets.py

**Every brand asset here was the Expo starter's** — a blue chevron on pale
blue with construction guides — until 2026-09-06, when all six were drawn: a
Bravura half note followed by a gold barline, ivory on ink. `tools/draw-brand-
assets.py` is the thing that draws them, and this is the guard on the result.

Nothing said so before. `icon.png` was 1024x1024, RGB, no alpha — exactly what
App Store Connect requires — so it would have uploaded, passed review's
automated checks and shipped. A wrong icon is not a build failure; it is a
build that succeeds and is wrong, which is the only kind this project keeps
finding.

Two things fail it now, and both are real:

- **A shipped asset is the starter's art again.** The five template hashes are
  kept for exactly this: a regenerated Expo project, a bad merge, a file
  restored from the wrong place. They are no longer a to-do list, they are a
  list of what may never come back.
- **A shipped asset is not what `draw-brand-assets.py` draws.** The icons are
  generated, so a PNG edited by hand — or a generator edited without re-running
  it — is a silent divergence between the art and the source of the art. This
  delegates that comparison rather than duplicating it.

What it still cannot check is whether the icon is any *good*. That was the
owner's call (CLAUDE.md §2) and it was made.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: Every image this repository ships as InTempo, and where a person sees it.
#:
#: `public/app-icon.png` is byte-identical to `assets/icon.png` today and is
#: still listed separately: they are two deliverables that happen to share a
#: file, and replacing one without the other is a real state to be in.
SHIPPED: dict[str, str] = {
    "mobile/assets/icon.png": "the App Store icon",
    "mobile/assets/favicon.png": "the browser tab icon",
    "mobile/assets/android-icon-foreground.png": "the Android launcher icon",
    "mobile/assets/android-icon-background.png": "the Android icon background",
    "mobile/assets/android-icon-monochrome.png": "the Android themed icon",
    "mobile/public/app-icon.png": "the home-screen icon for the installed web app",
}

#: SHA-256 of the Expo starter template's art, which must never ship again.
#:
#: Recorded rather than described because "is this a placeholder" is not a
#: question a program can answer about pixels — but "is this byte-for-byte the
#: file the template shipped" is exact and has no false positives.
#:
#: These were a to-do list until 2026-09-06, and the check failed on a hash no
#: shipped asset had any more — the right rule while they were the current
#: state, and the wrong one the moment the art was drawn. Now they are a
#: denylist, so restoring one is caught rather than celebrated.
STARTER_PLACEHOLDERS: dict[str, str] = {
    "119462bb78eb240a65c869fc067ee599639b3cb5a41953f25c07b17d2a8c7e0f": (
        "blue chevron on pale blue, with the template's construction guides"
    ),
    "a4e030697a7571b3e95d31860e4da55d2f98e5e861e2b55e414f45a8556828ba": (
        "the same chevron at favicon size"
    ),
    "9e3d0315a33c6799de601dd34cd8bf8cc3a8d16f3bf75592baec2ceb7240b391": (
        "the same chevron as an Android foreground layer"
    ),
    "fb139c2dee362ebf2070e23b96da6fc0d43f8492de38b8af1fd7223e19b5861d": (
        "the template's flat icon background"
    ),
    "6371fc2c12e33ad2215a86c281db3d682a81bebe7c957a842c13b8bf00cceb83": (
        "the template's monochrome icon"
    ),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def outstanding() -> list[str]:
    """The shipped assets that are still the Expo starter's art.

    A function rather than a line of output for somebody to grep, because
    `check-store-readiness.py` did grep it: it counted lines beginning
    "  mobile/", which meant "still the starter's" until the heading above them
    changed to "Drawn for InTempo" and the same count came to mean the exact
    opposite. It reported six assets outstanding on the day all six were drawn.
    """
    return [
        relative
        for relative in SHIPPED
        if (ROOT / relative).exists() and digest(ROOT / relative) in STARTER_PLACEHOLDERS
    ]


def main() -> int:
    if "--count-outstanding" in sys.argv:
        print(len(outstanding()))
        return 0

    problems: list[str] = []
    drawn: list[str] = []

    for relative, purpose in SHIPPED.items():
        path = ROOT / relative
        if not path.exists():
            problems.append(f"{relative} is {purpose} and is not in the repository")
            continue
        if digest(path) in STARTER_PLACEHOLDERS:
            problems.append(
                f"{relative} is {purpose} and is the Expo starter's art again "
                f"({STARTER_PLACEHOLDERS[digest(path)]}) — re-run tools/draw-brand-assets.py"
            )
        else:
            drawn.append(f"  {relative} — {purpose}")

    # The art is generated, so "is it drawn" and "is it what the generator
    # draws" are two questions. Delegated rather than duplicated: a second copy
    # of the drawing code here would be a second thing to keep in step.
    generator = ROOT / "tools" / "draw-brand-assets.py"
    result = subprocess.run(
        [sys.executable, str(generator), "--check"], capture_output=True, text=True
    )
    if result.returncode != 0:
        # **"It differs" and "it could not run" are different findings, and this
        # reported both as the first one.** The generator's disagreements go to
        # stdout; a crash goes to stderr, and only stdout was read — so a
        # missing Pillow produced the sentence "the shipped art is not what
        # draw-brand-assets.py draws:" followed by nothing at all. That ran on
        # CI for the first time on 2026-09-12 and accused the art of being
        # wrong when the truth was that nothing had looked at it.
        #
        # A check that cannot say why it failed is worse than one that does not
        # run, because the first is believed.
        detail = result.stdout.strip() or result.stderr.strip()
        crashed = result.stdout.strip() == "" and "Traceback" in result.stderr
        headline = (
            "tools/draw-brand-assets.py could not run, so whether the shipped"
            " art matches it is unknown:"
            if crashed
            else "the shipped art is not what tools/draw-brand-assets.py draws:"
        )
        problems.append(
            headline
            + "\n      "
            + "\n      ".join(
                (detail or "(the generator printed nothing at all)").splitlines()
            )
        )

    if drawn:
        print("Drawn for InTempo:")
        print("\n".join(drawn))

    if problems:
        print("\nFAIL")
        for problem in problems:
            print(f"  {problem}")
        return 1

    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
