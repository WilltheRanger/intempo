#!/usr/bin/env python3
"""Run the gates CI would run, here, in one command.

    tools/preflight.py            # everything that does not need a build
    tools/preflight.py --full     # and the builds, the walk and the audits

**Why this exists.** On 2026-09-09 every job in `.github/workflows/ci.yml` was
found failing **two to three seconds** after it started, with no logs at all —
`HTTP 404` on the log download, which is what GitHub returns when a run is
blocked before a runner picks it up. Six jobs, every push, for days. The
repository looked like it had six gates and had none, and the only reason
anything was checked is that the sessions working on it ran the commands by
hand.

Running them by hand is also how you forget one. This is the list, in one
place, so "did the checks pass" has an answer that does not depend on
remembering what the answer is made of.

**It is not a replacement for CI.** It runs on one machine, with one Node and
one Python, against whatever is in the working tree rather than against what
was pushed. `check-migrations` needs a Postgres this does not start, and the
whole point of a hosted runner is that it is not your laptop. When Actions is
paying its way again, this stays useful as the thing you run *before* pushing.

**The `.env` rule is encoded here rather than remembered.** `build:web` bakes
`EXPO_PUBLIC_*` into the bundle, so a build meant to run on fixtures has to be
made with `mobile/.env` moved aside — and moved *back*, which is the half that
gets forgotten. `EDIT_LOG` records it as a rule; this makes it a code path,
with the file restored in a `finally` and compared byte-for-byte afterwards.
"""

from __future__ import annotations

import argparse
import filecmp
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "mobile"
BACKEND = ROOT / "backend"

#: `(label, command, working directory)`, in the order CI runs them — cheapest
#: first, so a broken lint answers in a second rather than after the suite.
FAST: list[tuple[str, list[str], Path]] = [
    ("brand assets", ["python3", "tools/check-brand-assets.py"], ROOT),
    ("dead exports", ["python3", "tools/check-dead-exports.py"], ROOT),
    ("dependencies", ["python3", "tools/check-dependencies.py"], ROOT),
    ("backend lint", ["uv", "run", "ruff", "check", "app/", "scripts/", "modal_app.py"], BACKEND),
    ("mobile typecheck", ["npm", "run", "typecheck"], MOBILE),
    ("mobile lint", ["npm", "run", "lint"], MOBILE),
    ("mobile tests", ["npm", "test"], MOBILE),
    ("backend tests", ["uv", "run", "pytest", "-q"], BACKEND),
]


@contextmanager
def env_moved_aside():
    """`mobile/.env` out of the way, and back again whatever happens.

    Restored in a `finally` and then compared with `filecmp`, because "I put it
    back" is a claim and this is the check. A build that silently kept the live
    Supabase keys is a fixtures build that is not one.
    """
    env = MOBILE / ".env"
    if not env.exists():
        yield
        return
    keep = env.with_suffix(".env.preflight-backup")
    shutil.copy2(env, keep)
    env.rename(env.with_suffix(".env.preflight-aside"))
    try:
        yield
    finally:
        aside = env.with_suffix(".env.preflight-aside")
        if aside.exists():
            aside.rename(env)
        if not env.exists() or not filecmp.cmp(keep, env, shallow=False):
            print(
                "preflight: mobile/.env was NOT restored intact — restore it "
                f"from {keep.name} before doing anything else.",
                file=sys.stderr,
            )
            sys.exit(2)
        keep.unlink()


def run(label: str, command: list[str], cwd: Path) -> tuple[str, bool, float]:
    started = time.monotonic()
    done = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
    took = time.monotonic() - started
    ok = done.returncode == 0
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}  ({took:.1f}s)")
    if not ok:
        tail = (done.stdout + done.stderr).strip().splitlines()[-15:]
        for line in tail:
            print(f"        {line}")
    return label, ok, took


#: Not 4320. CI has the port to itself; a laptop may well have something on it,
#: and a preflight that fails because of an unrelated dev server is a preflight
#: nobody trusts.
PORT = 4327


def walk_the_built_app() -> list[tuple[str, bool, float]]:
    """Serve `mobile/dist` and run the two checks that need a running app."""
    server = subprocess.Popen(
        ["node", str(ROOT / "tools" / "serve-with-headers.mjs"), "dist", str(PORT)],
        cwd=MOBILE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            probe = subprocess.run(
                ["curl", "-sf", "-o", "/dev/null", f"http://localhost:{PORT}/"],
                capture_output=True,
            )
            if probe.returncode == 0:
                break
            time.sleep(0.5)
        else:
            print(f"  FAIL  serve  (the built app never came up on :{PORT})")
            return [("serve", False, 30.0)]

        return [
            run("app walk", ["node", str(ROOT / "tools" / "walk-app.mjs"), str(PORT)], MOBILE),
            run("accessibility", ["node", str(ROOT / "tools" / "audit-a11y.mjs"), str(PORT)], MOBILE),
        ]
    finally:
        server.terminate()
        server.wait(timeout=10)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--full",
        action="store_true",
        help="also build the web bundle and run the walk and accessibility audits",
    )
    args = parser.parse_args()

    print("preflight: the checks CI would run, if CI were running\n")
    results = [run(*check) for check in FAST]

    if args.full:
        print("\n  building the fixtures bundle (mobile/.env moved aside)")
        with env_moved_aside():
            results.append(run("web build", ["npm", "run", "build:web"], MOBILE))
        # Serving and walking needs the build to have worked; skip rather than
        # report a walk failure that is really a build failure wearing a mask.
        if results[-1][1]:
            results.extend(walk_the_built_app())
        else:
            print("  ....  walk + a11y  (skipped: the build did not produce one)")

    failed = [label for label, ok, _ in results if not ok]
    total = sum(took for _, _, took in results)
    print(f"\npreflight: {len(results) - len(failed)}/{len(results)} in {total:.0f}s")
    if failed:
        print("failed: " + ", ".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
