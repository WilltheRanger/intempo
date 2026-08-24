"""Tests for `ClaudeProvider` and the shared JSON-object extractor."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from app.services.ocr.base import OCRProviderError, OCRResponse, json_object_in
from app.services.ocr.claude_provider import (
    ClaudeProvider,
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
    #: Why the model stopped. `end_turn` on a complete answer; `max_tokens`
    #: when it ran out of room, which the provider must refuse rather than try
    #: to parse.
    stop_reason: str = "end_turn"


class _FakeMessages:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response
        self.calls: list[dict[str, Any]] = []

    def create(
        self, *, model: str, max_tokens: int, messages: list[dict], **extra: Any
    ) -> _FakeResponse:
        # `**extra` captures `thinking` and `output_config`, which the provider
        # now sets per model. Recorded rather than ignored: whether thinking is
        # on is a cost decision, and the tests below assert it.
        self.calls.append(
            {"model": model, "max_tokens": max_tokens, "messages": messages, **extra}
        )
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


# ---- json_object_in --------------------------------------------------------
#
# One copy, shared with `gemini_provider`. It used to live here as
# `_strip_markdown_fences` while Gemini carried the comment "JSON mode means no
# markdown fences are expected — but parse defensively" above a bare `.strip()`,
# which is not defensive at all. Gemini is first in the configured chain, so the
# provider that claimed to be careful was the one with nothing behind it.


def test_a_clean_response_is_left_alone() -> None:
    assert json_object_in('{"a": 1}') == '{"a": 1}'


@pytest.mark.parametrize(
    "raw",
    [
        '```json\n{"a": 1}\n```',
        '```\n{"a": 1}\n```',
        'Here is the transcription:\n{"a": 1}',
        '{"a": 1}\n\nHope that helps!',
        '```json\n{"a": 1}\n```\nLet me know if you need anything else.',
        '  \n {"a": 1} \n ',
    ],
)
def test_the_object_is_found_inside_whatever_the_model_actually_sent(raw: str) -> None:
    """A fence, a sentence before, a sentence after. All three arrive as
    `json_invalid` from `model_validate_json`, which the running service has
    logged from **both** providers on one page, and each costs the whole score."""
    assert json_object_in(raw) == '{"a": 1}'


def test_a_truncated_response_is_still_invalid() -> None:
    """The line this must not cross.

    A response that stopped mid-object has no matching closing brace for its
    first one, so slicing to the last `}` leaves JSON that is still invalid. The
    parse still raises and `_is_truncation` still stops the chain rather than
    paying for the next provider. Repairing a half-read page would be worse than
    failing on it: the bars that did arrive would be presented as the whole piece.
    """
    truncated = '{"measures": [{"measure_number": 1}, {"measure_number": 2'
    with pytest.raises(json.JSONDecodeError):
        json.loads(json_object_in(truncated))


def test_a_response_with_no_object_in_it_is_returned_as_it_came() -> None:
    """So the error the caller reports is about what the model actually said,
    not about a slice of it."""
    assert json_object_in("I cannot read this image.") == "I cannot read this image."


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
    assert result.model == "claude-sonnet-5"
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


def test_pricing_constants_match_the_published_rates() -> None:
    """Sonnet 5: $3/$15 per 1M. Opus 5: $5/$25 (list, checked 2026-08-24).

    The Opus figures this replaced were $15/$75 — wrong by 3x, and they had
    been overstating the fallback's cost for as long as they had been there.

    List rates, not Sonnet 5's $2/$10 introductory pricing, which expires
    2026-08-31: a hardcoded intro rate would quietly *under*-report every scan
    from September. Telemetry that overstates cost is a nuisance; telemetry
    that understates it is a trap.
    """
    from app.services.ocr.claude_provider import claude_opus_provider as opus

    assert claude_sonnet_provider._input_price == 3.0
    assert claude_sonnet_provider._output_price == 15.0
    assert opus._input_price == 5.0
    assert opus._output_price == 25.0


def test_the_first_read_does_not_pay_for_thinking(install_fake) -> None:
    """Transcription is perception, not reasoning — the answer is on the page.

    This matters twice over on Sonnet 5. Omitting the parameter runs *adaptive*
    thinking, which is billed, and thinking tokens count against `max_tokens` —
    so the default would both cost more and make truncation likelier on exactly
    the long pages that were already truncating.
    """
    fake = install_fake(
        claude_sonnet_provider,
        _FakeResponse(
            content=[_FakePart(json.dumps(GOOD_PAYLOAD))],
            usage=_FakeUsage(input_tokens=10, output_tokens=10),
        ),
    )
    claude_sonnet_provider.parse(b"<jpeg>")
    assert fake.messages.calls[0]["thinking"] == {"type": "disabled"}


def test_the_fallback_keeps_thinking_on_at_low_effort(install_fake) -> None:
    """Not disabled, deliberately.

    Anthropic documents two failure modes for disabled thinking on Opus 5: it
    can leak `<thinking>` tags into the visible response, and it can write a
    tool call into text instead of a tool block. The first would corrupt the
    JSON this parses. Adaptive at low effort is the documented way to avoid
    that while keeping the spend down, and the fallback runs rarely enough
    that the care is nearly free.
    """
    from app.services.ocr.claude_provider import claude_opus_provider as opus

    fake = install_fake(
        opus,
        _FakeResponse(
            content=[_FakePart(json.dumps(GOOD_PAYLOAD))],
            usage=_FakeUsage(input_tokens=10, output_tokens=10),
        ),
    )
    opus.parse(b"<jpeg>")
    assert fake.messages.calls[0]["thinking"] == {"type": "adaptive"}
    assert fake.messages.calls[0]["output_config"] == {"effort": "low"}


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


def test_a_truncated_transcription_is_named_as_one(install_fake) -> None:
    """The bug a real page found, and the reason it stayed hidden.

    A page of orchestral parts serialises to 4,500-6,100 tokens in this schema.
    Against the old 4000-token cap the JSON stopped mid-object, parsing raised,
    the pipeline counted it as the provider failing, the next provider truncated
    in the same place — and the musician was told their photograph could not be
    read. It was a perfectly sharp photograph.

    Anthropic *reports* truncation rather than leaving it to be inferred, and
    inferring it is exactly what went wrong.
    """
    fake = install_fake(
        claude_sonnet_provider,
        _FakeResponse(
            content=[_FakePart('{"time_signature": "4/4", "measures": [{"measure_')],
            usage=_FakeUsage(input_tokens=2000, output_tokens=16000),
        ),
    )
    fake.messages._response.stop_reason = "max_tokens"

    with pytest.raises(OCRProviderError) as caught:
        claude_sonnet_provider.parse(b"<a long page>")
    assert "cut off" in str(caught.value)


def test_a_complete_response_is_not_mistaken_for_a_truncated_one(install_fake) -> None:
    """`stop_reason` is `end_turn` on every normal answer, and the check has to
    leave those alone — a false positive here refuses a good transcription."""
    fake = install_fake(
        claude_sonnet_provider,
        _FakeResponse(
            content=[_FakePart(json.dumps(GOOD_PAYLOAD))],
            usage=_FakeUsage(input_tokens=10, output_tokens=10),
        ),
    )
    fake.messages._response.stop_reason = "end_turn"
    assert claude_sonnet_provider.parse(b"<jpeg>").score.measures


def test_the_output_budget_holds_a_real_page() -> None:
    """A page a cellist actually sent in needed ~6,100 tokens. The cap must
    have room for it and then some, or this regresses the moment someone
    photographs a busy system."""
    from app.services.ocr.claude_provider import MAX_TOKENS

    assert MAX_TOKENS >= 12000


# ---- a key that is not there ----------------------------------------------
#
# `Anthropic()` constructs perfectly well without one and defers the complaint
# to the first request, where it arrives as a **TypeError** — "Could not
# resolve authentication method". Not an `AnthropicError`, so this provider did
# not wrap it; not an `OCRProviderError`, so the chain did not catch it; not an
# `OCRError`, so the branch that keeps a doubtful engine reading did not catch
# it either. It discarded a usable homr transcription and the musician was told
# "Something went wrong reading this page."
#
# The Gemini provider has always checked its own key. This one did not.


def _provider() -> ClaudeProvider:
    return ClaudeProvider(
        model="claude-sonnet-4-5",
        name="claude-test",
        input_price_per_mtok_usd=3.0,
        output_price_per_mtok_usd=15.0,
    )


def test_a_missing_key_is_a_named_provider_failure(monkeypatch) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")

    with pytest.raises(OCRProviderError) as raised:
        _provider().parse(b"\xff\xd8\xff")

    # Named, so `/v1/ready` and `_why_it_failed` can both say which key, the
    # way they already can for Gemini.
    assert "ANTHROPIC_API_KEY" in str(raised.value)
    assert "claude-test" in str(raised.value)


def test_anything_the_sdk_raises_becomes_a_provider_failure(monkeypatch) -> None:
    """The narrow catch has been wrong twice — first for an API 400, then for
    a TypeError from a missing key. A provider raising *is* that provider
    failing to read the page, whatever it raised, and the chain exists to
    carry on past it."""
    from app.config import settings

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-stand-in")

    class _Boom:
        class messages:
            @staticmethod
            def create(**_kwargs):
                raise RuntimeError("something nobody planned for")

    provider = _provider()
    provider._client = _Boom()

    with pytest.raises(OCRProviderError) as raised:
        provider.parse(b"\xff\xd8\xff")

    # The type survives, so a real bug in here still says what it was rather
    # than hiding as "could not read the page".
    assert "RuntimeError" in str(raised.value)
