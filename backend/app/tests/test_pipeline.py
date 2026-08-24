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
from app.services.ocr.validate import problems as beat_problems
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

        def parse(
            self,
            image_bytes: bytes,
            mime_type: str = "image/jpeg",
            note: str | None = None,
        ) -> OCRResponse:
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


# ---- reading a page one system at a time ----------------------------------


def _system(
    name: str,
    *,
    bars: int = 2,
    conf: float = 0.9,
    clef: str | None = "bass",
    meter: str | None = "4/4",
    repeats: list[dict] | None = None,
    tempo_changes: list[dict] | None = None,
) -> OCRResponse:
    """One system's worth of transcription, numbered from 1 as a system is."""
    payload = {
        **GOOD_PAYLOAD,
        "clef": clef,
        "time_signature": meter,
        "ocr_confidence": conf,
        "repeats": repeats or [],
        "tempo_changes": tempo_changes or [],
        "measures": [
            {
                "measure_number": i + 1,
                "notes": [{"pitch": "D3", "duration": "quarter"}] * 4,
                "slurs": [],
            }
            for i in range(bars)
        ],
    }
    return OCRResponse(
        score=ScoreJson.model_validate(payload),
        raw_text="{}", model=name, input_tokens=1, output_tokens=1,
        cost_usd=0.0, latency_ms=1,
    )


def test_a_bar_number_from_the_last_system_is_shifted_to_where_it_belongs() -> None:
    """The whole job of joining systems.

    Each system comes back numbered from one, and `repeats` and
    `tempo_changes` point at *those* numbers. Joining without shifting them
    attaches a `rit.` printed in the last line to the second bar of the piece —
    and `measures_under_tempo_change` then suppresses the verdict for the wrong
    passage, on a page where the musician did slow down and was told nothing.
    """
    combined = pipeline_module._combine(
        [
            _system("s1", bars=4).score,
            _system(
                "s2",
                bars=4,
                tempo_changes=[{"measure_number": 2, "kind": "ritardando", "text": "rit."}],
                repeats=[{"start_measure": 1, "end_measure": 3, "type": "repeat"}],
            ).score,
        ]
    )

    assert [m.measure_number for m in combined.measures] == list(range(1, 9))
    assert combined.tempo_changes[0].measure_number == 6, "the rit. moved to bar 2"
    assert (combined.repeats[0].start_measure, combined.repeats[0].end_measure) == (5, 7)


def test_the_page_is_only_as_confident_as_its_worst_line() -> None:
    """Lowest, not mean. The page is one thing to the musician, and a line the
    reader was unsure of is a line of wrong notes wherever it sits — averaging
    it against nine confident ones hides the page that most needs checking."""
    combined = pipeline_module._combine(
        [_system("s1", conf=0.95).score, _system("s2", conf=0.3).score]
    )

    assert combined.ocr_confidence == pytest.approx(0.3)


def test_the_header_comes_from_the_line_that_prints_it() -> None:
    """A page prints its clef and metre on the first system and never again.
    Later systems answering `None` are not disagreeing — they are reading a
    line that does not say."""
    # The systems have to *disagree*, or first and last give the same answer
    # and the test proves nothing — which is how it was written first. A later
    # line printing 2/4 after a metre change is the real case: the page's
    # header is what system one prints, and per-measure `time_signature`
    # carries the change.
    combined = pipeline_module._combine(
        [
            _system("s1", clef="bass", meter="3/4").score,
            _system("s2", clef="treble", meter="2/4").score,
            _system("s3", clef=None, meter="unknown").score,
        ]
    )

    assert combined.clef == "bass", "the page was labelled with a later line's clef"
    assert combined.time_signature == "3/4"


def test_one_unreadable_system_sends_the_whole_page_instead_of_leaving_a_hole(
    monkeypatch,
) -> None:
    """The judgement call in this path, and it is not close.

    A page transcribed with one system out of ten missing is the worst outcome
    available: `alignment.py` accumulates durations, so a missing line shifts
    every bar after it and the musician is told they rushed a passage they
    played correctly. Reading the page whole is merely *worse at reading*.
    """
    monkeypatch.setattr(
        pipeline_module, "crop_systems", lambda _b, *, source=None: [b"crop-1", b"crop-2", b"crop-3"]
    )

    answers = [_system("p", bars=3), OCRProviderError("rate limited"), _system("p", bars=3)]
    calls = {"n": 0}

    class _PerCrop:
        name = "p"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            # The whole page is the one that is not a crop.
            if image_bytes not in (b"crop-1", b"crop-2", b"crop-3"):
                return _system("p", bars=9)
            answer = answers[calls["n"]]
            calls["n"] += 1
            if isinstance(answer, Exception):
                raise answer
            return answer

    score = parse_sheet_music(b"<page>", providers=[_PerCrop()], retry=False)

    assert len(score.measures) == 9, "a page with a hole in it was returned"
    # This used to also assert the reading *stopped* at the failure —
    # `calls["n"] == 2` — which was true while the systems were read one after
    # another and is not true now they are read four at a time. Unstarted work
    # is cancelled, so a twelve-system page failing on its first line does not
    # pay for the other eleven; work already in flight is not saved, and with
    # instant stubs every crop starts before the first result is collected.
    # Asserting a call count here would be asserting the scheduler's timing.
    assert calls["n"] >= 2, "the failing system was never reached"


def test_a_page_split_into_more_systems_than_a_page_has_is_read_whole(monkeypatch) -> None:
    """A wrong split costs a model call per phantom band. The ceiling bounds
    the bill on a page that was misread, not on an honest one."""
    monkeypatch.setattr(
        pipeline_module,
        "crop_systems",
        lambda _b, *, source=None: [
            f"crop-{i}".encode()
            for i in range(pipeline_module._MAX_SYSTEMS_TO_READ + 1)
        ],
    )
    whole = _FakeProvider("p", response=_system("p", bars=5))

    score = parse_sheet_music(b"<page>", providers=[whole], retry=False)

    assert whole.calls == 1, "it read the phantom bands one by one"
    assert len(score.measures) == 5


# ---- a metre change printed at the top of a line --------------------------


def _bars(count: int, beats_each: int, *, meter_on_first: str | None = None) -> list[dict]:
    """`count` measures of `beats_each` quarter notes, numbered from 1."""
    out = []
    for i in range(count):
        measure = {
            "measure_number": i + 1,
            "notes": [{"pitch": "D3", "duration": "quarter"}] * beats_each,
            "slurs": [],
        }
        if i == 0 and meter_on_first is not None:
            measure["time_signature"] = meter_on_first
        out.append(measure)
    return out


def _line(meter: str | None, measures: list[dict], *, conf: float = 0.9) -> ScoreJson:
    """One system's transcription, as a model reading one crop would answer."""
    return ScoreJson.model_validate(
        {
            **GOOD_PAYLOAD,
            "clef": "bass",
            "time_signature": meter,
            "ocr_confidence": conf,
            "repeats": [],
            "tempo_changes": [],
            "measures": measures,
        }
    )


def test_a_metre_change_printed_on_a_later_line_survives_the_join() -> None:
    """The bug reading a page one system at a time introduces, and the reason
    `_restate_meter_changes` exists.

    A model handed one crop cannot tell it is not the first line, so a 2/4
    printed where the music changes to 2/4 arrives in that system's *header*.
    `_combine` keeps the first header, so without this the page is checked
    against 4/4 to the last bar — and the prompt's own rule says what that
    does: every bar after the change is reported as having the wrong number of
    beats, on a page written and read correctly, with a control offered to
    "fix" each one.
    """
    combined = pipeline_module._combine(
        [
            _line("4/4", _bars(3, 4)),
            _line("2/4", _bars(3, 2)),
        ]
    )

    assert combined.time_signature == "4/4", "the page's opening metre moved"
    assert combined.measures[3].time_signature == "2/4", (
        "the change of metre was dropped when the systems were joined"
    )
    # The check that actually reaches the musician: every bar adds up.
    assert beat_problems(combined) == []


def test_a_metre_the_bars_do_not_support_is_not_promoted_to_a_change() -> None:
    """The other half, and the reason arithmetic decides rather than the model.

    A model asked for a time signature will often supply one whether or not
    the line prints it. Promoting a guess to a metre change is worse than
    dropping a real one — it invalidates a correct reading from that bar to
    the end of the page — so the bars have to agree first.
    """
    combined = pipeline_module._combine(
        [
            _line("4/4", _bars(3, 4)),
            _line("3/4", _bars(3, 4)),  # says 3/4, plays four quarters a bar
        ]
    )

    assert combined.measures[3].time_signature is None, (
        "a metre nothing on the line adds up to was written in as a change"
    )
    assert beat_problems(combined) == []


def test_a_change_the_model_put_on_the_measure_is_not_moved_to_the_top_of_it() -> None:
    """A change printed *inside* a line, reported the documented way.

    The model saw 2/4 come in at the second bar of the crop and said so on that
    measure — and then answered 2/4 for the crop's header too, because that is
    the time signature it read. Taking the header as the change would put it a
    bar early and call bar 3, which is right, a bar with too many beats.

    The guard is "this system states a metre on **any** measure", not "on its
    first". Written the second way this scenario walks straight through it.
    """
    combined = pipeline_module._combine(
        [
            _line("4/4", _bars(2, 4)),
            _line(
                "2/4",
                [
                    {
                        "measure_number": 1,
                        "notes": [{"pitch": "D3", "duration": "quarter"}] * 4,
                        "slurs": [],
                    },
                    {
                        "measure_number": 2,
                        "notes": [{"pitch": "D3", "duration": "quarter"}] * 2,
                        "slurs": [],
                        "time_signature": "2/4",
                    },
                    {
                        "measure_number": 3,
                        "notes": [{"pitch": "D3", "duration": "quarter"}] * 2,
                        "slurs": [],
                    },
                ],
            ),
        ]
    )

    written = [
        (m.measure_number, m.time_signature)
        for m in combined.measures
        if m.time_signature is not None
    ]
    assert written == [(4, "2/4")], "the change moved to the top of the line"
    assert beat_problems(combined) == [], "bar 3 of the page was called wrong"


def test_the_metre_keeps_running_across_a_line_that_does_not_print_one() -> None:
    """Only the first line of a page prints the metre, so the third system
    stating 4/4 again after a 2/4 section is a change *back* — not a repeat of
    the header, and not something to ignore because the header already says
    4/4."""
    combined = pipeline_module._combine(
        [
            _line("4/4", _bars(2, 4)),
            _line("2/4", _bars(2, 2)),
            _line(None, _bars(2, 2)),
            _line("4/4", _bars(2, 4)),
        ]
    )

    written = [
        (m.measure_number, m.time_signature)
        for m in combined.measures
        if m.time_signature is not None
    ]
    assert written == [(3, "2/4"), (7, "4/4")]
    assert beat_problems(combined) == []


def test_a_page_whose_first_line_never_states_a_metre_takes_the_next_one() -> None:
    """Nothing to change *from* is not a change. The first metre anyone states
    is the page's header — which is what `_combine` already did, and the case
    where a phone photograph cuts the top of the page off."""
    combined = pipeline_module._combine(
        [
            _line(None, _bars(2, 3)),
            _line("3/4", _bars(2, 3)),
        ]
    )

    assert combined.time_signature == "3/4"
    assert all(m.time_signature is None for m in combined.measures), (
        "the header was written in as a change of metre halfway down the page"
    )


def test_a_change_back_is_judged_against_the_metre_the_line_before_left_running() -> None:
    """The running metre has to survive a change printed *inside* a system.

    Line two goes into 2/4 at its second bar and reports it on that measure, so
    nothing is moved. What matters is what the metre is when line three starts:
    2/4. Line three prints 4/4 and is a change back.

    Read against the page header instead — 4/4, because the running metre never
    advanced — line three's 4/4 looks like no change at all, so nothing is
    written, the page stays in 2/4 to the end, and every bar of a correctly
    read line is reported as having twice the beats it should.
    """
    combined = pipeline_module._combine(
        [
            _line("4/4", _bars(2, 4)),
            _line(
                "4/4",
                [
                    {"measure_number": 1, "notes": [{"pitch": "D3", "duration": "quarter"}] * 4, "slurs": []},
                    {"measure_number": 2, "notes": [{"pitch": "D3", "duration": "quarter"}] * 2, "slurs": [], "time_signature": "2/4"},
                    {"measure_number": 3, "notes": [{"pitch": "D3", "duration": "quarter"}] * 2, "slurs": []},
                ],
            ),
            _line("4/4", _bars(2, 4)),
        ]
    )

    written = [
        (m.measure_number, m.time_signature)
        for m in combined.measures
        if m.time_signature is not None
    ]
    assert written == [(4, "2/4"), (6, "4/4")], "the change back to 4/4 was dropped"
    assert beat_problems(combined) == []


def test_a_line_that_splits_evenly_between_two_metres_does_not_switch_the_page() -> None:
    """A tie is not evidence, and the cost of treating it as evidence is not
    confined to the line that tied.

    Whatever metre is written in runs from that bar to the end of the page. So
    a system whose bars vote two-all hands every later line to a metre half of
    one line supported — here that is the last two bars, which are 4/4, read
    correctly, and would be reported as a bar too long each.
    """
    combined = pipeline_module._combine(
        [
            _line("4/4", _bars(2, 4)),
            _line(
                "3/4",
                [
                    {"measure_number": 1, "notes": [{"pitch": "D3", "duration": "quarter"}] * 4, "slurs": []},
                    {"measure_number": 2, "notes": [{"pitch": "D3", "duration": "quarter"}] * 3, "slurs": []},
                    {"measure_number": 3, "notes": [{"pitch": "D3", "duration": "quarter"}] * 4, "slurs": []},
                    {"measure_number": 4, "notes": [{"pitch": "D3", "duration": "quarter"}] * 3, "slurs": []},
                ],
            ),
            _line(None, _bars(2, 4)),
        ]
    )

    assert all(m.time_signature is None for m in combined.measures), (
        "a two-all vote switched the metre for the rest of the page"
    )
    flagged = {f.measure_number for f in beat_problems(combined)}
    assert flagged == {4, 6}, (
        "the two short bars in the ambiguous line are the problem; the 4/4 "
        f"line after it is not, and {sorted(flagged)} says otherwise"
    )


# ---- what a model is told when it is handed one line ----------------------


class _Recorder:
    """A provider that keeps every prompt note it was sent."""

    name = "recorder"

    def __init__(self, answer: OCRResponse | None = None) -> None:
        self.answer = answer
        self.notes: list[str | None] = []

    def parse(self, image_bytes, mime_type="image/jpeg", note=None):
        self.notes.append(note)
        return self.answer or _system("recorder", bars=2)


def test_each_line_is_told_which_line_of_the_page_it_is(monkeypatch) -> None:
    """The shared prompt is written for a page — "read the page straight
    through, top to bottom, once", "the header field is the metre the piece
    *starts* in". Handed one system, a model has no way to know any of that is
    now wrong. Which line it is decides what a time signature at the left edge
    means, so the number is in the note and not just the fact of the crop."""
    monkeypatch.setattr(
        pipeline_module, "crop_systems", lambda _b, *, source=None: [b"crop-1", b"crop-2", b"crop-3"]
    )
    recorder = _Recorder()

    parse_sheet_music(b"<page>", providers=[recorder], retry=False)

    assert len(recorder.notes) == 3
    for index, note in enumerate(recorder.notes, start=1):
        assert note is not None
        assert f"line {index} of 3" in note, note


def test_a_line_is_told_not_to_read_the_staff_the_crop_clips(monkeypatch) -> None:
    """`_SYSTEM_PADDING` is 55% of a system's height above and below, so on a
    densely set page a crop shows the notehead tips of its neighbours. A bar
    read from the line above is read twice — once here and once when that line
    is read — and the page comes out longer than the music. Every bar after it
    is then compared against the wrong moment in the recording."""
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: [b"a", b"b"])
    recorder = _Recorder()

    parse_sheet_music(b"<page>", providers=[recorder], retry=False)

    assert "ONLY the complete staff in the middle" in (recorder.notes[0] or "")


def test_a_page_read_whole_is_asked_the_question_it_always_was(monkeypatch) -> None:
    """No note on the whole-page path. That path is the fallback for everything
    the splitter cannot handle, and it has to keep working exactly as it did."""
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: [])
    recorder = _Recorder()

    parse_sheet_music(b"<page>", providers=[recorder], retry=False)

    assert recorder.notes == [None]


def test_the_arithmetic_retry_is_still_told_it_is_looking_at_one_line(
    monkeypatch,
) -> None:
    """The retry names the bars to re-read by number, and a system's bars are
    numbered from 1. Ask it without the context and it is a different question
    about a different thing: a model that believes it can see the whole page
    goes looking for the third bar of the *piece*, and whatever it sends back
    is spliced onto the third bar of this line.
    """
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: [b"a", b"b"])

    short = ScoreJson.model_validate(
        {
            **GOOD_PAYLOAD,
            "clef": "bass",
            "time_signature": "4/4",
            "ocr_confidence": 0.95,
            "repeats": [],
            "tempo_changes": [],
            "measures": _bars(2, 4) + _bars(1, 3),
        }
    )
    recorder = _Recorder(
        OCRResponse(
            score=short, raw_text="{}", model="recorder",
            input_tokens=1, output_tokens=1, cost_usd=0.0, latency_ms=1,
        )
    )

    parse_sheet_music(b"<page>", providers=[recorder], retry=True)

    # Keyed off text only the retry carries. Matching on "measure" instead
    # matched the *first* reading's note, which says "number this line's
    # measures", so the assertion passed with the context stripped off the
    # retry — the exact thing it was written to catch.
    retries = [n for n in recorder.notes if n and "Return ONLY the measures listed above" in n]
    assert len(retries) == 2, f"the retry did not fire per line: {recorder.notes}"
    assert "line 1 of 2" in retries[0], (
        "the retry was asked about a page while the first reading was asked "
        "about a line"
    )
    assert "line 2 of 2" in retries[1], "every line's retry carries its own number"


def test_cutting_the_page_up_is_reported_as_a_step(monkeypatch) -> None:
    """Decoding a 12-megapixel photograph, projecting it and re-encoding a crop
    per system takes real time, and until it was reported the screen said
    "Fetching the page" throughout it. `TranscribingPanel` has had a position
    for "Finding the staves" since the OMR engine that used to report it was
    removed; nothing emitted it, and `test_stage_parity.py` holds the words
    together but cannot know whether either side ever speaks.
    """
    seen: list[str] = []
    when: list[list[str]] = []

    def _crops(_image_bytes, *, source=None):
        # What the screen said *while* the cutting was happening. Asserting the
        # step appears somewhere in the list does not distinguish reporting it
        # before the work from reporting it after — and reporting it after is
        # the bug, because then the screen says "Fetching the page" for the
        # whole of the decode, projection and re-encode.
        when.append(list(seen))
        return [b"a", b"b"]

    monkeypatch.setattr(pipeline_module, "crop_systems", _crops)

    parse_sheet_music(
        b"<page>", providers=[_Recorder()], retry=False, on_stage=seen.append
    )

    assert when == [[pipeline_module.STAGE_SPLITTING]], (
        f"the page was cut up before the screen was told: {when}"
    )
    assert seen.index(pipeline_module.STAGE_SPLITTING) == 0, seen


def test_looking_for_the_staves_is_reported_even_when_there_is_one(monkeypatch) -> None:
    """A page that turns out not to need splitting has still been through the
    step: `find_systems` decoded it and projected it, which is the slow part,
    and found one system. Reporting it only on the pages that *do* split would
    make the step's appearance depend on the answer rather than on the work —
    and every fixture in this repository is a single system, so the common case
    would be the silent one.
    """
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: [])
    seen: list[str] = []

    parse_sheet_music(
        b"<page>", providers=[_Recorder()], retry=False, on_stage=seen.append
    )

    assert seen[0] == pipeline_module.STAGE_SPLITTING, seen
    assert seen.count(pipeline_module.STAGE_SPLITTING) == 1, seen


def test_a_single_system_is_not_searched_for_systems(monkeypatch) -> None:
    """Each crop goes back through `parse_sheet_music`, and a crop is one line.
    Reporting the splitting step from inside that recursion would say "finding
    the staves" once per system, in the middle of the reading — the bar would
    walk backwards from 0.7 to 0.3 on every line of the page."""
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: [b"a", b"b", b"c"])
    seen: list[str] = []

    parse_sheet_music(
        b"<page>", providers=[_Recorder()], retry=False, on_stage=seen.append
    )

    assert seen.count(pipeline_module.STAGE_SPLITTING) == 1, (
        f"the splitting step was reported once per system: {seen}"
    )


def test_the_systems_are_read_at_the_same_time(monkeypatch) -> None:
    """Concurrency, asserted rather than assumed — and without a timing test.

    Every crop's read waits at a barrier wide enough for `_SYSTEMS_AT_ONCE`. If
    the systems were read one after another the first one would sit there until
    the barrier's timeout and the whole page would fail; passing means that
    many reads were genuinely in flight together.

    Sequential is not a style preference here. A twelve-system page read one
    line at a time turns a thirty-second job into five minutes, in a
    `BackgroundTasks` thread inside a web process that a free instance spins
    down after fifteen minutes idle — an order of magnitude more time for the
    read to be interrupted, which is the failure this whole path exists to fix.
    """
    import threading

    width = pipeline_module._SYSTEMS_AT_ONCE
    crops = [f"crop-{i}".encode() for i in range(width)]
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: crops)
    barrier = threading.Barrier(width, timeout=10)

    class _AtTheSameTime:
        name = "concurrent"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            barrier.wait()
            return _system("concurrent", bars=2)

    score = parse_sheet_music(b"<page>", providers=[_AtTheSameTime()], retry=False)

    assert len(score.measures) == 2 * width, (
        "the barrier broke, so the systems were not read together"
    )


def test_more_systems_than_can_run_at_once_still_all_get_read(monkeypatch) -> None:
    """The pool is a width, not a limit on the page. Twelve systems with four
    threads is three rounds, and every crop has to come back — a page short by
    the systems that queued behind the pool would be a page with a hole in it,
    silently, which is the one outcome this path must never produce."""
    total = pipeline_module._SYSTEMS_AT_ONCE * 3
    crops = [f"crop-{i}".encode() for i in range(total)]
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: crops)
    seen: list[bytes] = []
    lock = __import__("threading").Lock()

    class _Counting:
        name = "counting"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            with lock:
                seen.append(image_bytes)
            return _system("counting", bars=2)

    score = parse_sheet_music(b"<page>", providers=[_Counting()], retry=False)

    assert sorted(seen) == sorted(crops), "not every system was read"
    assert len(score.measures) == 2 * total
    numbers = [m.measure_number for m in score.measures]
    assert numbers == list(range(1, len(numbers) + 1))


def test_the_systems_are_joined_in_page_order_not_completion_order(monkeypatch) -> None:
    """The one thing concurrency can break that sequential reading could not.

    `as_completed` yields whichever system finishes first, and a page assembled
    in that order is a page whose bars are shuffled — the notes are all there,
    every bar adds up, and the timeline compared against the recording is
    nonsense. Nothing downstream can notice. So results go into a list by
    index, never appended.
    """
    import threading

    crops = [b"first", b"second", b"third"]
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: crops)
    # The last crop finishes first, the first crop finishes last.
    order = {b"first": 0.06, b"second": 0.03, b"third": 0.0}
    pitches = {b"first": "C3", b"second": "D3", b"third": "E3"}

    class _OutOfOrder:
        name = "out-of-order"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            threading.Event().wait(order[image_bytes])
            payload = {
                **GOOD_PAYLOAD,
                "clef": "bass", "time_signature": "4/4", "ocr_confidence": 0.9,
                "repeats": [], "tempo_changes": [],
                "measures": [{
                    "measure_number": 1,
                    "notes": [{"pitch": pitches[image_bytes], "duration": "quarter"}] * 4,
                    "slurs": [],
                }],
            }
            return OCRResponse(
                score=ScoreJson.model_validate(payload), raw_text="{}",
                model="out-of-order", input_tokens=1, output_tokens=1,
                cost_usd=0.0, latency_ms=1,
            )

    score = parse_sheet_music(b"<page>", providers=[_OutOfOrder()], retry=False)

    assert [m.notes[0].pitch for m in score.measures] == ["C3", "D3", "E3"], (
        "the systems were joined in the order they came back, so the page is "
        "in the wrong order and every bar still adds up"
    )


def test_a_page_that_fails_early_does_not_pay_for_the_systems_behind_it(
    monkeypatch,
) -> None:
    """Cancellation, and it is money rather than correctness.

    A twelve-system page whose first line cannot be read is going to fall back
    to being read whole, so the eleven systems still queued behind the pool are
    eleven vision calls billed for a result that will be thrown away. Only
    *unstarted* work can be saved: the three lines already in flight alongside
    the failure are finished and discarded, which is why this waits on a
    quarter-second rather than asserting a call count on instant stubs.
    """
    import threading

    total = pipeline_module._SYSTEMS_AT_ONCE * 3
    crops = [f"crop-{i}".encode() for i in range(total)]
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: crops)
    started: list[bytes] = []
    lock = threading.Lock()

    class _FailsFirstAndSlowlyOtherwise:
        name = "slow"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            if image_bytes not in crops:
                return _system("slow", bars=9)  # the whole-page fallback
            with lock:
                started.append(image_bytes)
            if image_bytes == crops[0]:
                raise OCRProviderError("rate limited")
            threading.Event().wait(0.25)
            return _system("slow", bars=2)

    score = parse_sheet_music(
        b"<page>", providers=[_FailsFirstAndSlowlyOtherwise()], retry=False
    )

    assert len(score.measures) == 9, "the page was not read whole after the failure"
    # One more than the pool is wide, not exactly the pool: the failing read
    # returns instantly and frees its slot, and the pool hands that slot the
    # next crop before the main thread has collected the exception and
    # cancelled anything. That one extra is the race, and it is bounded —
    # everything that starts then blocks for a quarter-second, so no further
    # slot frees before the cancellation lands.
    assert len(started) <= pipeline_module._SYSTEMS_AT_ONCE + 1, (
        f"{len(started)} of {total} systems were read for a page that was "
        "going to be read whole anyway"
    )


def test_every_finished_system_moves_the_reported_step(monkeypatch) -> None:
    """Two jobs, and the second one is why this is not cosmetic.

    A musician watching a five-minute read needs the screen to keep saying
    something. And `transcription_runner._update` writes `updated_at` on every
    stage report, which is the column `sweep_stuck_transcriptions` compares
    against `STUCK_AFTER` — so these reports are what stop a long read being
    swept to `failed` while it is working. A page reporting once at the start
    would be killed at ten minutes with nothing wrong with it.
    """
    crops = [b"a", b"b", b"c", b"d", b"e"]
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: crops)
    seen: list[str] = []

    parse_sheet_music(
        b"<page>", providers=[_Recorder()], retry=False, on_stage=seen.append
    )

    counts = [s for s in seen if s.startswith(f"{pipeline_module.STAGE_READING}:system ")]
    assert counts == [
        f"{pipeline_module.STAGE_READING}:system {n} of {len(crops)}"
        for n in range(1, len(crops) + 1)
    ], counts


# ---- a crop with no music on it ------------------------------------------


def test_the_first_and_last_crop_may_hold_no_music(monkeypatch) -> None:
    """The crops tile the whole photograph, so the ones at the ends cover the
    page's margin, its title block and whatever the page was lying on.

    Measured on the real page: twelve crops, ten holding one system each and the
    first and last holding the desk. Treating those as failures sent the page
    back to be read whole — the fallback firing on every photograph with any
    edge in shot, which is nearly all of them.
    """
    crops = [b"desk", b"one", b"two", b"three", b"sliver"]
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: crops)

    class _EdgesAreBlank:
        name = "edges"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            if image_bytes in (b"desk", b"sliver"):
                return _system("edges", bars=0)
            return _system("edges", bars=2)

    score = parse_sheet_music(b"<page>", providers=[_EdgesAreBlank()], retry=False)

    assert len(score.measures) == 6, (
        "the page fell back to being read whole because its margin had no "
        f"notes on it: {len(score.measures)} measures"
    )
    numbers = [m.measure_number for m in score.measures]
    assert numbers == list(range(1, 7))


def test_a_crop_in_the_middle_with_no_music_sends_the_whole_page(monkeypatch) -> None:
    """The other half, and it is the difference between a margin and a hole.

    An interior crop has music above it and music below it, so one that comes
    back with no notes is a read that failed rather than an empty margin.
    Accepting it puts a hole in the page, and `alignment.py` accumulates
    durations — a missing line shifts every bar after it and the musician is
    told they rushed a passage they played correctly.
    """
    crops = [b"one", b"two", b"three", b"four"]
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: crops)

    class _MiddleIsBlank:
        name = "middle"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            if image_bytes not in crops:
                return _system("middle", bars=9)  # the whole-page fallback
            if image_bytes == b"three":
                return _system("middle", bars=0)
            return _system("middle", bars=2)

    score = parse_sheet_music(b"<page>", providers=[_MiddleIsBlank()], retry=False)

    assert len(score.measures) == 9, (
        "a page with a hole in the middle of it was returned"
    )


def test_a_page_where_nothing_reads_still_falls_back(monkeypatch) -> None:
    """Two crops, both at the edge by definition, both blank. There is no music
    anywhere, so `_read_systems` has nothing to return and the page goes through
    the whole-page loop — which is the path that reports an unreadable page in
    the provider's own words."""
    monkeypatch.setattr(pipeline_module, "crop_systems", lambda _b, *, source=None: [b"a", b"b"])

    class _AllBlank:
        name = "blank"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            if image_bytes in (b"a", b"b"):
                return _system("blank", bars=0)
            return _system("blank", bars=4)

    score = parse_sheet_music(b"<page>", providers=[_AllBlank()], retry=False)

    assert len(score.measures) == 4, "the whole-page fallback did not run"


def test_no_music_is_a_different_answer_from_could_not_read() -> None:
    """Why `NoMusicFound` is a subclass rather than a flag.

    A caller that does not know about it — every caller before the crops tiled
    the page — treats it exactly as the failure it is. And a *rate limit* on the
    first crop must not be mistaken for a blank margin: only "no notes" from
    every provider raises the subclass.
    """
    blank = ScoreJson.model_validate({
        **GOOD_PAYLOAD, "clef": "bass", "time_signature": "4/4",
        "ocr_confidence": 0.9, "repeats": [], "tempo_changes": [],
        "measures": [{"measure_number": 1, "notes": [], "slurs": []}],
    })

    class _Blank:
        name = "blank"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            return OCRResponse(
                score=blank, raw_text="{}", model="blank", input_tokens=1,
                output_tokens=1, cost_usd=0.0, latency_ms=1,
            )

    class _RateLimited:
        name = "limited"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            raise OCRProviderError("limited: rate limit reached")

    with pytest.raises(pipeline_module.NoMusicFound):
        parse_sheet_music(b"<jpeg>", providers=[_Blank()], retry=False)

    with pytest.raises(pipeline_module.OCRError) as failed:
        parse_sheet_music(b"<jpeg>", providers=[_RateLimited()], retry=False)
    assert not isinstance(failed.value, pipeline_module.NoMusicFound), (
        "a rate limit was reported as an empty margin, so a failed read of the "
        "first crop would be accepted as a page edge"
    )
    assert issubclass(pipeline_module.NoMusicFound, pipeline_module.OCRError)


def test_the_photograph_is_what_gets_cut_up(monkeypatch) -> None:
    """The pipeline has to hand the crop step the photograph, not the copy it is
    about to read. Detection is on the reduced page — cheap, and where every
    constant in the detector was measured — but a crop carved out of that page
    carries no more detail per system than the page did, which is the entire
    reason for cutting it up."""
    seen: dict = {}

    def _crops(image_bytes, *, source=None):
        seen["detected_on"] = image_bytes
        seen["cut_from"] = source
        return [b"a", b"b"]

    monkeypatch.setattr(pipeline_module, "crop_systems", _crops)

    parse_sheet_music(
        b"<reduced page>", providers=[_Recorder()], retry=False, source=b"<photograph>"
    )

    assert seen == {"detected_on": b"<reduced page>", "cut_from": b"<photograph>"}


def test_a_caller_with_only_the_prepared_page_still_works(monkeypatch) -> None:
    """`source` is optional, and its absence has to mean "cut what you were
    given" rather than "cut nothing"."""
    seen: dict = {}

    def _crops(image_bytes, *, source=None):
        seen["source"] = source
        return [b"a", b"b"]

    monkeypatch.setattr(pipeline_module, "crop_systems", _crops)

    score = parse_sheet_music(b"<page>", providers=[_Recorder()], retry=False)

    assert seen == {"source": None}
    assert score.measures, "the page was not read at all"


# ---- a provider that reads whole pages ------------------------------------


class _WholePage:
    """Stands in for homr: reads a page, refuses nothing, never sees a crop."""

    name = "engine"
    reads_whole_page = True

    def __init__(self, answer=None) -> None:
        self.answer = answer
        self.seen: list[bytes] = []

    def parse(self, image_bytes, mime_type="image/jpeg", note=None):
        self.seen.append(image_bytes)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer or _system("engine", bars=8)


def test_an_engine_gets_the_whole_page_and_never_a_crop(monkeypatch) -> None:
    """The routing that makes an OMR engine worth having.

    Everything else here is given one system at a time, because a
    vision-language model asked for four hundred notes in one answer returns a
    fraction of them. An engine has the opposite property — it finds and
    *dewarps* the staves itself, which is the reason to run it — so a crop
    throws away the part that works and pays for it in wall-clock too.
    """
    crops_cut: list[int] = []
    monkeypatch.setattr(
        pipeline_module,
        "crop_systems",
        lambda b, *, source=None: crops_cut.append(1) or [b"a", b"b", b"c"],
    )
    engine = _WholePage()

    score = parse_sheet_music(b"<the whole page>", providers=[engine], retry=False)

    assert engine.seen == [b"<the whole page>"], "it was handed something else"
    assert not crops_cut, "the page was cut up for an engine that reads pages"
    assert len(score.measures) == 8


def test_an_engine_that_cannot_read_the_page_hands_it_to_the_models(monkeypatch) -> None:
    """Never worse. homr finding no staves is a real outcome — a photograph too
    dark, or of something that is not music — and it must not cost the page.
    The vision chain still gets its turn, on crops, exactly as before.
    """
    monkeypatch.setattr(
        pipeline_module, "crop_systems", lambda b, *, source=None: [b"a", b"b"]
    )
    engine = _WholePage(answer=OCRProviderError("engine: found no staves"))
    models = _Recorder()

    score = parse_sheet_music(b"<page>", providers=[engine, models], retry=False)

    assert score.measures, "the page was lost when the engine could not read it"
    assert engine.seen == [b"<page>"]


def test_an_engine_alone_that_fails_reports_it_rather_than_reading_nothing(
    monkeypatch,
) -> None:
    """With nothing behind it there is nothing to fall back to, and the failure
    is the answer — not an empty page dressed up as one."""
    monkeypatch.setattr(
        pipeline_module, "crop_systems", lambda b, *, source=None: [b"a", b"b"]
    )
    engine = _WholePage(answer=OCRProviderError("engine: found no staves"))

    with pytest.raises(pipeline_module.OCRError, match="no staves"):
        parse_sheet_music(b"<page>", providers=[engine], retry=False)


def test_a_low_confidence_engine_reading_still_defers_to_the_models(monkeypatch) -> None:
    """`ocr_confidence` from homr is the share of its bars that add up, so a
    page it read badly falls under the gate — and the point of the gate is that
    something else then tries."""
    monkeypatch.setattr(
        pipeline_module, "crop_systems", lambda b, *, source=None: [b"a", b"b"]
    )
    doubtful = _system("engine", bars=8, conf=0.2)
    engine = _WholePage(answer=doubtful)
    models = _Recorder()

    score = parse_sheet_music(b"<page>", providers=[engine, models], retry=False)

    assert score.ocr_confidence > 0.2, "the doubtful reading was kept unchallenged"


def test_a_doubtful_engine_reading_is_kept_when_nothing_betters_it(monkeypatch) -> None:
    """A doubtful reading beats none, which is what the low-confidence fallback
    has always meant here. The engine's turn is not wasted just because the
    models could not improve on it."""
    monkeypatch.setattr(
        pipeline_module, "crop_systems", lambda b, *, source=None: [b"a", b"b"]
    )
    engine = _WholePage(answer=_system("engine", bars=8, conf=0.2))

    class _AllFail:
        name = "models"

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            raise OCRProviderError("models: rate limited")

    score = parse_sheet_music(
        b"<page>", providers=[engine, _AllFail()], retry=False
    )

    assert len(score.measures) == 8
    assert score.ocr_confidence == pytest.approx(0.2)
