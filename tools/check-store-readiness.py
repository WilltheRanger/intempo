#!/usr/bin/env python3
"""Everything a person still has to supply before InTempo can be submitted.

    tools/check-store-readiness.py

**The list this replaces was prose, and prose went stale.** `mobile/README.md`
said "three things still need a person" and named the EAS and Apple ones. There
are six, and the three it omitted are the ones with no account behind them: the
brand assets, the publisher's own details in the privacy policy, and a hosted
policy URL. `CLAUDE.md` repeated the same three. Nothing was wrong with either
sentence when it was written; a count in prose is a claim that goes stale the
first time the world moves, which is the failure this repository keeps finding
in its own documentation.

So this reads the sources rather than restating them. Four of the six are
measured live — `app.json`, `lib/legal.ts` and the brand-asset hashes — and
stop being listed the moment they are done, with nobody editing this file. The
two that cannot be measured from a checkout (an Apple account, a store listing)
are stated as such, and say why.

**It is a report, not a gate**, for the reason `check-brand-assets.py` gives:
these are the owner's to do, they cannot be done in a session, and a check that
is red from now until launch is one people learn to skip. It exits 1 while
anything measurable is outstanding so it can still be used as a release gate by
whoever runs the submission, and 2 when it cannot read a source it depends on —
because "0 blockers" from a broken glob is the one answer it must never give.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_JSON = ROOT / "mobile" / "app.json"
LEGAL_TS = ROOT / "mobile" / "src" / "lib" / "legal.ts"


class Unreadable(Exception):
    """A source this check depends on could not be read or parsed."""


def _app_json() -> dict:
    try:
        return json.loads(APP_JSON.read_text(encoding="utf-8"))["expo"]
    except Exception as exc:  # noqa: BLE001 - any failure here is the same failure
        raise Unreadable(f"{APP_JSON.relative_to(ROOT)}: {exc}") from exc


def _owner_fields() -> dict[str, str | None]:
    """`OWNER` out of `legal.ts`, read as source rather than restated here.

    The three keys and their nullness are the whole point, and a copy of them
    in this file would be one more thing to keep in step. Parsed with a regex
    because the value is a literal by design — `legal.ts` says why it is `null`
    and not a plausible-looking placeholder.
    """
    try:
        source = LEGAL_TS.read_text(encoding="utf-8")
    except OSError as exc:
        raise Unreadable(f"{LEGAL_TS.relative_to(ROOT)}: {exc}") from exc

    block = re.search(r"^\} = \{$(.*?)^\};$", source, re.M | re.S)
    if not block:
        raise Unreadable(f"{LEGAL_TS.relative_to(ROOT)}: no OWNER literal found")

    fields: dict[str, str | None] = {}
    for name, value in re.findall(
        r"^\s*(\w+):\s*(null|'[^']*'|\"[^\"]*\"),\s*$", block.group(1), re.M
    ):
        fields[name] = None if value == "null" else value[1:-1]

    expected = {"entity", "contact", "jurisdiction"}
    if set(fields) != expected:
        raise Unreadable(
            f"{LEGAL_TS.relative_to(ROOT)}: OWNER has {sorted(fields)}, "
            f"expected {sorted(expected)}"
        )
    return fields


def _starter_assets_outstanding() -> int:
    """How many brand assets are still the Expo starter's.

    Delegated rather than reimplemented: `check-brand-assets.py` holds the
    hashes and the reasoning, and two copies of a hash list is how one of them
    goes wrong. It prints its own detail; this only needs the count.
    """
    result = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "check-brand-assets.py")],
        capture_output=True,
        text=True,
    )
    if result.returncode not in (0, 1):
        raise Unreadable(f"check-brand-assets.py exited {result.returncode}")
    return sum(1 for line in result.stdout.splitlines() if line.startswith("  mobile/"))


def main() -> int:
    try:
        expo = _app_json()
        owner = _owner_fields()
        starter = _starter_assets_outstanding()
    except Unreadable as exc:
        print(f"check-store-readiness: cannot read a source — {exc}", file=sys.stderr)
        return 2

    #: (done, what it is, what to do about it). Order is the order they block in.
    checks: list[tuple[bool, str, str]] = []

    project_id = (expo.get("extra") or {}).get("eas", {}).get("projectId")
    checks.append(
        (
            bool(project_id),
            "an EAS project id",
            "`eas init` writes `expo.extra.eas.projectId` — a real id from "
            "Expo's servers that cannot be invented. Everything else in "
            "`eas.json` is in place for it.",
        )
    )

    missing_owner = [name for name, value in owner.items() if not value]
    checks.append(
        (
            not missing_owner,
            "the publisher's own details in the privacy policy and terms",
            "`OWNER` in `mobile/src/lib/legal.ts` is "
            + ", ".join(f"`{name}`" for name in sorted(missing_owner))
            + " — null on purpose, because a plausible-looking placeholder "
            "reads like a finished policy and would ship. `LegalScreen` "
            "prints each line only when its field is set, so today the "
            "policy is published by nobody and names no address."
            if missing_owner
            else "Set.",
        )
    )

    checks.append(
        (
            starter == 0,
            "InTempo's own icon and launcher art",
            f"{starter} asset(s) are still the Expo starter's blue chevron. "
            "`tools/check-brand-assets.py` names them. A wrong icon is not a "
            "build failure; it is a build that succeeds and is wrong.",
        )
    )

    # No hosted policy: nothing in the repository holds a URL, and there is
    # nowhere for one to live. Checked as "is there anywhere it could be" so
    # that publishing it somewhere makes this line stop firing.
    policy_url = (expo.get("extra") or {}).get("privacyPolicyUrl")
    checks.append(
        (
            bool(policy_url),
            "a privacy policy at a public URL",
            "App Store Connect asks for a URL, not a screen. The policy text "
            "exists in `lib/legal.ts` and is deliberately data rather than "
            "markup so the same words can be published without retyping — but "
            "nothing has published them. Put the address in "
            "`expo.extra.privacyPolicyUrl` once it is live.",
        )
    )

    outstanding = [item for item in checks if not item[0]]

    print("InTempo — what still stands between this repository and a submission\n")
    for done, what, detail in checks:
        print(f"  [{'x' if done else ' '}] {what}")
        if not done:
            print(f"      {detail}")
    print()
    print("  Needs an account, so it cannot be checked from a checkout:")
    print(
        "    - An Apple Developer account and signing credentials "
        "(`eas credentials`)."
    )
    print(
        "    - An App Store Connect listing: name, screenshots, description, "
        "privacy answers, age rating."
    )
    print()

    if outstanding:
        print(f"{len(outstanding)} of {len(checks)} measurable items outstanding.")
        return 1
    print("Every measurable item is done. The two account items are still yours.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
