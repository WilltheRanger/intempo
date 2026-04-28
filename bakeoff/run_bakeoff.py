"""OCR provider bake-off harness.

Iterate over fixture images, run each through the configured providers,
emit a versioned markdown report. The report is the artifact: it goes in
the repo so we have a record of what shipped after the bake-off.

Run from `backend/` so uv picks up the project's environment:

    cd backend
    uv run ../bakeoff/run_bakeoff.py

Optional flags:
    --fixtures-dir PATH      Override the default `fixtures/scores/`.
    --output PATH            Override the default `docs/ocr-bakeoff/<date>.md`.
    --include-premium        Also bench `claude-opus-4-7` and `gemini-2.5-pro`.
    --providers a,b,c        Explicit provider chain (comma-separated registry names).

The script never picks a winner — it writes the data, you decide.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any

# Resolve paths up front so the script works no matter where it's run from.
BAKEOFF_DIR = Path(__file__).resolve().parent
REPO_ROOT = BAKEOFF_DIR.parent
BACKEND_DIR = REPO_ROOT / "backend"
DEFAULT_FIXTURES = REPO_ROOT / "fixtures" / "scores"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "docs" / "ocr-bakeoff"

# Make backend's app.* importable when this script is invoked via `uv run`.
sys.path.insert(0, str(BACKEND_DIR))

# Load `.env` from backend so GEMINI_API_KEY / ANTHROPIC_API_KEY land in env.
from dotenv import load_dotenv  # noqa: E402

# override=True so a stale empty `ANTHROPIC_API_KEY=""` in the user's
# shell environment doesn't shadow the value from `backend/.env`.
load_dotenv(BACKEND_DIR / ".env", override=True)

from pydantic import ValidationError  # noqa: E402

from app.services.ocr.base import OCRResponse  # noqa: E402
from app.services.ocr.claude_provider import (  # noqa: E402
    claude_opus_provider,
    claude_sonnet_provider,
)
from app.services.ocr.gemini_provider import (  # noqa: E402
    gemini_flash_provider,
    gemini_pro_provider,
)


_DEFAULT_PROVIDERS = [claude_sonnet_provider, gemini_flash_provider]
_PREMIUM_PROVIDERS = [claude_opus_provider, gemini_pro_provider]

_REGISTRY = {
    p.name: p
    for p in (
        claude_sonnet_provider,
        claude_opus_provider,
        gemini_flash_provider,
        gemini_pro_provider,
    )
}

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}


def _mime_type_for(path: Path) -> str:
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".heic": "image/heic",
    }.get(path.suffix.lower(), "image/jpeg")


def _format_notes(text: str | None, *, max_len: int = 100) -> str:
    if not text:
        return ""
    cleaned = text.replace("|", "\\|").replace("\n", " ").replace("\r", " ").strip()
    return cleaned[: max_len - 1] + "…" if len(cleaned) > max_len else cleaned


def _parse_with_retry(provider, image_bytes: bytes, mime_type: str) -> OCRResponse:
    """One retry with backoff on transient throttling (HTTP 429 / 503)."""
    import time as _t

    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            return provider.parse(image_bytes, mime_type=mime_type)
        except Exception as exc:  # noqa: BLE001 — provider-agnostic catch
            text = f"{type(exc).__name__}: {exc}"
            transient = any(token in text for token in ("503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED"))
            if not transient or attempt == 1:
                raise
            print("(503 — backing off 8s)", end=" ", flush=True)
            _t.sleep(8)
            last_exc = exc
    raise last_exc  # unreachable, satisfies type checker


def _run_providers_on_image(
    image_path: Path, providers: list
) -> dict[str, dict[str, Any]]:
    image_bytes = image_path.read_bytes()
    mime_type = _mime_type_for(image_path)
    out: dict[str, dict[str, Any]] = {}
    for provider in providers:
        print(f"  -> {provider.name}", end=" ", flush=True)
        entry: dict[str, Any] = {"schema_valid": False, "error": None}
        try:
            response: OCRResponse = _parse_with_retry(provider, image_bytes, mime_type)
        except ValidationError as exc:
            err = f"ValidationError: {exc.error_count()} error(s)"
            print(f"FAIL {err}")
            entry["error"] = err
        except Exception as exc:  # noqa: BLE001 — bake-off must keep going
            err = f"{type(exc).__name__}: {exc}"
            print(f"FAIL {err[:120]}")
            entry["error"] = err
        else:
            note_count = sum(len(m.notes) for m in response.score.measures)
            entry.update(
                {
                    "schema_valid": True,
                    "ocr_confidence": response.score.ocr_confidence,
                    "notes_to_human": response.score.notes_to_human,
                    "measures": len(response.score.measures),
                    "notes_total": note_count,
                    "input_tokens": response.input_tokens,
                    "output_tokens": response.output_tokens,
                    "cost_usd": response.cost_usd,
                    "latency_ms": response.latency_ms,
                    "raw_text": response.raw_text,
                }
            )
            print(
                f"OK conf={response.score.ocr_confidence:.2f} "
                f"latency={response.latency_ms}ms cost=${response.cost_usd:.4f}"
            )
        out[provider.name] = entry
    return out


def _render_report(
    output_path: Path,
    providers: list,
    results: dict[str, dict[str, dict[str, Any]]],
) -> None:
    lines: list[str] = []
    lines.append(f"# OCR provider bake-off — {time.strftime('%Y-%m-%d %H:%M %Z')}")
    lines.append("")
    lines.append(f"Providers tested: {', '.join(p.name for p in providers)}")
    lines.append("")
    lines.append(
        "Generated by `bakeoff/run_bakeoff.py`. The provider chain that ships "
        "lives in `backend/.env` (`OCR_PROVIDER_CHAIN`); pick from this report."
    )
    lines.append("")

    # Per-fixture detail tables.
    for image_name, provider_results in results.items():
        lines.append(f"## `{image_name}`")
        lines.append("")
        lines.append(
            "| Provider | Schema | Confidence | Measures | Notes | Latency (ms) | "
            "Input tok | Output tok | Cost (USD) | Notes-to-human / error |"
        )
        lines.append("|---|---|---:|---:|---:|---:|---:|---:|---:|---|")
        for provider_name, entry in provider_results.items():
            if entry["schema_valid"]:
                notes = _format_notes(entry.get("notes_to_human", ""))
                lines.append(
                    f"| `{provider_name}` | ✓ | {entry['ocr_confidence']:.2f} | "
                    f"{entry['measures']} | {entry['notes_total']} | "
                    f"{entry['latency_ms']} | {entry['input_tokens']} | "
                    f"{entry['output_tokens']} | ${entry['cost_usd']:.4f} | {notes} |"
                )
            else:
                err = _format_notes(entry.get("error", "unknown error"), max_len=140)
                lines.append(
                    f"| `{provider_name}` | ✗ | — | — | — | — | — | — | — | {err} |"
                )
        lines.append("")

    # Summary table.
    lines.append("## Summary")
    lines.append("")
    lines.append(
        "| Provider | Pass rate | Avg confidence (passes) | "
        "Avg latency (ms) | Total cost (USD) | Total measures |"
    )
    lines.append("|---|---|---:|---:|---:|---:|")
    for provider in providers:
        passes: list[dict[str, Any]] = []
        attempts = 0
        total_cost = 0.0
        for image_results in results.values():
            entry = image_results.get(provider.name, {})
            attempts += 1
            if entry.get("schema_valid"):
                passes.append(entry)
                total_cost += float(entry.get("cost_usd", 0.0))
        pass_rate = len(passes) / attempts if attempts else 0.0
        avg_conf = sum(p["ocr_confidence"] for p in passes) / len(passes) if passes else 0.0
        avg_latency = sum(p["latency_ms"] for p in passes) / len(passes) if passes else 0.0
        total_measures = sum(p["measures"] for p in passes) if passes else 0
        lines.append(
            f"| `{provider.name}` | {len(passes)}/{attempts} ({pass_rate*100:.0f}%) | "
            f"{avg_conf:.2f} | {avg_latency:.0f} | ${total_cost:.4f} | {total_measures} |"
        )
    lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")


def _select_providers(args: argparse.Namespace) -> list:
    if args.providers:
        names = [n.strip() for n in args.providers.split(",") if n.strip()]
        try:
            return [_REGISTRY[n] for n in names]
        except KeyError as exc:
            sys.exit(f"unknown provider {exc.args[0]!r}; known: {sorted(_REGISTRY)}")
    chain = list(_DEFAULT_PROVIDERS)
    if args.include_premium:
        chain.extend(_PREMIUM_PROVIDERS)
    return chain


def main() -> int:
    parser = argparse.ArgumentParser(description="OCR provider bake-off")
    parser.add_argument(
        "--fixtures-dir",
        default=str(DEFAULT_FIXTURES),
        help=f"directory of fixture images (default: {DEFAULT_FIXTURES})",
    )
    parser.add_argument(
        "--output",
        default=None,
        help=f"output markdown path (default: {DEFAULT_OUTPUT_DIR}/<date>-bakeoff.md)",
    )
    parser.add_argument(
        "--include-premium",
        action="store_true",
        help="also bench claude-opus-4-7 and gemini-2.5-pro",
    )
    parser.add_argument(
        "--providers",
        default=None,
        help=(
            "explicit comma-separated provider chain (overrides --include-premium); "
            f"choices: {sorted(_REGISTRY)}"
        ),
    )
    args = parser.parse_args()

    fixtures_dir = Path(args.fixtures_dir).resolve()
    if not fixtures_dir.is_dir():
        sys.exit(f"fixtures dir not found: {fixtures_dir}")

    images = sorted(p for p in fixtures_dir.iterdir() if p.suffix.lower() in _IMAGE_EXTS)
    if not images:
        sys.exit(f"no images found in {fixtures_dir} (looked for: {sorted(_IMAGE_EXTS)})")

    providers = _select_providers(args)
    print(f"Bake-off: {len(images)} fixture(s) × {len(providers)} provider(s)")
    print(f"Providers: {', '.join(p.name for p in providers)}")

    results: dict[str, dict[str, dict[str, Any]]] = {}
    for image_path in images:
        print(f"\n=== {image_path.name} ===")
        results[image_path.name] = _run_providers_on_image(image_path, providers)

    output_path = Path(args.output) if args.output else (
        DEFAULT_OUTPUT_DIR / f"{time.strftime('%Y-%m-%d')}-bakeoff.md"
    )
    _render_report(output_path, providers, results)
    print(f"\nReport written to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
