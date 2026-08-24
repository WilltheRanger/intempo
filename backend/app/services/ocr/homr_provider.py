"""homr: an actual OMR engine, reading the page instead of describing it.

**What this is and why it is different from every other provider here.** The
rest of the chain is vision-language models — they look at a photograph and
write JSON about it. homr is a purpose-built optical music recognition system:
it segments the page, finds the staves, *dewarps each one*, and runs a
transformer over the staff image. It emits MusicXML, which this codebase has
had a tested importer for since Batch 2.

**Dewarping is the reason it is here.** Measured on the first real page this
project has seen — a photographed String Bass part — each system slopes by more
than its own height across the page, the slope grows down the page, and no
single rotation straightens them because every system tilts differently. That
defeats a horizontal projection outright and it is not something a prompt can
fix. homr found and dewarped ten staves on that page, which is exactly what is
on it.

Measured on the same photograph, against the vision chain's best real result:

| | vision chain | homr |
|---|---|---|
| measures | 59 | 74 (the page holds 80) |
| notes | 112 | 267 |
| bars that add up | — | 73 of 74 |

**It does not run on the API host.** 1350 MB peak, 21 s wall clock, 63 s of CPU
on that page. The instance this deploys to has 512 MB for the whole
application. This runs on Modal, in its own container with its own image — the
shape `modal_app.py` was written for.

**Licence: homr is AGPL-3.0.** It is used unmodified, imported into a container
that does one job, and nothing here is derived from it. That is a deliberate
arrangement and not an accident of packaging.
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
from pathlib import Path

from app.services.ocr.base import OCRProviderError, OCRResponse
from app.services.ocr.musicxml import MusicXMLError, score_json_from_musicxml
from app.services.score_schema import ScoreJson

log = logging.getLogger("intempo.ocr")

#: Suffixes homr will open. It reads the file from disk, by path, and decides
#: for itself — so the media type this project carries around has to become a
#: file extension somewhere, and this is that somewhere.
_SUFFIX_FOR = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def _confidence_from_arithmetic(score: ScoreJson) -> float:
    """How much of this reading agrees with itself, as a fraction of its bars.

    **Not the number the importer computes, and the difference matters.**
    `score_json_from_musicxml` reports the fraction of notes that survived
    conversion, which on real homr output is **1.0** — it says the XML parsed,
    not that the page was read correctly. Handing that on would claim certainty
    about a photograph, which is the exact thing `import_score` refuses to do:
    "a file is not *confident*, it is *stated*".

    homr states no confidence of its own, so the honest substitute is a
    measurement this codebase already trusts: the share of measures whose beats
    add up. It is real evidence, it is computed by our checks rather than by the
    engine marking its own homework, and it falls when a reading goes wrong —
    which is what the number is used for. A page whose bars mostly do not add up
    drops below `CONFIDENCE_THRESHOLD` and the vision chain gets its turn.

    **It is not a claim that the notes are right.** A wrong note of the right
    length still sums. Nothing here substitutes for the musician looking, which
    is why `POST /scores/:id/accept` exists and why nothing else may discard the
    photograph.
    """
    from app.services.ocr.validate import validate_measures

    findings = validate_measures(score)
    if not findings:
        return 0.0
    agree = sum(1 for f in findings if f.verdict in ("ok", "pickup"))
    return round(agree / len(findings), 3)


class HomrProvider:
    """One page, read by homr, returned in this project's own shape."""

    name = "homr"

    #: This provider reads a whole page and must not be handed a crop.
    #:
    #: Every other provider is given one system at a time, because a
    #: vision-language model asked for four hundred notes in one answer returns
    #: a fraction of them. homr has its own staff detection *and its own
    #: dewarping*, both better than the crops this repo can cut — that is the
    #: reason to run it at all. Feeding it a crop would throw away the part that
    #: works and pay for it in wall-clock as well.
    reads_whole_page = True

    #: No API key. This is the odd one out in the chain and `/v1/ready` has to
    #: ask it a different question: every other provider is usable when a key is
    #: set, and this one when the engine is installed *in this container*.
    api_key_setting = ""

    def available(self) -> bool:
        return homr_available()

    def parse(
        self,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        note: str | None = None,
    ) -> OCRResponse:
        """Read the page. `note` is accepted and ignored — there is no prompt.

        homr takes a *path* and writes its MusicXML beside it, so the bytes go
        to a temporary directory that is removed either way.
        """
        suffix = _SUFFIX_FOR.get(mime_type)
        if suffix is None:
            raise OCRProviderError(
                f"{self.name}: unsupported media type {mime_type!r}; "
                f"it reads {', '.join(sorted(_SUFFIX_FOR))}"
            )

        started = time.perf_counter()
        with tempfile.TemporaryDirectory(prefix="homr-") as workspace:
            page = Path(workspace) / f"page{suffix}"
            page.write_bytes(image_bytes)
            xml = self._run(page)

        latency_ms = int((time.perf_counter() - started) * 1000)

        try:
            score = score_json_from_musicxml(xml)
        except MusicXMLError as exc:
            raise OCRProviderError(f"{self.name}: {exc}") from exc

        score = score.model_copy(
            update={"ocr_confidence": _confidence_from_arithmetic(score)}
        )
        log.info(
            "%s: %d measures, %d notes, %d%% of bars add up, %d ms",
            self.name,
            len(score.measures),
            sum(len(m.notes) for m in score.measures),
            round(score.ocr_confidence * 100),
            latency_ms,
        )
        return OCRResponse(
            score=score,
            raw_text=xml,
            model=self.name,
            # No tokens and no per-page price: this is compute time on a
            # container, billed by the second by Modal rather than by the
            # thousand tokens. Reporting a fabricated cost here would put a
            # number nobody measured into the telemetry beside real ones.
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
            latency_ms=latency_ms,
        )

    def _run(self, page: Path) -> str:
        """homr, in this process, on one file. Returns the MusicXML."""
        try:
            from homr.main import ProcessingConfig, process_image
            from homr.music_xml_generator import XmlGeneratorArguments
        except ImportError as exc:  # pragma: no cover — image builds with it
            raise OCRProviderError(
                f"{self.name}: homr is not installed in this container"
            ) from exc

        try:
            process_image(
                str(page),
                ProcessingConfig(),
                XmlGeneratorArguments(large_page=None, metronome=None, tempo=None),
            )
        except Exception as exc:  # noqa: BLE001 — any failure is this provider's
            raise OCRProviderError(f"{self.name}: {type(exc).__name__}: {exc}") from exc

        written = page.with_suffix(".musicxml")
        if not written.exists():
            # It reports "no staffs detected" by writing nothing at all.
            raise OCRProviderError(
                f"{self.name}: found no staves on this page"
            )
        return written.read_text(encoding="utf-8")


#: Instantiated once. Nothing here holds state between pages; the weights are
#: loaded by `onnxruntime` inside homr and cached there.
homr_provider = HomrProvider()

#: Whether this container can actually run it.
#:
#: `/v1/ready` asks, because the failure it prevents is silent: a chain naming
#: `homr` on a host without it falls through to the vision models and reads
#: every page the slower, worse way while appearing to work.
def homr_available() -> bool:
    if os.getenv("HOMR_DISABLED", "").strip():
        return False
    try:
        import homr  # noqa: F401
    except ImportError:
        return False
    return True
