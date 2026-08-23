"""Base types for the OCR provider abstraction.

A provider performs ONE shot at parsing an image into a `ScoreJson`.
Retries, fallback chains, and confidence thresholding live in
`pipeline.py`. Providers are stateless wrappers around their vendor
SDK; they own model name + per-token pricing constants.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, Field

from app.services.score_schema import ScoreJson

# The OCR prompt is shared across providers so all of them speak the same
# language to the model. Externalized in `app/prompts/ocr_prompt.txt`.
PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "ocr_prompt.txt"
PROMPT = PROMPT_PATH.read_text(encoding="utf-8")


class OCRProviderError(Exception):
    """Raised when a single provider fails (e.g. SDK error, non-text response).

    Pipeline catches this alongside `pydantic.ValidationError` to fall through
    to the next provider in the chain.
    """


class OCRResponse(BaseModel):
    """One provider's parsed result + telemetry."""

    score: ScoreJson
    raw_text: str
    model: str
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    cost_usd: float = Field(ge=0.0)
    latency_ms: int = Field(ge=0)


class OCRProvider(Protocol):
    """Structural interface every provider implements."""

    name: str

    def parse(
        self,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        note: str | None = None,
    ) -> OCRResponse:
        """Read the image once.

        `note` is appended after the shared prompt. It exists so a caller can
        ask a second question of the same page — "here is what another engine
        read, check it" — without a second prompt file drifting away from this
        one.
        """
        ...
