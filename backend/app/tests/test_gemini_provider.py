"""Tests for `GeminiProvider` with a mocked google-genai client."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import pytest

from app.services.ocr.base import OCRProviderError, OCRResponse
from app.services.ocr.gemini_provider import (
    GeminiProvider,
    gemini_flash_provider,
    gemini_pro_provider,
)


GOOD_PAYLOAD = {
    "time_signature": "3/4",
    "key_signature": "G major",
    "tempo_marking": "Allegro",
    "bpm_hint": 120,
    "clef": "treble",
    "measures": [
        {
            "measure_number": 1,
            "notes": [
                {
                    "pitch": "G3",
                    "duration": "quarter",
                    "articulation": None,
                    "tied_to_next": False,
                    "dynamics": "f",
                }
            ],
            "slurs": [],
        }
    ],
    "repeats": [],
    "ocr_confidence": 0.88,
    "notes_to_human": "",
}


@dataclass
class _FakeUsage:
    prompt_token_count: int = 0
    candidates_token_count: int = 0
    thoughts_token_count: int = 0


@dataclass
class _FakeResponse:
    text: str | None
    usage_metadata: _FakeUsage | None = None


class _FakeModels:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response
        self.calls: list[dict[str, Any]] = []

    def generate_content(self, *, model: str, contents, config) -> _FakeResponse:
        self.calls.append({"model": model, "contents": contents, "config": config})
        return self._response


class _FakeClient:
    def __init__(self, response: _FakeResponse) -> None:
        self.models = _FakeModels(response)


@pytest.fixture()
def install_fake(monkeypatch: pytest.MonkeyPatch):
    def _install(provider: GeminiProvider, response: _FakeResponse) -> _FakeClient:
        fake = _FakeClient(response)
        monkeypatch.setattr(provider, "_client", fake)
        return fake

    return _install


# ---- happy path -----------------------------------------------------------


def test_parse_clean_json_response(install_fake) -> None:
    fake = install_fake(
        gemini_flash_provider,
        _FakeResponse(
            text=json.dumps(GOOD_PAYLOAD),
            usage_metadata=_FakeUsage(prompt_token_count=2000, candidates_token_count=400),
        ),
    )
    result = gemini_flash_provider.parse(b"<jpeg>", mime_type="image/jpeg")
    assert isinstance(result, OCRResponse)
    assert result.model == "gemini-2.5-flash"
    assert result.score.tempo_marking == "Allegro"
    assert result.input_tokens == 2000
    assert result.output_tokens == 400
    # Flash pricing: $0.30 / $2.50 per 1M tokens.
    expected_cost = (2000 * 0.30 + 400 * 2.50) / 1_000_000
    assert result.cost_usd == pytest.approx(expected_cost, rel=1e-9)
    # Verify the call shape: response_mime_type=application/json forces JSON mode,
    # max_output_tokens is sized for Gemini 2.5 (well above Claude's 4000), and
    # thinking is disabled so internal reasoning tokens don't eat the budget.
    sent = fake.models.calls[0]["config"]
    assert sent.response_mime_type == "application/json"
    assert sent.max_output_tokens == 16000
    assert sent.thinking_config is not None
    assert sent.thinking_config.thinking_budget == 0


def test_thoughts_tokens_count_as_output(install_fake) -> None:
    """Gemini 2.5 returns thinking tokens — they're billed as output."""
    install_fake(
        gemini_flash_provider,
        _FakeResponse(
            text=json.dumps(GOOD_PAYLOAD),
            usage_metadata=_FakeUsage(
                prompt_token_count=1000,
                candidates_token_count=200,
                thoughts_token_count=500,
            ),
        ),
    )
    result = gemini_flash_provider.parse(b"<jpeg>")
    assert result.output_tokens == 700  # 200 visible + 500 thoughts
    expected_cost = (1000 * 0.30 + 700 * 2.50) / 1_000_000
    assert result.cost_usd == pytest.approx(expected_cost, rel=1e-9)


def test_parse_invalid_json_raises_value_error(install_fake) -> None:
    install_fake(
        gemini_flash_provider,
        _FakeResponse(text="not json", usage_metadata=_FakeUsage()),
    )
    with pytest.raises(ValueError):
        gemini_flash_provider.parse(b"<jpeg>")


def test_parse_empty_response_raises(install_fake) -> None:
    install_fake(
        gemini_flash_provider,
        _FakeResponse(text=None, usage_metadata=_FakeUsage()),
    )
    with pytest.raises(OCRProviderError, match="empty response text"):
        gemini_flash_provider.parse(b"<jpeg>")


def test_pro_provider_pricing() -> None:
    """Gemini 2.5 Pro: $1.25 / $10.00 per 1M tokens (≤200k context)."""
    assert gemini_pro_provider._input_price == 1.25
    assert gemini_pro_provider._output_price == 10.00


def test_missing_api_key_raises_provider_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """If GEMINI_API_KEY is empty, the provider error fires before any SDK call."""
    from app.services.ocr import gemini_provider as gp

    # Force re-init by clearing the cached client.
    fresh = GeminiProvider(
        model="gemini-2.5-flash",
        name="gemini-2.5-flash-test",
        input_price_per_mtok_usd=0.30,
        output_price_per_mtok_usd=2.50,
    )
    monkeypatch.setattr(gp.settings, "GEMINI_API_KEY", "")
    with pytest.raises(OCRProviderError, match="GEMINI_API_KEY is not configured"):
        fresh.parse(b"<jpeg>")


def test_an_sdk_error_arrives_as_an_ocr_provider_error(monkeypatch) -> None:
    """Gemini is last in the chain, which makes this matter more, not less.

    Whatever it raises is the last thing between the caller and a 500, so it
    has to arrive as the failure the pipeline knows how to report.
    """
    from google.genai import errors as genai_errors

    class _Models:
        @staticmethod
        def generate_content(**_kwargs):
            raise genai_errors.ClientError(
                400, {"error": {"message": "unsupported media type"}}
            )

    class _Boom:
        models = _Models()

    monkeypatch.setattr(gemini_flash_provider, "_client", _Boom())
    with pytest.raises(OCRProviderError) as caught:
        gemini_flash_provider.parse(b"<heic bytes>")
    assert gemini_flash_provider.name in str(caught.value)
