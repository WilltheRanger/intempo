#!/usr/bin/env python3
"""Read a photograph with one provider and print what it got, checked.

    cd backend
    uv run python scripts/read_page.py ~/Desktop/part.jpg --provider omr-local
    uv run python scripts/read_page.py ~/Desktop/part.jpg --provider gemini-2.5-flash
    uv run python scripts/read_page.py ~/Desktop/part.jpg --provider omr-local,gemini-2.5-flash

Exists because the local OMR engine has nowhere else to run. The scan bench is
one HTML file with no server, so it cannot start a subprocess, and the API needs
hosting. This is the shortest path from a photograph on disk to an answer you
can judge.

It prints the beat-sum verdict per measure, not just the transcription. A
transcription on its own invites reading it and nodding; the verdict is the part
that can say the reading is wrong without anyone checking it against the page.

Named providers run **independently**, one after another — this is a comparison,
not the fallback chain. Two engines that disagree is the finding.
"""

from __future__ import annotations

import argparse
import mimetypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.ocr.base import OCRProviderError  # noqa: E402
from app.services.ocr.pipeline import PROVIDER_REGISTRY, get_provider  # noqa: E402
from app.services.ocr.validate import (  # noqa: E402
    describe_for_retry,
    validate_measures,
)

_TAG = {
    "ok": "  ok  ",
    "short": " SHORT",
    "long": "  LONG",
    "empty": " EMPTY",
    "pickup": "pickup",
    "unverifiable": "  ??  ",
}


def _report(name: str, image: bytes, mime: str, *, dump: Path | None) -> bool:
    print(f"\n\033[1m{name}\033[0m")
    try:
        response = get_provider(name).parse(image, mime)
    except OCRProviderError as exc:
        print(f"  failed: {exc}")
        return False

    score = response.score
    print(
        f"  {len(score.measures)} measures · {score.clef} clef · "
        f"{score.time_signature or 'no metre'} · {score.key_signature or 'no key'} · "
        f"{response.latency_ms / 1000:.1f}s · ${response.cost_usd:.4f}"
    )
    if score.notes_to_human:
        print(f"  note: {score.notes_to_human}")

    rows = validate_measures(score)
    # enumerate, not rows.index(row): two measures with the same verdict and the
    # same beat count compare equal, and index() would return the first of them
    # — printing one measure's notes beside another measure's verdict.
    for position, row in enumerate(rows):
        notes = " ".join(n.duration[:4] for n in score.measures[position].notes[:12])
        print(
            f"  {_TAG.get(row.verdict, row.verdict):>6}  m{row.measure_number:<4}"
            f" {row.actual_beats:>5.2f}/{row.expected_beats if row.expected_beats else '?':<4}"
            f"  {notes}"
        )
    problems = describe_for_retry(rows)
    print(f"  {problems}" if problems else "  every measure adds up")

    if dump is not None:
        target = dump / f"{name}.json"
        target.write_text(score.model_dump_json(indent=2), encoding="utf-8")
        raw = dump / f"{name}.raw.txt"
        raw.write_text(response.raw_text, encoding="utf-8")
        print(f"  wrote {target.name} and {raw.name}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument(
        "--provider",
        default="omr-local",
        help="comma-separated; run independently for comparison. "
        f"known: {', '.join(sorted(PROVIDER_REGISTRY))}",
    )
    parser.add_argument(
        "--dump",
        type=Path,
        default=None,
        help="directory to write each provider's JSON and raw output into",
    )
    args = parser.parse_args()

    if not args.image.is_file():
        print(f"no such file: {args.image}", file=sys.stderr)
        return 2
    image = args.image.read_bytes()
    mime = mimetypes.guess_type(args.image.name)[0] or "image/png"
    if args.dump is not None:
        args.dump.mkdir(parents=True, exist_ok=True)

    print(f"{args.image.name} · {len(image) / 1_048_576:.1f} MB · {mime}")
    names = [n.strip() for n in args.provider.split(",") if n.strip()]
    unknown = [n for n in names if n not in PROVIDER_REGISTRY]
    if unknown:
        print(
            f"unknown provider(s): {', '.join(unknown)}\n"
            f"known: {', '.join(sorted(PROVIDER_REGISTRY))}",
            file=sys.stderr,
        )
        return 2

    # Exit non-zero only if *every* provider failed. One engine failing while
    # another succeeds is a result worth seeing, not an error worth aborting on.
    results = [_report(name, image, mime, dump=args.dump) for name in names]
    return 0 if any(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
