#!/usr/bin/env python3
"""Read a photograph the way the server does, and print exactly what happened.

    cd backend                       # ANTHROPIC_API_KEY comes from backend/.env

    # Reproduce a failed scan — the real chain, on the real page:
    uv run python scripts/read_page.py ~/Desktop/part.jpg --chain

    # Compare providers on the same page, each run independently:
    uv run python scripts/read_page.py ~/Desktop/part.jpg --provider claude-sonnet-5,claude-opus-5

    # Prove whether normalisation is what fixed a page:
    uv run python scripts/read_page.py ~/Desktop/part.jpg --chain --raw

**Use this when the app says a page could not be read.** The app has one line
of room to explain a failure and no way to show you the answer that failed; this
prints the provider's actual error, or the schema fields it got wrong, or the
transcription and its beat-sum verdict. It normalises the image first, exactly
as the worker does, so what runs here is what runs on the server.

There is no OMR engine any more — see DECISIONS.md, 2026-08-25.

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

from pydantic import ValidationError  # noqa: E402

from app.config import settings  # noqa: E402
from app.services.ocr.base import OCRProviderError  # noqa: E402
from app.services.ocr.pipeline import (  # noqa: E402
    OCRError,
    PROVIDER_REGISTRY,
    get_provider,
    parse_sheet_music,
)
from app.services.page_image import prepare_for_model  # noqa: E402
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
    except ValidationError as exc:
        # The failure that used to be invisible. A model answering with one key
        # this schema does not declare used to lose the whole page, and the
        # only trace was "the photograph could not be read". Printing which
        # field, and how many, is the difference between a diagnosis and a
        # guess.
        print(f"  failed: the answer did not fit the schema ({exc.error_count()} problem(s))")
        for error in exc.errors()[:8]:
            where = ".".join(str(part) for part in error["loc"]) or "(root)"
            print(f"    {where}: {error['msg']}")
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
    if problems:
        print(f"  {problems}")
    elif all(row.verdict == "unverifiable" for row in rows):
        # "every measure adds up" was printed here, and it was a lie: nothing
        # had been checked. `describe_for_retry` reports problems, and an
        # unverifiable measure is not a problem — it is an absence of evidence,
        # which is the opposite of a clean bill of health.
        print(
            "  nothing could be checked — no time signature was read, and the beat "
            "counts disagree too much to infer one"
        )
    else:
        checked = sum(1 for row in rows if row.verdict != "unverifiable")
        print(f"  every measure that could be checked adds up ({checked} of {len(rows)})")

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
        default=None,
        help="comma-separated; run independently for comparison. Defaults to "
        "the configured chain, so the default run is what the server does. "
        f"known: {', '.join(sorted(PROVIDER_REGISTRY))}",
    )
    parser.add_argument(
        "--chain",
        action="store_true",
        help="run the real pipeline — fallthrough, beat-sum gate, OMR second "
        "opinion — exactly as the transcription worker does, instead of each "
        "provider independently. Use this to reproduce a failed scan.",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="send the file untouched, skipping the normalisation the server "
        "applies. For proving that normalisation is what fixed a page.",
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
    original = args.image.read_bytes()
    if args.raw:
        image = original
        mime = mimetypes.guess_type(args.image.name)[0] or "image/png"
    else:
        # What the server actually sends. Without this the script answers a
        # different question from the one being asked.
        image, mime = prepare_for_model(original)
    if args.dump is not None:
        args.dump.mkdir(parents=True, exist_ok=True)

    print(f"{args.image.name} · {len(original) / 1_048_576:.2f} MB")
    if not args.raw:
        # The base64 payload is what the 5 MB API limit applies to, so it is
        # the number worth printing.
        print(
            f"  normalised → {len(image) / 1_048_576:.2f} MB {mime}"
            f" · {len(image) * 4 / 3 / 1_048_576:.2f} MB as base64 (limit 5.00)"
        )
    else:
        print(f"  sent untouched · {len(image) * 4 / 3 / 1_048_576:.2f} MB as base64 (limit 5.00)")

    if args.chain:
        print(f"\n\033[1mchain: {settings.OCR_PROVIDER_CHAIN}\033[0m")
        try:
            score = parse_sheet_music(image, media_type=mime)
        except OCRError as exc:
            print(f"  every provider failed:\n    {exc}")
            return 1
        print(
            f"  {len(score.measures)} measures · {score.clef} clef · "
            f"{score.time_signature or 'no metre'}"
        )
        rows = validate_measures(score)
        problems = describe_for_retry(rows)
        print(f"  {problems}" if problems else "  every measure that could be checked adds up")
        if args.dump is not None:
            (args.dump / "chain.json").write_text(
                score.model_dump_json(indent=2), encoding="utf-8"
            )
            print(f"  wrote chain.json into {args.dump}")
        return 0

    names = [
        n.strip()
        for n in (args.provider or settings.OCR_PROVIDER_CHAIN).split(",")
        if n.strip()
    ]
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
