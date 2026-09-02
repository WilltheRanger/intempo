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


def test_a_reply_that_does_not_actually_fix_the_bar_is_discarded(wired) -> None:
    """A model asked to fix one bar can return three that are worse. The page in
    hand is kept — it is a real reading with one known-bad bar, and that is
    better than a rewrite that sounds more confident and is not.

    **The first version of this test asserted the degraded bar was kept**, which
    is what the code did: the guard counted *how many* bars were broken, and a
    bar going from three beats to two leaves that count unchanged. So a reply
    that answered the question without improving the answer was accepted, and
    the page got worse while reporting the same number of problems.

    The rule is now **distance** from the metre rather than count — and it had
    to be, because a strict "must come back better" rule fails a test that is
    older and right: the re-read fixes pitches too, and a bar whose beats stay
    equally wrong may have had a notehead corrected. Equal distance is accepted;
    drifting further is not.
    """
    original = _score(4, 3, 4)
    # "Fixes" bar 2 from three beats to two: still wrong, and now more wrong.
    helper = wired(_score(4, 2, 4))

    out = _retry(original, helper)

    assert [len(m.notes) for m in out.measures] == [4, 3, 4]
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


# ---------------------------------------------------------------------------
# Showing it the line, not the page
# ---------------------------------------------------------------------------
#
# Naming a bar on a whole page asks a model to count to it. A miscount produces
# a *plausible* correction for the wrong bar, which every guard here accepts
# because it adds up — so this is the one failure mode arithmetic cannot catch,
# and cropping removes it instead of detecting it.


def _score_on_systems(layout: dict[int, int | None], beats: dict[int, int]) -> ScoreJson:
    return ScoreJson(
        time_signature="4/4",
        clef="bass",
        ocr_confidence=1.0,
        measures=[
            Measure(
                measure_number=n,
                system=layout[n],
                notes=[Note(pitch="D3", duration="quarter") for _ in range(beats[n])],
            )
            for n in sorted(layout)
        ],
    )


def _by_system(score, crops, helper):
    from app.services.ocr.confirm import retry_by_system

    return retry_by_system(score, crops, media_type="image/jpeg", provider=helper)


def test_the_crop_for_the_line_the_broken_bar_is_on_is_the_one_sent(wired) -> None:
    """Bar 4 is on line 1, so line 1's crop is what the model sees."""
    layout = {1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1}
    score = _score_on_systems(layout, {1: 4, 2: 4, 3: 4, 4: 3, 5: 4, 6: 4})
    fixed = _score_on_systems(layout, {1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4})
    helper = wired(fixed)
    helper.seen: list[bytes] = []
    parse = helper.parse

    def record(image_bytes, mime_type="image/jpeg", note=None):
        helper.seen.append(image_bytes)
        return parse(image_bytes, mime_type, note)

    helper.parse = record

    out = _by_system(score, [b"<line-0>", b"<line-1>"], helper)

    assert helper.seen == [b"<line-1>"], "the wrong line was sent"
    assert [f.verdict for f in validate_measures(out)] == ["ok"] * 6


def test_the_model_is_told_the_bar_numbers_are_the_page_s(wired) -> None:
    """**Without this the correction lands on the wrong bar.**

    A model shown a crop numbers what it sees from 1 unless told otherwise, and
    the bars being asked about are numbered as the page numbers them. `_splice`
    matches on those numbers, so a reply renumbered from 1 either patches bar 1
    or matches nothing at all.
    """
    layout = {1: 0, 2: 0, 3: 1, 4: 1}
    score = _score_on_systems(layout, {1: 4, 2: 4, 3: 3, 4: 4})
    helper = wired(_score_on_systems(layout, {1: 4, 2: 4, 3: 4, 4: 4}))

    _by_system(score, [b"<line-0>", b"<line-1>"], helper)

    asked = helper.asked[0]
    assert "bars 3 to 4" in asked
    assert "do not renumber" in asked
    assert "measure 3" in asked


def test_a_crop_count_that_disagrees_with_the_reading_sends_nothing(wired) -> None:
    """**Two independent opinions about how many lines are on the page.**

    `crop_systems` cuts by ink density; `Measure.system` comes from
    `<print new-system="yes">`. When they disagree there is no way to tell which
    is right, and sending the wrong crop is worse than sending the page — the
    model would be shown music that is not the bar and asked to correct it. So
    it does nothing and the caller falls back.
    """
    layout = {1: 0, 2: 0, 3: 1, 4: 1}
    score = _score_on_systems(layout, {1: 4, 2: 4, 3: 3, 4: 4})
    helper = wired(_score_on_systems(layout, {1: 4, 2: 4, 3: 4, 4: 4}))

    out = _by_system(score, [b"a", b"b", b"c"], helper)

    assert helper.asked == [], "it asked despite not knowing which crop to send"
    assert out is score


def test_a_reading_with_no_layout_sends_nothing(wired) -> None:
    """Most exports carry no `<print new-system="yes">` at all, so every bar's
    `system` is None. That is honestly "not known", and the caller falls back to
    the whole page — the behaviour that existed before crops."""
    layout = {1: None, 2: None, 3: None}
    score = _score_on_systems(layout, {1: 4, 2: 3, 3: 4})
    helper = wired(_score_on_systems(layout, {1: 4, 2: 4, 3: 4}))

    out = _by_system(score, [b"a", b"b"], helper)

    assert helper.asked == []
    assert out is score


def test_one_bad_line_does_not_discard_another_line_s_correction(wired) -> None:
    """The better-or-nothing check runs per line rather than once at the end.

    A model that ruins line 1 and repairs line 0 should leave line 0 repaired;
    judging the whole page at the end would throw both away together.
    """
    # Bar 2 and bar 3 are the broken ones, one per line. **Not bar 1**: a short
    # first bar is a pickup, which is legitimate notation and not a problem, so
    # a fixture that breaks bar 1 gives line 0 nothing to correct and the test
    # passes for the wrong reason. It did, until the run was traced.
    layout = {1: 0, 2: 0, 3: 1, 4: 1}
    score = _score_on_systems(layout, {1: 4, 2: 3, 3: 3, 4: 4})

    replies = iter(
        [
            _score_on_systems(layout, {1: 4, 2: 4, 3: 3, 4: 4}),  # line 0 fixed
            _score_on_systems(layout, {1: 4, 2: 4, 3: 1, 4: 4}),  # line 1 made worse
        ]
    )
    helper = wired(_score_on_systems(layout, {1: 4, 2: 4, 3: 4, 4: 4}))

    def reply(image_bytes, mime_type="image/jpeg", note=None):
        helper.asked.append(note or "")
        helper.reply = next(replies)
        return _Corrector.parse(helper, image_bytes, mime_type, note)

    helper.parse = reply

    out = _by_system(score, [b"<line-0>", b"<line-1>"], helper)

    assert len(out.measures[1].notes) == 4, "line 0's repair was thrown away"
    assert len(out.measures[2].notes) == 3, "line 1's damage was kept instead of refused"


# ---------------------------------------------------------------------------
# Telling it what it is looking at
# ---------------------------------------------------------------------------


def _keyed(key: str | None, clef: str | None = "bass", metre: str | None = "4/4") -> ScoreJson:
    return ScoreJson(
        time_signature=metre,
        key_signature=key,
        clef=clef,
        ocr_confidence=1.0,
        measures=[
            Measure(
                measure_number=n,
                notes=[Note(pitch="D3", duration="quarter") for _ in range(4)],
            )
            for n in (1, 2, 3)
        ],
    )


def test_the_key_is_stated_because_it_decides_the_pitch_names() -> None:
    """**The one reading error arithmetic cannot see.**

    `pitch` is an absolute name, so a notehead on the F line in D major is
    `F#4`. A bar spelled in the wrong key sums perfectly and is still wrong —
    and a tie is recognised only when two noteheads share a pitch name, so one
    mis-spelled accidental deletes an onset rather than merely looking odd.
    """
    from app.services.ocr.confirm import what_this_piece_is

    said = what_this_piece_is(_keyed("D major"), [2])

    assert "D major" in said
    assert "accidental the key gives it" in said


def test_the_clef_is_stated_too() -> None:
    """A bass part read as treble is a seventh out on every note, which is the
    mistake `ScoreJson.clef` is documented never to guess at."""
    from app.services.ocr.confirm import what_this_piece_is

    assert "bass-clef" in what_this_piece_is(_keyed("D major"), [2])


def test_nothing_is_invented_when_the_page_states_nothing() -> None:
    """An inner page often carries no header at all. Naming a key to sound
    authoritative is how a wrong note gets written confidently."""
    from app.services.ocr.confirm import what_this_piece_is

    assert what_this_piece_is(_keyed(None, clef=None, metre=None), [2]) == ""


def test_an_unknown_key_is_not_repeated_back_as_a_key() -> None:
    """"unknown" is the escape hatch the prompt offers for an illegible header.
    Handing it back as `in unknown` would be asking the model to spell the
    accidentals of a key called unknown."""
    from app.services.ocr.confirm import what_this_piece_is

    said = what_this_piece_is(_keyed("unknown"), [2])

    assert "unknown" not in said
    assert "accidental the key gives it" not in said


def test_the_metre_is_the_one_in_force_at_those_bars() -> None:
    """**Not the header's.** A page that turns 3/4 at bar 3 and is re-read
    against the 4/4 it started in has its correct bars reported short — the
    false caveat `Measure.time_signature` was added to stop."""
    from app.services.ocr.confirm import what_this_piece_is

    score = _keyed("D major")
    score.measures[2].time_signature = "3/4"

    assert "in 3/4" in what_this_piece_is(score, [3])
    assert "in 4/4" in what_this_piece_is(score, [2])


def test_the_corrector_is_on_by_default() -> None:
    """**This asserted the opposite yesterday**, and the reason it did was
    sound: a metered call per page is a decision about a bill and not one to
    make on someone's behalf. The owner made it on 2026-08-30 — *"Im fine with
    the api costs"* — so the default moved and the test with it.

    It costs nothing on a page that reads cleanly: the retry runs only where
    `validate.py` has already found bars that do not add up.
    """
    from app.config import settings

    assert settings.OCR_CORRECTOR == "claude-sonnet-5"


def test_the_key_is_the_one_in_force_at_those_bars() -> None:
    """**Not the header's**, exactly as the metre is not.

    A part that turns from B-flat to G at bar 2 and is re-read in B-flat gets
    every F in the crop back spelled `F3` where the page prints `F#3` — a bar
    that adds up perfectly, in the wrong key, with a tie the pitch mismatch has
    silently deleted. The real photograph in `audiveris_phone_photo` does this
    at its bar 7.
    """
    from app.services.ocr.confirm import what_this_piece_is

    score = _keyed("Bb major")
    score.measures[1].key_signature = "G major"

    assert "in G major" in what_this_piece_is(score, [2])
    assert "in G major" in what_this_piece_is(score, [3])
    assert "in Bb major" in what_this_piece_is(score, [1])


def test_bars_that_straddle_a_key_change_name_no_key_at_all() -> None:
    """Naming one of the two would be wrong for the other half of the crop, and
    the model is being told to spell every pitch against it. The metre already
    drops its sentence the same way when the bars disagree."""
    from app.services.ocr.confirm import what_this_piece_is

    score = _keyed("Bb major")
    score.measures[1].key_signature = "G major"

    said = what_this_piece_is(score, [1, 2])

    assert "Bb major" not in said
    assert "G major" not in said
    # The clef is still worth saying — it did not change.
    assert "bass-clef" in said
