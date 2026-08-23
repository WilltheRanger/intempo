"""Pipeline orchestration: try providers in order, fall through on failure.

Public API (re-exported by `app.services.ocr.__init__`):
- `parse_sheet_music(image_bytes, *, media_type, providers) -> ScoreJson`
- `OCRError` — raised when every provider in the chain fails.

Provider chain semantics:
- Each provider is called once per image. If it raises (validation,
  SDK error, etc.), the next provider is tried.
- A provider that returns a `ScoreJson` with `ocr_confidence >= 0.7`
  is the winner — pipeline returns immediately.
- A provider that returns a low-confidence result is remembered but
  not returned yet — we keep trying for someone better. If everyone
  else fails or also comes back low-confidence, the first parseable
  low-confidence result is returned (per spec §6 + Batch 2 — a
  parseable-but-uncertain parse beats nothing for the human-correction
  flow).
- Only when nothing parseable comes back do we raise `OCRError`.
"""

from __future__ import annotations

import logging
from typing import Callable

from pydantic import ValidationError

from app.config import settings
from app.services.ocr.base import OCRProvider, OCRProviderError, OCRResponse
from app.services.ocr.claude_provider import (
    claude_opus_provider,
    claude_sonnet_provider,
)
from app.services.ocr.validate import numbering_gaps
from app.services.ocr.validate import problems as beat_problems
from app.services.ocr.gemini_provider import (
    gemini_flash_provider,
    gemini_pro_provider,
)
from app.services.ocr.confirm import retry_with_arithmetic
from app.services.score_schema import ScoreJson

log = logging.getLogger("intempo.ocr")

CONFIDENCE_THRESHOLD = 0.7


class OCRError(Exception):
    """Raised when every provider in the chain fails to produce a usable parse."""


# Built-in registry — bake-off and pipeline both look providers up here.
PROVIDER_REGISTRY: dict[str, OCRProvider] = {
    claude_sonnet_provider.name: claude_sonnet_provider,
    claude_opus_provider.name: claude_opus_provider,
    gemini_flash_provider.name: gemini_flash_provider,
    gemini_pro_provider.name: gemini_pro_provider,
}


def get_provider(name: str) -> OCRProvider:
    if name not in PROVIDER_REGISTRY:
        raise OCRError(
            f"unknown provider {name!r}; known: {sorted(PROVIDER_REGISTRY)}"
        )
    return PROVIDER_REGISTRY[name]


#: Names in `OCR_PROVIDER_CHAIN` that this build does not know.
#:
#: Read by `/v1/ready` so a stale name is *reported* rather than merely
#: survived. Recomputed on every `_default_chain()` call, because the setting
#: is read fresh each time.
unknown_provider_names: list[str] = []


def _default_chain() -> list[OCRProvider]:
    """The configured chain, minus any name this build has never heard of.

    **Skips rather than raises, and that is a deliberate reversal.** It used to
    raise, and the consequence was found the hard way: the shipped default read
    `claude-sonnet-4-6,claude-opus-4-7`, both names from the previous Claude
    generation, so the very first scan died with "unknown provider" and no page
    could be read whatever keys were set. One stale name in a list of three
    took down a feature that had two working models in it.

    A model being renamed is a fact of life and should cost that model, not the
    feature. What must not happen is losing it *silently*, so the names are
    logged at warning and kept in `unknown_provider_names` for `/v1/ready` to
    report. An empty result still raises — a chain with nothing usable in it is
    a configuration error with no fallback left.
    """
    raw = settings.OCR_PROVIDER_CHAIN.strip()
    if not raw:
        return [claude_sonnet_provider, claude_opus_provider]

    names = [n.strip() for n in raw.split(",") if n.strip()]
    chain: list[OCRProvider] = []
    unknown: list[str] = []
    for name in names:
        if name in PROVIDER_REGISTRY:
            chain.append(PROVIDER_REGISTRY[name])
        else:
            unknown.append(name)

    unknown_provider_names[:] = unknown
    if unknown:
        log.warning(
            "OCR_PROVIDER_CHAIN names %s are not known to this build and were "
            "skipped; usable chain is %s",
            unknown,
            [p.name for p in chain] or "empty",
        )
    if not chain:
        raise OCRError(
            f"OCR_PROVIDER_CHAIN has no usable provider; unknown: {unknown}; "
            f"known: {sorted(PROVIDER_REGISTRY)}"
        )
    return chain


#: A step the pipeline actually took, reported as it happens.
#:
#: Every value is an event the pipeline observes, never an estimate of how far
#: through it is — there is no such number. The chain's length is known but a
#: provider's duration is not, and the second one is only reached when the
#: first has failed. Anything smoother than this would be invented.
Stage = str

STAGE_CONFIRMING = "rereading"
#: Reading with a named provider, e.g. `reading:claude-sonnet-4-6`.
STAGE_READING = "reading"



def _is_truncation(exc: Exception) -> bool:
    """Whether a provider failed by running out of output room.

    Matched on the providers' own phrase rather than an exception type, because
    both of them raise plain `OCRProviderError` and adding a subclass would put
    the knowledge in two places. `claude_provider` and `gemini_provider` both
    say "cut off"; that string is the contract and the tests hold all three to
    it.
    """
    return "cut off" in str(exc).lower()



def renumber(score: ScoreJson) -> ScoreJson:
    """Number the measures 1..N in the order they were read.

    **The program is better at this than a model and it is not close.** The
    numbers are positional — first bar on the page is 1 — so deriving them is
    counting, and counting is what a program does without ever having a bad
    minute. Asking for them instead bought the single most common failure this
    pipeline has: a boxed rehearsal mark reading **49** came back as measure
    **409**, which inserted an empty measure and renumbered the rest of the
    line.

    The anomaly is *reported before it is normalised*, not hidden by it.
    `numbering_gaps` is what catches a rehearsal mark being counted as a bar,
    and silently renumbering would destroy exactly that signal — the numbers
    would come out 1..N and look immaculate while a spurious measure sat in the
    middle of them. So the gap is logged and named in `notes_to_human`, and
    then the numbering is made positional.

    Deliberately not a no-op when the numbers already run 1..N: it must be safe
    to call on every reading, or it will not be called on the one that needed
    it.
    """
    gaps = numbering_gaps(score)
    if gaps:
        described = ", ".join(f"{g.after}→{g.next}" for g in gaps)
        log.info("measure numbers skip (%s); renumbering positionally", described)

    renumbered = [
        measure.model_copy(update={"measure_number": position})
        for position, measure in enumerate(score.measures, start=1)
    ]
    note = score.notes_to_human
    if gaps:
        gap_note = (
            f"The measure numbers read from the page skipped ({described}), which "
            "usually means a rehearsal mark was counted as a bar. They have been "
            "renumbered from 1 — check the bar count against your copy."
        )
        note = f"{note}\n{gap_note}".strip() if note else gap_note
    return score.model_copy(update={"measures": renumbered, "notes_to_human": note})


def parse_sheet_music(
    image_bytes: bytes,
    *,
    media_type: str = "image/jpeg",
    providers: list[OCRProvider] | None = None,
    retry: bool = True,
    on_stage: Callable[[Stage], None] | None = None,
) -> ScoreJson:
    """Run the image through the configured provider chain.

    `retry=False` turns off the arithmetic re-read, for tests and for callers
    that want a single pass.

    `engine_bytes` is the *same page* prepared for the OMR engine rather than
    for a model, and the two are not interchangeable. Measured on a full page:
    at the 1568px a vision model is served, Audiveris reports "interline value
    of 10 pixels … resolution is too low" and reads nothing; at 2048px it
    transcribes the page. Passing the model's copy to the engine does not
    degrade the second opinion — it removes it, silently, as an engine that
    "found nothing". Defaults to `image_bytes` so a caller with one image
    behaves exactly as before.

    `on_stage` is called as each step begins, for a caller that has to tell a
    human what is happening — this takes tens of seconds and a musician
    watching a spinner cannot tell it apart from a hang. It is advisory: a
    callback that raises must not lose a transcription that succeeded, so it is
    called defensively.
    """
    chain = providers if providers is not None else _default_chain()
    if not chain:
        raise OCRError("provider chain is empty")

    def stage(name: Stage) -> None:
        if on_stage is None:
            return
        try:
            on_stage(name)
        except Exception:  # noqa: BLE001 — reporting must never break reading
            log.warning("stage callback failed for %s", name, exc_info=True)

    # A transcription whose bars do not add up is *known* to be wrong — no
    # judgement, just arithmetic — and it is wrong in the way that matters
    # most, because `alignment.py` accumulates durations to build its expected
    # timeline and one bad bar shifts every bar after it.
    #
    # So instead of shrugging and keeping it as a low-confidence fallback, the
    # model is handed its own arithmetic back with the offending measures named
    # and asked to re-read those. See `confirm.py` for why a correction is
    # taken only when it is not worse.
    #
    # This replaced an OMR second opinion, which read the page with Audiveris
    # and asked a model to check it. The engine needed a 2 GB host to find
    # fewer measures than the model already found; the shape of the step was
    # right and survives here with a model on both sides.

    failures: list[str] = []
    # **First** in the chain, not highest-scoring, and deliberately so — this
    # was called `best_low_confidence`, which implied a comparison that would
    # be meaningless. `ocr_confidence` is each model's own estimate of its own
    # work; a 0.5 from one provider and a 0.4 from another are not the same
    # quantity and ranking them would be reading a number that does not exist.
    # The chain order encodes which provider is trusted more, so the first one
    # to produce anything usable is the one to keep.
    first_low_confidence: ScoreJson | None = None
    first_low_confidence_from: str | None = None

    for provider in chain:
        try:
            stage(f"{STAGE_READING}:{provider.name}")
            response: OCRResponse = provider.parse(image_bytes, mime_type=media_type)
            # Before the beat check, the retry or the confidence gate look at
            # it: everything downstream keys off measure numbers, and the
            # program can derive them more reliably than a model can read them.
            response = response.model_copy(update={"score": renumber(response.score)})
        except (ValidationError, OCRProviderError, ValueError) as exc:
            failures.append(f"{provider.name}: {type(exc).__name__}: {exc}")
            if _is_truncation(exc):
                # Stop, rather than fall through. Running out of room is a
                # property of the *page*, not of the provider: the next one is
                # asked the identical question about the identical image and
                # stops in the same place. Falling through bought a second
                # full-price failure and an identical error message, and this
                # is the failure mode of a long page, which is exactly when
                # the response was most expensive to begin with.
                log.info("%s ran out of room; the rest of the chain would too", provider.name)
                break
            continue

        if response.score.clef is None:
            # `ScoreJson.clef` is optional so a score can exist before it has
            # been read. A provider answering without one has not read it
            # either, and the next provider deserves the page.
            failures.append(f"{provider.name}: no clef")
            log.info("%s: returned no clef, trying the next provider", provider.name)
            continue

        # Arithmetic before self-assessment.
        #
        # `ocr_confidence` is the model marking its own homework, and the
        # bake-off shows how little that is worth: on the handwritten fixture
        # one provider reported 0.90 and the other 0.32 for the same page, and
        # the confident one is first in the shipped chain — so it clears the
        # threshold, returns, and the second opinion is never asked for.
        #
        # Whether the durations in a measure add up to the time signature is
        # not an opinion. A transcription that contradicts itself is wrong no
        # matter how sure the model is, and it is wrong in the way that matters
        # most: `alignment.py` builds its whole expected timeline from those
        # durations, so one bad measure desynchronises every measure after it.
        broken = beat_problems(response.score)
        if broken:
            failures.append(
                f"{provider.name}: {len(broken)} measure(s) do not add up "
                f"({', '.join(str(f.measure_number) for f in broken)})"
            )
            log.info(
                "%s: transcription does not add up, trying the next provider: %s",
                provider.name,
                "; ".join(f.describe() for f in broken),
            )
            if retry:
                stage(STAGE_CONFIRMING)
                corrected = retry_with_arithmetic(
                    response.score, image_bytes, media_type=media_type, provider=provider
                )
                if not beat_problems(corrected):
                    return corrected
                # Still broken, but possibly less so — keep the better of the
                # two as the fallback rather than the one we started with.
                response = response.model_copy(update={"score": corrected})

            # Kept as a fallback, exactly like a low-confidence result: a
            # transcription with a bad measure is still better than none for
            # the human-correction flow, and refusing outright would make a
            # single mis-read note lose the whole page.
            if first_low_confidence is None:
                first_low_confidence = response.score
                first_low_confidence_from = provider.name
            continue

        if response.score.ocr_confidence >= CONFIDENCE_THRESHOLD:
            return response.score

        failures.append(
            f"{provider.name}: low confidence {response.score.ocr_confidence:.2f}"
        )
        if first_low_confidence is None:
            first_low_confidence = response.score
            first_low_confidence_from = provider.name

    if first_low_confidence is not None:
        # Which provider's transcription the musician is about to be shown and
        # asked to correct. The name was being tracked and then dropped, so
        # nothing anywhere recorded whose reading of the page this was.
        log.info(
            "returning low-confidence transcription from %s (confidence %.2f); tried: %s",
            first_low_confidence_from,
            first_low_confidence.ocr_confidence,
            "; ".join(failures),
        )
        return first_low_confidence

    raise OCRError("all providers failed: " + "; ".join(failures))
