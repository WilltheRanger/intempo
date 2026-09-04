"""The samples the app's legibility check sees, and the server's answer to them.

Two trees measure how far apart a page's staff lines are, in two languages,
and neither had ever seen the other's answer on the same page.
`backend/app/services/page_image.staff_space_px` is the real check and decides
whether a scan is refused; `mobile/src/lib/scan/legibility.ts` is a coarser
copy that runs at the shutter so the advice arrives while the musician is still
holding the music. The app's own module note states the rule between them:

    it may never refuse a page the server would accept.

That rule was asserted only about the two *constants* (`CLIENT_FLOOR <
SERVER_FLOOR`) and about synthetic ruled pages that only the app ever measured.
Neither is the rule. Two different algorithms can order their thresholds
correctly and still disagree about a photograph, and when they did — measured
2026-09-04, on three of the five real pages in this repository — nothing went
red. The musician is simply told to move closer to a page that would have read
perfectly.

So this builds the artefact the two sides meet on: the greyscale samples the
app would hand its own check, taken from pages already in the repository, with
the server's verdict on the same page recorded beside them.

**The samples are the app's, not a convenient approximation of them.**
`_app_samples` reproduces `mobile/src/lib/scan/pageSamples.web.ts` exactly —
centre crop at 1:1 bounded to 1400x2000, Rec. 601 luma truncated to a byte —
because a fixture that is merely *similar* to what the app measures tests
nothing about what the app measures.
`backend/app/tests/test_legibility_contract.py` recomputes them from the JPEG
and fails if the stored bytes have drifted from the source pages, so the
artefact cannot rot into a record of what used to be true.

Regenerate after changing either the crop rule or the server's measurement:

    python3 tools/legibility_fixture.py
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend_python import use_backend_python  # noqa: E402

use_backend_python()

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
OUT = ROOT / "fixtures" / "legibility"

#: Mirrors `MAX_SAMPLE_WIDTH` / `MAX_SAMPLE_HEIGHT` in `pageSamples.web.ts`.
MAX_SAMPLE_WIDTH = 1400
MAX_SAMPLE_HEIGHT = 2000

#: The pages, and why each one is here. A fixture set that is all one answer
#: proves only that the code has an opinion.
PAGES: tuple[tuple[str, str, str], ...] = (
    (
        "01_simple_printed",
        "fixtures/scores/01_simple_printed.jpg",
        "Engraved, sharp, comfortably above the floor. The page a fix must not break.",
    ),
    (
        "03_complex_printed",
        "fixtures/scores/03_complex_printed.jpg",
        "Engraved and dense with sixteenths. The server reads it; the app called it "
        "too small to read. This is the case the contract exists for.",
    ),
    (
        "04_handwritten_clean",
        "fixtures/scores/04_handwritten_clean.jpg",
        "Manuscript on an aged ground — the quietest true staff signal here. Read by "
        "the server, and the second page the app wrongly warned about.",
    ),
    (
        "05_handwritten_messy",
        "fixtures/scores/05_handwritten_messy.jpg",
        "Genuinely under the floor. The server refuses it, so the app is free to.",
    ),
    (
        "page-01",
        "mobile/assets/captures/page-01.jpg",
        "Page-shaped (900x1273), so it is the only sample whose densest band is a "
        "choice rather than the whole image. Real engraving, synthetic page layout "
        "(see mobile/assets/captures/SOURCES.md); scaled down far enough that the "
        "server refuses it.",
    ),
)


def app_samples(image_bytes: bytes) -> tuple[bytes, int, int]:
    """The greyscale the app's `pageSamples` would produce for this photograph.

    A centre crop at 1:1, never a downscaled copy: shrinking the page shrinks
    the staff spacing being measured, and the check would then be reporting its
    own resampling. `pageSamples.web.ts` says the same thing at more length and
    is the authority — this follows it.
    """
    from io import BytesIO

    from PIL import Image

    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    width = min(image.width, MAX_SAMPLE_WIDTH)
    height = min(image.height, MAX_SAMPLE_HEIGHT)
    left = (image.width - width) // 2
    top = (image.height - height) // 2
    pixels = image.crop((left, top, left + width, top + height)).tobytes()

    gray = bytearray(width * height)
    for i in range(width * height):
        red, green, blue = pixels[3 * i], pixels[3 * i + 1], pixels[3 * i + 2]
        # Rec. 601 luma, then truncated by the assignment into a Uint8Array.
        gray[i] = (red * 299 + green * 587 + blue * 114) // 1000
    return bytes(gray), width, height


def main() -> int:
    from app.services.page_image import staff_space_px, too_small_to_read

    OUT.mkdir(parents=True, exist_ok=True)
    pages = []
    for name, source, why in PAGES:
        image_bytes = (ROOT / source).read_bytes()
        gray, width, height = app_samples(image_bytes)
        (OUT / f"{name}.samples.json").write_text(
            json.dumps(
                {
                    "gzip_b64": base64.b64encode(
                        gzip.compress(gray, 9, mtime=0)
                    ).decode("ascii")
                }
            )
            + "\n"
        )
        pages.append(
            {
                "name": name,
                "why": why,
                "source": source,
                "samples": f"{name}.samples.json",
                "width": width,
                "height": height,
                "sha256": hashlib.sha256(gray).hexdigest(),
                "server_staff_space_px": staff_space_px(image_bytes),
                "server_refuses": too_small_to_read(image_bytes) is not None,
            }
        )
        print(f"{name:22s} {width}x{height} server={pages[-1]['server_staff_space_px']}")

    (OUT / "parity.json").write_text(
        json.dumps(
            {
                "generated_by": "tools/legibility_fixture.py",
                "what": (
                    "The greyscale samples mobile/src/lib/scan/pageSamples.web.ts "
                    "would hand the app's legibility check, with the server's answer "
                    "to the same page beside them."
                ),
                "rule": (
                    "The app may never say tooSmall about a page the server accepts. "
                    "Held by mobile/src/lib/scan/legibility.contract.test.ts; the "
                    "samples and the server's answers are held by "
                    "backend/app/tests/test_legibility_contract.py."
                ),
                "pages": pages,
            },
            indent=2,
        )
        + "\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
