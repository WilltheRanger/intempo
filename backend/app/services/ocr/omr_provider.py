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

`OMR_COMMAND` and `OMR_ARGS` point at any engine that writes MusicXML. The
argument shapes differ and there is no convention to rely on:

    oemer      {image} -o {out}
    Audiveris  -batch -export -output {out} -- {image}

Audiveris also exports `.mxl` — a zip holding the MusicXML — rather than a bare
document, so both are read.
"""

from __future__ import annotations

import shlex
import shutil
import subprocess
import tempfile
import time
import zipfile
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
        args: str | None = None,
        timeout_s: int = DEFAULT_TIMEOUT_S,
        clef_fallback: str = "treble",
    ) -> None:
        self.name = name
        self.model = name
        self._command = command
        self._args = args
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

            template = self._args if self._args is not None else settings.OMR_ARGS
            try:
                argv = [
                    part.format(image=str(image_path), out=str(out_dir))
                    for part in shlex.split(template)
                ]
            except (KeyError, IndexError, ValueError) as exc:
                raise OCRProviderError(
                    f"{self.name}: OMR_ARGS is not a usable template ({template!r}): {exc}. "
                    "Use {image} and {out} as the placeholders."
                ) from exc

            try:
                completed = subprocess.run(
                    [command, *argv],
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
                raise OCRProviderError(
                    f"{self.name}: engine exited {completed.returncode}"
                    + _explain(completed)
                )

            produced = (
                sorted(out_dir.rglob("*.musicxml"))
                + sorted(out_dir.rglob("*.mxl"))
                + sorted(out_dir.rglob("*.xml"))
            )
            if not produced:
                # Audiveris exits *zero* when it gives up — "Could not export
                # since transcription did not complete successfully" — and the
                # actual reason is a line further up its own log. Without it the
                # failure is a mystery; with it, it says things like "Too large
                # image: 24,470,208 pixels (vs 20,000,000 max)", which names both
                # the problem and the fix.
                raise OCRProviderError(
                    f"{self.name}: engine finished but wrote no MusicXML"
                    + _explain(completed)
                )
            raw_text = _read_musicxml(produced[0], self.name)

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


def _explain(completed: subprocess.CompletedProcess[str]) -> str:
    """The engine's own words about what went wrong.

    Both streams, because these engines disagree about which one to use —
    Audiveris logs everything to stdout, oemer raises on stderr — and the last
    few lines only, because both are chatty about progress and the useful part
    is at the end.
    """
    lines: list[str] = []
    for stream in (completed.stderr, completed.stdout):
        lines.extend((stream or "").strip().splitlines())
    interesting = [
        line for line in lines
        if any(word in line for word in ("rror", "ARN", "xception", "ailed", "not ", "Too "))
    ]
    tail = (interesting or lines)[-4:]
    return (" — " + " | ".join(t.strip() for t in tail)) if tail else ""


def _read_musicxml(path: Path, provider: str) -> str:
    """Read a MusicXML document, compressed or not.

    A `.mxl` is a zip. Its `META-INF/container.xml` names the real document, but
    that indirection is not worth honouring for one file: take the first entry
    that is not container metadata, which is what every writer produces.
    """
    if path.suffix.lower() != ".mxl":
        return path.read_text(encoding="utf-8", errors="replace")
    try:
        with zipfile.ZipFile(path) as archive:
            names = [
                n for n in archive.namelist()
                if not n.startswith("META-INF/") and n.lower().endswith((".xml", ".musicxml"))
            ]
            if not names:
                raise OCRProviderError(f"{provider}: {path.name} holds no MusicXML document")
            return archive.read(names[0]).decode("utf-8", errors="replace")
    except zipfile.BadZipFile as exc:
        raise OCRProviderError(f"{provider}: {path.name} is not a readable .mxl: {exc}") from exc


omr_local_provider = OMRProvider()
