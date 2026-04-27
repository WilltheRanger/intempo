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

from pydantic import ValidationError

from app.config import settings
from app.services.ocr.base import OCRProvider, OCRProviderError, OCRResponse
from app.services.ocr.claude_provider import (
    claude_opus_provider,
    claude_sonnet_provider,
)
from app.services.ocr.gemini_provider import (
    gemini_flash_provider,
    gemini_pro_provider,
)
from app.services.score_schema import ScoreJson

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


def _default_chain() -> list[OCRProvider]:
    raw = settings.OCR_PROVIDER_CHAIN.strip()
    if not raw:
        return [claude_sonnet_provider, claude_opus_provider]
    names = [n.strip() for n in raw.split(",") if n.strip()]
    return [get_provider(n) for n in names]


def parse_sheet_music(
    image_bytes: bytes,
    *,
    media_type: str = "image/jpeg",
    providers: list[OCRProvider] | None = None,
) -> ScoreJson:
    """Run the image through the configured provider chain."""
    chain = providers if providers is not None else _default_chain()
    if not chain:
        raise OCRError("provider chain is empty")

    failures: list[str] = []
    best_low_confidence: ScoreJson | None = None
    best_low_confidence_label: str | None = None

    for provider in chain:
        try:
            response: OCRResponse = provider.parse(image_bytes, mime_type=media_type)
        except (ValidationError, OCRProviderError, ValueError) as exc:
            failures.append(f"{provider.name}: {type(exc).__name__}: {exc}")
            continue

        if response.score.ocr_confidence >= CONFIDENCE_THRESHOLD:
            return response.score

        failures.append(
            f"{provider.name}: low confidence {response.score.ocr_confidence:.2f}"
        )
        if best_low_confidence is None:
            best_low_confidence = response.score
            best_low_confidence_label = provider.name

    if best_low_confidence is not None:
        return best_low_confidence

    raise OCRError("all providers failed: " + "; ".join(failures))
