"""Re-reading the bars that do not add up, with a provider that can be asked.

**Why this exists at all.** `confirm.retry_with_arithmetic` names the bars whose
durations are wrong, asks for those and nothing else, and splices the answer
back. It has been dead in production since the chain became homr alone, because
it can only ask a provider that `takes_a_note` and homr is deterministic with no
prompt — so the branch logged "cannot reconsider" and stopped, on every page that
needed it. `OCR_CORRECTOR` names a different provider for that one job.

**This is not the vision chain coming back**, and the difference is the whole
reason it is safe. Those were asked to *read a page*; on a page they could not
read they wrote notes nobody had printed, at a confidence the app displayed as a
transcription. The question here is narrower and, unlike that one, checkable:

  * the bars sent are ones arithmetic has already proved wrong;
  * `_splice` accepts a replacement for **only those bars**;
  * a reply that leaves more bars broken than it found is discarded;
  * a metre cannot be lost by omission.

Nothing is originated here. Every test below is about one of those limits
holding when the corrector misbehaves, because a corrector that misbehaves is
the case the history of this project says to expect.
"""

from __future__ import annotations

import pytest

from app.services.ocr import pipeline
from app.services.ocr.base import OCRProviderError, OCRResponse
from app.services.ocr.validate import validate_measures
from app.services.score_schema import Measure, Note, ScoreJson


def _measure(number: int, beats: int) -> Measure:
    return Measure(
        measure_number=number,
        notes=[Note(pitch="D3", duration="quarter") for _ in range(beats)],
    )


def _score(*beats_per_bar: int) -> ScoreJson:
    return ScoreJson(
        time_signature="4/4",
        clef="bass",
        measures=[_measure(i, b) for i, b in enumerate(beats_per_bar, start=1)],
        ocr_confidence=1.0,
    )


class _Corrector:
    """A stand-in for the vision model, scripted per test."""

    name = "test-corrector"
    takes_a_note = True

    def __init__(self, reply: ScoreJson | Exception) -> None:
        self.reply = reply
        self.asked: list[str] = []

    def parse(self, image_bytes, mime_type="image/jpeg", note=None):
        self.asked.append(note or "")
        if isinstance(self.reply, Exception):
            raise self.reply
        return OCRResponse(
            score=self.reply,
            raw_text="",
            model=self.name,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
            latency_ms=0,
        )


@pytest.fixture()
def wired(monkeypatch):
    """Install a corrector and hand the test the object it can inspect."""

    def _install(reply):
        helper = _Corrector(reply)
        monkeypatch.setattr(pipeline, "PROVIDER_REGISTRY", {**pipeline.PROVIDER_REGISTRY, helper.name: helper})
        monkeypatch.setenv("OCR_CORRECTOR", helper.name)
        from app.config import settings

        monkeypatch.setattr(settings, "OCR_CORRECTOR", helper.name, raising=False)
        return helper

    return _install


def _retry(score: ScoreJson, helper) -> ScoreJson:
    from app.services.ocr.confirm import retry_with_arithmetic

    return retry_with_arithmetic(score, b"<page>", media_type="image/jpeg", provider=helper)


# ---------------------------------------------------------------------------
# Resolving one
# ---------------------------------------------------------------------------


def test_no_corrector_is_configured_by_default() -> None:
    """Off unless asked for. It costs a metered call per page that needs one,
    and turning that on is a decision about a bill."""
    from app.config import settings

    assert settings.OCR_CORRECTOR == ""


def test_a_corrector_that_takes_no_prompt_is_refused(monkeypatch, caplog) -> None:
    """Naming homr here is asking it the question it cannot be asked, which is
    the situation the setting exists to escape."""
    from app.config import settings

    monkeypatch.setattr(settings, "OCR_CORRECTOR", "homr", raising=False)
    assert pipeline.corrector() is None


def test_an_unknown_corrector_does_not_take_the_page_down(monkeypatch) -> None:
    """A misconfiguration must not lose a reading that is already in hand."""
    from app.config import settings

    monkeypatch.setattr(settings, "OCR_CORRECTOR", "nonesuch", raising=False)
    assert pipeline.corrector() is None


# ---------------------------------------------------------------------------
# The limits, when the corrector misbehaves
# ---------------------------------------------------------------------------


def test_a_corrected_bar_is_taken(wired) -> None:
    """The ordinary case: bar 2 was three beats, comes back four."""
    helper = wired(_score(4, 4, 4))
    out = _retry(_score(4, 3, 4), helper)

    assert [f.verdict for f in validate_measures(out)] == ["ok", "ok", "ok"]
    assert "measure 2" in helper.asked[0]


def test_only_the_bars_that_were_asked_about_can_change(wired) -> None:
    """**A retry aimed at bar 2 may not rewrite bar 3.**

    Bar 3 was read correctly and was never in question. A corrector that
    rewrites it has not been checked against anything, and accepting it would
    let a narrow question edit a page.
    """
    reply = _score(4, 4, 1)  # bar 3 gutted, and it was never broken
    helper = wired(reply)

    out = _retry(_score(4, 3, 4), helper)

    assert len(out.measures[2].notes) == 4, "bar 3 was replaced and must not be"
    assert [f.verdict for f in validate_measures(out)] == ["ok", "ok", "ok"]


def test_a_reply_that_breaks_more_than_it_fixes_is_discarded(wired) -> None:
    """A model asked to fix one bar can return three that are worse. The page in
    hand is kept — it is a real reading with one known-bad bar, and that is
    better than a rewrite that sounds more confident and is not."""
    original = _score(4, 3, 4)
    # "Fixes" bar 2 to two beats: still wrong, and no better.
    helper = wired(_score(4, 2, 4))

    out = _retry(original, helper)

    assert [len(m.notes) for m in out.measures] == [4, 2, 4]
    assert sum(1 for f in validate_measures(out) if f.verdict != "ok") == 1


def test_a_corrector_that_raises_leaves_the_reading_standing(wired) -> None:
    """A retry improves something that already works, so its failure must cost
    nothing. The caller has a usable transcription and would be trading it for
    an exception."""
    helper = wired(OCRProviderError("the corrector is down"))
    original = _score(4, 3, 4)

    out = _retry(original, helper)

    assert [len(m.notes) for m in out.measures] == [4, 3, 4]


def test_a_corrector_that_returns_nothing_leaves_the_reading_standing(wired) -> None:
    helper = wired(
        ScoreJson(time_signature="4/4", clef="bass", measures=[], ocr_confidence=1.0)
    )
    out = _retry(_score(4, 3, 4), helper)

    assert [len(m.notes) for m in out.measures] == [4, 3, 4]


def test_the_corrector_is_told_which_bars_and_why(wired) -> None:
    """The prompt names the bar, its beat count and the metre it is measured
    against. Without the number a model re-reads the page; without the count it
    has no way to know what "wrong" meant."""
    helper = wired(_score(4, 4, 4))
    _retry(_score(4, 3, 4), helper)

    asked = helper.asked[0]
    assert "measure 2" in asked
    assert "3 beats" in asked and "expected 4" in asked
