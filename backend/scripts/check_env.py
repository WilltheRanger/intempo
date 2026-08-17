#!/usr/bin/env python3
"""Checks that backend/.env is complete and that the keys in it actually work.

    uv run python scripts/check_env.py

Prints a line per credential and exits non-zero if anything the app needs is
missing or rejected.

**It never prints a secret.** Every value is reported as present/absent plus a
length and a four-character fingerprint of its SHA-256 — enough to tell two keys
apart or to confirm you pasted the one you meant, and useless to anyone reading
over your shoulder or scrolling back through a terminal. The one thing worse
than a missing key is a leaked one, and a setup script is exactly where that
tends to happen.

Reachability is tested against Supabase's own REST endpoint rather than through
FastAPI, so a failure here is unambiguously about the credential and not about
the app.
"""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
TIMEOUT = 10.0

OK = "  ok  "
BAD = " FAIL "
WARN = " warn "


def fingerprint(value: str) -> str:
    """Four hex characters of the hash. Identifies a key without revealing it."""
    return hashlib.sha256(value.encode()).hexdigest()[:4]


def describe(value: str) -> str:
    return f"{len(value)} chars, #{fingerprint(value)}"


def main() -> int:
    if not ENV_PATH.exists():
        print(f"{BAD} {ENV_PATH} does not exist.")
        print("       Copy .env.example to .env and fill it in.")
        return 1

    load_dotenv(ENV_PATH, override=True)
    failures = 0
    warnings = 0

    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    anon = os.getenv("SUPABASE_KEY", "").strip()
    service = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    # ---- SUPABASE_URL ----
    if not url:
        print(f"{BAD} SUPABASE_URL is empty. Nothing can work without it.")
        return 1
    if not url.startswith("https://"):
        print(f"{WARN} SUPABASE_URL is not https — {url}")
        warnings += 1
    print(f"{OK} SUPABASE_URL              {url}")

    # ---- JWKS: what verifies every user token ----
    jwks = f"{url}/auth/v1/.well-known/jwks.json"
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.get(jwks)
        if response.status_code == 200 and response.json().get("keys"):
            print(f"{OK} JWKS endpoint             {len(response.json()['keys'])} signing key(s)")
        else:
            print(f"{BAD} JWKS endpoint             HTTP {response.status_code} — user tokens cannot be verified")
            failures += 1
    except Exception as exc:  # noqa: BLE001 — any failure here is worth showing verbatim
        print(f"{BAD} JWKS endpoint             unreachable: {type(exc).__name__}: {exc}")
        print("       If this is a sandbox, the host may be blocked by an egress policy.")
        failures += 1

    # ---- the two Supabase keys ----
    #
    # `scores` is queried because RLS is on and the table exists. The anon key
    # should be *accepted* and return nothing (no session, so no rows); the
    # service-role key should be accepted and return rows or an empty list. A
    # 401 means the key is wrong; a 200 means it is right.
    for name, key in (("SUPABASE_KEY", anon), ("SUPABASE_SERVICE_ROLE_KEY", service)):
        if not key:
            if name == "SUPABASE_SERVICE_ROLE_KEY":
                print(f"{BAD} {name:<25} empty — every write and every /v1/* call will 500")
                print("       Supabase dashboard → Project Settings → API keys → service_role")
                failures += 1
            else:
                print(f"{WARN} {name:<25} empty")
                warnings += 1
            continue

        try:
            with httpx.Client(timeout=TIMEOUT) as client:
                response = client.get(
                    f"{url}/rest/v1/scores",
                    params={"select": "id", "limit": 1},
                    headers={"apikey": key, "Authorization": f"Bearer {key}"},
                )
        except Exception as exc:  # noqa: BLE001
            print(f"{BAD} {name:<25} unreachable: {type(exc).__name__}")
            failures += 1
            continue

        if response.status_code == 200:
            print(f"{OK} {name:<25} accepted ({describe(key)})")
        elif response.status_code in (401, 403):
            print(f"{BAD} {name:<25} rejected — HTTP {response.status_code} ({describe(key)})")
            print(f"       {response.text[:140]}")
            failures += 1
        else:
            print(f"{WARN} {name:<25} HTTP {response.status_code} ({describe(key)})")
            warnings += 1

    if service and anon and service == anon:
        print(f"{BAD} SUPABASE_SERVICE_ROLE_KEY is the same value as SUPABASE_KEY.")
        print("       The service-role key is a different key; writes will fail under RLS.")
        failures += 1

    # ---- storage buckets ----
    if service:
        try:
            with httpx.Client(timeout=TIMEOUT) as client:
                response = client.get(
                    f"{url}/storage/v1/bucket",
                    headers={"apikey": service, "Authorization": f"Bearer {service}"},
                )
            if response.status_code == 200:
                names = {b.get("name") for b in response.json()}
                for bucket in ("score-images", "audio-uploads"):
                    if bucket in names:
                        print(f"{OK} bucket                    {bucket}")
                    else:
                        print(f"{BAD} bucket                    {bucket} is missing")
                        failures += 1
            else:
                print(f"{WARN} storage                   HTTP {response.status_code}")
                warnings += 1
        except Exception as exc:  # noqa: BLE001
            print(f"{WARN} storage                   unreachable: {type(exc).__name__}")
            warnings += 1

    # ---- OCR ----
    #
    # Presence only. A live call would cost money on every run of a script whose
    # whole job is to be run often, and a key's shape tells you nothing about
    # whether it has credit — so this reports what is configured and lets
    # `POST /v1/scores` be the real test.
    chain = os.getenv("OCR_PROVIDER_CHAIN", "").strip()
    providers = [p.strip() for p in chain.split(",") if p.strip()]
    print(f"{OK} OCR_PROVIDER_CHAIN        {' → '.join(providers) if providers else '(default)'}")

    needs_gemini = any(p.startswith("gemini") for p in providers)
    needs_claude = any(p.startswith("claude") for p in providers)
    for label, key, needed in (
        ("GEMINI_API_KEY", os.getenv("GEMINI_API_KEY", "").strip(), needs_gemini),
        ("ANTHROPIC_API_KEY", os.getenv("ANTHROPIC_API_KEY", "").strip(), needs_claude),
    ):
        if key:
            print(f"{OK} {label:<25} set ({describe(key)})")
        elif needed:
            print(f"{WARN} {label:<25} empty — the chain names it, so scanning a page will fail")
            warnings += 1
        else:
            print(f"{OK} {label:<25} not needed by the chain")

    print()
    if failures:
        print(f"{failures} problem(s), {warnings} warning(s). The app will not work until these are fixed.")
        return 1
    if warnings:
        print(f"No blockers, {warnings} warning(s). Everything except the warnings above will work.")
        return 0
    print("Everything checks out.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
