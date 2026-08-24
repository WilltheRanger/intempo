"""Gemini Vision OCR provider via google-genai.

Uses native JSON mode (`response_mime_type="application/json"`), which
should give cleaner output than Claude (no markdown fences to strip).
"""

from __future__ import annotations

import threading
import time

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.config import settings
from app.services.ocr.base import (
    PROMPT,
    OCRProviderError,
    OCRResponse,
)
from app.services.score_schema import ScoreJson

# Gemini 2.5 has thinking mode on by default and bills thinking tokens
# against `max_output_tokens`. Even with thinking disabled (we set
# `thinking_budget=0` below), the OCR JSON for a dense single-staff line
# can run 2-3k visible tokens. 16000 leaves comfortable headroom.
MAX_OUTPUT_TOKENS = 16000


class GeminiProvider:
    """Provider for Gemini multimodal models."""

    #: See `ClaudeProvider.api_key_setting`.
    api_key_setting = "GEMINI_API_KEY"

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
        self._client: genai.Client | None = None
        #: See `claude_provider`: systems are read concurrently.
        self._client_lock = threading.Lock()

    def _get_client(self) -> genai.Client:
        if self._client is None:
            with self._client_lock:
                if self._client is None:
                    if not settings.GEMINI_API_KEY:
                        raise OCRProviderError(
                            f"{self.name}: GEMINI_API_KEY is not configured"
                        )
                    self._client = genai.Client(api_key=settings.GEMINI_API_KEY)
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
        start = time.monotonic()
        try:
            response = self._get_client().models.generate_content(
                model=self.model,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    prompt,
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    max_output_tokens=MAX_OUTPUT_TOKENS,
                    # Gemini 2.5 enables thinking by default; thinking tokens
                    # are billed and counted against max_output_tokens. For
                    # OCR we don't need internal reasoning, so disable it.
                    # Per Google docs: thinking_budget=0 turns thinking off
                    # for 2.5 Flash. Pro has a non-zero minimum but accepts 0.
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
        except genai_errors.APIError as exc:
            # Same reason as the Claude provider: an SDK error is a provider
            # failure, and the chain can only route around it if it arrives as
            # one. Being last in the chain makes this worse, not better — the
            # message here is the last thing the caller gets.
            raise OCRProviderError(f"{self.name}: {type(exc).__name__}: {exc}") from exc
        latency_ms = int((time.monotonic() - start) * 1000)

        # The same truncation check as the Claude provider, for the same
        # reason: a response that ran out of room is invalid JSON, and invalid
        # JSON reported as "the model answered badly" is how a page with too
        # many notes came to be described as an unreadable photograph.
        # Gemini spells the reason on the candidate rather than the response.
        candidates = getattr(response, "candidates", None) or []
        if candidates and str(getattr(candidates[0], "finish_reason", "")).endswith(
            "MAX_TOKENS"
        ):
            raise OCRProviderError(
                f"{self.name}: the transcription was cut off at "
                f"{MAX_OUTPUT_TOKENS} tokens — this page has more notes than "
                "one response can hold"
            )

        text = getattr(response, "text", None)
        if not text:
            raise OCRProviderError(f"{self.name}: empty response text")

        # JSON mode means no markdown fences are expected — but parse defensively.
        score = ScoreJson.model_validate_json(text.strip())

        usage = getattr(response, "usage_metadata", None)
        input_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
        # `candidates_token_count` covers the model's output. `thoughts_token_count`
        # may also exist on Gemini 2.5; if present it's billed as output too.
        output_tokens = int(getattr(usage, "candidates_token_count", 0) or 0)
        thoughts = int(getattr(usage, "thoughts_token_count", 0) or 0)
        output_tokens += thoughts

        return OCRResponse(
            score=score,
            raw_text=text,
            model=self.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=self._cost(input_tokens, output_tokens),
            latency_ms=latency_ms,
        )


# Pricing verified 2026-04-26 from https://ai.google.dev/gemini-api/docs/pricing
# (paid tier, prompts ≤200k tokens). Update if the docs page changes.
gemini_flash_provider = GeminiProvider(
    model="gemini-2.5-flash",
    name="gemini-2.5-flash",
    input_price_per_mtok_usd=0.30,
    output_price_per_mtok_usd=2.50,
)

gemini_pro_provider = GeminiProvider(
    model="gemini-2.5-pro",
    name="gemini-2.5-pro",
    input_price_per_mtok_usd=1.25,
    output_price_per_mtok_usd=10.00,
)
