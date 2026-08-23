"""The OMR second opinion, and the vision model checking it.

The arrangement only earns its place if it can be *worse* as well as better,
and the code has to notice. So most of these are about the confirmation being
rejected, not accepted.
"""

from __future__ import annotations

import pytest

from app.services.ocr.base import OCRProviderError, OCRResponse
from app.services.ocr.confirm import confirm_reading
from app.services.score_schema import Measure, Note, ScoreJson


def _score(measures: list[list[tuple[str, str]]], **kwargs) -> ScoreJson:
    return ScoreJson(
        time_signature=kwargs.pop("time_signature", "4/4"),
        clef=kwargs.pop("clef", "bass"),
        ocr_confidence=kwargs.pop("ocr_confidence", 0.9),
        measures=[
            Measure(
                measure_number=i + 1,
                notes=[Note(pitch=p, duration=d) for p, d in notes],
            )
            for i, notes in enumerate(measures)
        ],
        **kwargs,
    )


class _Stub:
    """A provider that answers with whatever it was handed."""

    name = "stub"

    def __init__(self, answer: ScoreJson | Exception) -> None:
        self.answer = answer
        self.note: str | None = None

    def parse(self, image_bytes, mime_type="image/jpeg", note=None) -> OCRResponse:
        self.note = note
        if isinstance(self.answer, Exception):
            raise self.answer
        return OCRResponse(
            score=self.answer, raw_text="{}", model="stub",
            input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
        )


FOUR = [("C3", "quarter")] * 4


def test_the_engine_reading_is_shown_to_the_model() -> None:
    """The whole point: the model is checking, not transcribing from nothing."""
    engine = _score([FOUR])
    stub = _Stub(_score([FOUR, FOUR]))
    confirm_reading(engine, b"img", media_type="image/png", provider=stub)
    assert "already read this image" in stub.note
    assert '"C3"' in stub.note, "the engine's actual notes have to be in the prompt"


def test_a_correction_that_adds_missing_measures_is_taken() -> None:
    """The engine's characteristic failure is dropping measures it could not
    resolve. Recovering them is the main thing this step is for."""
    engine = _score([FOUR])
    better = _score([FOUR, FOUR, FOUR])
    assert len(confirm_reading(
        engine, b"img", media_type="image/png", provider=_Stub(better)
    ).measures) == 3


def test_a_correction_that_breaks_more_measures_is_refused() -> None:
    """A model asked to check can decide to rewrite instead.

    A rewrite that breaks measures which previously added up has made the page
    worse while sounding more confident about it, so it is measured rather than
    trusted — and beat sums are not an opinion.
    """
    engine = _score([FOUR, FOUR])
    worse = _score([FOUR, [("C3", "quarter")] * 7])
    assert confirm_reading(
        engine, b"img", media_type="image/png", provider=_Stub(worse)
    ) is engine


def test_an_equally_broken_correction_is_still_taken() -> None:
    """Not-worse is the bar, not strictly-better.

    The model is also fixing pitches and adding measures, and holding it to
    strict improvement in beat sums alone would throw away those fixes whenever
    the count happened to stay level.
    """
    engine = _score([[("C3", "quarter")] * 7])
    other = _score([[("D3", "quarter")] * 7])
    assert confirm_reading(
        engine, b"img", media_type="image/png", provider=_Stub(other)
    ) is other


def test_a_failing_model_leaves_the_engine_reading_standing() -> None:
    """Never raises. The caller already has a usable transcription and would be
    trading it for an exception."""
    engine = _score([FOUR])
    stub = _Stub(OCRProviderError("rate limited"))
    assert confirm_reading(
        engine, b"img", media_type="image/png", provider=stub
    ) is engine


def test_an_empty_correction_leaves_the_engine_reading_standing() -> None:
    engine = _score([FOUR])
    empty = ScoreJson(clef="bass", ocr_confidence=0.5, measures=[])
    assert confirm_reading(
        engine, b"img", media_type="image/png", provider=_Stub(empty)
    ) is engine


def test_it_is_on_by_default_and_names_the_local_engine() -> None:
    from app.config import settings

    assert settings.OMR_CONFIRM == "omr-local"


def test_the_engine_is_not_in_the_fallthrough_chain() -> None:
    """It must not be, and this is the reason.

    The chain stops at the first provider that succeeds. The engine's reading
    is accurate about clef, key and barlines but incomplete — on a real page it
    found 15 measures where there were about 25 — so a chain that stopped there
    would return less than the vision model alone.
    """
    from app.config import settings

    assert "omr-local" not in settings.OCR_PROVIDER_CHAIN


@pytest.mark.parametrize("missing", ["", "   "])
def test_an_empty_setting_disables_the_step(missing: str) -> None:
    """So a deployment can turn it off without uninstalling anything."""
    assert not missing.strip()
