"""Tests for the pipeline orchestration in `app.services.ocr.pipeline`.

Each provider is replaced with a `_FakeProvider` whose `parse` either
returns a canned `OCRResponse` or raises a chosen exception. This
exercises the chain logic without going through any real SDK.
"""

from __future__ import annotations

from typing import Callable

import pytest
from pydantic import ValidationError

from app import config as app_config
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
    monkeypatch.setattr(app_config.settings, "OCR_PROVIDER_CHAIN", "beta,alpha")

    parse_sheet_music(b"<jpeg>")
    assert captured == ["beta"]  # first one wins; alpha never tried


def test_a_chain_with_no_usable_provider_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Nothing left to try is a configuration error with no fallback."""
    monkeypatch.setattr(app_config.settings, "OCR_PROVIDER_CHAIN", "claude-sonnet-4-6,bogus")
    with pytest.raises(OCRError, match="no usable provider"):
        parse_sheet_music(b"<jpeg>")


def test_a_stale_name_is_skipped_rather_than_fatal(monkeypatch: pytest.MonkeyPatch) -> None:
    """One renamed model must cost that model, not the whole feature.

    This test asserted the opposite — that any unknown name raised — and the
    cost of that showed up in production: the shipped `OCR_PROVIDER_CHAIN`
    default read `gemini-2.5-flash,claude-sonnet-4-6,claude-opus-4-7`, two
    names from the previous Claude generation, so `_default_chain()` raised on
    the first scan and **no page could be read at all**, whatever keys were
    set. Note that this very test used `claude-sonnet-4-6` as its example of a
    bogus name while the default shipped it as a real one.

    Skipped, not swallowed: the names are logged at warning and `/v1/ready`
    reports them.
    """
    monkeypatch.setattr(
        app_config.settings,
        "OCR_PROVIDER_CHAIN",
        "claude-sonnet-4-6,claude-sonnet-5,also-bogus",
    )
    chain = pipeline_module._default_chain()

    assert [p.name for p in chain] == ["claude-sonnet-5"]
    assert pipeline_module.unknown_provider_names == ["claude-sonnet-4-6", "also-bogus"]


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

    # Content, not identity: every reading is renumbered on the way through,
    # which returns a copy.
    result = parse_sheet_music(b"img", providers=[_Fails(), _Works()], retry=False)
    assert result.measures[0].notes == good.measures[0].notes
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


# ---- the program numbers the measures --------------------------------------


def test_measures_are_renumbered_positionally() -> None:
    """The numbers are positional — first bar on the page is 1 — so deriving
    them is counting, and a program counts without having a bad minute."""
    from app.services.ocr.pipeline import renumber
    from app.services.score_schema import Measure, Note, ScoreJson

    score = ScoreJson(
        clef="bass", time_signature="4/4", ocr_confidence=0.9,
        measures=[
            Measure(measure_number=n, notes=[Note(pitch="C3", duration="whole")])
            for n in (409, 414, 415)
        ],
    )
    assert [m.measure_number for m in renumber(score).measures] == [1, 2, 3]


def test_a_numbering_gap_is_reported_before_it_is_normalised() -> None:
    """Renumbering silently would destroy the signal it exists to fix.

    A boxed rehearsal mark reading 49 came back as measure 409 on a real
    photograph, inserting an empty measure and renumbering the rest. If the
    program just renumbers, the output runs 1..N and looks immaculate with the
    spurious measure still in the middle of it.
    """
    from app.services.ocr.pipeline import renumber
    from app.services.score_schema import Measure, Note, ScoreJson

    score = ScoreJson(
        clef="bass", time_signature="4/4", ocr_confidence=0.9,
        measures=[
            Measure(measure_number=n, notes=[Note(pitch="C3", duration="whole")])
            for n in (1, 2, 409)
        ],
    )
    fixed = renumber(score)
    assert [m.measure_number for m in fixed.measures] == [1, 2, 3]
    assert "rehearsal mark" in fixed.notes_to_human
    assert "2→409" in fixed.notes_to_human


def test_renumbering_a_clean_reading_says_nothing() -> None:
    """It runs on every reading, so it must be silent when there is nothing to
    say — otherwise every score carries a warning about itself."""
    from app.services.ocr.pipeline import renumber
    from app.services.score_schema import Measure, Note, ScoreJson

    score = ScoreJson(
        clef="bass", time_signature="4/4", ocr_confidence=0.9,
        notes_to_human="Bar 3 was hard to read.",
        measures=[
            Measure(measure_number=n, notes=[Note(pitch="C3", duration="whole")])
            for n in (1, 2, 3)
        ],
    )
    fixed = renumber(score)
    assert [m.measure_number for m in fixed.measures] == [1, 2, 3]
    assert fixed.notes_to_human == "Bar 3 was hard to read."


# ---- the branches nothing reached -----------------------------------------
#
# Found by coverage rather than by reading: `pipeline.py` sat at 89% and every
# missing line was a path a *difficult* page takes. A simple exercise sheet
# never reaches any of them, and simple exercise sheets are the whole corpus.


def test_progress_reporting_cannot_take_the_reading_down() -> None:
    """The scan screen's progress bar is a callback into this loop.

    A page is read once and it is the expensive thing that happened; losing it
    because the thing *describing* it threw would be absurd — and the callback
    crosses into the worker, the row and eventually a phone, so it has more
    ways to fail than the reading does.
    """
    calls: list[str] = []

    def _explodes(stage) -> None:
        calls.append(stage)
        raise RuntimeError("the progress row went away")

    good = _FakeProvider("p1", response=_response("p1", conf=0.95))

    score = parse_sheet_music(b"<jpeg>", providers=[good], on_stage=_explodes)

    assert score.ocr_confidence == 0.95
    assert calls, "the callback was never called, so this proved nothing"


def test_a_provider_that_did_not_read_the_clef_is_not_believed() -> None:
    """`ScoreJson.clef` is optional so a score can exist before it has been
    read. A *provider* answering without one has not read the page either, and
    the next provider deserves it — silently accepting the reading would put a
    bass part on screen labelled with no clef at all, and the same notehead is
    a different pitch to a violist than to a violinist.
    """
    clefless = ScoreJson.model_validate({**GOOD_PAYLOAD, "clef": None})
    first = _FakeProvider(
        "p1",
        response=OCRResponse(
            score=clefless,
            raw_text="{}",
            model="p1",
            input_tokens=1,
            output_tokens=1,
            cost_usd=0.0,
            latency_ms=1,
        ),
    )
    second = _FakeProvider("p2", response=_response("p2", conf=0.95))

    score = parse_sheet_music(b"<jpeg>", providers=[first, second])

    assert first.calls == 1
    assert second.calls == 1, "the page was never handed on"
    assert score.clef == "treble"


def test_an_unknown_provider_name_is_refused_by_name() -> None:
    """The failure that took sheet-music reading down once already: the shipped
    default named two models from the previous Claude generation, so the chain
    raised on the first scan and no photograph could be read at all, whatever
    keys were set. The message has to name what it did not recognise.
    """
    with pytest.raises(OCRError, match="unknown provider"):
        pipeline_module.get_provider("gemini-1.0-ultra")

    with pytest.raises(OCRError, match="known:"):
        pipeline_module.get_provider("")


def test_an_unset_chain_falls_back_to_models_this_build_knows(monkeypatch) -> None:
    """An empty `OCR_PROVIDER_CHAIN` must not mean an empty chain.

    The default is spelled with current model names and has to stay that way —
    a stale name here is not a slow path, it is a feature that cannot run. So
    whatever it falls back to has to be in the registry *now*, checked rather
    than trusted.
    """
    settings = app_config.settings
    monkeypatch.setattr(settings, "OCR_PROVIDER_CHAIN", "   ")

    chain = pipeline_module._default_chain()

    assert chain, "an unset chain produced no providers, so no page can be read"
    for provider in chain:
        assert pipeline_module.get_provider(provider.name) is provider


# ---- a page with nothing on it --------------------------------------------
#
# Found in a real library rather than by reading the code. Of six scans, two
# came back `done` — one with a single empty measure, one with four notes for a
# whole page — both at 0.2 confidence, and both were shown to the musician as a
# finished piece with nothing on the screen.


def _empty_reading(name: str, *, measures: int = 1) -> OCRResponse:
    """What a model returns when it has not read the page: structure, no music."""
    payload = {
        **GOOD_PAYLOAD,
        "ocr_confidence": 0.2,
        "measures": [
            {"measure_number": i + 1, "notes": [], "slurs": []} for i in range(measures)
        ],
    }
    return OCRResponse(
        score=ScoreJson.model_validate(payload),
        raw_text="{}",
        model=name,
        input_tokens=1,
        output_tokens=1,
        cost_usd=0.0,
        latency_ms=1,
    )


def test_a_reading_with_no_notes_is_handed_to_the_next_provider() -> None:
    """Not a page read badly — a page not read.

    Nothing else in the loop catches it: the clef is there so the clef check
    passes, and a measure with no notes contradicts no metre it can establish
    so the beat check passes.
    """
    nothing = _FakeProvider("p1", response=_empty_reading("p1"))
    real = _FakeProvider("p2", response=_response("p2", conf=0.95))

    score = parse_sheet_music(b"<jpeg>", providers=[nothing, real])

    assert nothing.calls == 1
    assert real.calls == 1, "the page was never handed on"
    assert any(m.notes for m in score.measures)


def test_a_page_nobody_could_read_fails_rather_than_looking_finished() -> None:
    """The state two of six real scans were left in.

    An empty score cannot be corrected, practised against, or told apart from a
    scan that never ran — and being `done` denies the musician the "try reading
    it again" that `failed` offers. Refusing costs a retry; accepting costs the
    piece.
    """
    with pytest.raises(OCRError, match="no notes"):
        parse_sheet_music(
            b"<jpeg>",
            providers=[
                _FakeProvider("p1", response=_empty_reading("p1")),
                _FakeProvider("p2", response=_empty_reading("p2", measures=40)),
            ],
        )


def test_an_empty_reading_never_becomes_the_low_confidence_fallback() -> None:
    """The fallback is for a *bad* reading, which beats none, not an *absent*
    one, which is worse. A page of forty empty measures looks like a serious
    transcription and contains nothing."""
    empty = _FakeProvider("p1", response=_empty_reading("p1", measures=40))
    poor = _FakeProvider("p2", response=_response("p2", conf=0.3))

    score = parse_sheet_music(b"<jpeg>", providers=[empty, poor])

    assert score.ocr_confidence == 0.3, "the empty reading was preferred"
    assert any(m.notes for m in score.measures)


def test_one_note_is_enough_to_be_a_reading() -> None:
    """The bar is "did it read anything", not "did it read enough". Judging
    sufficiency here would throw away a correct transcription of a page that
    genuinely holds four bars of whole notes."""
    sparse_payload = {
        **GOOD_PAYLOAD,
        "ocr_confidence": 0.95,
        "measures": [
            {"measure_number": 1, "notes": [], "slurs": []},
            {
                "measure_number": 2,
                "notes": [{"pitch": "D3", "duration": "whole"}],
                "slurs": [],
            },
        ],
    }
    sparse = _FakeProvider(
        "p1",
        response=OCRResponse(
            score=ScoreJson.model_validate(sparse_payload),
            raw_text="{}", model="p1", input_tokens=1, output_tokens=1,
            cost_usd=0.0, latency_ms=1,
        ),
    )

    score = parse_sheet_music(b"<jpeg>", providers=[sparse])

    assert sum(len(m.notes) for m in score.measures) == 1
