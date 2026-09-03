"""Run this tool under the backend's interpreter, whatever was used to start it.

**Eight of the twelve tools here could not be started the way they document
themselves** (measured 2026-09-03). `tools/engraver-coverage.py` says
`python tools/engraver-coverage.py`; `homr-bench`, `pipeline-check`,
`notation-coverage` and `musicxml-bench` print a bare `tools/x.py ...` and
carry a `#!/usr/bin/env python3` shebang. All of them import `app.*`, which
lives in `backend/.venv`, so every one of those commands ends in
`ModuleNotFoundError: No module named 'pydantic'` before a single fixture is
read.

That matters more here than in most repositories, because `CLAUDE.md` puts
`tools/` on the list of things a change must be recorded for, and says why:
*"The benches decide what gets measured and therefore what gets believed."* A
bench nobody can start is a bench nobody runs, and the measurement it would
have produced is quietly replaced by whatever people already believed.

The fix is the same one `tools/audit-a11y.mjs` documents for itself — its
`require` is anchored to `mobile/package.json` so the lookup matches the
install *"from any working directory"*. Here that means re-executing under
`backend/.venv/bin/python` rather than telling five docstrings to say
something longer. Making the documented command true beats documenting the
awkward one.

Import and call this **before** any `app.*` import:

    from backend_python import use_backend_python

    use_backend_python()
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VENV = REPO / "backend" / ".venv"

#: Set across the re-exec so a venv that is itself missing a dependency fails
#: with that dependency's error rather than looping.
_ALREADY = "INTEMPO_TOOL_REEXECED"


def use_backend_python() -> None:
    """Re-exec under `backend/.venv` unless we are already there.

    Silent on every path that cannot help: already inside the venv (which is
    what `cd backend && uv run python ../tools/x.py` gives), already
    re-executed once, or no venv on disk. In that last case the tool goes on to
    fail on its own import, which is the right error — "no module named
    pydantic" tells you to install the backend, and a message from here about
    a missing `.venv` would not.
    """
    if os.environ.get(_ALREADY):
        return
    python = VENV / "bin" / "python"
    if not python.exists():
        return
    try:
        if Path(sys.prefix).resolve() == VENV.resolve():
            return
    except OSError:  # pragma: no cover - an unreadable prefix is not our problem
        return

    # `sys.argv[0]` may be relative; the working directory is preserved across
    # the exec, so either form resolves, and the absolute one also survives a
    # tool that chdirs before re-reading it.
    argv = [str(python), os.path.abspath(sys.argv[0]), *sys.argv[1:]]
    os.execve(str(python), argv, {**os.environ, _ALREADY: "1"})
