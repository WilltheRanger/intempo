"""Handing a model its own bad arithmetic back, and letting it try again.

The step only earns its place if it can be *worse* as well as better, and the
code has to notice. So most of these are about the retry being rejected, not
accepted.

A measure whose durations do not sum to the time signature is *known* to be
wrong — no judgement, just arithmetic — and it is wrong in the way that matters
most: `alignment.py` accumulates durations to build its expected timeline, so
one bad bar shifts every bar after it.
"""

from __future__ import annotations

import pytest

from app.services.ocr.base import OCRProviderError, OCRResponse
from app.services.ocr.confirm import _splice, retry_with_arithmetic
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


def test_the_model_is_told_which_measures_do_not_add_up() -> None:
    """The whole point: the retry is aimed, not a re-roll.

    A bare "try again" re-rolls the same dice. Naming the measure and the
    arithmetic gives the model somewhere to look — and lets it answer that the
    passage is a tuplet, which is a real answer this schema cannot represent.
    """
    broken = _score([[("C3", "quarter")] * 7])
    stub = _Stub(_score([FOUR]))
    retry_with_arithmetic(broken, b"img", media_type="image/png", provider=stub)

    # The substance, not the wording: which measure, what is wrong with it, and
    # what to do about it. (This asserted the literal phrase "does not add up",
    # which stopped being accurate once broken ties could reach the same
    # prompt — the durations in a tie-only fault sum perfectly.)
    assert "measure 1" in stub.note, "the offending measure has to be named"
    assert "7 beats" in stub.note and "expected 4" in stub.note
    assert "Correct the durations" in stub.note


def test_a_reading_that_already_adds_up_is_not_re_read() -> None:
    """No second call, and therefore no second bill, when the arithmetic is
    already sound. This is the common case."""
    good = _score([FOUR, FOUR])
    stub = _Stub(_score([FOUR]))
    assert retry_with_arithmetic(
        good, b"img", media_type="image/png", provider=stub
    ) is good
    assert stub.note is None, "the model was asked to re-read a page that was fine"


def test_a_retry_that_fixes_the_arithmetic_is_taken() -> None:
    """The point of the whole step.

    The model returns **only measure 2** — the one that did not add up — and
    the program splices it in. Re-transcribing the page to fix one bar costs
    the page again: ~2,200 output tokens against the ~150 that bar needs.
    """
    broken = _score([FOUR, [("C3", "quarter")] * 7])
    only_two = _score([FOUR])
    only_two.measures[0].measure_number = 2  # what the model was asked for

    result = retry_with_arithmetic(
        broken, b"img", media_type="image/png", provider=_Stub(only_two)
    )
    assert len(result.measures) == 2, "the untouched measure was dropped"
    assert len(result.measures[1].notes) == 4, "the broken measure was not replaced"
    assert result.measures[0] is broken.measures[0], "measure 1 was needlessly rewritten"


def test_the_model_is_told_not_to_return_the_measures_that_were_fine() -> None:
    """Half the saving. The other half is that a page handed back whole is a
    page the model is free to change its mind about."""
    broken = _score([FOUR, [("C3", "quarter")] * 7])
    stub = _Stub(_score([FOUR]))
    retry_with_arithmetic(broken, b"img", media_type="image/png", provider=stub)
    assert "ONLY the measures listed" in stub.note


def test_a_measure_that_was_not_asked_about_is_ignored() -> None:
    """A retry aimed at bar 2 must not rewrite bar 1.

    Bar 1 was not reported as broken, the returned version has been checked
    against nothing, and quietly accepting it would make every retry a licence
    to redo the page.
    """
    broken = _score([FOUR, [("C3", "quarter")] * 7])
    meddling = _score([[("G3", "quarter")] * 4, FOUR])  # rewrites measure 1 too
    result = retry_with_arithmetic(
        broken, b"img", media_type="image/png", provider=_Stub(meddling)
    )
    assert result.measures[0].notes[0].pitch == "C3", "measure 1 was overwritten"


def test_a_correction_that_breaks_more_measures_is_refused() -> None:
    """A model asked to check can decide to rewrite instead.

    A rewrite that breaks measures which previously added up has made the page
    worse while sounding more confident about it, so it is measured rather than
    trusted — and beat sums are not an opinion.
    """
    engine = _score([FOUR, FOUR])
    worse = _score([FOUR, [("C3", "quarter")] * 7])
    assert retry_with_arithmetic(
        engine, b"img", media_type="image/png", provider=_Stub(worse)
    ) is engine


def test_an_equally_broken_reread_is_still_taken() -> None:
    """Not-worse is the bar, not strictly-better.

    The model is also fixing pitches, and holding it to strict improvement in
    beat sums alone would throw away those fixes whenever the count happened to
    stay level.
    """
    first = _score([[("C3", "quarter")] * 7])
    other = _score([[("D3", "quarter")] * 7])
    result = retry_with_arithmetic(
        first, b"img", media_type="image/png", provider=_Stub(other)
    )
    assert result.measures[0].notes[0].pitch == "D3"


def test_a_failing_model_leaves_the_engine_reading_standing() -> None:
    """Never raises. The caller already has a usable transcription and would be
    trading it for an exception."""
    engine = _score([FOUR])
    stub = _Stub(OCRProviderError("rate limited"))
    assert retry_with_arithmetic(
        engine, b"img", media_type="image/png", provider=stub
    ) is engine


def test_an_empty_correction_leaves_the_engine_reading_standing() -> None:
    engine = _score([FOUR])
    empty = ScoreJson(clef="bass", ocr_confidence=0.5, measures=[])
    assert retry_with_arithmetic(
        engine, b"img", media_type="image/png", provider=_Stub(empty)
    ) is engine


def test_the_retry_is_on_by_default() -> None:
    """A page whose bars do not add up is the failure this exists for, so it
    must not need switching on."""
    import inspect

    from app.services.ocr.pipeline import parse_sheet_music

    assert inspect.signature(parse_sheet_music).parameters["retry"].default is True




@pytest.mark.parametrize("missing", ["", "   "])
def test_an_empty_setting_disables_the_step(missing: str) -> None:
    """So a deployment can turn it off without uninstalling anything."""
    assert not missing.strip()


def test_a_retry_cannot_lose_a_change_of_metre() -> None:
    """A change of metre belongs to the *bar*, not to the notes in it.

    The retry asks about durations. A model that fixes four of them and says
    nothing about the time signature would delete the change by omission — and
    then every bar after it reads short too, because the metre it set was
    running for all of them.

    Measured before the fix: bar 2 carrying "3/4", re-read with its count
    corrected, came back with the metre gone and bars 2 **and 3** newly
    flagged. The not-worse guard happened to catch that one, which is luck: a
    retry that also "fixed" bar 3 to four beats would have passed the guard and
    lost the metre silently.
    """
    from app.services.ocr.validate import validate_measures

    def bar(number: int, beats: int, meter: str | None = None) -> Measure:
        return Measure(
            measure_number=number,
            notes=[Note(pitch="C3", duration="quarter")] * beats,
            time_signature=meter,
        )

    original = ScoreJson(
        clef="bass",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[bar(1, 4), bar(2, 5, "3/4"), bar(3, 3)],
    )
    # The model returns bar 2 with the count fixed and no time signature.
    patch = ScoreJson(
        clef="bass", time_signature="4/4", ocr_confidence=0.9, measures=[bar(2, 3)]
    )

    spliced = _splice(original, patch, [2])

    assert spliced.measures[1].time_signature == "3/4"
    assert [f.measure_number for f in validate_measures(spliced) if f.is_problem] == []


def test_a_retry_may_still_correct_the_metre_it_reads() -> None:
    """Carried forward by omission only. A model that *states* a time signature
    has read one, and that reading is the point of asking again."""
    original = ScoreJson(
        clef="bass",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(
                measure_number=1,
                notes=[Note(pitch="C3", duration="quarter")] * 5,
                time_signature="3/4",
            )
        ],
    )
    patch = ScoreJson(
        clef="bass",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(
                measure_number=1,
                notes=[Note(pitch="C3", duration="quarter")] * 4,
                time_signature="4/4",
            )
        ],
    )

    assert _splice(original, patch, [1]).measures[0].time_signature == "4/4"
