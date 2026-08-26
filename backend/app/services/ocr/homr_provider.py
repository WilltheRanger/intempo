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
from collections import Counter
from pathlib import Path

from app.services.ocr.base import OCRProviderError, OCRResponse
from app.services.ocr.musicxml import MusicXMLError, score_json_from_musicxml
from app.services.ocr.validate import MeasureFinding, validate_measures
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


def confidence_from_arithmetic(findings: list[MeasureFinding]) -> float:
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

    **It is not a claim that the notes are right, and the blind spot is bigger
    than "a wrong note of the right length".** A bar of four quarters adds up in
    4/4 whether or not the page shows eight eighths — so a reading that
    quantised an entire page would score **1.0** here, and be wrong in every bar
    in the way that matters most: `alignment.py` accumulates durations, so the
    musician is told they rushed every passage the page writes short.

    Measured on the first real page: 55 of its 74 bars are exactly four
    quarters, no sixteenth appears anywhere, and 73 of 74 bars add up. That may
    be a correct reading of a march. Nothing in this number can say.

    So it is a floor, not a grade: it *falls* when a reading is visibly broken,
    which is what the gate needs, and it never rises above what arithmetic can
    see. Nothing here substitutes for the musician looking, which is why
    `POST /scores/:id/accept` exists and why nothing else may discard the
    photograph.
    """
    if not findings:
        return 0.0
    agree = sum(1 for f in findings if f.verdict in ("ok", "pickup"))
    return round(agree / len(findings), 3)


def _refuse_if_it_is_not_a_reading(
    name: str, score: ScoreJson, findings: list[MeasureFinding]
) -> None:
    """Stop a reading that has nothing in it from being shown as a score.

    **Measured on `04_handwritten_clean`.** homr returns 7 measures holding 13
    notes: five of the seven are *empty*, the other two hold everything, no
    clef was found and no metre. That was stored, and drawn for a musician as
    their piece. Every mechanism this project has for doubt was working and not
    one of them applies — the caveat line names the bars that do not add up,
    the confidence sentence says a reading *might* be wrong, and both of those
    say "this reading is imperfect" when the true statement is "there is no
    reading here". It is the same distinction `too_small_to_read` exists for,
    one stage later.

    **Three refusals, because they are three different pages** and the musician
    can act on only one of them. Collapsing them costs the difference between
    *your photograph did not come out* and *this page cannot be read however
    well you photograph it*, which is the whole of the advice.

    **What is deliberately *not* refused: a page whose metre could not be
    established.** `validate_measures` calls those bars `unverifiable`, and
    `confidence_from_arithmetic` scores them zero because a bar whose metre is
    unknown has not been shown to add up. An earlier version of this refused on
    the confidence alone, which would have thrown away a *correctly read* inner
    page — no header, no metre inferable — over a number that only ever meant
    "not proven". The durations are still there, the timeline still builds, and
    `MeasureEditScreen` still works. So the arithmetic refusal fires only where
    arithmetic could actually see something: bars whose metre was known.
    """
    if not score.measures:
        raise OCRProviderError(f"{name}: found no bars of music on this page")

    # More holes than music.
    #
    # A bar with no notes in it is not a quiet bar — a rest is a note here,
    # with pitch `"rest"`, so multi-bar rests in an orchestral part come
    # through as music and are counted as such. An empty measure is a barline
    # with nothing between it, which `validate.py` already calls "not a
    # reading, a hole".
    #
    # The comparison is holes against music, not a tuned fraction: one smudged
    # bar in seventy-four is a page with a hole in it, and five in seven is
    # holes with a page around them. There is no constant here to fit to a
    # photograph, which is the point — the line sits where the words change.
    holes = sum(1 for measure in score.measures if not measure.notes)
    if holes * 2 > len(score.measures):
        raise OCRProviderError(
            f"{name}: {holes} of the {len(score.measures)} bars on this page "
            f"came out empty"
        )

    # Nothing that could be checked, checked out.
    #
    # `> 0` rather than a threshold on purpose: this is not a quality bar, and
    # choosing one would be inventing a number. It asks whether *any* bar that
    # arithmetic can see survived it, which is the least this can require and
    # still be a score. A page read at 0.5 is worth having — the app names the
    # bars that do not add up and `MeasureEditScreen` fixes them.
    checkable = [f for f in findings if f.verdict != "unverifiable"]
    if checkable and not any(f.verdict in ("ok", "pickup") for f in checkable):
        raise OCRProviderError(
            f"{name}: none of the {len(checkable)} bars on this page could be "
            f"read as music"
        )


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
            xml = self._read_at_any_orientation(page)

        latency_ms = int((time.perf_counter() - started) * 1000)

        try:
            score = score_json_from_musicxml(xml)
        except MusicXMLError as exc:
            raise OCRProviderError(f"{self.name}: {exc}") from exc

        # Validated once, and the answer used twice: the confidence reported to
        # the app, and whether this is a reading at all.
        findings = validate_measures(score)
        score = score.model_copy(
            update={"ocr_confidence": confidence_from_arithmetic(findings)}
        )
        _refuse_if_it_is_not_a_reading(self.name, score, findings)

        # The duration mix, not just the totals.
        #
        # **Because the beat check cannot see the failure that matters most
        # here.** A bar of four quarters adds up perfectly in 4/4 whether or not
        # the page shows eight eighths, so "73 of 74 bars add up" — the number
        # this engine earned on the first real page — says nothing at all about
        # whether the rhythms are right. Measured on that page: 230 quarters, 20
        # eighths, 9 wholes, 8 halves, and **no sixteenths anywhere**. That may
        # be correct; a march in quarter notes looks exactly like that. It is
        # also what a reading that quantised everything would look like, and
        # nothing downstream can tell the two apart.
        #
        # `alignment.py` accumulates durations, so if it is the second one a
        # musician is told they rushed every passage the page writes in eighths.
        # This line is what makes the shape of a reading visible without
        # anybody having to guess it from a confidence number.
        mix = Counter(n.duration for m in score.measures for n in m.notes)
        log.info(
            "%s: %d measures, %d notes, %d%% of bars add up, %d ms; durations %s",
            self.name,
            len(score.measures),
            sum(len(m.notes) for m in score.measures),
            round(score.ocr_confidence * 100),
            latency_ms,
            dict(mix.most_common()),
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
                # **Every argument, by name.** `ProcessingConfig` takes eight
                # required positional parameters in 0.7.0, and this called it
                # with none — so every page ever handed to homr raised
                # `TypeError: ProcessingConfig.__init__() missing 8 required
                # positional arguments` before a pixel was looked at.
                #
                # It was wrapped as an `OCRProviderError`, matched no needle in
                # `_FAILURE_REASONS`, and reached the musician as "a flatter,
                # better-lit shot of the page usually fixes it" — advice about a
                # photograph, for a call that never reached one. **homr has
                # never once run in this deployment.**
                #
                # The values are homr's own CLI defaults, read from its
                # `main()`: no debug, no cache, no staff-position files, every
                # staff (`-1`), and CPU everywhere because the container has no
                # GPU. Keywords rather than positions so a reordering upstream
                # is a `TypeError` at the call site instead of a silently
                # different configuration.
                ProcessingConfig(
                    enable_debug=False,
                    enable_cache=False,
                    write_staff_positions=False,
                    read_staff_positions=False,
                    selected_staff=_EVERY_STAFF,
                    transformer_use_gpu=False,
                    segnet_use_gpu=False,
                    coreml_encoder=False,
                ),
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

    def _read_at_any_orientation(self, page: Path) -> str:
        """homr on the page, and on the page turned, if it has to be.

        **homr decides, not a heuristic.** A previous attempt guessed the
        orientation from ink profiles before anything read the page, and got it
        wrong on the first real photograph: EXIF had already put that page the
        right way up, and rotating it took homr from *5 staffs, 25 measures and
        112 notes* to none at all.

        The engine is simply better placed to answer. It segments the page,
        finds its staves and dewarps them, and when it cannot it says so in one
        sentence — "No staffs found" — which is a far more reliable signal than
        counting bands. So the page goes in as it arrived, and only a page homr
        rejects outright is turned and offered again.

        The cost is bounded and paid only by pages that were failing anyway: a
        page it reads costs one pass, exactly as before.
        """
        first: OCRProviderError | None = None
        for turn in _ORIENTATIONS:
            candidate = page if turn == 0 else _turned(page, turn)
            if candidate is None:
                continue
            try:
                return self._run(candidate)
            except OCRProviderError as exc:
                first = first or exc
                if not _looks_like_no_staves(exc):
                    # A missing model, a container without homr, an unreadable
                    # file — turning the page cannot help any of those, and
                    # trying twice would double a failure rather than fix it.
                    raise
        raise first or OCRProviderError(f"{self.name}: found no staves on this page")


#: The turns to try, in order. Zero first: a page that arrives correct must
#: cost exactly one pass, and every page whose EXIF tag is honoured arrives
#: correct.
_ORIENTATIONS = (0, 90, 270)


def _looks_like_no_staves(exc: Exception) -> bool:
    """Whether this failure is the one that turning the page might fix.

    homr raises `Exception("No staffs found")`, and `_run` raises its own
    "found no staves on this page" when nothing was written. Matched on the
    words rather than the type because homr raises a bare `Exception`, which
    cannot be told apart from anything else by class.
    """
    said = str(exc).lower()
    return "no staffs found" in said or "found no staves" in said


def _turned(page: Path, degrees: int) -> Path | None:
    """The same page, rotated, written beside it. None if it cannot be."""
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover — Pillow is a declared dependency
        return None
    out = page.with_name(f"{page.stem}-turned{degrees}{page.suffix}")
    try:
        with Image.open(page) as image:
            image.convert("RGB").rotate(-degrees, expand=True).save(
                out, quality=95
            )
    except Exception:  # noqa: BLE001 — a page that will not turn is not fatal
        return None
    return out


#: `selected_staff` for "all of them", which is what homr's own CLI passes.
#: Named because `-1` at a call site reads like a mistake.
_EVERY_STAFF = -1

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
