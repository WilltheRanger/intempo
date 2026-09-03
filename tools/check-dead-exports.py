#!/usr/bin/env python3
"""Refuse an export that nothing anywhere references.

    tools/check-dead-exports.py

**Written because it happened, three times.** Code that is built, documented
and never wired up is this project's most-repeated defect, and it is invisible
by construction: it compiles, it is tested, it reads as finished work, and the
only symptom is a feature quietly not existing.

- `describeFixtureReason` was written to say at boot whether a build is on
  fixtures or on real data, and was never called — so the one moment it existed
  for, somebody opening a fresh deployment and seeing a library of Bach they
  did not put there, had no answer.
- `POST /v1/analyses/:id/corrections` is complete, owner-scoped and tested, and
  no client posted to it, so the table the Batch 3 tuning depends on was empty
  for every account by construction. `test_client_reachability.py` is the
  standing check that came out of that — **on the server side only**.
- `instrumentInUse` was named by `CLAUDE.md` as the mechanism that reconciles
  the account's instrument with the device's, and was called by nothing. A
  cellist signing in on a second phone was analysed with violin thresholds.

This is that check for the client. It is deliberately the strictest, quietest
form: a named export that appears **nowhere else in the corpus at all** — not
in a screen, not in a test, not in a tool. One hit today, out of 512.

What it cannot see, said plainly: a name common enough to appear in unrelated
text is matched by that text and passes. That makes the failures here false
*negatives*, never false alarms — which is the direction a check has to fail in
if people are going to keep running it.

There is **no allowlist**, on purpose. An exclusion list is a thing that rots
(`fixtures/timeline/parity.json`'s `excluded_on_purpose` listed repeats long
after playback started expanding them), and the remedy for an export nothing
uses is not an entry here, it is to stop exporting it.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: The shipping app. `frontend/` is the legacy Vite tree and is not the
#: product — see `CLAUDE.md` — so a dead export there is not a defect worth
#: failing a build over.
SOURCES = (ROOT / "mobile" / "src",)

#: Also searched for *references*, never for definitions: a build script or a
#: bench importing from `src` is a real use, and missing one would be the one
#: kind of false alarm this check must not produce.
ALSO_REFERENCED_BY = (ROOT / "mobile" / "scripts", ROOT / "tools")

_EXPORT = re.compile(
    r"^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.M,
)

#: A floor, so a broken glob reports "clean" instead of nothing. The tree held
#: 512 named exports when this was written; anything under a few hundred means
#: the scan found the wrong files.
_MIN_EXPORTS = 300


def _files(roots: tuple[Path, ...], suffixes: tuple[str, ...]) -> list[Path]:
    return sorted(
        p
        for root in roots
        if root.is_dir()
        for p in root.rglob("*")
        if p.suffix in suffixes and p.is_file()
    )


def main() -> int:
    defining = _files(SOURCES, (".ts", ".tsx"))
    corpus = defining + _files(ALSO_REFERENCED_BY, (".ts", ".tsx", ".mjs", ".js"))
    text = {p: p.read_text(encoding="utf-8") for p in corpus}

    scanned = 0
    dead: list[tuple[str, Path]] = []
    for path in defining:
        # A test file defines nothing the app ships.
        if ".test." in path.name:
            continue
        for match in _EXPORT.finditer(text[path]):
            scanned += 1
            name = match.group(1)
            word = re.compile(r"\b" + re.escape(name) + r"\b")
            # Every occurrence in the corpus, less the one inside the `export`
            # statement that defines it.
            hits = sum(len(word.findall(body)) for body in text.values()) - 1
            if hits == 0:
                dead.append((name, path))

    if scanned < _MIN_EXPORTS:
        print(
            f"check-dead-exports: only {scanned} exports found under "
            f"{', '.join(str(s) for s in SOURCES)} — the scan is looking in the "
            "wrong place, not at a tidy tree.",
            file=sys.stderr,
        )
        return 2

    if dead:
        print(
            f"check-dead-exports: {len(dead)} export(s) that nothing references:\n",
            file=sys.stderr,
        )
        for name, path in dead:
            print(f"  {name}  ({path.relative_to(ROOT)})", file=sys.stderr)
        print(
            "\nEach is either a feature that was never wired up — which is what "
            "this check exists\nto find — or something that simply should not be "
            "exported. Wire it or unexport it;\nthere is no allowlist.",
            file=sys.stderr,
        )
        return 1

    print(f"check-dead-exports: {scanned} exports, all of them referenced.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
