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

#: Output budget for one transcription.
#:
#: **4000 was too small for a real page, and the way it failed hid why.** A
#: page of orchestral parts — 25 bars, ~120 notes — serialises to 4,500-6,100
#: tokens in this schema, because every note carries five fields. Over the cap
#: the JSON stops mid-object, `model_validate_json` raises, the pipeline counts
#: that as the provider failing, the next provider is asked the same question
#: and truncates in the same place, and the musician is told their photograph
#: could not be read. The photograph was fine. Measured against a real page a
#: cellist sent in, which is what turned this up.
#:
#: 16000 matches the Gemini provider and holds roughly three times that page.
#: The cap is still a cliff, which is why `stop_reason` is now checked — a
#: bigger number alone would only move the cliff somewhere less common and
#: leave the misdiagnosis in place for whoever found it.
MAX_TOKENS = 16000


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
        thinking: dict | None = None,
        effort: str | None = None,
    ) -> None:
        self.model = model
        self.name = name
        self._input_price = input_price_per_mtok_usd
        self._output_price = output_price_per_mtok_usd
        #: How this model should think, if at all. Explicit on every provider
        #: because the *default* differs by model and the default is expensive
        #: here: on Sonnet 5 and Opus 5, omitting `thinking` runs adaptive
        #: thinking, which is billed and which counts against `max_tokens`.
        #: Reading notes off a page is perception, not reasoning — and thinking
        #: tokens eating the output budget is precisely how a long page came to
        #: be reported as an unreadable photograph.
        self._thinking = thinking
        self._effort = effort
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
            extra: dict = {}
            if self._thinking is not None:
                extra["thinking"] = self._thinking
            if self._effort is not None:
                extra["output_config"] = {"effort": self._effort}
            response = self._get_client().messages.create(
                model=self.model,
                max_tokens=MAX_TOKENS,
                **extra,
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

        # Truncation, named. Anthropic reports it rather than leaving it to be
        # inferred, and inferring it is what went wrong before: a cut-off
        # response is invalid JSON, invalid JSON is indistinguishable from a
        # model that answered badly, and "answered badly" is what the whole
        # chain then reported about a page it had simply run out of room to
        # write down.
        if getattr(response, "stop_reason", None) == "max_tokens":
            raise OCRProviderError(
                f"{self.name}: the transcription was cut off at {MAX_TOKENS} tokens "
                "— this page has more notes than one response can hold"
            )

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


# List pricing, checked 2026-08-24. Sonnet 5: $3 / $15 per 1M. Opus 5: $5 / $25.
#
# Sonnet 5 is on introductory pricing of $2 / $10 until 2026-08-31. The list
# rate is used here on purpose: the intro rate expires in a week and a hardcoded
# $2 would then quietly *under*-report every scan. Telemetry that overstates
# cost is a nuisance; telemetry that understates it is a trap.
#
# The Opus figures this replaces were $15 / $75 — wrong by 3x, and had been
# overstating the fallback's cost since they were written.

#: The first read, and the one that does the work on nearly every page.
#:
#: Thinking is **off**. On Sonnet 5 omitting the parameter runs adaptive
#: thinking, which is billed and counts against `max_tokens` — so the default
#: would both cost more and make truncation more likely on exactly the long
#: pages that were already truncating. Transcription is perception, not
#: reasoning: the answer is on the page.
claude_sonnet_provider = ClaudeProvider(
    model="claude-sonnet-5",
    name="claude-sonnet-5",
    input_price_per_mtok_usd=3.0,
    output_price_per_mtok_usd=15.0,
    thinking={"type": "disabled"},
)

#: The fallback, reached only when the first read has already failed.
#:
#: Thinking stays *on* here, at low effort, rather than disabled. Anthropic
#: documents two failure modes for disabled thinking on Opus 5 — it can leak
#: `<thinking>` tags into the visible response, and it can write a tool call
#: into text instead of a tool block. The first would corrupt the JSON this
#: parses, and adaptive-at-low-effort is the documented way to avoid it while
#: still keeping the spend down. It also runs rarely enough that the extra
#: care is nearly free.
claude_opus_provider = ClaudeProvider(
    model="claude-opus-5",
    name="claude-opus-5",
    input_price_per_mtok_usd=5.0,
    output_price_per_mtok_usd=25.0,
    thinking={"type": "adaptive"},
    effort="low",
)
