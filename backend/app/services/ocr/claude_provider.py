"""Claude Vision OCR provider.

One Anthropic call per `parse`. Module-level lazy `_client` so unit
tests monkeypatch the instance attribute without going through the
real SDK constructor and CI never needs `ANTHROPIC_API_KEY`.
"""

from __future__ import annotations

import base64
import time

from anthropic import Anthropic, AnthropicError

from app.services.ocr.base import (
    PROMPT,
    OCRProviderError,
    OCRResponse,
)
from app.services.score_schema import ScoreJson

MAX_TOKENS = 4000


def _strip_markdown_fences(text: str) -> str:
    """Claude sometimes wraps JSON in ``` fences despite the prompt forbidding it."""
    text = text.strip()
    if not text.startswith("```"):
        return text
    inner = text.split("```", 2)
    if len(inner) < 2:
        return text
    body = inner[1]
    if body.startswith("json"):
        body = body[4:]
    return body.strip()


class ClaudeProvider:
    """Provider for any HS256-served Claude vision-capable model."""

    def __init__(
        self,
        *,
        model: str,
        name: str,
        input_price_per_mtok_usd: float,
        output_price_per_mtok_usd: float,
    ) -> None:
        self.model = model
        self.name = name
        self._input_price = input_price_per_mtok_usd
        self._output_price = output_price_per_mtok_usd
        self._client: Anthropic | None = None

    def _get_client(self) -> Anthropic:
        if self._client is None:
            self._client = Anthropic()
        return self._client

    def _cost(self, input_tokens: int, output_tokens: int) -> float:
        return (
            input_tokens * self._input_price + output_tokens * self._output_price
        ) / 1_000_000

    def parse(
        self,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        note: str | None = None,
    ) -> OCRResponse:
        prompt = f"{PROMPT}\n\n{note}" if note else PROMPT
        b64 = base64.standard_b64encode(image_bytes).decode("ascii")
        start = time.monotonic()
        try:
            response = self._get_client().messages.create(
                model=self.model,
                max_tokens=MAX_TOKENS,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": mime_type,
                                    "data": b64,
                                },
                            },
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
            )
        except AnthropicError as exc:
            # The contract in `base.py` says an SDK error is an
            # `OCRProviderError`, and until a real scan hit one this did not
            # honour it: a 400 from the API escaped the pipeline's `except`,
            # skipped every remaining provider, and reached the client as a
            # 500 with a stack trace. One provider being unable to read a page
            # is precisely the situation the chain exists for.
            raise OCRProviderError(f"{self.name}: {type(exc).__name__}: {exc}") from exc
        latency_ms = int((time.monotonic() - start) * 1000)

        parts = getattr(response, "content", None) or []
        if not parts:
            raise OCRProviderError(f"{self.name}: no content parts")
        text = getattr(parts[0], "text", None)
        if text is None:
            raise OCRProviderError(f"{self.name}: first content part has no text")

        cleaned = _strip_markdown_fences(text)
        score = ScoreJson.model_validate_json(cleaned)

        usage = getattr(response, "usage", None)
        input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
        output_tokens = int(getattr(usage, "output_tokens", 0) or 0)

        return OCRResponse(
            score=score,
            raw_text=text,
            model=self.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=self._cost(input_tokens, output_tokens),
            latency_ms=latency_ms,
        )


# Pricing as of 2026-04 (https://www.anthropic.com/pricing#api).
# Sonnet 4.6: $3 / $15 per 1M tokens. Opus 4.7: $15 / $75 per 1M tokens.
claude_sonnet_provider = ClaudeProvider(
    model="claude-sonnet-4-6",
    name="claude-sonnet-4-6",
    input_price_per_mtok_usd=3.0,
    output_price_per_mtok_usd=15.0,
)

claude_opus_provider = ClaudeProvider(
    model="claude-opus-4-7",
    name="claude-opus-4-7",
    input_price_per_mtok_usd=15.0,
    output_price_per_mtok_usd=75.0,
)
