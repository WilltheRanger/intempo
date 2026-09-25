"""`tempo_marks`: the tempo words on a photographed page, asked of a model.

The owner's piece says "poco" somewhere, homr reads notes and not words, and a
musician who slowed down where the page asks was told they dragged
(2026-09-25). These hold how a model's answer becomes tempo changes — and, as
much, what it may not become: a word read as a change stops bars being judged.

**Every model answer here is a stand-in written for the test, not a recorded
response.** None had been recorded when this was written: the session that
built it had no `ANTHROPIC_API_KEY`. The shapes are the ones the prompt asks
for, plus the ways a model departs from a prompt that `json_object_in` already
exists to absorb.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import pytest

from app.services.ocr import tempo_marks
from app.services.ocr.base import OCRProviderError
from app.services.ocr.claude_provider import ClaudeProvider
from app.services.ocr.tempo_marks import (
    PageTempo,
    PrintedMark,
    apply_page_tempo,
    bars_by_line,
    marks_in,
    place_marks,
    read_tempo_marks,
    with_tempo_marks,
)
from app.services.score_schema import Measure, Note, ScoreJson, TempoChange


def _score(lines: list[int], *, systems: bool = True, **fields) -> ScoreJson:
    """A reading of `lines[k]` bars on each line, numbered on from 1."""
    measures = []
    number = 1
    for system, bars in enumerate(lines):
        for _ in range(bars):
            measures.append(
                Measure(
                    measure_number=number,
                    system=system if systems else None,
                    notes=[Note(pitch="C3", duration="whole")],
                )
            )
            number += 1
    return ScoreJson(
        clef="bass", time_signature="4/4", ocr_confidence=0.9, measures=measures, **fields
    )


@dataclass
class _Reader:
    """A stand-in for the model: answers what it is told to, records the asks."""

    answer: str = '{"marks": []}'
    raises: Exception | None = None
    asks: list[dict] = field(default_factory=list)
    name: str = "stand-in"

    def ask(
        self, images, prompt, *, media_type="image/jpeg", max_tokens=1024, timeout_s=None
    ) -> str:
        self.asks.append(
            {
                "images": images,
                "prompt": prompt,
                "media_type": media_type,
                "max_tokens": max_tokens,
                "timeout_s": timeout_s,
            }
        )
        if self.raises is not None:
            raise self.raises
        return self.answer


# ---- the answer ------------------------------------------------------------


def test_an_answer_names_each_mark_where_it_is_printed() -> None:
    marks = marks_in(
        '{"marks": [{"line": 3, "bar": 2, "text": "poco rit.", "bpm": null, "unit": null},'
        ' {"line": 4, "bar": 1, "text": "a tempo", "bpm": null, "unit": null}]}'
    )

    assert marks == [
        PrintedMark(3, 2, "poco rit.", None, None),
        PrintedMark(4, 1, "a tempo", None, None),
    ]


def test_an_answer_wrapped_in_a_fence_and_a_sentence_still_reads() -> None:
    marks = marks_in(
        'Here are the markings:\n```json\n{"marks": [{"line": 1, "bar": 5, "text": "rit."}]}\n```'
    )

    assert [m.text for m in marks] == ["rit."]


@pytest.mark.parametrize(
    "answer",
    ["", "no markings", "[]", '{"marks": "none"}', '{"marks": [', "null"],
)
def test_an_answer_that_is_not_the_shape_asked_for_reads_as_nothing(answer: str) -> None:
    assert marks_in(answer) == []


def test_a_mark_without_a_usable_place_or_anything_printed_is_left_out() -> None:
    marks = marks_in(
        '{"marks": ['
        '{"line": 0, "bar": 1, "text": "rit."},'
        '{"line": 1, "bar": true, "text": "rit."},'
        '{"line": "2", "bar": 1, "text": "rit."},'
        '{"line": 2, "bar": 1.5, "text": "rit."},'
        '{"line": 2, "bar": 1, "text": "   "},'
        '{"line": 2, "bar": 1},'
        '"rit.",'
        '{"line": 2, "bar": 3, "text": "  poco   rit. "}'
        "]}"
    )

    assert marks == [PrintedMark(2, 3, "poco rit.", None, None)]


@pytest.mark.parametrize(
    ("bpm", "unit", "quarters"),
    [
        (104, "quarter", 104),
        (104, None, 104),
        (60, "dotted_quarter", 90),
        (120, "eighth", 60),
        (60, "half", 120),
        (40, "dotted_half", 120),
        (88.0, "quarter", 88),
    ],
)
def test_a_metronome_mark_becomes_quarter_notes_per_minute(bpm, unit, quarters) -> None:
    (mark,) = marks_in(
        json.dumps({"marks": [{"line": 1, "bar": 1, "text": "", "bpm": bpm, "unit": unit}]})
    )

    assert mark.bpm == quarters


@pytest.mark.parametrize(
    ("bpm", "unit"),
    [(104, "crotchet"), (104, "triplet_quarter"), (10, "quarter"), (400, "quarter"), ("104", "quarter"), (True, "quarter")],
)
def test_a_metronome_mark_this_cannot_convert_is_dropped_not_guessed(bpm, unit) -> None:
    # A dotted-quarter piece read as quarters is judged at two-thirds of its
    # tempo, which is worse than no number at all.
    answer = json.dumps({"marks": [{"line": 1, "bar": 1, "text": "", "bpm": bpm, "unit": unit}]})

    assert marks_in(answer) == []


# ---- lines and bars --------------------------------------------------------


def test_each_line_holds_the_bars_the_reading_put_on_it() -> None:
    assert bars_by_line(_score([4, 5, 3])) == [[1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12]]


def test_a_reading_that_does_not_say_where_its_lines_break_has_no_lines() -> None:
    assert bars_by_line(_score([4, 5], systems=False)) == []


def test_a_reading_that_says_it_for_only_some_bars_is_not_trusted() -> None:
    score = _score([4, 5])
    measures = [*score.measures]
    measures[6] = measures[6].model_copy(update={"system": None})

    assert bars_by_line(score.model_copy(update={"measures": measures})) == []


def test_a_mark_goes_to_the_bar_it_is_printed_over() -> None:
    placed = place_marks(
        [PrintedMark(2, 3, "poco rit.", None, None), PrintedMark(3, 1, "a tempo", None, None)],
        bars_by_line(_score([4, 5, 3])),
        first_page=True,
    )

    assert placed.changes == [
        TempoChange(measure_number=7, kind="ritardando", text="poco rit."),
        TempoChange(measure_number=10, kind="a_tempo", text="a tempo"),
    ]


def test_a_place_the_reading_has_no_bar_for_is_left_out() -> None:
    # A line past the last, or a bar past the end of its line: the model
    # counted something the reading did not. Clamping would move the rit.
    placed = place_marks(
        [PrintedMark(4, 1, "rit.", None, None), PrintedMark(1, 5, "rit.", None, None)],
        bars_by_line(_score([4, 5, 3])),
        first_page=True,
    )

    assert placed.changes == []


def test_words_that_are_not_a_tempo_change_change_nothing() -> None:
    placed = place_marks(
        [
            PrintedMark(2, 1, "cresc.", None, None),
            PrintedMark(2, 2, "dolce", None, None),
            PrintedMark(2, 3, "pizz.", None, None),
        ],
        bars_by_line(_score([4, 5])),
        first_page=True,
    )

    assert placed.changes == []


def test_the_tempo_over_the_first_bar_is_the_pieces_own() -> None:
    placed = place_marks(
        [PrintedMark(1, 1, "Allegro moderato", 104, "quarter")],
        bars_by_line(_score([4, 5])),
        first_page=True,
    )

    assert placed.changes == []
    assert placed.heading_words == "Allegro moderato"
    assert placed.heading_bpm == 104
    assert placed.heading_unit == "quarter"


def test_words_over_the_first_bar_that_are_not_a_tempo_are_not_its_name() -> None:
    placed = place_marks(
        [PrintedMark(1, 1, "dolce", None, None)], bars_by_line(_score([4])), first_page=True
    )

    assert placed.heading_words is None
    assert placed.changes == []


def test_the_first_bar_of_a_later_page_is_not_the_top_of_the_piece() -> None:
    # Page 2 opening "Adagio" is the music changing there.
    placed = place_marks(
        [PrintedMark(1, 1, "Adagio", None, None)], bars_by_line(_score([4])), first_page=False
    )

    assert placed.changes == [TempoChange(measure_number=1, kind="new_tempo", text="Adagio")]
    assert placed.heading_words is None


def test_a_metronome_mark_part_way_through_sets_a_new_tempo() -> None:
    placed = place_marks(
        [PrintedMark(2, 2, "", 88, "quarter")], bars_by_line(_score([4, 5])), first_page=True
    )

    assert placed.changes == [
        TempoChange(measure_number=6, kind="new_tempo", text="new tempo", bpm=88)
    ]


def test_words_and_a_number_at_one_bar_are_one_change() -> None:
    # "meno mosso" and "♩ = 88" are often two marks at one bar, and the model
    # may report them apart.
    placed = place_marks(
        [PrintedMark(2, 2, "meno mosso", None, None), PrintedMark(2, 2, "", 88, "quarter")],
        bars_by_line(_score([4, 5])),
        first_page=True,
    )

    assert placed.changes == [
        TempoChange(measure_number=6, kind="new_tempo", text="meno mosso", bpm=88)
    ]


# ---- asking ----------------------------------------------------------------


def test_the_page_cut_into_as_many_lines_as_the_reading_found_is_shown_line_by_line(
    monkeypatch,
) -> None:
    monkeypatch.setattr(tempo_marks, "crop_systems", lambda page, source=None: [b"a", b"b"])
    reader = _Reader('{"marks": [{"line": 2, "bar": 2, "text": "rit."}]}')

    read = read_tempo_marks(
        b"page", _score([4, 5]), media_type="image/png", source=b"photo", provider=reader
    )

    (ask,) = reader.asks
    assert ask["images"] == [("Line 1", b"a"), ("Line 2", b"b")]
    # Crops are always JPEG, whatever the page was.
    assert ask["media_type"] == "image/jpeg"
    assert "each image above is one line" in ask["prompt"]
    # An optional pass must not be able to hold a scan for the SDK's ten minutes.
    assert ask["timeout_s"] is not None and ask["timeout_s"] <= 60
    assert read is not None and read.changes == [
        TempoChange(measure_number=6, kind="ritardando", text="rit.")
    ]


def test_when_the_cut_disagrees_with_the_reading_the_page_is_shown_whole(monkeypatch) -> None:
    # Two opinions about how many lines there are, and no way to tell which is
    # right: showing a crop as the wrong line would move every mark on it.
    monkeypatch.setattr(tempo_marks, "crop_systems", lambda page, source=None: [b"a", b"b", b"c"])
    reader = _Reader()

    read_tempo_marks(b"page", _score([4, 5]), media_type="image/png", provider=reader)

    (ask,) = reader.asks
    assert ask["images"] == [(None, b"page")]
    assert ask["media_type"] == "image/png"
    assert "count only lines of music" in ask["prompt"]


def test_a_cut_that_fails_still_asks_about_the_page(monkeypatch) -> None:
    def broken(page, source=None):
        raise ValueError("not an image")

    monkeypatch.setattr(tempo_marks, "crop_systems", broken)
    reader = _Reader()

    assert read_tempo_marks(b"page", _score([4]), provider=reader) is not None
    assert reader.asks[0]["images"] == [(None, b"page")]


def test_a_reading_with_no_lines_is_not_asked_about(monkeypatch) -> None:
    monkeypatch.setattr(tempo_marks, "crop_systems", lambda page, source=None: [])
    reader = _Reader()

    assert read_tempo_marks(b"page", _score([4], systems=False), provider=reader) is None
    assert reader.asks == []


def test_a_model_that_fails_leaves_nothing_read(monkeypatch) -> None:
    monkeypatch.setattr(tempo_marks, "crop_systems", lambda page, source=None: [])
    reader = _Reader(raises=OCRProviderError("rate limited"))

    assert read_tempo_marks(b"page", _score([4]), provider=reader) is None


# ---- applying --------------------------------------------------------------


def test_the_heading_fills_only_what_the_reading_left_empty() -> None:
    tempo = PageTempo(changes=[], heading_words="Allegro", heading_bpm=90, heading_unit="dotted_quarter")

    filled = apply_page_tempo(_score([4]), tempo)
    kept = apply_page_tempo(
        _score([4], tempo_marking="Andante", bpm_hint=76, tempo_beat_unit="quarter"), tempo
    )

    assert (filled.tempo_marking, filled.bpm_hint, filled.tempo_beat_unit) == (
        "Allegro",
        90,
        "dotted_quarter",
    )
    assert (kept.tempo_marking, kept.bpm_hint, kept.tempo_beat_unit) == ("Andante", 76, "quarter")


def test_a_bar_that_already_has_a_marking_keeps_it() -> None:
    score = _score(
        [4, 5], tempo_changes=[TempoChange(measure_number=6, kind="accelerando", text="accel.")]
    )
    tempo = PageTempo(
        changes=[
            TempoChange(measure_number=3, kind="ritardando", text="rit."),
            TempoChange(measure_number=6, kind="ritardando", text="rit."),
        ]
    )

    applied = apply_page_tempo(score, tempo)

    assert [(c.measure_number, c.kind) for c in applied.tempo_changes] == [
        (3, "ritardando"),
        (6, "accelerando"),
    ]


def test_nothing_read_is_the_same_reading() -> None:
    score = _score([4])

    assert apply_page_tempo(score, PageTempo(changes=[])) is score


# ---- the whole pass, as the worker calls it --------------------------------


@pytest.fixture()
def configured(monkeypatch):
    """A stand-in model named as the tempo reader, as the setting would name it."""
    from app.config import settings
    from app.services.ocr import pipeline

    reader = _Reader()
    monkeypatch.setitem(pipeline.PROVIDER_REGISTRY, "stand-in", reader)
    monkeypatch.setattr(settings, "OCR_TEMPO_READER", "stand-in", raising=False)
    monkeypatch.setattr(tempo_marks, "crop_systems", lambda page, source=None: [])
    return reader


def test_a_reading_with_no_tempo_words_gains_the_pages(configured) -> None:
    configured.answer = (
        '{"marks": [{"line": 1, "bar": 1, "text": "Andante", "bpm": 76, "unit": "quarter"},'
        ' {"line": 2, "bar": 4, "text": "poco rit.", "bpm": null, "unit": null}]}'
    )

    read = with_tempo_marks(_score([4, 5]), b"page")

    assert read.tempo_changes == [TempoChange(measure_number=8, kind="ritardando", text="poco rit.")]
    assert (read.tempo_marking, read.bpm_hint) == ("Andante", 76)


def test_a_reading_that_already_has_tempo_words_is_not_asked_about_again(configured) -> None:
    # A vision reader is asked for them in its own prompt; a second call
    # would pay to second-guess it.
    score = _score([4], tempo_changes=[TempoChange(measure_number=2, kind="ritardando", text="rit.")])

    assert with_tempo_marks(score, b"page") is score
    assert configured.asks == []


def test_a_failure_anywhere_keeps_the_reading(configured, monkeypatch) -> None:
    def broken(*_a, **_k):
        raise RuntimeError("anything at all")

    monkeypatch.setattr(tempo_marks, "place_marks", broken)
    score = _score([4])

    assert with_tempo_marks(score, b"page") is score


def test_the_reader_is_off_when_the_setting_is_empty(monkeypatch) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "OCR_TEMPO_READER", "", raising=False)

    assert tempo_marks.tempo_reader() is None


@pytest.mark.parametrize("name", ["homr", "nonesuch"])
def test_a_reader_that_cannot_be_asked_about_a_page_is_refused(monkeypatch, name: str) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "OCR_TEMPO_READER", name, raising=False)

    assert tempo_marks.tempo_reader() is None


def test_the_default_reader_is_one_that_can_be_asked(monkeypatch) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "OCR_TEMPO_READER", "claude-sonnet-5", raising=False)

    assert isinstance(tempo_marks.tempo_reader(), ClaudeProvider)
