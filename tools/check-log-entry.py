#!/usr/bin/env python3
"""Refuse a commit that changes the product without saying what changed.

    tools/check-log-entry.py <base>..<head>
    tools/check-log-entry.py            # staged changes

`CLAUDE.md` §1 makes four logs binding and part of the Definition of Done, and
`EDIT_LOG.md` is the one that applies to every meaningful change. Nothing
checked it.

**Written because it happened.** On 2026-08-26 a commit landed with its tooling
changes and without its entry: the script that writes the entry ran from the
wrong directory and failed on a relative path, while the `git commit` in the
same shell command succeeded. Nothing anywhere noticed, and the gap was found
by reading the output afterwards — which is exactly the kind of silent gap the
three ticks before it had been about.

A log entry is a claim about work, so this cannot check that the entry is
*good*. It checks the one thing a program can: that the change did not go out
in silence.
"""

from __future__ import annotations

import subprocess
import sys

#: Trees whose contents are the product. A change under one of these is what
#: `CLAUDE.md` means by "a meaningful change".
#:
#: `tools/` is here deliberately. The benches decide what gets measured and
#: therefore what gets believed — this session, two conclusions came from a
#: bench that silently skipped a production gate — so a change to one is
#: exactly as worth recording as a change to the code it measures.
CODE_TREES = ("backend/", "mobile/", "frontend/", "tools/", "fixtures/", ".github/")

#: The entry itself, and the files that are already a record rather than a
#: change needing one.
LOGS = ("EDIT_LOG.md", "DECISIONS.md", "TUNING_LOG.md")


def needs_an_entry(paths: list[str]) -> list[str]:
    """The changed code files that went unrecorded, or an empty list.

    Empty when nothing under `CODE_TREES` changed — a commit that only edits
    the logs, `CLAUDE.md` or a README is a record, not a change needing one —
    and empty when `EDIT_LOG.md` is among the paths.
    """
    if "EDIT_LOG.md" in paths:
        return []
    return sorted(p for p in paths if p.startswith(CODE_TREES))


def _changed(argv: list[str]) -> list[str]:
    if len(argv) > 1:
        cmd = ["git", "diff", "--name-only", argv[1]]
    else:
        cmd = ["git", "diff", "--cached", "--name-only"]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return [line for line in out.stdout.splitlines() if line.strip()]


def main(argv: list[str]) -> int:
    unrecorded = needs_an_entry(_changed(argv))
    if not unrecorded:
        return 0
    print("This change touches the product and adds no EDIT_LOG.md entry:")
    for path in unrecorded[:20]:
        print(f"  {path}")
    if len(unrecorded) > 20:
        print(f"  … and {len(unrecorded) - 20} more")
    print()
    print("CLAUDE.md §1: the four logs are part of the Definition of Done.")
    print("Add the entry — newest at the top — and commit it with the change.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
