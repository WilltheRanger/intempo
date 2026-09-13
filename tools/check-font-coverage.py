#!/usr/bin/env python3
"""Every character this app prints must survive the subset of the fonts it prints in.

    python3 tools/check-font-coverage.py

**The guard for `tools/subset-text-fonts.py`.** Subsetting cut the text faces
from 899 KB to 327 KB by dropping 88% of their glyphs, and the risk it creates
is precise: someone writes a nicer dash, a superscript or an accented name into
a label, and the glyph is simply not in the font any more.

**It does not crash and it is not obvious.** Browsers and both mobile platforms
fall back per character, so the character still appears — in the system font,
one weight off and a different shape, beside the text it belongs to. On a
screenshot it reads as a rendering quirk. That is exactly the class of silent
defect this repository keeps paying for, so it is a gate rather than a note.

**It compares against upstream, which is the whole design.** The first version
asked "is this character in all four subsets", and that question cannot be
answered usefully: it failed on ♭, ♯ and ♩, which *no* text face here has ever
contained and which have fallen back to the system font since the day they were
typed. Those are not subsetting defects and nothing in this repository can fix
them. The answerable question is **"did the subset drop something upstream
had"** — the one risk subsetting introduces — and that needs the packages in
`mobile/node_modules`, so this runs beside the mobile job rather than in the
Python one.

**Literal strings only, and not the ones in comments.** Anything a musician
types is out of scope and has to be: a piece title in Greek is legitimate and
falls back gracefully. What is checked is text the repository itself ships.
Comments are skipped because the first version did not skip them and reported
`♩` and `→` from two doc comments as defects — a false positive in a lint tool
costs the investigation it triggers, which here was two files and a font table.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

try:
    from fontTools.ttLib import TTFont
except ImportError:  # pragma: no cover - a dev machine without the tool
    sys.exit("fontTools is required: pip install fonttools")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "mobile" / "src"
SUBSET = ROOT / "mobile" / "assets" / "fonts"
UPSTREAM = ROOT / "mobile" / "node_modules" / "@expo-google-fonts"

#: Characters that never reach a font.
IGNORED = set(" \n\r\t")

#: What can precede a `/` that opens a regular expression. After a value — an
#: identifier, a literal, a `)` or a `]` — a `/` is division. Without this the
#: apostrophe inside something like `/it's/` opens a string that never closes
#: and the rest of the file is read as one literal.
BEFORE_REGEX = set("(,=:[!&|?{};+-*%~^<>") | {""}


def faces() -> list[tuple[str, str, str]]:
    """The face list, read from the script that produced the subsets.

    Imported rather than copied: a guard that checks a different set of files
    from the one the generator writes is a guard that passes for the wrong
    reason, and this project has shipped that shape of mistake before.
    """
    path = ROOT / "tools" / "subset-text-fonts.py"
    spec = importlib.util.spec_from_file_location("subset_text_fonts", path)
    if spec is None or spec.loader is None:  # pragma: no cover - unreachable
        sys.exit(f"cannot read {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return list(module.FACES)


def literals(text: str) -> list[str]:
    """Every string, template and JSX text in a TypeScript source, comments aside.

    A scanner rather than a regular expression, because the three things that
    have to be told apart — a quote, a comment and a regular expression — are
    each defined by what came before them, which is exactly what a regular
    expression cannot see.

    **JSX children are text and are not quoted**, which the first version of
    this missed: `<Text>Behind ← Target → Ahead</Text>` and a `•` on two
    account screens are drawn on a real screen and appear in no string literal.
    Rather than parse JSX, this uses what the scanner already knows — having
    consumed every comment, string and regular expression, whatever is left is
    code, and a non-ASCII character sitting in code is JSX text. ASCII there is
    syntax, and is skipped: `{`, `=>` and the rest are not drawn, and every
    printable ASCII character is in the subset unconditionally, so nothing is
    lost by not looking.
    """
    out: list[str] = []
    i, n = 0, len(text)
    prev = ""  # last significant character, for the regex/division decision
    while i < n:
        ch = text[i]
        pair = text[i : i + 2]

        if pair == "//":
            i = text.find("\n", i)
            if i == -1:
                break
            continue
        if pair == "/*":
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if ch == "/" and prev in BEFORE_REGEX:
            # A regular expression: consumed, not collected. Its characters are
            # matched against input rather than drawn.
            i += 1
            while i < n and text[i] != "\n":
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == "[":
                    while i < n and text[i] != "]" and text[i] != "\n":
                        i += 2 if text[i] == "\\" else 1
                if text[i] == "/":
                    i += 1
                    break
                i += 1
            prev = ")"  # a regex is a value, so a `/` after it is division
            continue
        if ch in "'\"`":
            quote, i = ch, i + 1
            buf: list[str] = []
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == quote:
                    i += 1
                    break
                if quote == "`" and text[i : i + 2] == "${":
                    # An interpolation is code, not text. Collect what is on
                    # either side of it and skip the expression between.
                    depth, i = 1, i + 2
                    while i < n and depth:
                        depth += (text[i] == "{") - (text[i] == "}")
                        i += 1
                    continue
                if quote != "`" and text[i] == "\n":
                    break  # an unterminated quote: an apostrophe in prose
                buf.append(text[i])
                i += 1
            out.append("".join(buf))
            prev = ")"
            continue

        if ch not in " \t\r\n":
            prev = ch
        if ord(ch) > 0x7E:
            out.append(ch)  # JSX text — see the note above
        i += 1
    return out


def printable_strings() -> dict[str, list[Path]]:
    """Every character the app's own copy contributes, and where it came from."""
    seen: dict[str, list[Path]] = {}
    paths = sorted(SRC.rglob("*.ts")) + sorted(SRC.rglob("*.tsx"))
    for path in paths:
        if path.name.endswith((".test.ts", ".test.tsx")):
            continue
        for literal in literals(path.read_text(encoding="utf-8")):
            for char in literal:
                if char in IGNORED or ord(char) < 0x20:
                    continue
                if path not in seen.setdefault(char, []):
                    seen[char].append(path)
    return seen


def cmaps() -> tuple[dict[str, set[int]], dict[str, set[int]]]:
    have: dict[str, set[int]] = {}
    kept: dict[str, set[int]] = {}
    for package, weight, name in faces():
        source = UPSTREAM / package / weight / f"{name}.ttf"
        subset = SUBSET / f"{name}.ttf"
        if not source.exists():
            sys.exit(
                f"missing {source} — run `npm install` in mobile/ first.\n\n"
                "If it was removed rather than uninstalled: `@expo-google-fonts`\n"
                "is a dependency on purpose. Nothing imports it at runtime any\n"
                "more — `typography.ts` loads the subsets out of\n"
                "`mobile/assets/fonts` — but it is what the subsetter rebuilds\n"
                "from, and the only thing this check can compare against. Its\n"
                "OFL attribution in `mobile/src/data/licences.ts` stays either\n"
                "way: a subset is still the font."
            )
        if not subset.exists():
            sys.exit(f"missing {subset} — run `python3 tools/subset-text-fonts.py`")
        have[name] = set(TTFont(source).getBestCmap())
        kept[name] = set(TTFont(subset).getBestCmap())
    return have, kept


def main() -> int:
    have, kept = cmaps()
    used = printable_strings()

    dropped: list[str] = []
    never: list[tuple[str, list[str]]] = []

    for char, paths in sorted(used.items()):
        point = ord(char)
        gone = [
            name
            for name in kept
            if point in have[name] and point not in kept[name]
        ]
        absent = [name for name in have if point not in have[name]]
        if gone:
            where = ", ".join(str(p.relative_to(ROOT)) for p in paths[:3])
            more = f" (+{len(paths) - 3} more)" if len(paths) > 3 else ""
            dropped.append(
                f"  U+{point:04X} {char!r} dropped from {', '.join(sorted(gone))}\n"
                f"      used in {where}{more}"
            )
        elif absent:
            never.append((char, sorted(absent)))

    if never:
        # Reported, never failed: no change to this repository can add a glyph
        # to a font that does not have one, and the app has always rendered
        # these in the system font. Which faces lack it is the useful half —
        # ♭ is in none of them, while ⁵ is in Inter and only missing from
        # Newsreader, and those are different facts about a screen.
        print(
            f"check-font-coverage: {len(never)} character(s) upstream never "
            f"had, so they fall back to the system font as they always have:"
        )
        for char, absent in never:
            missing = (
                "in no text face at all"
                if len(absent) == len(have)
                else "missing from " + ", ".join(absent)
            )
            print(f"  U+{ord(char):04X} {char} — {missing}")

    if dropped:
        print(
            f"\ncheck-font-coverage: {len(dropped)} character(s) the subset "
            f"dropped\n"
        )
        print("\n".join(dropped))
        print(
            "\nAdd the codepoint to `COVERAGE` or `EXTRA` in "
            "tools/subset-text-fonts.py and regenerate, or use a character the "
            "font has."
        )
        return 1

    print(
        f"check-font-coverage: {len(used)} distinct characters in the app's own "
        f"copy, and the subset kept every one its font had."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
