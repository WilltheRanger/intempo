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
from app.services.ocr.validate import problems as beat_problems
from app.services.ocr.gemini_provider import (
    gemini_flash_provider,
    gemini_pro_provider,
)
from app.services.ocr.confirm import confirm_reading
from app.services.ocr.omr_provider import omr_local_provider
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
    # Registered but not in the default chain: it needs installing, it takes
    # minutes, and it is a second opinion rather than a first read.
    omr_local_provider.name: omr_local_provider,
}


def get_provider(name: str) -> OCRProvider:
    if name not in PROVIDER_REGISTRY:
        raise OCRError(
            f"unknown provider {name!r}; known: {sorted(PROVIDER_REGISTRY)}"
        )
    return PROVIDER_REGISTRY[name]


def _default_chain() -> list[OCRProvider]:
    raw = settings.OCR_PROVIDER_CHAIN.strip()
    if not raw:
        return [claude_sonnet_provider, claude_opus_provider]
    names = [n.strip() for n in raw.split(",") if n.strip()]
    return [get_provider(n) for n in names]


#: A step the pipeline actually took, reported as it happens.
#:
#: Every value is an event the pipeline observes, never an estimate of how far
#: through it is — there is no such number. The chain's length is known but a
#: provider's duration is not, and the second one is only reached when the
#: first has failed. Anything smoother than this would be invented.
Stage = str

STAGE_ENGINE = "engine"
STAGE_CONFIRMING = "confirming"
#: Reading with a named provider, e.g. `reading:claude-sonnet-4-6`.
STAGE_READING = "reading"


def parse_sheet_music(
    image_bytes: bytes,
    *,
    media_type: str = "image/jpeg",
    providers: list[OCRProvider] | None = None,
    confirm: bool = True,
    on_stage: Callable[[Stage], None] | None = None,
) -> ScoreJson:
    """Run the image through the configured provider chain.

    `confirm=False` turns off the OMR second opinion, for tests and for callers
    that want the vision chain on its own.

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

    # The OMR engine reads first, and a vision model checks its answer.
    #
    # Not a fallthrough step, because a fallthrough would stop at the engine
    # and the engine's reading is *partial* — measured on a real page it got
    # the clef, the key and the barlines right and found 15 measures where
    # there were about 25. Returning that would be worse than the vision model
    # alone. Showing it to the model instead plays each to its strength:
    # structure from the engine, coverage from the model, and a much easier
    # question than transcribing from nothing.
    #
    # Skipped silently when the engine is not installed, which is the normal
    # case — it costs one failed `which` and the chain proceeds as before.
    if confirm and settings.OMR_CONFIRM:
        try:
            stage(STAGE_ENGINE)
            engine = get_provider(settings.OMR_CONFIRM).parse(image_bytes, media_type)
        except (ValidationError, OCRProviderError, ValueError, OCRError) as exc:
            log.info("no OMR second opinion available: %s", exc)
        else:
            stage(STAGE_CONFIRMING)
            confirmed = confirm_reading(
                engine.score, image_bytes, media_type=media_type, provider=chain[0]
            )
            if not beat_problems(confirmed):
                return confirmed
            log.info(
                "confirmed reading still has measures that do not add up; "
                "falling back to the ordinary chain"
            )

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
        except (ValidationError, OCRProviderError, ValueError) as exc:
            failures.append(f"{provider.name}: {type(exc).__name__}: {exc}")
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
