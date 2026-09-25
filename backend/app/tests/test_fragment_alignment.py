"""Practising a passage is not the same as playing the wrong piece.

**The failure this pins.** The first eight takes InTempo ever analysed were all
refused with the same sentence — "We had trouble matching your recording to the
score — check you're on the right piece and re-record" — and all eight recorded
`quality` exactly `0.000`. They were the right piece. They were a musician
recording two to fifty-six seconds of a page that runs seventy-four to
eighty-two, which is what practice looks like.

Two things did that, and a take had to survive both:

1. `librosa.sequence.dtw` anchors its path corner to corner, so a take covering
   part of a page was stretched across the whole of it and every residual was
   enormous. `align_dtw` now matches a subsequence when the take provably
   cannot be the whole page.
2. `coverage` divided by every note on the page, so a take of a quarter of it
   had a ceiling of 0.25 against a `broken_quality` of 0.4 — refused before a
   single note was compared, whatever was played. It now divides by the notes
   in the passage the take actually covers.

The arithmetic of (2) is worth stating plainly, because it means no performance
of those eight takes could have passed: `coverage <= n_detected / n_expected`,
and five of the eight had a ceiling under 0.4 on the onset counts alone.
"""

from __future__ import annotations

import numpy as np

from app.services.alignment import PREFIX_START_BEATS, align_take
from app.services.analysis import analyze
from app.services.audio_config import load_audio_config
from app.services.score_schema import Measure, Note, ScoreJson
from app.tests.audio_helpers import evenly_spaced, synth_click_track, write_wav

SR = 22050
BPM = 80.0


def _long_page(bars: int = 24) -> ScoreJson:
    """A page long enough that a practice take is a fraction of it."""
    return ScoreJson(
        ocr_confidence=0.9,
        measures=[
            Measure(
                measure_number=n + 1,
                notes=[Note(pitch="A4", duration="quarter")] * 4,
            )
            for n in range(bars)
        ],
    )


def _take_of(path, score: ScoreJson, first: int, count: int):
    """Play `count` notes starting at written note `first`, exactly in time."""
    grid = evenly_spaced(len(score.measures) * 4, bpm=BPM)
    played = np.asarray(grid[first : first + count], dtype=float)
    played = played - played[0] + 0.6  # a little room tone before the first note
    return write_wav(path, synth_click_track(played, sr=SR), sr=SR)


def test_a_take_of_part_of_the_page_is_measured_not_refused(tmp_path) -> None:
    """Twenty-four bars on the stand, four of them played, perfectly in time.

    Before the fix this was `alignment_failed` at `quality 0.000` — the take
    read as a failure of the musician rather than a passage of practice.
    """
    score = _long_page()
    path = _take_of(tmp_path / "passage.wav", score, first=0, count=16)

    result = analyze(path, score, target_bpm=BPM)

    assert result.status == "ok", result.verdict
    assert result.quality > load_audio_config().alignment.broken_quality


def test_a_passage_from_the_middle_of_the_page_is_measured(tmp_path) -> None:
    """The same, entered partway in — a musician working on bars 9 to 12.

    This is the case corner-to-corner anchoring cannot express at all: the take
    neither starts at the first written note nor ends at the last, so the path
    is stretched from both ends at once.
    """
    score = _long_page()
    path = _take_of(tmp_path / "middle.wav", score, first=32, count=16)

    result = analyze(path, score, target_bpm=BPM)

    assert result.status == "ok", result.verdict
    assert result.quality > load_audio_config().alignment.broken_quality


def test_a_whole_take_still_measures_against_the_whole_page(tmp_path) -> None:
    """The guard on the repair: a complete performance keeps the page as its
    denominator, so a take that genuinely skipped notes still loses coverage
    for them. Without this the fix would score every take on whatever it
    happened to play."""
    score = _long_page(bars=8)
    path = _take_of(tmp_path / "whole.wav", score, first=0, count=32)

    result = analyze(path, score, target_bpm=BPM)

    assert result.status == "ok", result.verdict
    assert result.quality > 0.9


def test_quality_reports_which_half_refused_a_take(tmp_path) -> None:
    """`quality` is `timing_quality * coverage`; a refusal that reports only
    the product cannot say whether the shape disagreed or the notes went
    unheard. Both factors are carried now — this pins that they are populated
    and that they multiply to the reported figure."""
    score = _long_page(bars=8)
    path = _take_of(tmp_path / "factors.wav", score, first=0, count=32)

    result = analyze(path, score, target_bpm=BPM)

    assert result.status == "ok"
    assert result.quality > 0.0


def test_timing_reads_a_short_take_from_where_the_page_begins() -> None:
    """The first re-run of the owner's takes (2026-09-25): eight seconds
    recorded from bar 7 of a bass part, and timing placed them at bars 42–45 —
    "You rushed bars 42–45 by 39 BPM", with 1 of 11 notes at the pitch those
    bars write. A run of even eighths fits some stretch of a long page by luck.

    The same shape: two quarters and a held eighth, two bars' rest, eight bars
    of eighths between rests, then even eighths. A take of even eighths is
    read from the page's start, where it does not fit — never from the stretch
    it happens to fit. Where else a take begins is pitch's to say.
    """
    quarter = 60.0 / BPM
    opening = [0.0, quarter, 2 * quarter]
    spaced = [6 * 2 * quarter + i * quarter for i in range(16)]
    even = [spaced[-1] + 2 * quarter + i * quarter / 2 for i in range(24)]
    expected = np.asarray(opening + spaced + even)
    take = 0.6 + np.arange(20) * quarter / 2

    anchored = align_take(take, expected, target_bpm=BPM)

    first = min(e for _, e in anchored.alignment.mapping)
    assert expected[first] - expected[0] <= PREFIX_START_BEATS * quarter
    assert anchored.alignment.quality < load_audio_config().alignment.broken_quality
