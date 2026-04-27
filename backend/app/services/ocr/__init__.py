"""OCR pipeline + providers.

Public API:
- `parse_sheet_music(image_bytes, *, media_type, providers) -> ScoreJson`
- `OCRError`

Built-in providers:
- `claude_sonnet_provider`, `claude_opus_provider`
- `gemini_flash_provider`, `gemini_pro_provider`

The default chain is read from `settings.OCR_PROVIDER_CHAIN`.
"""

from app.services.ocr.base import OCRProvider, OCRProviderError, OCRResponse
from app.services.ocr.claude_provider import (
    claude_opus_provider,
    claude_sonnet_provider,
)
from app.services.ocr.gemini_provider import (
    gemini_flash_provider,
    gemini_pro_provider,
)
from app.services.ocr.pipeline import (
    CONFIDENCE_THRESHOLD,
    OCRError,
    PROVIDER_REGISTRY,
    get_provider,
    parse_sheet_music,
)

__all__ = [
    "CONFIDENCE_THRESHOLD",
    "OCRError",
    "OCRProvider",
    "OCRProviderError",
    "OCRResponse",
    "PROVIDER_REGISTRY",
    "claude_opus_provider",
    "claude_sonnet_provider",
    "gemini_flash_provider",
    "gemini_pro_provider",
    "get_provider",
    "parse_sheet_music",
]
