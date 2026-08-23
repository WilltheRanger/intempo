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

import logging
import shlex
import shutil
import threading
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path

from app.config import settings
from app.services.ocr.base import OCRProviderError, OCRResponse
from app.services.score_schema import Measure, ScoreJson
from app.services.ocr.musicxml import MusicXMLError, score_json_from_musicxml
from app.services.page_image import split_systems

log = logging.getLogger("intempo.omr")

#: Only so many engine runs at once, process-wide.
#:
#: Audiveris peaks at ~328 MB on a page read system by system. Two at once is
#: 656 MB, and an OOM kill takes the **whole instance** down rather than the
#: scan that caused it — so an unbounded engine is the difference between a
#: slow scan and a dead server. `BackgroundTasks` runs on a 40-thread pool, so
#: forty simultaneous scans is a reachable state, not a hypothetical one.
#:
#: A module-level semaphore, which is per-process and therefore per-instance —
#: which is the right scope, because memory is per-instance too.
_engine_slots = threading.BoundedSemaphore(max(1, settings.OMR_MAX_CONCURRENT))

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
        """Read a page, one staff system at a time where that is possible.

        **Sequential systems halve peak memory and find the same measures.**
        Measured on a 3024x4032 page with Audiveris 5.4, peak RSS sampled from
        /proc:

            whole page at 2048px      9.5s   512 MB   10 measures
            all strips, one JVM      19.1s   570 MB   10 measures
            one strip on its own      6.2s   322 MB    2 measures

        Memory is the binding constraint on any host worth paying for: 322 MB
        alongside a ~150 MB Python service fits inside 512 MB, and 512 MB
        alongside it does not. The saving comes from the process exiting
        between systems, which is also what the extra wall-clock buys — one JVM
        start per strip.

        Batching every strip into a single invocation is the obvious
        optimisation and it is worse than both: Audiveris holds them all and
        peaks higher than the whole page.

        A page that will not split is read whole, exactly as before.
        """
        slices = split_systems(image_bytes)
        if len(slices) > 1:
            return self._parse_by_system(slices)
        return self._parse_one(image_bytes, mime_type)

    def _parse_by_system(self, slices: list[bytes]) -> OCRResponse:
        """One engine run per system, sequentially, merged at the end.

        A system the engine cannot read is skipped rather than fatal. A page of
        five systems where one is smudged is four systems of real notation plus
        a gap, and losing the page over the gap would be the wrong trade —
        `_merge` renumbers what survived so the result is still coherent.
        """
        parts: list[ScoreJson] = []
        failures: list[str] = []
        started = time.perf_counter()
        for index, page in enumerate(slices, start=1):
            try:
                parts.append(self._parse_one(page, "image/jpeg").score)
            except OCRProviderError as exc:
                failures.append(f"system {index}: {exc}")
                log.info("%s: system %d unreadable: %s", self.name, index, exc)

        if not parts:
            raise OCRProviderError(
                f"{self.name}: no system on this page could be read"
                + (f" ({'; '.join(failures[:3])})" if failures else "")
            )
        if failures:
            log.info("%s: %d of %d systems read", self.name, len(parts), len(slices))

        score = _merge(parts)
        return OCRResponse(
            score=score,
            raw_text="",
            model=self.name,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

    def _parse_one(self, image_bytes: bytes, mime_type: str = "image/jpeg") -> OCRResponse:
        command = self._resolve_command()
        started = time.perf_counter()

        # Wait for a slot, but not forever. Giving up here costs the second
        # opinion and nothing else: the caller logs it and the vision chain
        # answers alone, which is exactly what happens on every install with no
        # engine at all. Blocking indefinitely would instead hold a threadpool
        # thread — one of forty — behind a queue that may never drain.
        if not _engine_slots.acquire(timeout=settings.OMR_QUEUE_TIMEOUT_S):
            raise OCRProviderError(
                f"{self.name}: the engine was busy for "
                f"{settings.OMR_QUEUE_TIMEOUT_S:.0f}s; skipping the second opinion"
            )
        try:
            return self._run(command, image_bytes, mime_type, started)
        finally:
            _engine_slots.release()

    def _run(
        self, command: str, image_bytes: bytes, mime_type: str, started: float
    ) -> OCRResponse:

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


def _merge(parts: list[ScoreJson]) -> ScoreJson:
    """Stitch per-system readings back into one score.

    Measures are renumbered across the whole page rather than kept as each
    strip numbered them. Every strip is its own document to the engine and
    starts again at 1, so concatenating them unchanged would produce a score
    with five measure 1s — and `alignment.py` builds its expected timeline in
    order, so a repeated number is not cosmetic.

    Header fields come from the first system that names one. Printed music
    repeats the clef and key on every system, which is what makes a strip
    readable on its own, but the **time signature appears once** at the head of
    the piece — so a later system legitimately has none, and taking the first
    non-null is the only reading that survives that.
    """
    merged: list[Measure] = []
    for part in parts:
        for measure in part.measures:
            merged.append(measure.model_copy(update={"measure_number": len(merged) + 1}))

    def first(field: str):
        for part in parts:
            value = getattr(part, field)
            if value:
                return value
        return None

    confidences = [p.ocr_confidence for p in parts if p.ocr_confidence]
    return ScoreJson(
        clef=first("clef"),
        time_signature=first("time_signature"),
        key_signature=first("key_signature"),
        tempo_marking=first("tempo_marking"),
        bpm_hint=first("bpm_hint"),
        measures=merged,
        repeats=[],
        # The weakest system, not the average. A page is only as trustworthy as
        # its worst-read line, and averaging would let four clean systems hide
        # one the engine struggled with.
        ocr_confidence=min(confidences) if confidences else 0.0,
        notes_to_human=f"Read system by system ({len(parts)} systems).",
    )
