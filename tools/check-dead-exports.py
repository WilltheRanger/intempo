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
text is matched by that text and passes, so most of what this misses are false
*negatives*.

**It claimed those were the only kind it could produce, and that was wrong.**
`StbVorbis` in `lib/score/sf2OnlyDecoder.ts` was reported dead on every run for
weeks, and it is not: `metro.config.js` aliases the module `stb-vorbis` to that
file, so `spessasynth_core` imports it under a name that never appears in this
corpus. A source-text scan cannot see a bundler alias keyed by package name.

The cost was not the wrong line of output. Four separate `EDIT_LOG.md` entries
recorded it as "the one pre-existing finding" and moved on, which is what a
check that cries wolf trains people to do — and on the same day, the same habit
let `walk-app.mjs`'s standing failure sit unexamined through three commits
before it turned out to be a real recording bug. A false alarm is not a
cosmetic defect in a check; it is the thing that makes the true alarms
invisible.

So the entry points are now **read from the build configuration** rather than
kept in a list here. Delete the alias and the export is reported again, which is
correct — it would genuinely be dead.

There is **no allowlist**, on purpose. An exclusion list is a thing that rots
(`fixtures/timeline/parity.json`'s `excluded_on_purpose` listed repeats long
after playback started expanding them), and the remedy for an export nothing
uses is not an entry here, it is to stop exporting it.

The one thing that reads as an exemption is not one. A **test-only** export —
referenced by its own test and by nothing that ships — may carry `@test-seam
<why>` in the comment directly above it, and it is then listed separately with
its reason printed in full. Three things keep that from being an allowlist: it
is not a list, it lives at the definition and is deleted by the same hand that
deletes the export, and the argument for it is read aloud on every run rather
than being a name in a file nobody opens. Nothing about the strict category
changes — an export the tests do not reach either still fails, with no way out
but to be wired up or unexported.
"""

from __future__ import annotations

import re
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: The shipping app, and since 2026-09-09 the only app — the legacy `frontend/`
#: Vite tree it used to have to be distinguished from was deleted. It is not the
#: product — see `CLAUDE.md` — so a dead export there is not a defect worth
#: failing a build over.
SOURCES = (ROOT / "mobile" / "src",)

#: Also searched for *references*, never for definitions: a build script or a
#: bench importing from `src` is a real use, and missing one would be the one
#: kind of false alarm this check must not produce.
ALSO_REFERENCED_BY = (ROOT / "mobile" / "scripts", ROOT / "tools")

#: Metro's resolver config, read for the modules it redirects to our own files.
#:
#: A file aliased here is imported by a *package name* — `stb-vorbis` — from
#: inside `node_modules`, which is not in this corpus and never should be. The
#: reference is real and unfindable by text search, so the config is parsed for
#: it instead of the name being exempted by hand. This is not an allowlist: it
#: is derived, and it stops being true the moment the alias is deleted.
_METRO_CONFIG = ROOT / "mobile" / "metro.config.js"
_ALIAS_TARGET = re.compile(
    r"""filePath:\s*path\.resolve\(\s*__dirname\s*,\s*['"]([^'"]+)['"]""",
)


def _bundler_entry_points() -> set[Path]:
    """Files the bundler redirects a package import to."""
    if not _METRO_CONFIG.is_file():
        return set()
    config = _METRO_CONFIG.read_text(encoding="utf-8")
    return {
        (_METRO_CONFIG.parent / relative).resolve()
        for relative in _ALIAS_TARGET.findall(config)
    }

_EXPORT = re.compile(
    r"^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.M,
)

#: A test-only export declaring itself deliberate, and saying why.
#:
#: **The instruction existed before the mechanism did.** This check closed every
#: run by telling you to "say so where it is defined" if an entry was
#: deliberate — and then read nothing, so saying so changed the output not at
#: all and the two known-fine entries were reported forever beside the real
#: ones. That is the affordance-that-does-nothing failure `CLAUDE.md` §3 names,
#: in a tool rather than on a screen, and it costs the same thing: it teaches
#: you to skim a list this file's own docstring spends four paragraphs
#: explaining why you must not skim.
#:
#: **A reason is required**, and it is printed on every run. A bare marker
#: would be the allowlist the docstring refuses; a sentence at the definition
#: site is an argument, it lives in the diff that would invalidate it, and it
#: is deleted by the same hand that deletes the export.
#:
#: This is only ever consulted for the *test-only* category. An export nothing
#: references at all still has no way out but to be wired up or unexported.
#: The reason runs to the end of its paragraph, not to the end of its line — a
#: reason worth reading is usually a sentence or two, and truncating it at the
#: first newline printed half of both of the first two written.
#:
#: It must *begin* on the marker's own line, though. `\s+` here instead of
#: `[ \t]+` let a bare `@test-seam` reach across the blank line under it and
#: adopt the next paragraph as its reason — so the marker that says nothing,
#: which this is supposed to reject, was accepted with somebody else's words.
#: Found by mutation, not by reading.
_SEAM = re.compile(r"@test-seam[ \t]+(\S.*?)(?=\n\s*\n|\n\s*@|\Z)", re.S)


def _uncomment(block: str) -> str:
    """A comment's prose, without the syntax that carries it."""
    block = re.sub(r"^\s*/\*+|\*+/\s*$", "", block)
    return "\n".join(
        re.sub(r"^\s*(?:\*|//)[ \t]?", "", line) for line in block.splitlines()
    )


def _declaration(body: str, start: int) -> str | None:
    """The `@test-seam` reason in the comment abutting an export, if any.

    Abutting, not merely nearby: a blank line or any code between the comment
    and the `export` means the comment belongs to something else, and a marker
    that drifted off its own export would exempt whatever moved underneath it.
    """
    head = body[:start]

    # `\s*` here matched a blank line, so a comment separated from its export
    # by one still counted — while the docstring above claimed the opposite.
    # One line break and any indentation, and nothing else.
    block = re.search(r"(/\*(?:[^*]|\*(?!/))*\*/)[ \t]*\n?[ \t]*\Z", head)
    if block:
        prose = _uncomment(block.group(1))
    else:
        run: list[str] = []
        for line in reversed(head.splitlines()):
            stripped = line.strip()
            if stripped.startswith("//"):
                run.append(stripped)
                continue
            break
        if not run:
            return None
        prose = _uncomment("\n".join(reversed(run)))

    found = _SEAM.search(prose)
    return " ".join(found.group(1).split()) if found else None

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

    aliased = _bundler_entry_points()

    # Split the corpus, because "referenced" was quietly counting the wrong
    # thing. A test is not a caller: an export whose only mention is its own
    # test compiles, passes, reads as finished work and **ships nothing** —
    # which is the exact failure this file's docstring says it exists to catch,
    # walking straight past it. Two modules and 209 lines were sitting behind
    # that hole when it was found, both of them designed screens nobody can
    # reach.
    shipped = {p: b for p, b in text.items() if ".test." not in p.name}
    tested = {p: b for p, b in text.items() if ".test." in p.name}

    scanned = 0
    dead: list[tuple[str, Path]] = []
    test_only: list[tuple[str, Path]] = []
    declared: list[tuple[str, Path, str]] = []
    for path in defining:
        # A test file defines nothing the app ships.
        if ".test." in path.name:
            continue
        # Whatever imports this does so by the package name the bundler
        # redirects, from outside this corpus. Counted, so the total still
        # means "every export", and not reported.
        if path.resolve() in aliased:
            scanned += len(_EXPORT.findall(text[path]))
            continue
        for match in _EXPORT.finditer(text[path]):
            scanned += 1
            name = match.group(1)
            word = re.compile(r"\b" + re.escape(name) + r"\b")
            # Every occurrence in shipping code, less the one inside the
            # `export` statement that defines it — which is itself in a
            # non-test file, so it comes off this side of the split.
            hits = sum(len(word.findall(body)) for body in shipped.values()) - 1
            if hits > 0:
                continue
            if any(word.search(body) for body in tested.values()):
                reason = _declaration(text[path], match.start())
                if reason:
                    declared.append((name, path, reason))
                else:
                    test_only.append((name, path))
            else:
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

    if test_only:
        # **Reported, and deliberately not a failure yet.** Every one of these
        # is a feature somebody designed, wrote and tested, and the choice
        # between wiring it and deleting it belongs to the owner — failing the
        # build would make that choice by deadline instead. The number is
        # printed on every run so it can only be argued down.
        #
        # Promote this to `return 1` once the list is empty. A category that
        # cannot fail is a category that grows.
        print(
            f"check-dead-exports: {len(test_only)} export(s) referenced only by "
            "their own tests —\n  shipped nowhere, so the app cannot reach them:"
        )
        for name, path in test_only:
            print(f"    {name}  ({path.relative_to(ROOT)})")
        print(
            "\n  Not automatically a fault. A test seam is a real answer, and so\n"
            "  is a reference implementation the tests hold another copy to.\n"
            "  What this list is for is the *other* kind: a feature designed,\n"
            "  written and tested, that no screen can reach.\n"
            "\n  If an entry is deliberate, write `@test-seam <why>` in the comment\n"
            "  directly above it — the why on the marker's own line, running on\n"
            "  to the end of its paragraph — and it moves to the list below,\n"
            "  reason and all. A marker with nothing after it stays here."
        )

    if declared:
        # Printed rather than merely subtracted, and printed **with the reason**.
        # A declaration that disappears from the output is an allowlist; one
        # that is read aloud on every run is an argument somebody can lose.
        print(
            f"check-dead-exports: {len(declared)} export(s) declared as test "
            "seams at their\n  definition:"
        )
        for name, path, reason in declared:
            print(f"    {name}  ({path.relative_to(ROOT)})")
            # Identifiers, not prose: `pcm-recorder.worklet.js` split across
            # two lines the first time this wrapped, which makes a filename
            # ungreppable in exactly the output somebody would grep.
            print(
                textwrap.fill(
                    reason,
                    width=76,
                    initial_indent="      ",
                    subsequent_indent="      ",
                    break_on_hyphens=False,
                    break_long_words=False,
                )
            )

    print(f"check-dead-exports: {scanned} exports, all of them referenced.")
    for path in sorted(aliased):
        print(
            f"  (via the bundler alias in {_METRO_CONFIG.relative_to(ROOT)}: "
            f"{path.relative_to(ROOT)})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
