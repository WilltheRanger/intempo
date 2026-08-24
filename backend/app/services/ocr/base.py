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


def json_object_in(text: str) -> str:
    """The JSON object inside whatever a model actually sent back.

    **One copy, because there were nearly two and only one of them worked.**
    `claude_provider` carried a fence-stripper; `gemini_provider` carried the
    comment *"JSON mode means no markdown fences are expected — but parse
    defensively"* above a bare `.strip()`, which is not defensive at all. Gemini
    is first in the configured chain, so the provider that claimed to be careful
    was the one with nothing behind it.

    Handles the three things a model does despite being told not to: a
    ```` ```json ```` fence, a sentence before the object, and a sentence after
    it. All three arrive as `json_invalid` from `model_validate_json` — the
    running service has logged that from **both** providers on one page — and
    each costs the whole score.

    **All three by the same two lines**, and that is worth stating because this
    started with a dedicated fence-stripper beside them. Taking the first `{` to
    the last `}` removes a fence exactly as it removes a preamble: the fence is
    just prose that happens to be punctuation. Mutation testing found the
    stripper unkillable — no input reached it that the slice did not already
    handle — so it went, rather than growing a test that could not fail.

    Nothing is trimmed first: slicing between the braces discards surrounding
    whitespace on its own, and when there is no object to find the text comes
    back exactly as the model sent it — so the error a caller reports quotes
    what was actually said.

    **Truncation still fails, and must.** A response that stopped mid-object has
    no matching closing brace for its first one, so slicing to the last `}`
    leaves JSON that is still invalid; the parse still raises and `_is_truncation`
    still stops the chain rather than paying for the next provider. Repairing a
    half-read page would be worse than failing on it: the bars that did arrive
    would be presented as the whole piece.
    """
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    return text


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
