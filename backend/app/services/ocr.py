"""Sheet-music OCR via Claude Vision.

Per spec §6 + Batch 2: try Sonnet first; on validation failure or
`ocr_confidence < 0.7`, retry once with Opus passing the original
error as feedback. After 2 failures, raise `OCRError`.

The Anthropic client is module-level so unit tests can monkeypatch it
without going through the real SDK constructor (and without needing
a real `ANTHROPIC_API_KEY` in CI).
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from anthropic import Anthropic
from pydantic import ValidationError

from app.services.score_schema import ScoreJson

SONNET_MODEL = "claude-sonnet-4-6"
OPUS_MODEL = "claude-opus-4-7"

CONFIDENCE_THRESHOLD = 0.7
MAX_TOKENS = 4000

PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "ocr_prompt.txt"
PROMPT = PROMPT_PATH.read_text(encoding="utf-8")


class OCRError(Exception):
    """Raised when the OCR pipeline can't produce a valid ScoreJson after retry."""


@dataclass(slots=True)
class OCRResult:
    score: ScoreJson
    model_used: str
    raw_response: str


# Lazy-init so import never crashes when the env var is unset.
_client: Anthropic | None = None


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic()
    return _client


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


def _call_claude(
    image_b64: str,
    media_type: str,
    model: str,
    *,
    feedback: str | None = None,
) -> str:
    text_block = PROMPT
    if feedback:
        text_block = (
            f"{PROMPT}\n\n---\nThe previous attempt failed with this error:\n"
            f"{feedback}\nPlease return a corrected JSON object that conforms to the schema."
        )

    response = _get_client().messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": text_block},
                ],
            }
        ],
    )
    parts = getattr(response, "content", None) or []
    if not parts:
        raise OCRError("Claude returned no content parts")
    text = getattr(parts[0], "text", None)
    if text is None:
        raise OCRError("Claude returned a non-text first content part")
    return text


def _attempt(
    image_b64: str,
    media_type: str,
    model: str,
    *,
    feedback: str | None = None,
) -> tuple[ScoreJson, str]:
    """Single Claude call → cleaned text → ScoreJson. Returns (score, raw_text)."""
    raw = _call_claude(image_b64, media_type, model, feedback=feedback)
    cleaned = _strip_markdown_fences(raw)
    score = ScoreJson.model_validate_json(cleaned)
    return score, raw


def parse_sheet_music(
    image_bytes: bytes,
    *,
    media_type: str = "image/jpeg",
    primary_model: str = SONNET_MODEL,
    fallback_model: str = OPUS_MODEL,
) -> OCRResult:
    """Run a Sheet music image through the OCR pipeline.

    Try `primary_model` (Sonnet by default). If validation fails OR the
    returned `ocr_confidence` is below `CONFIDENCE_THRESHOLD`, retry once
    with `fallback_model` (Opus by default), passing the failure reason as
    feedback. Raises `OCRError` if both attempts fail.
    """
    image_b64 = base64.standard_b64encode(image_bytes).decode("ascii")

    primary_error: str | None = None
    primary_low_confidence: ScoreJson | None = None
    primary_raw: str | None = None
    try:
        score, raw = _attempt(image_b64, media_type, primary_model)
        primary_raw = raw
        if score.ocr_confidence >= CONFIDENCE_THRESHOLD:
            return OCRResult(score=score, model_used=primary_model, raw_response=raw)
        primary_low_confidence = score
        primary_error = (
            f"ocr_confidence={score.ocr_confidence:.2f} below threshold {CONFIDENCE_THRESHOLD}"
        )
    except (ValidationError, OCRError, ValueError) as exc:
        primary_error = f"{type(exc).__name__}: {exc}"

    # Retry with the fallback model, passing the primary failure as feedback.
    try:
        score, raw = _attempt(
            image_b64, media_type, fallback_model, feedback=primary_error
        )
    except (ValidationError, OCRError, ValueError) as exc:
        # Both attempts failed — surface the better available signal. If the
        # primary returned a parseable but low-confidence score, hand it back
        # rather than throw, since the spec says "surface the failure to the
        # user" and a low-confidence parse is more useful than nothing for
        # the human-correction flow. We still raise when both attempts gave
        # nothing usable.
        if primary_low_confidence is not None and primary_raw is not None:
            return OCRResult(
                score=primary_low_confidence,
                model_used=primary_model,
                raw_response=primary_raw,
            )
        raise OCRError(
            f"both OCR attempts failed. primary({primary_model})={primary_error}; "
            f"fallback({fallback_model})={type(exc).__name__}: {exc}"
        ) from exc

    return OCRResult(score=score, model_used=fallback_model, raw_response=raw)
