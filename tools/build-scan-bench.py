#!/usr/bin/env python3
"""Build the scan bench — photograph a page, see what the pipeline reads.

    cd backend && uv run python ../tools/build-scan-bench.py

Writes `tools/scan-bench.html`: one file, no server, no install. Open it,
paste an API key, drop in a photograph of sheet music.

**The prompt and the model registry are read out of the backend**, not copied
by hand, because a bench that asks a different question than production answers
a question nobody has. If `ocr_prompt.txt` changes or a model is repriced, the
bench changes with it on the next build.

The key is the user's own and goes straight to the model provider from their
browser. There is no server here to send it to.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "tools" / "scan-bench.template.html"
OUTPUT = ROOT / "tools" / "scan-bench.html"


def main() -> int:
    sys.path.insert(0, str(ROOT / "backend"))
    from app.services.ocr.base import PROMPT
    from app.services.ocr.claude_provider import (
        claude_opus_provider,
        claude_sonnet_provider,
    )
    from app.services.ocr.gemini_provider import (
        gemini_flash_provider,
        gemini_pro_provider,
    )

    # Chain order first, since that is the one the pipeline actually runs.
    registry = [
        (gemini_flash_provider, "google"),
        (claude_sonnet_provider, "anthropic"),
        (claude_opus_provider, "anthropic"),
        (gemini_pro_provider, "google"),
    ]
    models = [
        {
            "name": p.name,
            "model": p.model,
            "vendor": vendor,
            "input_price": p._input_price,
            "output_price": p._output_price,
        }
        for p, vendor in registry
    ]

    html = TEMPLATE.read_text()
    for placeholder, value in (("__PROMPT__", PROMPT), ("__MODELS__", models)):
        if placeholder not in html:
            print(f"template has no {placeholder} placeholder", file=sys.stderr)
            return 1
        html = html.replace(placeholder, json.dumps(value))

    OUTPUT.write_text(html)
    print(
        f"{OUTPUT.relative_to(ROOT)}  —  {len(models)} models, "
        f"prompt {len(PROMPT)} chars, {OUTPUT.stat().st_size / 1024:.0f} KB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
