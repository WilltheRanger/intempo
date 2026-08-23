"""Tests for `ClaudeProvider` and the markdown-fence stripper."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from app.services.ocr.base import OCRProviderError, OCRResponse
from app.services.ocr.claude_provider import (
    ClaudeProvider,
    _strip_markdown_fences,
    claude_sonnet_provider,
)

GOOD_PAYLOAD = {
    "time_signature": "4/4",
    "key_signature": "D major",
    "tempo_marking": None,
    "bpm_hint": None,
    "clef": "treble",
    "measures": [
        {
            "measure_number": 1,
            "notes": [
                {
                    "pitch": "D3",
                    "duration": "quarter",
                    "articulation": None,
                    "tied_to_next": False,
                    "dynamics": None,
                }
            ],
            "slurs": [],
        }
    ],
    "repeats": [],
    "ocr_confidence": 0.92,
    "notes_to_human": "",
}


@dataclass
class _FakePart:
    text: str | None


@dataclass
class _FakeUsage:
    input_tokens: int
    output_tokens: int


@dataclass
class _FakeResponse:
    content: list[_FakePart]
    usage: _FakeUsage | None = None


class _FakeMessages:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response
        self.calls: list[dict[str, Any]] = []

    def create(self, *, model: str, max_tokens: int, messages: list[dict]) -> _FakeResponse:
        self.calls.append({"model": model, "max_tokens": max_tokens, "messages": messages})
        return self._response


class _FakeClient:
    def __init__(self, response: _FakeResponse) -> None:
        self.messages = _FakeMessages(response)


@pytest.fixture()
def install_fake(monkeypatch: pytest.MonkeyPatch):
    """Replace a provider's lazy `_client` with a fake configured per test."""

    def _install(provider: ClaudeProvider, response: _FakeResponse) -> _FakeClient:
        fake = _FakeClient(response)
        monkeypatch.setattr(provider, "_client", fake)
        return fake

    return _install


# ---- _strip_markdown_fences ------------------------------------------------


def test_strip_no_fence() -> None:
    raw = '{"a": 1}'
    assert _strip_markdown_fences(raw) == raw


def test_strip_with_json_label() -> None:
    raw = '```json\n{"a": 1}\n```'
    assert _strip_markdown_fences(raw) == '{"a": 1}'


def test_strip_without_label() -> None:
    raw = '```\n{"a": 1}\n```'
    assert _strip_markdown_fences(raw) == '{"a": 1}'


# ---- ClaudeProvider.parse --------------------------------------------------


def test_parse_clean_response_returns_ocr_response(install_fake) -> None:
    fake = install_fake(
        claude_sonnet_provider,
        _FakeResponse(
            content=[_FakePart(json.dumps(GOOD_PAYLOAD))],
            usage=_FakeUsage(input_tokens=1500, output_tokens=300),
        ),
    )
    result = claude_sonnet_provider.parse(b"<jpeg>")
    assert isinstance(result, OCRResponse)
    assert result.model == "claude-sonnet-4-6"
    assert result.score.measures[0].notes[0].pitch == "D3"
    assert result.input_tokens == 1500
    assert result.output_tokens == 300
    # Sonnet pricing: $3 input, $15 output per 1M.
    expected_cost = (1500 * 3.0 + 300 * 15.0) / 1_000_000
    assert result.cost_usd == pytest.approx(expected_cost, rel=1e-9)
    assert result.latency_ms >= 0
    assert len(fake.messages.calls) == 1


def test_parse_strips_markdown_fences(install_fake) -> None:
    install_fake(
        claude_sonnet_provider,
        _FakeResponse(
            content=[_FakePart(f"```json\n{json.dumps(GOOD_PAYLOAD)}\n```")],
            usage=_FakeUsage(input_tokens=10, output_tokens=10),
        ),
    )
    result = claude_sonnet_provider.parse(b"<jpeg>")
    assert result.score.ocr_confidence == GOOD_PAYLOAD["ocr_confidence"]


def test_parse_invalid_json_raises_validation(install_fake) -> None:
    install_fake(
        claude_sonnet_provider,
        _FakeResponse(
            content=[_FakePart("not even json")],
            usage=_FakeUsage(0, 0),
        ),
    )
    with pytest.raises(ValueError):
        # ScoreJson.model_validate_json raises ValidationError (subclass of ValueError).
        claude_sonnet_provider.parse(b"<jpeg>")


def test_parse_no_content_parts_raises(install_fake) -> None:
    install_fake(
        claude_sonnet_provider,
        _FakeResponse(content=[], usage=_FakeUsage(0, 0)),
    )
    with pytest.raises(OCRProviderError, match="no content parts"):
        claude_sonnet_provider.parse(b"<jpeg>")


def test_parse_first_part_no_text_raises(install_fake) -> None:
    install_fake(
        claude_sonnet_provider,
        _FakeResponse(content=[_FakePart(text=None)], usage=_FakeUsage(0, 0)),
    )
    with pytest.raises(OCRProviderError, match="no text"):
        claude_sonnet_provider.parse(b"<jpeg>")


def test_pricing_constants_match_spec() -> None:
    """Sonnet 4.6: $3/$15 per 1M; Opus 4.7: $15/$75 per 1M (spec §6 + Anthropic pricing 2026-04)."""
    from app.services.ocr.claude_provider import claude_opus_provider as opus

    assert claude_sonnet_provider._input_price == 3.0
    assert claude_sonnet_provider._output_price == 15.0
    assert opus._input_price == 15.0
    assert opus._output_price == 75.0


# ---- SDK errors ------------------------------------------------------------


def test_an_sdk_error_arrives_as_an_ocr_provider_error(monkeypatch) -> None:
    """So the chain can route around it.

    Found live. Anthropic answered a real scan with
    `messages.0.content.0.image.source.base64: The image was specified using
    the image/jpeg media type, but the image appears to be a image/png image`
    and a 400. `BadRequestError` is not one of the exceptions `pipeline.py`
    catches, so it escaped the loop, skipped Gemini entirely, and reached the
    phone as a 500 with a traceback — for a page the next provider might well
    have read.
    """
    from anthropic import BadRequestError

    class _Boom:
        class messages:  # noqa: N801 - mirrors the SDK's attribute shape
            @staticmethod
            def create(**_kwargs):
                raise BadRequestError(
                    "media type mismatch",
                    response=httpx.Response(
                        400, request=httpx.Request("POST", "https://api.anthropic.com")
                    ),
                    body=None,
                )

    monkeypatch.setattr(claude_sonnet_provider, "_client", _Boom())
    with pytest.raises(OCRProviderError) as caught:
        claude_sonnet_provider.parse(b"<png bytes named jpeg>")
    assert "BadRequestError" in str(caught.value)
    assert claude_sonnet_provider.name in str(caught.value)


def test_a_connection_error_arrives_as_an_ocr_provider_error(monkeypatch) -> None:
    """Not only status errors — `AnthropicError` is the whole family, and a
    provider that cannot be reached is the plainest case of one to skip."""
    from anthropic import APIConnectionError

    class _Boom:
        class messages:  # noqa: N801
            @staticmethod
            def create(**_kwargs):
                raise APIConnectionError(
                    request=httpx.Request("POST", "https://api.anthropic.com")
                )

    monkeypatch.setattr(claude_sonnet_provider, "_client", _Boom())
    with pytest.raises(OCRProviderError):
        claude_sonnet_provider.parse(b"<jpeg>")
