"""A part that is more than one page, read by the worker.

The rules under test are `pages_of` — which shape of row means which pages —
and the all-or-nothing property of the read. Both are in the worker rather
than in a screen, and both are here rather than only in production, because
this project's own history is that a rule which runs only on a real host with
a real page is a rule nothing checks.
"""

from __future__ import annotations

import pytest

from app.workers import transcription_runner as runner


# ---------------------------------------------------------------------------
# Which pages a row means
# ---------------------------------------------------------------------------


def test_the_array_is_the_answer_where_it_exists() -> None:
    assert runner.pages_of(
        {"source_image_url": "one.jpg", "source_image_urls": ["a.jpg", "b.jpg"]}
    ) == ["a.jpg", "b.jpg"]


def test_the_array_wins_over_the_column_and_that_is_the_point() -> None:
    """**Not merely a preference — the other order loses pages.**

    A deployment mid-rollout writes both: page one into `source_image_url`, so
    an older worker still finds something, and every page into
    `source_image_urls`. Reading the single column first would read page one
    of a three-page part on a database that holds all three.
    """
    row = {"source_image_url": "page1.jpg", "source_image_urls": ["p1", "p2", "p3"]}

    assert runner.pages_of(row) == ["p1", "p2", "p3"]


def test_a_row_written_before_the_migration_still_reads() -> None:
    """Every scan in the library today, and every scan on a deployment that
    has not applied 011 yet."""
    assert runner.pages_of({"source_image_url": "only.jpg"}) == ["only.jpg"]
    assert runner.pages_of(
        {"source_image_url": "only.jpg", "source_image_urls": None}
    ) == ["only.jpg"]


def test_a_piece_entered_by_hand_has_no_pages() -> None:
    assert runner.pages_of({}) == []
    assert runner.pages_of({"source_image_url": None, "source_image_urls": []}) == []


def test_a_blank_entry_in_the_array_is_not_a_page() -> None:
    """A NULL that reached the array is not a photograph, and handing it to
    `download_image` would fail the whole part over a row somebody edited."""
    assert runner.pages_of({"source_image_urls": ["a.jpg", None, "", "b.jpg"]}) == [
        "a.jpg",
        "b.jpg",
    ]


# ---------------------------------------------------------------------------
# All-or-nothing, and the failure names the page
# ---------------------------------------------------------------------------


class _Rows:
    """The two writes the worker makes, recorded."""

    def __init__(self) -> None:
        self.patches: list[dict] = []

    def table(self, _name):
        return self

    def update(self, patch):
        self.patches.append(patch)
        return self

    def eq(self, *_a, **_k):
        return self

    def execute(self):
        return self

    @property
    def finished(self) -> dict:
        return self.patches[-1]


@pytest.fixture()
def worker(monkeypatch):
    """`_read_one_page`, replaced by a script of outcomes, one per page."""

    def _install(outcomes: list[object]):
        seen: list[int] = []

        def _read_one_page(client, score_id, image_url, page_number, total):
            seen.append(page_number)
            outcome = outcomes[page_number - 1]
            if outcome is None:
                runner._fail(client, score_id, f"Page {page_number} of {total}: no.")
            return outcome

        monkeypatch.setattr(runner, "_read_one_page", _read_one_page)
        monkeypatch.setattr(runner, "_nothing_here_can_read", lambda: False)
        return seen

    return _install


def _score(measures: int, number_from: int = 1):
    from app.services.score_schema import Measure, Note, ScoreJson

    return ScoreJson(
        time_signature="4/4",
        clef="bass",
        measures=[
            Measure(
                measure_number=number_from + i,
                notes=[Note(pitch="D3", duration="quarter") for _ in range(4)],
            )
            for i in range(measures)
        ],
        ocr_confidence=1.0,
    )


def test_three_pages_become_one_score(worker) -> None:
    rows = _Rows()
    seen = worker([_score(2), _score(3), _score(1)])

    runner._read_pages(rows, "s1", ["a", "b", "c"])

    assert seen == [1, 2, 3]
    assert rows.finished["transcription_status"] == "done"
    assert len(rows.finished["score_json"]["measures"]) == 6


def test_a_page_that_fails_stops_the_scan_there(worker) -> None:
    """**All-or-nothing.** A score built from pages 1 and 3 is a timeline with
    a silent hole where page 2 was, and `alignment.py` accumulates durations —
    so every bar after the gap is judged against music that is not there and
    the musician is told they rushed a passage they played correctly.

    Stopping also means page 3 is never fetched, which is the cheap half of
    the same decision.
    """
    rows = _Rows()
    seen = worker([_score(2), None, _score(1)])

    runner._read_pages(rows, "s1", ["a", "b", "c"])

    assert seen == [1, 2], "it went on reading after a page had already failed"
    assert rows.finished["transcription_status"] == "failed"
    assert "Page 2 of 3" in rows.finished["transcription_error"]


# ---------------------------------------------------------------------------
# The real `_read_one_page`, not a stand-in for it
# ---------------------------------------------------------------------------
#
# The tests above replace `_read_one_page` wholesale, which is right for
# sequencing — they are about what `_read_pages` does with the answers — and
# wrong for anything the real function decides. A first version asserted the
# page was named in the failure and passed against a stub that did the naming
# itself: a double more permissive than the real thing agrees with the code
# instead of testing it, which is the same mistake that let
# `ProcessingConfig()` ship with no arguments.


@pytest.fixture()
def one_page(monkeypatch):
    """Everything under `_read_one_page`, replaced at the module boundary."""

    def _install(*, fails: bool = False):
        stages: list[str | None] = []
        monkeypatch.setattr(runner, "readable_url", lambda url: url)
        monkeypatch.setattr(runner, "download_image", lambda url: b"<page>")
        monkeypatch.setattr(runner, "too_small_to_read", lambda _b: None)
        monkeypatch.setattr(
            runner, "prepare_for_model", lambda _b: (b"<page>", "image/jpeg")
        )

        def parse(page, media_type, on_stage, source):
            on_stage("splitting")
            if fails:
                raise runner.OCRError("homr: Exception: No noteheads found")
            return _score(1)

        monkeypatch.setattr(runner, "parse_sheet_music", parse)

        real_update = runner._update

        def _update(client, score_id, patch):
            if "transcription_stage" in patch:
                stages.append(patch["transcription_stage"])
            return real_update(client, score_id, patch)

        monkeypatch.setattr(runner, "_update", _update)
        return stages

    return _install


def test_a_failure_on_page_two_of_three_says_so(one_page) -> None:
    """The musician re-photographs one page. Which page is the whole of the
    advice, and an unnamed failure makes them re-shoot all three."""
    rows = _Rows()
    one_page(fails=True)

    assert runner._read_one_page(rows, "s1", "b.jpg", 2, 3) is None
    assert "Page 2 of 3" in rows.finished["transcription_error"]
    # And the sentence that follows it is still the one about the page.
    assert "handwritten" in rows.finished["transcription_error"].lower()


def test_a_one_page_scan_is_not_labelled_page_one_of_one(one_page) -> None:
    """Noise in front of every error message in the app, on the shape of scan
    that is still the common one."""
    rows = _Rows()
    one_page(fails=True)

    runner._read_one_page(rows, "s1", "a.jpg", 1, 1)

    assert not rows.finished["transcription_error"].startswith("Page")


def test_a_one_page_scan_still_reports_every_step(one_page) -> None:
    """Unchanged from before multi-page existed, which is the property that
    matters most here: the common case must not lose its measured progress."""
    rows = _Rows()
    stages = one_page()

    runner._read_one_page(rows, "s1", "a.jpg", 1, 1)

    assert runner._human_stage("splitting") in stages


def test_a_multi_page_scan_does_not_walk_the_bar_backwards(one_page) -> None:
    """**The reason a multi-page read reports one coarse stage.**

    The bar's positions are keyed on the worker's words and rise in the order
    the worker reaches them (`fixtures/stages/parity.json`). Page 2 starting
    over at "Finding the staves" — 0.3, after page 1 left the bar at 0.9 —
    walks it backwards, which reads as the scan having restarted and is the
    exact failure `transcriptionProgress.ts` exists to prevent.

    So a multi-page read says "Reading the notation" for the whole of it:
    coarse, true throughout, and monotone. The honest fix is a page counter in
    the words, which is new copy on a screen and waits for the UI gate.
    """
    rows = _Rows()
    stages = one_page()

    runner._read_one_page(rows, "s1", "b.jpg", 2, 3)

    assert stages == [runner.STAGE_READING_HUMAN], (
        f"page 2 reported a step that would move the bar: {stages}"
    )
