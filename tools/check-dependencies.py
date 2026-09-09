#!/usr/bin/env python3
"""What the dependency advisories actually mean for this app.

    tools/check-dependencies.py

**Why this is not just `npm audit`.** Run bare, `npm audit` on this tree
reports 24 advisories — 7 high — and ends with the advice to run
`npm audit fix --force`. Following that advice would resolve `expo` to
**46.0.21**: a downgrade of eleven major versions, SDK 57 to SDK 46, because
npm's resolver will happily satisfy "no known advisory" by going back to a
release from before the vulnerable transitive dependency existed. It would not
warn you that it had; it would report the vulnerabilities fixed.

So the raw number is worse than useless here. It is alarming, it is mostly
about software that never reaches a musician, and the remedy it names destroys
the app.

**What the advisories are.** Every high-severity one is build tooling —
`metro`, `metro-config`, `metro-transform-worker` and `@expo/metro` are the
bundler; `js-yaml` and `image-size` are read by Expo's asset and config
pipeline; `@xmldom/xmldom` comes in through `@expo/prebuild-config`, which
rewrites native manifests. All of them run on a developer's machine or a CI
runner, at build time, against inputs from this repository. None is in the
bundle that a browser downloads or in the binary a phone runs.

That is a real distinction and it is not a dismissal: a malicious `.icns` or a
hostile XML in a build input could hang or exploit the machine doing the build.
It is a smaller and differently-shaped risk than "the app is vulnerable", and
saying which one it is, is the job.

**What this checks.** `critical` fails, because nothing here is critical today
and one appearing deserves a stop. Everything else is reported with its
severity and the packages involved, so the number can be watched rather than
either ignored or panicked at.

**Not covered: the Python side.** `uv` has no audit, and `backend/` is not
checked by anything. That is a real gap and it is named here rather than left
to be discovered.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "mobile"

#: Never run. Kept as a string rather than a comment so that a search for it
#: lands on the explanation above rather than on somebody's shell history.
DESTRUCTIVE = "npm audit fix --force"


def main() -> int:
    done = subprocess.run(
        ["npm", "audit", "--omit=dev", "--json"],
        cwd=MOBILE,
        capture_output=True,
        text=True,
    )
    # A non-zero exit only means "advisories exist", which is the normal state.
    if not done.stdout.strip():
        print(f"check-dependencies: npm audit produced nothing\n{done.stderr[:400]}",
              file=sys.stderr)
        return 2

    report = json.loads(done.stdout)
    counts = report.get("metadata", {}).get("vulnerabilities", {})
    packages = report.get("vulnerabilities", {})

    critical = sorted(n for n, i in packages.items() if i.get("severity") == "critical")
    high = sorted(n for n, i in packages.items() if i.get("severity") == "high")

    summary = ", ".join(
        f"{n} {level}" for level, n in counts.items() if n and level != "total"
    )
    print(f"check-dependencies: {summary or 'no advisories'}")
    if high:
        print(f"  high: {', '.join(high)}")
    print(
        f"\n  Do not run `{DESTRUCTIVE}` to clear these. It resolves expo to\n"
        "  46.0.21 — eleven major versions back — and reports success. See this\n"
        "  file's docstring for what the advisories actually reach."
    )

    if critical:
        print(
            f"\ncheck-dependencies: {len(critical)} critical advisory(ies): "
            f"{', '.join(critical)}\nThese are worth stopping for. Read them "
            "before changing any version.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
