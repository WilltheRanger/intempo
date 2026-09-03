#!/usr/bin/env python3
"""Keep the Expo starter's placeholder art from becoming InTempo's identity.

    tools/check-brand-assets.py

**Every brand asset in this repository is the Expo starter's**, measured on
2026-09-03: a blue chevron on pale blue with construction guides — dashed
sight lines, two circles and a centre crosshair. It is the App Store icon, the
Android launcher icon, the browser favicon and the icon a phone puts on its
home screen when someone installs the web app. On a product whose whole visual
identity is warm paper and engraved notation.

Nothing said so. `icon.png` is 1024x1024, RGB, no alpha — exactly what App
Store Connect requires — so it would upload, pass review's automated checks and
ship. A wrong icon is not a build failure; it is a build that succeeds and is
wrong, which is the only kind this project keeps finding.

**This is not a hard gate, deliberately.** Drawing an icon is the owner's
(CLAUDE.md §2 — the human owns look and feel), it cannot be done in a session,
and failing every commit until it exists would train someone to skip the check.
So it works the way `KNOWN_ECHOES` in `facts.test.ts` works: the placeholders
are listed by hash as outstanding, and the check fails on the two things that
*are* mistakes — a new asset shipped as a placeholder, and a listed one that
has been replaced (delete its line, and the identity is one asset closer to
done).

Run it, and it prints what is still the starter's.
"""

from __future__ import annotations

import hashlib
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

#: SHA-256 of the Expo starter template's art, as it stands in this repository.
#:
#: Recorded rather than described because "is this a placeholder" is not a
#: question a program can answer about pixels — but "is this byte-for-byte the
#: file the template shipped" is exact, has no false positives, and stops
#: being true the moment somebody draws something.
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


def main() -> int:
    problems: list[str] = []
    outstanding: list[str] = []
    replaced: list[str] = []
    seen: set[str] = set()

    for relative, purpose in SHIPPED.items():
        path = ROOT / relative
        if not path.exists():
            problems.append(f"{relative} is {purpose} and is not in the repository")
            continue
        found = digest(path)
        seen.add(found)
        if found in STARTER_PLACEHOLDERS:
            outstanding.append(f"  {relative}\n      {purpose} — {STARTER_PLACEHOLDERS[found]}")
        else:
            replaced.append(f"  {relative} — {purpose}")

    # A hash on the list that no shipped asset has any more. The asset was
    # drawn; the line is now a claim about the repository that is not true.
    for stale in sorted(set(STARTER_PLACEHOLDERS) - seen):
        problems.append(
            f"no shipped asset is {stale[:16]}… any more "
            f"({STARTER_PLACEHOLDERS[stale]}) — delete it from STARTER_PLACEHOLDERS"
        )

    if outstanding:
        print("Still the Expo starter's art:")
        print("\n".join(outstanding))
        print(
            "\nThese ship as InTempo's identity. Drawing them is the owner's "
            "(CLAUDE.md §2); this check exists so it cannot happen by accident."
        )
    if replaced:
        print("\nDrawn for InTempo:")
        print("\n".join(replaced))

    if problems:
        print("\nFAIL")
        for problem in problems:
            print(f"  {problem}")
        return 1

    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
