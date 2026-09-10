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

**What it does not run is printed, not omitted.** A stand-in for CI that
quietly covers less than CI is worse than no stand-in, because it reads as a
green light. Every job in `.github/workflows/ci.yml` is either a gate below or
a line in `NOT_COVERED` with a reason. That mattered immediately: on 2026-09-09
a migration was written, tested, committed and pushed without ever being
applied to a database, because the migrations job lives only in CI and CI was
blocked — and nothing said so out loud.
"""

from __future__ import annotations

import argparse
import filecmp
import os
import shutil
import subprocess
import sys
import tempfile
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
    ("outbound fetch", ["python3", "tools/check-outbound-fetch.py"], ROOT),
    ("backend lint", ["uv", "run", "ruff", "check", "app/", "scripts/", "modal_app.py"], BACKEND),
    ("mobile typecheck", ["npm", "run", "typecheck"], MOBILE),
    ("mobile lint", ["npm", "run", "lint"], MOBILE),
    ("mobile tests", ["npm", "test"], MOBILE),
    ("backend tests", ["uv", "run", "pytest", "-q"], BACKEND),
]


#: CI jobs and steps this cannot run, and why. Printed at the end of every run.
#:
#: The point is that the list is *visible*. A gate that exists only in a
#: blocked workflow is a gate that is not running, and the way that fact stays
#: known is by being said on every preflight rather than remembered.
#: Empty since 2026-09-10, and worth keeping rather than deleting: the one
#: entry it held was the `EDIT_LOG` gate, and that log is gone. A future gate
#: that CI can run and this cannot goes here, so the gap stays visible.
NOT_COVERED: list[tuple[str, str]] = []


def migrations_gate() -> tuple[str, bool, float] | None:
    """Apply every migration in order, when there is a database to apply to.

    **Reported as skipped rather than left out.** `check-migrations.py` needs a
    Postgres, exits 2 without one, and was simply absent from this list — so a
    preflight that said 8/8 had checked nothing about the schema, and said
    nothing about not having. On 2026-09-09 that let a migration go out
    unguarded and unregistered; the two static checks in `test_readiness.py`
    caught those, and neither of them can catch SQL that does not run.
    """
    dsn = os.getenv("DATABASE_URL", "")
    if not dsn:
        print(
            "  ....  migrations  (skipped: no DATABASE_URL)\n"
            "        Any empty Postgres will do, and the check leaves it dirty on "
            "purpose:\n"
            "        DATABASE_URL=postgresql://…/scratch tools/preflight.py"
        )
        return None
    return run("migrations", ["python3", "tools/check-migrations.py"], ROOT)


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


def _came_up(port: int, seconds: float = 30) -> bool:
    """Poll rather than sleep — the point is to start when it is ready."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        probe = subprocess.run(
            ["curl", "-sf", "-o", "/dev/null", f"http://localhost:{port}/"],
            capture_output=True,
        )
        if probe.returncode == 0:
            return True
        time.sleep(0.5)
    return False


def walk_the_built_app() -> list[tuple[str, bool, float]]:
    """Serve `mobile/dist` and run the two checks that need a running app."""
    server = subprocess.Popen(
        ["node", str(ROOT / "tools" / "serve-with-headers.mjs"), "dist", str(PORT)],
        cwd=MOBILE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        if not _came_up(PORT):
            print(f"  FAIL  serve  (the built app never came up on :{PORT})")
            return [("serve", False, 30.0)]

        audit = ["node", str(ROOT / "tools" / "audit-a11y.mjs"), str(PORT)]
        return [
            run("app walk", ["node", str(ROOT / "tools" / "walk-app.mjs"), str(PORT)], MOBILE),
            run("accessibility", audit, MOBILE),
            # **Both appearances, against the same build.** The audit's findings
            # — touch targets, focus order, accessible names, labels that spill
            # at 2x text — are palette-independent in principle and not in
            # practice: a control whose label is drawn in the wrong token is
            # invisible in exactly one of the two modes. `contrast.test.ts`
            # holds the dark palette's arithmetic and cannot see any of that.
            run("accessibility, dark", [*audit, "--dark"], MOBILE),
        ]
    finally:
        server.terminate()
        server.wait(timeout=10)


def build_the_ios_bundle() -> tuple[str, bool, float]:
    """Metro's *native* module graph, compiled by Hermes.

    **The App Store target, and everything else here is the web one.** The two
    graphs are not the same: `.web.ts` files resolve to native siblings,
    `Platform.OS` branches fold the other way, and a web-only import in shared
    code is invisible until a phone runs it. This proves the bundle builds; it
    proves nothing about how it behaves, and the native recorder and player
    have still never made a sound.

    Into a temporary directory that is then removed — the output is 6 MB of
    Hermes bytecode nobody reads, and building it inside `env_moved_aside`
    keeps live Supabase keys out of a file this script leaves behind.
    """
    out = tempfile.mkdtemp(prefix="preflight-ios-")
    try:
        return run(
            "ios bundle",
            ["npx", "expo", "export", "--platform", "ios", "--output-dir", out],
            MOBILE,
        )
    finally:
        shutil.rmtree(out, ignore_errors=True)


def audit_the_empty_account() -> list[tuple[str, bool, float]]:
    """The state every musician meets first, which no other build here has.

    Today, Library and Insights are otherwise always seen with a library, a
    take and thirty days of trend behind them. That gap cost a real bug on
    2026-09-02 — Today saying "Nothing to practice yet" above a fully built
    daily warmup it was hiding — found by hand, because reaching the state took
    five source edits and a revert.

    Named routes, because the rest of the list points at `fixture-…` ids an
    empty account does not have; sweeping them would measure a page of
    not-found states.
    """
    built = run("web build, empty account", ["npm", "run", "build:web:empty"], MOBILE)
    if not built[1]:
        return [built]
    port = PORT + 1
    server = subprocess.Popen(
        ["node", str(ROOT / "tools" / "serve-with-headers.mjs"), "dist-empty", str(port)],
        cwd=MOBILE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        if not _came_up(port):
            print(f"  FAIL  serve (empty)  (never came up on :{port})")
            return [built, ("serve (empty)", False, 30.0)]
        empty = [
            "node",
            str(ROOT / "tools" / "audit-a11y.mjs"),
            str(port),
            "Today",
            "Library",
            "Insights",
            "Profile",
        ]
        return [
            built,
            run("accessibility, empty account", empty, MOBILE),
            # Four routes, so the second appearance costs seconds rather than
            # the ninety the full sweep does. Worth those seconds: an empty
            # state is mostly type on a bare ground, which is precisely the
            # composition where reaching for the wrong token leaves nothing
            # visible at all rather than something that looks slightly off.
            run("accessibility, empty account, dark", [*empty, "--dark"], MOBILE),
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
    migrations = migrations_gate()
    if migrations is not None:
        results.append(migrations)

    if args.full:
        print("\n  building the fixtures bundles (mobile/.env moved aside)")
        with env_moved_aside():
            results.append(run("web build", ["npm", "run", "build:web"], MOBILE))
            web_built = results[-1][1]
            if web_built:
                # Straight after the build, on the artefact it just produced.
                # The number this guards is invisible to every other gate here:
                # a barrel import type-checks, lints, tests green and leaves the
                # app identical, 180 KB heavier.
                results.append(
                    run(
                        "bundle size",
                        ["node", str(ROOT / "tools" / "check-bundle-size.mjs")],
                        ROOT,
                    )
                )
            # Inside the same block: the iOS export bakes `EXPO_PUBLIC_*` too,
            # and this one is a check, not a release.
            results.append(build_the_ios_bundle())
            if web_built:
                results.extend(audit_the_empty_account())
            else:
                print("  ....  empty account  (skipped: the build did not produce one)")
        # Serving and walking needs the build to have worked; skip rather than
        # report a walk failure that is really a build failure wearing a mask.
        if web_built:
            results.extend(walk_the_built_app())
        else:
            print("  ....  walk + a11y  (skipped: the build did not produce one)")

    if NOT_COVERED:
        print("\n  not covered here:")
        for label, why in NOT_COVERED:
            print(f"    {label} — {why}")

    failed = [label for label, ok, _ in results if not ok]
    total = sum(took for _, _, took in results)
    print(f"\npreflight: {len(results) - len(failed)}/{len(results)} in {total:.0f}s")
    if failed:
        print("failed: " + ", ".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
