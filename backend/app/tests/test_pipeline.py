"""Tests for the pipeline orchestration in `app.services.ocr.pipeline`.

Each provider is replaced with a `_FakeProvider` whose `parse` either
returns a canned `OCRResponse` or raises a chosen exception. This
exercises the chain logic without going through any real SDK.
"""

from __future__ import annotations

from typing import Callable

import pytest
from pydantic import ValidationError

from app.services.ocr import pipeline as pipeline_module
from app.services.ocr.base import OCRProviderError, OCRResponse
from app.services.ocr.pipeline import (
    CONFIDENCE_THRESHOLD,
    OCRError,
    parse_sheet_music,
)
from app.services.score_schema import ScoreJson


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


def _score(conf: float = 0.92) -> ScoreJson:
    return ScoreJson.model_validate({**GOOD_PAYLOAD, "ocr_confidence": conf})


def _response(name: str, conf: float = 0.92) -> OCRResponse:
    return OCRResponse(
        score=_score(conf),
        raw_text="{}",
        model=name,
        input_tokens=10,
        output_tokens=10,
        cost_usd=0.0001,
        latency_ms=42,
    )


class _FakeProvider:
    def __init__(
        self,
        name: str,
        *,
        outcome: Callable[[], OCRResponse | None] | None = None,
        response: OCRResponse | None = None,
        raises: BaseException | None = None,
    ) -> None:
        self.name = name
        self._outcome = outcome
        self._response = response
        self._raises = raises
        self.calls = 0

    def parse(
        self,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        note: str | None = None,
    ) -> OCRResponse:
        # `note` is the third argument of the `OCRProvider` protocol and is how
        # the arithmetic re-read hands a model its own bad bars back. A fake
        # that omits it stops being a stand-in for a provider.
        self.calls += 1
        self.note = note
        if self._raises is not None:
            raise self._raises
        if self._outcome is not None:
            res = self._outcome()
            if res is None:
                raise RuntimeError("fake outcome returned None")
            return res
        assert self._response is not None
        return self._response


# ---- chain semantics ------------------------------------------------------


def test_first_provider_high_confidence_returns_immediately() -> None:
    p1 = _FakeProvider("p1", response=_response("p1", conf=0.92))
    p2 = _FakeProvider("p2", response=_response("p2", conf=0.92))
    score = parse_sheet_music(b"<jpeg>", providers=[p1, p2])
    assert score.ocr_confidence == 0.92
    assert p1.calls == 1
    assert p2.calls == 0  # never tried


def test_first_fails_validation_second_succeeds() -> None:
    bad = _FakeProvider("p1", raises=ValidationError.from_exception_data("x", []))
    good = _FakeProvider("p2", response=_response("p2", conf=0.9))
    score = parse_sheet_music(b"<jpeg>", providers=[bad, good])
    assert score.ocr_confidence == 0.9
    assert bad.calls == 1
    assert good.calls == 1


def test_first_provider_error_second_succeeds() -> None:
    bad = _FakeProvider("p1", raises=OCRProviderError("boom"))
    good = _FakeProvider("p2", response=_response("p2", conf=0.95))
    score = parse_sheet_music(b"<jpeg>", providers=[bad, good])
    assert score.ocr_confidence == 0.95
    assert bad.calls == 1
    assert good.calls == 1


def test_first_low_confidence_second_high_returns_second() -> None:
    low = CONFIDENCE_THRESHOLD - 0.2
    p1 = _FakeProvider("p1", response=_response("p1", conf=low))
    p2 = _FakeProvider("p2", response=_response("p2", conf=0.95))
    score = parse_sheet_music(b"<jpeg>", providers=[p1, p2])
    assert score.ocr_confidence == 0.95


def test_all_low_confidence_returns_first_low_confidence() -> None:
    """Spec carve-out: low-confidence parse beats no parse for the human-correction flow."""
    p1 = _FakeProvider("p1", response=_response("p1", conf=0.4))
    p2 = _FakeProvider("p2", response=_response("p2", conf=0.5))
    score = parse_sheet_music(b"<jpeg>", providers=[p1, p2])
    # First in the chain wins, not the higher score: cross-provider confidence
    # figures are each model's estimate of its own work and are not comparable.
    # See the comment in `pipeline.py`; the variable used to be called
    # `best_low_confidence`, which implied a ranking that does not exist.
    assert score.ocr_confidence == 0.4
    assert p1.calls == 1
    assert p2.calls == 1


def test_low_confidence_then_invalid_returns_low_confidence() -> None:
    p1 = _FakeProvider("p1", response=_response("p1", conf=0.3))
    p2 = _FakeProvider("p2", raises=ValueError("malformed"))
    score = parse_sheet_music(b"<jpeg>", providers=[p1, p2])
    assert score.ocr_confidence == 0.3


def test_all_fail_raises_ocr_error() -> None:
    p1 = _FakeProvider("p1", raises=OCRProviderError("a"))
    p2 = _FakeProvider("p2", raises=ValueError("b"))
    with pytest.raises(OCRError) as exc_info:
        parse_sheet_music(b"<jpeg>", providers=[p1, p2])
    msg = str(exc_info.value)
    assert "p1" in msg and "p2" in msg


def test_empty_chain_raises() -> None:
    with pytest.raises(OCRError, match="empty"):
        parse_sheet_music(b"<jpeg>", providers=[])


# ---- default chain (env-driven) -------------------------------------------


def test_default_chain_uses_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """`parse_sheet_music` with providers=None reads `settings.OCR_PROVIDER_CHAIN`."""
    captured: list[str] = []

    class _Sentinel:
        def __init__(self, name: str) -> None:
            self.name = name

        def parse(self, image_bytes: bytes, mime_type: str = "image/jpeg") -> OCRResponse:
            captured.append(self.name)
            return _response(self.name, conf=0.95)

    fake_registry = {
        "alpha": _Sentinel("alpha"),
        "beta": _Sentinel("beta"),
    }
    monkeypatch.setattr(pipeline_module, "PROVIDER_REGISTRY", fake_registry)
    monkeypatch.setattr(pipeline_module.settings, "OCR_PROVIDER_CHAIN", "beta,alpha")

    parse_sheet_music(b"<jpeg>")
    assert captured == ["beta"]  # first one wins; alpha never tried


def test_unknown_provider_in_chain_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline_module.settings, "OCR_PROVIDER_CHAIN", "claude-sonnet-4-6,bogus")
    with pytest.raises(OCRError, match="unknown provider"):
        parse_sheet_music(b"<jpeg>")


# ---------------------------------------------------------------------------
# Beat-sum validation in the chain
#
# The point of these is that arithmetic outranks self-assessment. A provider
# saying 0.95 about a transcription that contradicts itself should not end the
# search — that is precisely the case the bake-off exposed, where the most
# confident provider is first in the chain and the second opinion is never
# reached.
# ---------------------------------------------------------------------------


def _measures(*beat_counts: int) -> list[dict]:
    """Measures of N quarter notes each, so the sums are obvious to read."""
    return [
        {
            "measure_number": i + 1,
            "notes": [
                {"pitch": "A4", "duration": "quarter", "tied_to_next": False}
                for _ in range(n)
            ],
            "slurs": [],
        }
        for i, n in enumerate(beat_counts)
    ]


def _scored(conf: float, *beat_counts: int, time_signature: str = "4/4") -> OCRResponse:
    """`_response` above, with the measures spelled out rather than stubbed."""
    base = _response("fake", conf)
    return base.model_copy(
        update={
            "score": ScoreJson.model_validate(
                {
                    "time_signature": time_signature,
                    "key_signature": "C major",
                    "tempo_marking": None,
                    "bpm_hint": None,
                    "clef": "treble",
                    "measures": _measures(*beat_counts),
                    "repeats": [],
                    "ocr_confidence": conf,
                    "notes_to_human": "",
                }
            )
        }
    )


def test_a_confident_transcription_that_does_not_add_up_does_not_win() -> None:
    """0.95 and a three-beat measure in 4/4 is still wrong."""
    p1 = _FakeProvider("p1", response=_scored(0.95, 4, 3, 4))
    p2 = _FakeProvider("p2", response=_scored(0.80, 4, 4, 4))
    score = parse_sheet_music(b"<jpeg>", providers=[p1, p2])
    assert score.ocr_confidence == 0.80
    assert p2.calls == 1, "the second provider must actually be reached"


def test_a_sound_transcription_still_short_circuits_the_chain() -> None:
    """Validation must not make every page pay for every provider."""
    p1 = _FakeProvider("p1", response=_scored(0.95, 4, 4, 4))
    p2 = _FakeProvider("p2", response=_scored(0.99, 4, 4, 4))
    parse_sheet_music(b"<jpeg>", providers=[p1, p2])
    assert p2.calls == 0


def test_a_broken_transcription_is_kept_when_nothing_better_arrives() -> None:
    """Better than nothing: the correction flow needs something to correct.

    Refusing the page outright would let one mis-read note lose the whole
    transcription, which is a worse trade than showing it with a flagged
    measure.
    """
    p1 = _FakeProvider("p1", response=_scored(0.95, 4, 3, 4))
    score = parse_sheet_music(b"<jpeg>", providers=[p1])
    assert score.ocr_confidence == 0.95


def test_an_unreadable_meter_does_not_make_everything_suspect() -> None:
    """Inference must not turn a coherent score into a pile of failures."""
    p1 = _FakeProvider("p1", response=_scored(0.9, 2, 2, 2, 2, time_signature="unknown"))
    p2 = _FakeProvider("p2", response=_scored(0.99, 4, 4, 4))
    parse_sheet_music(b"<jpeg>", providers=[p1, p2])
    assert p2.calls == 0, "a self-consistent 2/4 score should have been accepted"


# ---- not paying twice for the same failure --------------------------------


def test_a_truncated_page_stops_the_chain(monkeypatch) -> None:
    """Running out of room is a property of the page, not the provider.

    The second provider is asked the identical question about the identical
    image and stops in the same place — so falling through bought a second
    full-price failure and an identical error message. It is also the failure
    mode of a *long* page, which is exactly when a response is most expensive.
    """
    from app.services.ocr.base import OCRProviderError
    from app.services.ocr.pipeline import OCRError, parse_sheet_music

    asked: list[str] = []

    class _Provider:
        def __init__(self, name: str, exc: Exception) -> None:
            self.name, self._exc = name, exc

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            asked.append(self.name)
            raise self._exc

    chain = [
        _Provider("first", OCRProviderError("first: the transcription was cut off at 16000 tokens")),
        _Provider("second", OCRProviderError("second: should never be asked")),
    ]
    with pytest.raises(OCRError):
        parse_sheet_music(b"img", providers=chain, retry=False)

    assert asked == ["first"], "the second provider was billed for a certain failure"


def test_an_ordinary_failure_still_falls_through(monkeypatch) -> None:
    """The chain's whole point. Only truncation is hopeless for the next
    provider; a rate limit or a bad response is exactly what it exists for."""
    from app.services.ocr.base import OCRProviderError, OCRResponse
    from app.services.ocr.pipeline import parse_sheet_music
    from app.services.score_schema import Measure, Note, ScoreJson

    asked: list[str] = []
    good = ScoreJson(
        clef="bass", time_signature="4/4", ocr_confidence=0.9,
        measures=[Measure(measure_number=1, notes=[Note(pitch="C3", duration="quarter")] * 4)],
    )

    class _Fails:
        name = "first"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            asked.append(self.name)
            raise OCRProviderError("first: RateLimitError")

    class _Works:
        name = "second"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            asked.append(self.name)
            return OCRResponse(
                score=good, raw_text="{}", model="second",
                input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
            )

    assert parse_sheet_music(b"img", providers=[_Fails(), _Works()], retry=False) is good
    assert asked == ["first", "second"]


def test_the_prompt_does_not_ask_for_fields_nothing_reads() -> None:
    """`articulation` and `dynamics` were emitted on every note and consumed
    nowhere — `alignment.py` reads `slurs`, and neither of those two.

    Three keys per note, on a page with over a hundred notes, is most of the
    difference between a page that fits in one response and one that doesn't.
    """
    from app.services.ocr.base import PROMPT

    shape = PROMPT.split("Rules:")[0]
    assert '"articulation"' not in shape
    assert '"dynamics"' not in shape
    # Still asked for, because the analysis genuinely uses them.
    assert '"slurs"' in shape
    assert '"tied_to_next"' in shape
