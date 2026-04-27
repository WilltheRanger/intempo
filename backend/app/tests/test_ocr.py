"""OCR pipeline tests with a mocked Anthropic SDK.

The real `Anthropic()` client is replaced via monkeypatch on
`app.services.ocr._client`, so no API tokens are spent and CI never
needs `ANTHROPIC_API_KEY`. The fakes return whatever shape the test
sets up, exercising each branch of the retry logic in `parse_sheet_music`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import pytest

from app.services import ocr as ocr_module
from app.services.ocr import (
    CONFIDENCE_THRESHOLD,
    OCRError,
    OPUS_MODEL,
    SONNET_MODEL,
    _strip_markdown_fences,
    parse_sheet_music,
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


def _good_text() -> str:
    return json.dumps(GOOD_PAYLOAD)


def _low_confidence_text(conf: float = 0.4) -> str:
    payload = {**GOOD_PAYLOAD, "ocr_confidence": conf}
    return json.dumps(payload)


def _fenced_text(inner: str) -> str:
    return f"```json\n{inner}\n```"


def _invalid_text() -> str:
    return json.dumps({**GOOD_PAYLOAD, "ocr_confidence": 9.9})


@dataclass
class _FakePart:
    text: str


@dataclass
class _FakeResponse:
    content: list[_FakePart]


class _FakeMessages:
    def __init__(self, responses_per_model: dict[str, list[str]]):
        self._responses = {k: list(v) for k, v in responses_per_model.items()}
        self.calls: list[dict[str, Any]] = []

    def create(self, *, model: str, max_tokens: int, messages: list[dict]) -> _FakeResponse:
        self.calls.append({"model": model, "max_tokens": max_tokens, "messages": messages})
        try:
            text = self._responses[model].pop(0)
        except (KeyError, IndexError) as exc:
            raise AssertionError(f"no fake response queued for model {model!r}") from exc
        return _FakeResponse(content=[_FakePart(text=text)])


class _FakeClient:
    def __init__(self, responses: dict[str, list[str]]):
        self.messages = _FakeMessages(responses)


@pytest.fixture()
def install_fake(monkeypatch: pytest.MonkeyPatch):
    """Returns a builder that replaces `_client` with a fake configured for the test."""

    def _install(responses: dict[str, list[str]]) -> _FakeClient:
        fake = _FakeClient(responses)
        monkeypatch.setattr(ocr_module, "_client", fake)
        return fake

    return _install


# ---- _strip_markdown_fences -----------------------------------------------


def test_strip_markdown_fences_no_fence() -> None:
    raw = '{"a": 1}'
    assert _strip_markdown_fences(raw) == raw


def test_strip_markdown_fences_with_json_label() -> None:
    raw = '```json\n{"a": 1}\n```'
    assert _strip_markdown_fences(raw) == '{"a": 1}'


def test_strip_markdown_fences_without_label() -> None:
    raw = '```\n{"a": 1}\n```'
    assert _strip_markdown_fences(raw) == '{"a": 1}'


# ---- parse_sheet_music ----------------------------------------------------


def test_clean_sonnet_response_returns_score(install_fake) -> None:
    fake = install_fake({SONNET_MODEL: [_good_text()]})
    result = parse_sheet_music(b"<jpeg>")
    assert result.model_used == SONNET_MODEL
    assert result.score.ocr_confidence == GOOD_PAYLOAD["ocr_confidence"]
    assert result.score.measures[0].notes[0].pitch == "D3"
    # Only one Claude call — Sonnet, no retry.
    assert len(fake.messages.calls) == 1
    assert fake.messages.calls[0]["model"] == SONNET_MODEL


def test_markdown_fenced_response_is_unwrapped(install_fake) -> None:
    fake = install_fake({SONNET_MODEL: [_fenced_text(_good_text())]})
    result = parse_sheet_music(b"<jpeg>")
    assert result.model_used == SONNET_MODEL
    assert result.score.measures[0].notes[0].pitch == "D3"


def test_invalid_sonnet_then_clean_opus_returns_opus_score(install_fake) -> None:
    fake = install_fake(
        {
            SONNET_MODEL: [_invalid_text()],
            OPUS_MODEL: [_good_text()],
        }
    )
    result = parse_sheet_music(b"<jpeg>")
    assert result.model_used == OPUS_MODEL
    assert len(fake.messages.calls) == 2
    # The second call should include the failure feedback text.
    fallback_messages = fake.messages.calls[1]["messages"]
    text_block = fallback_messages[0]["content"][1]["text"]
    assert "previous attempt failed" in text_block.lower()


def test_low_confidence_sonnet_triggers_opus_retry(install_fake) -> None:
    low_conf = CONFIDENCE_THRESHOLD - 0.1
    fake = install_fake(
        {
            SONNET_MODEL: [_low_confidence_text(low_conf)],
            OPUS_MODEL: [_good_text()],
        }
    )
    result = parse_sheet_music(b"<jpeg>")
    assert result.model_used == OPUS_MODEL
    assert result.score.ocr_confidence >= CONFIDENCE_THRESHOLD


def test_both_attempts_invalid_raises_ocr_error(install_fake) -> None:
    install_fake(
        {
            SONNET_MODEL: ["not even json"],
            OPUS_MODEL: ["still not json"],
        }
    )
    with pytest.raises(OCRError) as exc_info:
        parse_sheet_music(b"<jpeg>")
    assert SONNET_MODEL in str(exc_info.value)
    assert OPUS_MODEL in str(exc_info.value)


def test_low_conf_then_opus_invalid_returns_low_conf_score(install_fake) -> None:
    """Sonnet returned a parseable but low-confidence score; Opus failed.
    Per the spec's intent ("surface to the user"), we still return the
    low-confidence parse rather than raise."""
    fake = install_fake(
        {
            SONNET_MODEL: [_low_confidence_text(0.3)],
            OPUS_MODEL: ["not json"],
        }
    )
    result = parse_sheet_music(b"<jpeg>")
    assert result.model_used == SONNET_MODEL
    assert result.score.ocr_confidence == 0.3
    assert len(fake.messages.calls) == 2
