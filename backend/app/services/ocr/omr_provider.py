"""A real OMR engine as a provider, alongside the vision models.

`intempo-combined.md` §"Claude Vision vs custom OMR" chose a vision model over
Audiveris and OEmer, and that choice stands for the *primary* read: a rule-based
engine is worse on handwriting and on the pencilled-in bowings a real part
carries. This is not a reversal of it. It is the second opinion.

Two reads from the same vision model agreeing tells you almost nothing — same
weights, same blind spots, same confident misreading of the same ambiguous
notehead. A rule-based engine gets it wrong in *unrelated* ways, so where the
two agree there is real evidence, and where they disagree the beat-sum check in
`validate.py` has something to arbitrate between. That is worth a slow local
subprocess.

**Not installed by default.** The engine pulls ~500MB of ONNX runtime and
downloads model weights on first run, which does not belong in the deployed
image unless it is being used. When it is absent the provider says so and the
chain moves on, which is the point of the chain.

To install it, the pins matter and neither is oemer's fault — it was released
against older majors and both dependencies have since made breaking changes
that surface as tracebacks from inside the library:

    pip install oemer 'onnxruntime==1.21.1' 'opencv-python-headless==4.12.0.88'

Unpinned, `onnxruntime` 1.29 refuses oemer's exported graph outright
("ConvTranspose ... pads must not contain negative values") and OpenCV 5 changes
what `HoughLinesP` returns, which surfaces twenty minutes into a run as
`IndexError: invalid index to scalar variable` — after the segmentation networks
have done their work and thrown it away.

`OMR_COMMAND` points at any engine taking `<image> -o <dir>` and writing
MusicXML; Audiveris and homr both fit and carry neither of these problems.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from app.config import settings
from app.services.ocr.base import OCRProviderError, OCRResponse
from app.services.ocr.musicxml import MusicXMLError, score_json_from_musicxml

# oemer takes minutes on a full page — it runs two segmentation networks and
# then a deterministic reconstruction pass. The default is generous because the
# failure it guards against is a hung subprocess, not a slow one.
DEFAULT_TIMEOUT_S = 600

_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


class OMRProvider:
    """Runs a local OMR binary and converts its MusicXML.

    Costs nothing per call, which is the other reason to keep it: it can be run
    on every page without watching a bill, so it is the cheap half of a
    two-engine comparison.
    """

    def __init__(
        self,
        *,
        name: str = "omr-local",
        command: str | None = None,
        timeout_s: int = DEFAULT_TIMEOUT_S,
        clef_fallback: str = "treble",
    ) -> None:
        self.name = name
        self.model = name
        self._command = command
        self._timeout_s = timeout_s
        self._clef_fallback = clef_fallback

    def _resolve_command(self) -> str:
        command = self._command or settings.OMR_COMMAND
        resolved = shutil.which(command)
        if resolved is None:
            raise OCRProviderError(
                f"{self.name}: no OMR engine on PATH (looked for {command!r}). "
                "Install one with `pip install oemer 'onnxruntime==1.21.1' "
                "'opencv-python-headless==4.12.0.88'` — both pins are load-bearing, "
                "see this module's docstring — or point OMR_COMMAND at any binary "
                "that takes an image and writes MusicXML."
            )
        return resolved

    def parse(self, image_bytes: bytes, mime_type: str = "image/jpeg") -> OCRResponse:
        command = self._resolve_command()
        started = time.perf_counter()

        with tempfile.TemporaryDirectory(prefix="intempo-omr-") as workdir:
            work = Path(workdir)
            image_path = work / f"page{_EXTENSIONS.get(mime_type, '.png')}"
            image_path.write_bytes(image_bytes)
            out_dir = work / "out"
            out_dir.mkdir()

            try:
                completed = subprocess.run(
                    [command, str(image_path), "-o", str(out_dir)],
                    capture_output=True,
                    text=True,
                    timeout=self._timeout_s,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise OCRProviderError(
                    f"{self.name}: engine did not finish within {self._timeout_s}s"
                ) from exc
            except OSError as exc:  # pragma: no cover - depends on the host
                raise OCRProviderError(f"{self.name}: could not run {command!r}: {exc}") from exc

            if completed.returncode != 0:
                # The last few lines of stderr, not all of it: these engines are
                # chatty about progress and the useful part is at the end.
                tail = "\n".join((completed.stderr or "").strip().splitlines()[-4:])
                raise OCRProviderError(
                    f"{self.name}: engine exited {completed.returncode}"
                    + (f" — {tail}" if tail else "")
                )

            produced = sorted(out_dir.rglob("*.musicxml")) + sorted(out_dir.rglob("*.xml"))
            if not produced:
                raise OCRProviderError(
                    f"{self.name}: engine finished but wrote no MusicXML into {out_dir.name}"
                )
            raw_text = produced[0].read_text(encoding="utf-8", errors="replace")

        try:
            score = score_json_from_musicxml(raw_text, clef_fallback=self._clef_fallback)
        except MusicXMLError as exc:
            raise OCRProviderError(f"{self.name}: {exc}") from exc

        if not score.measures:
            # An engine that finds no staff still exits zero and writes a valid
            # but empty document. Returning that as a transcription would put an
            # empty score into the chain as a success and stop the fallback.
            raise OCRProviderError(
                f"{self.name}: engine read no measures — usually means it found no staff"
            )

        return OCRResponse(
            score=score,
            raw_text=raw_text,
            model=self.model,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )


omr_local_provider = OMRProvider()
