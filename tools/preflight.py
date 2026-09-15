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
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "mobile"
BACKEND = ROOT / "backend"

@dataclass(frozen=True)
class Prereq:
    """Something a gate needs installed, and the one command that installs it.

    **"I could not look" is not "it is wrong", and this printed them the
    same.** In a fresh checkout — or this project's session container, which
    has no `mobile/node_modules` — four of the ten gates below failed for want
    of an install and were reported exactly like a defect: `FAIL  mobile
    typecheck` under fourteen `TS17004: Cannot use JSX unless the '--jsx' flag
    is provided`, which is what `tsc` says when `expo/tsconfig.base` is not on
    disk. Nothing there is about the code, and working that out costs a
    session the same attention a real failure would.

    That is the mistake `check-brand-assets.py` was rewritten to stop making
    after CI hit it on 2026-09-12 — *"a check that cannot say why it failed is
    worse than one that does not run, because the first is believed"* — and
    this file was making it four times over, one level up.

    `migrations_gate` already had the shape: say it was skipped, say what is
    missing, and print the one command that fixes it.
    """

    #: What is missing, named the way the reader would search for it.
    missing: str
    #: The command that installs it, runnable from the repository root.
    fix: str
    #: Cheap enough to ask before every gate — a `stat`, or one interpreter
    #: start. Never the gate's own work.
    present: Callable[[], bool]

    def satisfied(self) -> bool:
        return self.present()


def _node_modules() -> bool:
    """Whether `npm` can resolve anything in `mobile/`.

    A directory test rather than a probe command: `npm ls` on a tree this size
    is seconds, and every `npm` gate here fails identically without it.
    """
    return (MOBILE / "node_modules").is_dir()


def _font_tools() -> bool:
    """Whether the interpreter that will run the check can import fontTools.

    Asked of `python3` in a subprocess rather than of *this* process, because
    that is the interpreter the command below uses and the two need not be the
    same one.
    """
    return (
        subprocess.run(
            ["python3", "-c", "import fontTools"],
            capture_output=True,
            check=False,
        ).returncode
        == 0
    )


#: `mobile/node_modules` and the fontTools pin, which is the one `ci.yml`
#: installs by hand — see its "fontTools, for the font subset guard" step.
NODE_MODULES = Prereq(
    missing="mobile/node_modules",
    fix="npm --prefix mobile ci",
    present=_node_modules,
)
FONT_TOOLS = Prereq(
    missing="fontTools",
    fix="python3 -m pip install 'fonttools==4.64.0'",
    present=_font_tools,
)


#: `(label, command, working directory, what it needs first)`, in the order CI
#: runs them — cheapest first, so a broken lint answers in a second rather than
#: after the suite. An empty tuple for a gate that needs nothing installed.
#:
#: **`font coverage` needs both**, which is why this is a tuple rather than one
#: prerequisite: it reads `cmap` tables with fontTools, and it reads them out of
#: `@expo-google-fonts` in `mobile/node_modules` — what the subsetter rebuilds
#: from, and the only thing it can compare the shipped subsets against.
FAST: list[tuple[str, list[str], Path, tuple[Prereq, ...]]] = [
    ("brand assets", ["python3", "tools/check-brand-assets.py"], ROOT, ()),
    ("dead exports", ["python3", "tools/check-dead-exports.py"], ROOT, ()),
    ("dependencies", ["python3", "tools/check-dependencies.py"], ROOT, ()),
    ("outbound fetch", ["python3", "tools/check-outbound-fetch.py"], ROOT, ()),
    (
        "backend lint",
        ["uv", "run", "ruff", "check", "app/", "scripts/", "modal_app.py"],
        BACKEND,
        (),
    ),
    ("mobile typecheck", ["npm", "run", "typecheck"], MOBILE, (NODE_MODULES,)),
    ("mobile lint", ["npm", "run", "lint"], MOBILE, (NODE_MODULES,)),
    (
        "font coverage",
        ["python3", "tools/check-font-coverage.py"],
        ROOT,
        (FONT_TOOLS, NODE_MODULES),
    ),
    ("mobile tests", ["npm", "test"], MOBILE, (NODE_MODULES,)),
    ("backend tests", ["uv", "run", "pytest", "-q"], BACKEND, ()),
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
        lines = [
            "  ....  migrations  (skipped: no DATABASE_URL)",
            "        Any empty Postgres will do, and the check leaves it dirty on "
            "purpose:",
            "        DATABASE_URL=postgresql://…/scratch tools/preflight.py",
        ]
        if _postgres_is_answering():
            # **This gate had been skipped for want of a server that was
            # already running.** The advice above is true and abstract, and
            # every session read it as "there is no Postgres here" — so the one
            # check that can catch SQL that does not run had never run at all.
            # A session that knows a server is answering can get from here to a
            # passing gate in one command.
            lines += [
                "        A server on this machine is answering. If this shell's "
                "user has no role",
                "        on it:  su postgres -c 'createdb preflight' && "
                "DATABASE_URL=… (as above)",
            ]
        print("\n".join(lines))
        return None
    return run("migrations", ["python3", "tools/check-migrations.py"], ROOT)


def _postgres_is_answering() -> bool:
    """Whether *some* Postgres on this machine accepts connections.

    Asked with `pg_isready`, which reports the server and says nothing about
    whether this user can log in — which is the point. Being unable to
    authenticate is a fixable step; there being no server at all is not, and
    the two were indistinguishable from the message above.
    """
    if shutil.which("pg_isready") is None:
        return False
    try:
        return (
            subprocess.run(
                ["pg_isready", "-q"], timeout=5, check=False
            ).returncode
            == 0
        )
    except (OSError, subprocess.SubprocessError):
        return False


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


#: Every gate that did not run, and what was missing. Reprinted at the end and
#: counted in the summary line: a skip that scrolls off the top of a ten-minute
#: run is a skip nobody sees, and `10/10` over a gate that never ran is the
#: green light this script's own docstring argues against.
SKIPPED: list[tuple[str, tuple[Prereq, ...]]] = []


def run_or_skip(
    label: str, command: list[str], cwd: Path, needs: tuple[Prereq, ...]
) -> tuple[str, bool, float] | None:
    """The gate, unless what it needs is not installed — then say so instead.

    Returns `None` for a skip, which keeps it out of the pass/fail tally the
    way `migrations_gate` already does. It goes into `SKIPPED` instead, so the
    summary can count it rather than quietly rounding it down to nothing.

    **Every missing prerequisite, not the first.** Installing what one line
    named and running again to be told about the next one is the same waste in
    slow motion.
    """
    absent = [need for need in needs if not need.satisfied()]
    if absent:
        gone = ", no ".join(need.missing for need in absent)
        print(f"  ....  {label}  (skipped: no {gone})")
        for need in absent:
            print(f"        {need.fix}")
        SKIPPED.append((label, tuple(absent)))
        return None
    return run(label, command, cwd)


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
            # The microphone and the camera, on devices Chromium invents.
            # The only gate that reaches the hardware edge; everything else
            # here stops where the app asks the OS for a device.
            run("devices", ["node", str(ROOT / "tools" / "device-check.mjs"), str(PORT)], MOBILE),
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
    results = [done for check in FAST if (done := run_or_skip(*check)) is not None]
    migrations = migrations_gate()
    if migrations is not None:
        results.append(migrations)

    if args.full and not NODE_MODULES.satisfied():
        # **One line rather than eight failures.** Everything under `--full`
        # is `npm`, `npx` or a server serving what they built, so without the
        # install they all fail at once and none of it is about the code —
        # the same confusion the fast gates above now avoid, at eight times
        # the volume and after a `.env` has been moved aside to get there.
        print(f"\n  ....  builds + walk + a11y  (skipped: no {NODE_MODULES.missing})")
        print(f"        {NODE_MODULES.fix}")
        SKIPPED.append(("builds + walk + a11y", (NODE_MODULES,)))
    elif args.full:
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

    if SKIPPED:
        # Reprinted rather than left where it scrolled past. On a `--full` run
        # the skip is minutes above this line, and the number beside it is the
        # only place the reader is still looking.
        print("\n  did not run here:")
        for label, needs in SKIPPED:
            missing = ", ".join(need.missing for need in needs)
            fixes = ";  ".join(dict.fromkeys(need.fix for need in needs))
            print(f"    {label} — no {missing};  {fixes}")

    failed = [label for label, ok, _ in results if not ok]
    total = sum(took for _, _, took in results)
    ran = len(results)
    tally = f"\npreflight: {ran - len(failed)}/{ran} in {total:.0f}s"
    if SKIPPED:
        tally += f", {len(SKIPPED)} skipped"
    print(tally)
    if failed:
        print("failed: " + ", ".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
