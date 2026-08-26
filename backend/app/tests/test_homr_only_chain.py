"""homr alone, with no vision model behind it.

The owner's decision on 2026-08-24: *"run homr only, no backup AI."* The models
were the backup and they were the thing inventing notes — on the one page
measured against both, homr read 74 measures and 267 notes with 73 of 74 bars
adding up, against the vision chain's 59 and 112, and when homr never ran at
all the chain returned a page of notes nobody had read at 0.40 confidence which
the app displayed as a transcription.

**The cost is real and is the point of most of this file.** homr is installed
only in the Modal container, so a host without it can no longer read a page at
all. What must not happen is that arriving as `_UNKNOWN_REASON` — *"a flatter,
better-lit shot of the page usually fixes it"* — which sends a musician to
re-photograph a page for a fault that is entirely ours. This project has
shipped that sentence for a server fault twice.
"""

from __future__ import annotations

import pytest

from app.services.ocr.pipeline import PROVIDER_REGISTRY, _default_chain
from app.workers import transcription_runner as runner


def _chain_names(monkeypatch, value: str) -> list[str]:
    from app.config import settings

    monkeypatch.setattr(settings, "OCR_PROVIDER_CHAIN", value)
    return [p.name for p in _default_chain()]


def test_the_shipped_default_is_homr_and_nothing_else() -> None:
    """What a deployment gets when it sets nothing.

    Read out of the source rather than by constructing `Settings`. The default
    is baked by `os.getenv` when `app.config` is first imported, and
    `load_dotenv()` runs before that — so a developer's own `backend/.env`
    decides what a constructed `Settings` says, and this test would then be
    reporting the local machine rather than the shipped default. The first
    version of it did exactly that and passed for the wrong reason.
    """
    import re
    from pathlib import Path

    source = (Path(__file__).resolve().parents[1] / "config.py").read_text()
    match = re.search(
        r'OCR_PROVIDER_CHAIN:\s*str\s*=\s*os\.getenv\(\s*"OCR_PROVIDER_CHAIN",\s*"([^"]*)"',
        source,
    )
    assert match, "could not find the OCR_PROVIDER_CHAIN default in config.py"
    assert match.group(1) == "homr", (
        f"a deployment that sets nothing would run {match.group(1)!r}"
    )


def test_an_empty_setting_means_homr_not_the_models(monkeypatch) -> None:
    """An explicitly empty value used to fall back to two Claude models. That
    was the backup, and the backup is what is being removed."""
    assert _chain_names(monkeypatch, "") == ["homr"]
    assert _chain_names(monkeypatch, "   ") == ["homr"]


def test_the_models_are_still_reachable_by_name(monkeypatch) -> None:
    """Removed from the *default*, not from the build.

    A deployment that wants them back sets one variable. Deleting the
    providers would make that a code change and a deploy, and the decision
    being reversible is part of why it is safe to make.
    """
    assert "claude-sonnet-5" in PROVIDER_REGISTRY
    assert "gemini-2.5-flash" in PROVIDER_REGISTRY
    assert _chain_names(monkeypatch, "homr,claude-sonnet-5") == ["homr", "claude-sonnet-5"]


def test_the_modal_image_ships_the_same_chain() -> None:
    """The container is the only place homr exists, so its chain is the one
    that decides what actually reads a page. It carried the four-name chain and
    would have gone on using the models behind homr."""
    from pathlib import Path

    source = (Path(__file__).resolve().parents[2] / "modal_app.py").read_text()

    assert '"OCR_PROVIDER_CHAIN": "homr"' in source, (
        "the reading container still names a model behind homr"
    )


# ---- what a host with no reader in it must say -----------------------------


class _Absent:
    name = "homr"

    def available(self) -> bool:
        return False


class _Present:
    name = "homr"

    def available(self) -> bool:
        return True


class _OverTheNetwork:
    """A provider reached with a key. Whether it works is not knowable here."""

    name = "claude-sonnet-5"


def test_a_process_with_no_provider_installed_knows_it(monkeypatch) -> None:
    monkeypatch.setattr(runner, "_default_chain", lambda: [_Absent()], raising=False)
    monkeypatch.setattr(
        "app.services.ocr.pipeline._default_chain", lambda: [_Absent()]
    )

    assert runner._nothing_here_can_read() is True


def test_a_process_that_has_homr_is_not_stopped(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.ocr.pipeline._default_chain", lambda: [_Present()]
    )

    assert runner._nothing_here_can_read() is False


def test_a_provider_reached_over_the_network_is_never_declared_absent(
    monkeypatch,
) -> None:
    """Only a provider that says outright it is not here counts. A model is
    reached with a key over the network, and whether that call will work is not
    something this process can answer — guessing would refuse pages that would
    have read."""
    monkeypatch.setattr(
        "app.services.ocr.pipeline._default_chain",
        lambda: [_Absent(), _OverTheNetwork()],
    )

    assert runner._nothing_here_can_read() is False


def test_an_unresolvable_chain_does_not_refuse(monkeypatch) -> None:
    """`_default_chain` raising is reported by `/v1/ready` and is a different
    fault. Turning it into "we cannot read here" would put a wrong reason in
    front of a musician."""

    def _boom() -> list:
        raise RuntimeError("chain cannot be resolved")

    monkeypatch.setattr("app.services.ocr.pipeline._default_chain", _boom)

    assert runner._nothing_here_can_read() is False


def test_it_refuses_before_the_page_is_downloaded(monkeypatch) -> None:
    """The whole reason the check is where it is.

    Downloading several megabytes to discover that the only provider named is
    not installed pays for the download to arrive at a *worse* error: "homr is
    not installed in this container" matches no entry in `_FAILURE_REASONS` and
    lands on the sentence that blames the photograph.
    """
    from app.tests.fake_supabase import FakeSupabase

    fetched: list[str] = []
    monkeypatch.setattr(
        "app.services.ocr.pipeline._default_chain", lambda: [_Absent()]
    )
    monkeypatch.setattr(runner, "readable_url", lambda url: fetched.append(url) or url)
    monkeypatch.setattr(
        runner, "download_image", lambda url: fetched.append("downloaded") or b""
    )

    fake = FakeSupabase()
    fake.seed("scores", [{"id": "s1", "transcription_status": "queued"}])

    runner._read_pages(fake, "s1", ["https://example.test/page.jpg"])

    assert fetched == [], "the page was downloaded before we knew we could read it"
    row = fake.table("scores").rows[0]
    assert row["transcription_status"] == "failed"
    assert row["transcription_error"] == runner._NO_READER_HERE


def test_the_reason_blames_us_and_not_the_photograph() -> None:
    """The sentence itself, because the sentence is the deliverable.

    `_UNKNOWN_REASON` — "A flatter, better-lit shot of the page usually fixes
    it" — is a confident wrong reason for a server fault, and a musician will
    act on it, and it will fail again.
    """
    said = runner._NO_READER_HERE.lower()

    assert "our side" in said or "fault on our" in said
    assert "flatter" not in said and "better-lit" not in said
    # The photograph survives a failed read, so "again" is a button and not a
    # trip back to the music stand.
    assert "photograph is still here" in said
    assert "again" in said


def test_the_same_answer_arrives_even_if_the_pipeline_is_reached() -> None:
    """A backstop for the path this does not guard — a chain resolved
    differently inside `parse_sheet_music`, or a provider that reports itself
    available and then finds it is not."""
    reason = runner._why_it_failed(
        "all providers failed: homr: OCRProviderError: homr: homr is not "
        "installed in this container"
    )

    assert reason != runner._UNKNOWN_REASON
    assert "fault on our side" in reason.lower() or "our side" in reason.lower()


@pytest.mark.parametrize(
    "detail",
    [
        "homr is not installed in this container",
        "HOMR IS NOT INSTALLED IN THIS CONTAINER",
        "all providers failed: homr: not installed",
    ],
)
def test_the_backstop_matches_however_it_is_written(detail: str) -> None:
    assert runner._why_it_failed(detail) != runner._UNKNOWN_REASON


# ---------------------------------------------------------------------------
# Every way homr can find nothing says which nothing it found
# ---------------------------------------------------------------------------


def test_a_page_with_no_noteheads_is_not_blamed_on_the_photograph() -> None:
    """homr raises `Exception("No noteheads found")` once its segmentation has
    found staff-line ink and its notehead model has found none at all.

    Measured on `05_handwritten_messy`, and pre-processing it — 2x upscale,
    autocontrast, both — moved it not at all. It is a limit of a model trained
    on printed notation, so *"a flatter, better-lit shot of the page usually
    fixes it"* is advice for a page that cannot get past this however well it
    is photographed. That default has now been reached wrongly five times in
    this file's history and every one of them was a missing needle.
    """
    reason = runner._why_it_failed("homr: Exception: No noteheads found")

    assert reason != runner._UNKNOWN_REASON
    assert "flatter" not in reason and "better-lit" not in reason
    assert "handwritten" in reason.lower()
    # Name a route that exists. The 413 message named a camera setting the
    # scanner does not have; this one may only offer what the app can do.
    assert "MusicXML" in reason and "by hand" in reason


def test_a_page_with_no_staves_still_gets_the_photograph_advice() -> None:
    """The other side of the same line, and the reason this is a *separate*
    needle rather than one that matches both.

    "No staffs found" is raised after the notehead check, so it is what a page
    lying on its side actually produces — measured: `01_simple_printed` turned
    90 degrees reads zero staffs while its noteheads are still found. That page
    is re-tried turned by `_read_at_any_orientation`, and if it still fails,
    the photograph really is the thing to change: a sideways, dark, cropped or
    non-musical page all land here. The default sentence is correct for it, and
    widening the noteheads needle to cover it would replace right advice with
    wrong.
    """
    assert (
        runner._why_it_failed("homr: found no staves on this page")
        == runner._UNKNOWN_REASON
    )


# ---------------------------------------------------------------------------
# Orientation: homr decides, not a heuristic
# ---------------------------------------------------------------------------


def test_a_page_homr_reads_costs_exactly_one_pass(tmp_path, monkeypatch) -> None:
    """The page that arrives correct — which is every page whose EXIF tag is
    honoured — must not pay for the retry."""
    from app.services.ocr import homr_provider as module

    seen: list[str] = []
    monkeypatch.setattr(
        module.HomrProvider, "_run", lambda self, page: seen.append(page.name) or "<xml/>"
    )
    page = tmp_path / "page.jpg"
    page.write_bytes(b"x")

    assert module.homr_provider._read_at_any_orientation(page) == "<xml/>"
    assert seen == ["page.jpg"], "an upright page was turned"


def test_a_page_homr_cannot_segment_is_turned_and_offered_again(
    tmp_path, monkeypatch
) -> None:
    """**Why this replaced a heuristic.** Guessing the orientation from ink
    profiles got it wrong on the first real photograph: EXIF had already put
    that page the right way up, and rotating it took homr from 5 staffs, 25
    measures and 112 notes to none at all. homr's own "No staffs found" is a
    far better signal than counting bands."""
    from PIL import Image

    from app.services.ocr import homr_provider as module
    from app.services.ocr.base import OCRProviderError

    page = tmp_path / "page.jpg"
    Image.new("RGB", (40, 30), "white").save(page)

    attempts: list[str] = []

    def _run(self, path):
        attempts.append(path.name)
        if len(attempts) == 1:
            raise OCRProviderError("homr: Exception: No staffs found")
        return "<xml/>"

    monkeypatch.setattr(module.HomrProvider, "_run", _run)

    assert module.homr_provider._read_at_any_orientation(page) == "<xml/>"
    assert len(attempts) == 2
    assert "turned" in attempts[1]


def test_a_failure_turning_the_page_cannot_fix_is_not_retried(
    tmp_path, monkeypatch
) -> None:
    """A container without homr, a missing model, an unreadable file. Turning
    the page helps none of them, and trying twice doubles a failure rather than
    fixing it — on a worker that is billed by the second."""
    from PIL import Image

    from app.services.ocr import homr_provider as module
    from app.services.ocr.base import OCRProviderError

    attempts: list[str] = []

    def _run(self, path):
        attempts.append(path.name)
        raise OCRProviderError("homr: homr is not installed in this container")

    monkeypatch.setattr(module.HomrProvider, "_run", _run)
    # A page that genuinely *can* be turned. Written as raw bytes it could not
    # be, so the loop skipped the rotations for that reason instead of this
    # one — and a mutation removing the check survived.
    page = tmp_path / "page.jpg"
    Image.new("RGB", (40, 30), "white").save(page)

    with pytest.raises(OCRProviderError):
        module.homr_provider._read_at_any_orientation(page)

    assert len(attempts) == 1


def test_the_first_failure_is_the_one_reported(tmp_path, monkeypatch) -> None:
    """After turning it twice and failing, the musician should be told what
    happened to their page as it was, not to the third rotation of it."""
    from PIL import Image

    from app.services.ocr import homr_provider as module
    from app.services.ocr.base import OCRProviderError

    page = tmp_path / "page.jpg"
    Image.new("RGB", (40, 30), "white").save(page)

    def _run(self, path):
        raise OCRProviderError(f"homr: No staffs found in {path.name}")

    monkeypatch.setattr(module.HomrProvider, "_run", _run)

    with pytest.raises(OCRProviderError) as caught:
        module.homr_provider._read_at_any_orientation(page)

    assert "page.jpg" in str(caught.value)
    assert "turned" not in str(caught.value)


# ---------------------------------------------------------------------------
# A provider that cannot reconsider is not asked twice
# ---------------------------------------------------------------------------


def _doubtful_score():
    from app.services.score_schema import Measure, Note, ScoreJson

    return ScoreJson(
        time_signature="4/4",
        clef="bass",
        measures=[
            Measure(
                measure_number=1,
                notes=[Note(pitch="D3", duration="quarter") for _ in range(4)],
            ),
            Measure(measure_number=2, notes=[Note(pitch="D3", duration="quarter")]),
        ],
        ocr_confidence=0.5,
    )


class _Counting:
    """A provider that records how many times it was asked to read."""

    name = "counting"
    reads_whole_page = True

    def __init__(self, *, takes_a_note: bool) -> None:
        self.takes_a_note = takes_a_note
        self.reads = 0

    def available(self) -> bool:
        return True

    def parse(self, image_bytes, mime_type="image/jpeg", note=None):
        from app.services.ocr.base import OCRResponse

        self.reads += 1
        return OCRResponse(
            score=_doubtful_score(), raw_text="", model=self.name,
            input_tokens=0, output_tokens=0, cost_usd=0.0, latency_ms=1,
        )


def test_homr_is_not_asked_to_re_read_a_page_it_cannot_re_read() -> None:
    """**Measured, not assumed: the same page read twice returns byte-identical
    MusicXML, and the second read costs 14.5 seconds.**

    `retry_with_arithmetic` was written for a model you can talk to — it hands
    the reading's own beat sums back with the offending measures named. homr
    has no prompt (`parse` accepts a `note` and ignores it) and is
    deterministic, so the retry is the same computation on the same bytes. On
    Modal that is a second 2.5 GB container spent to reproduce an answer that
    could not differ, on exactly the pages that are already the slowest.
    """
    from app.services.ocr import pipeline

    provider = _Counting(takes_a_note=False)
    try:
        pipeline.parse_sheet_music(b"x", providers=[provider])
    except Exception:
        pass

    assert provider.reads == 1, (
        f"the page was read {provider.reads} times by a provider whose second "
        "reading cannot differ from its first"
    )


def test_a_provider_that_can_be_talked_to_is_still_asked_again() -> None:
    """The other side of the line, and the reason the default is `True`: a
    vision model handed its own arithmetic back really can fix a bar, which is
    the whole point of `confirm.py`. A new provider has to opt out
    deliberately."""
    from app.services.ocr import pipeline

    provider = _Counting(takes_a_note=True)
    try:
        pipeline.parse_sheet_music(b"x", providers=[provider])
    except Exception:
        pass

    assert provider.reads > 1, "a provider that can reconsider was never asked to"


def test_a_provider_that_says_nothing_is_asked_again() -> None:
    """**The default, tested on a provider that does not declare it** — which
    is every vision provider in the registry, none of which has ever heard of
    this attribute.

    `_Counting` sets it explicitly either way, so it exercises the flag and
    never the fallback: the mutation making the default opt-in passed against
    it, silencing the retry for the whole chain. A rule's default has to be
    tested on something that does not state it.
    """
    from app.services.ocr import pipeline

    class _Silent:
        name = "silent"
        reads_whole_page = True

        def __init__(self) -> None:
            self.reads = 0

        def available(self) -> bool:
            return True

        def parse(self, image_bytes, mime_type="image/jpeg", note=None):
            from app.services.ocr.base import OCRResponse

            self.reads += 1
            return OCRResponse(
                score=_doubtful_score(), raw_text="", model=self.name,
                input_tokens=0, output_tokens=0, cost_usd=0.0, latency_ms=1,
            )

    assert not hasattr(_Silent, "takes_a_note")
    provider = _Silent()
    try:
        pipeline.parse_sheet_music(b"x", providers=[provider])
    except Exception:
        pass

    assert provider.reads > 1, "a provider that says nothing was silently skipped"


def test_homr_declares_that_it_cannot_reconsider() -> None:
    """The flag is only worth having if the one provider it exists for sets
    it, and nothing else in the suite reads homr's own value."""
    from app.services.ocr.homr_provider import homr_provider

    assert homr_provider.takes_a_note is False


def test_homr_never_looks_like_a_truncated_answer() -> None:
    """`_is_truncation` matches the phrase "cut off", which `claude_provider`
    and `gemini_provider` both use for running out of output room. That string
    is a contract between three files and nothing held homr to it.

    A homr failure that matched would be retried as though half an answer had
    arrived — and, in `_FAILURE_REASONS`, told the musician to photograph fewer
    bars at a time, which is advice about an output cap homr does not have.
    """
    from app.services.ocr.pipeline import _is_truncation

    for said in (
        "homr: Exception: No noteheads found",
        "homr: found no staves on this page",
        "homr: none of the 3 bars on this page could be read as music",
        "homr: 5 of the 7 bars on this page came out empty",
        "homr: found no bars of music on this page",
        "homr: homr is not installed in this container",
        "homr: unsupported media type 'image/heic'; it reads .jpg, .png, .webp",
    ):
        assert not _is_truncation(Exception(said)), said
