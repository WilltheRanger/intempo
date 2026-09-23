"""A page is not always played the way it is printed, and that is not a mistake.

Every case here was refused with "Check you're on the right piece" on a take in
which every note was on time:

    a slurred passage whose notes the detector heard     quality 0.385
    a printed repeat, not taken                          quality 0.000
    stopping in bar 6 and starting again from bar 5      quality 0.134

None of them is a wrong piece. Each is the same page read another way, so the
analysis now builds each reading as a timeline, aligns the take against every
one, and keeps the page as written unless another fits clearly better. See
`analysis.Reading`.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.alignment import build_timeline, expand_repeats
from app.services.analysis import (
    MIN_READING_GAIN,
    _with_restarts,
    analyze,
    readings_of,
)
from app.services.audio_config import load_audio_config
from app.services.score_schema import Measure, Note, Repeat, ScoreJson, Slur
from app.tests.audio_helpers import synth_click_track, synth_legato_line

SR = 22050


def _with_floor(y: np.ndarray, seed: int = 0) -> np.ndarray:
    """Room tone under the take, which every real recording has."""
    rng = np.random.default_rng(seed)
    return (y + rng.normal(0, 2e-3, y.size)).astype(np.float32)


# ---------------------------------------------------------------------------
# Slurs: the notes under the bow may or may not be heard
# ---------------------------------------------------------------------------

SLUR_BPM = 80.0
EIGHTH = 60.0 / SLUR_BPM / 2
_SCALE = [62, 64, 66, 67, 69, 71, 73, 74, 73, 71, 69, 67, 66, 64, 62, 64]


def _slurred_page(bars: int = 4) -> ScoreJson:
    """Eighths, two four-note slurs a bar: one bow change per four notes."""
    return ScoreJson(
        clef="treble",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(
                measure_number=m + 1,
                notes=[Note(pitch="A4", duration="eighth")] * 8,
                slurs=[
                    Slur(start_note_index=0, end_note_index=3),
                    Slur(start_note_index=4, end_note_index=7),
                ],
            )
            for m in range(bars)
        ],
    )


def _legato(pace: float = 1.0) -> np.ndarray:
    times = [0.6 + i * EIGHTH / pace for i in range(32)]
    freqs = [440.0 * 2 ** ((_SCALE[i % 16] - 69) / 12) for i in range(32)]
    return synth_legato_line(times, freqs, times[::4])


def test_a_legato_passage_played_perfectly_is_read() -> None:
    """**The detector hears a slurred note, and the timeline said it could not.**

    On this line the detector fires on all 24 of the 24 slurred pitch
    changes. The page's timeline held only the 8 bow changes and sized the
    detector's window from them — ±464 ms — so what was kept was whichever
    pitch change was loudest in each window, and the take was refused.
    """
    result = analyze((_legato(), SR), _slurred_page(), SLUR_BPM, instrument="violin")

    assert result.status == "ok", result.verdict
    assert result.quality > 0.95
    assert result.n_missed_notes == 0 and result.n_extra_notes == 0
    assert result.verdict.startswith("Steady")


def test_a_legato_passage_played_fast_is_told_the_tempo_it_was_played_at() -> None:
    result = analyze(
        (_legato(pace=1.03), SR), _slurred_page(), SLUR_BPM, instrument="violin"
    )

    assert result.status == "ok"
    assert result.verdict_direction.value == "rush"
    assert result.insights.played_bpm == pytest.approx(SLUR_BPM * 1.03, abs=0.5)
    # Before: "You rushed across measures 2–4 by an average of 57 BPM."
    assert "by 57" not in result.verdict
    assert "by 2 BPM" in result.verdict or "by 3 BPM" in result.verdict


def test_slurred_notes_the_detector_did_not_hear_are_not_missed() -> None:
    """The reading the old timeline was built for still reads the same: only
    the bow changes sound, and nothing is called missing."""
    bow_changes = [0.6 + i * 4 * EIGHTH for i in range(8)]
    y = _with_floor(synth_click_track(bow_changes))

    result = analyze((y, SR), _slurred_page(), SLUR_BPM)

    assert result.status == "ok"
    assert result.quality > 0.95
    assert result.n_missed_notes == 0 and result.n_extra_notes == 0
    # Only the attacks the page times: the bow changes.
    assert len([n for n in result.per_note if not n.is_slur_interior]) == 8


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_a_line_where_only_some_slurred_notes_are_heard_reads_cleanly(seed: int) -> None:
    """The real case, and the one neither reading fits alone.

    Which slurred notes a detector hears depends on the interval, the string
    and the room, so a take is usually a mixture. Before the matcher learned
    to measure an interval back across an unheard optional note, a random
    half heard read at quality 0.512 with two bow changes called missed.
    """
    rng = np.random.default_rng(seed)
    heard = [i for i in range(32) if i % 4 == 0 or rng.random() < 0.5]
    y = _with_floor(synth_click_track([0.6 + i * EIGHTH for i in heard]))

    result = analyze((y, SR), _slurred_page(), SLUR_BPM)

    assert result.status == "ok"
    assert result.quality > 0.95
    assert result.n_missed_notes == 0 and result.n_extra_notes == 0
    assert result.verdict.startswith("Steady")


def test_slurred_notes_are_never_timed() -> None:
    """Heard or not, a note under the bow is the player's to place: it may
    appear in `per_note`, and it never reaches a bar's reading or the verdict."""
    result = analyze((_legato(pace=1.03), SR), _slurred_page(), SLUR_BPM, instrument="violin")

    interior = [n for n in result.per_note if n.is_slur_interior]
    assert interior, "the legato reading should have matched the slurred notes"
    assert all(m.note_count == 2 for m in result.per_measure), (
        "a bar's reading counted notes under a slur"
    )


def test_a_page_without_slurs_or_repeats_is_read_one_way() -> None:
    """Nothing is aligned twice that was aligned once before."""
    score = ScoreJson(
        clef="treble",
        ocr_confidence=0.9,
        measures=[Measure(measure_number=1, notes=[Note(pitch="A4", duration="quarter")] * 4)],
    )
    assert [r.name for r in readings_of(score, 60.0)] == ["as written"]


# ---------------------------------------------------------------------------
# Repeats: printed, and not always taken
# ---------------------------------------------------------------------------

REPEAT_BPM = 100.0
BEAT = 60.0 / REPEAT_BPM


def _repeat_page() -> ScoreJson:
    """|: four bars of quarters :| then four bars of eighths."""
    return ScoreJson(
        clef="treble",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(measure_number=m + 1, notes=[Note(pitch="A4", duration="quarter")] * 4)
            for m in range(4)
        ]
        + [
            Measure(measure_number=m + 5, notes=[Note(pitch="A4", duration="eighth")] * 8)
            for m in range(4)
        ],
        repeats=[Repeat(start_measure=1, end_measure=4, type="repeat")],
    )


def _quarters_then_eighths(quarter_bars: int) -> list[float]:
    times = [0.5 + i * BEAT for i in range(4 * quarter_bars)]
    start = 0.5 + 4 * quarter_bars * BEAT
    return times + [start + i * BEAT / 2 for i in range(32)]


def test_a_repeat_that_was_not_taken_is_read_straight_through() -> None:
    """Most people practising a passage with a repeat in it play it once."""
    y = _with_floor(synth_click_track(_quarters_then_eighths(4)))

    result = analyze((y, SR), _repeat_page(), REPEAT_BPM)

    assert result.status == "ok", result.verdict
    assert result.quality > 0.95
    assert result.n_missed_notes == 0 and result.n_extra_notes == 0
    assert result.verdict.startswith("Steady")


def test_a_repeat_that_was_taken_is_still_read_as_written() -> None:
    y = _with_floor(synth_click_track(_quarters_then_eighths(8)))

    result = analyze((y, SR), _repeat_page(), REPEAT_BPM)

    assert result.status == "ok"
    assert result.quality > 0.95
    assert result.n_missed_notes == 0
    assert result.n_expected_onsets == 64


def test_straight_through_takes_the_second_ending() -> None:
    """|: 1 2 |1. 3 :|2. 4 | — played once, the player skips the first time bar."""
    score = ScoreJson(
        clef="treble",
        ocr_confidence=0.9,
        measures=[
            Measure(measure_number=n, notes=[Note(pitch="A4", duration="whole")])
            for n in (1, 2, 3, 4)
        ],
        repeats=[
            Repeat(start_measure=1, end_measure=3, type="repeat"),
            Repeat(start_measure=3, end_measure=3, type="first_ending"),
            Repeat(start_measure=4, end_measure=4, type="second_ending"),
        ],
    )
    as_written = [m.measure_number for m in expand_repeats(score)]
    straight = [m.measure_number for m in expand_repeats(score, take_repeats=False)]

    assert as_written == [1, 2, 3, 1, 2, 4]
    assert straight == [1, 2, 4]


# ---------------------------------------------------------------------------
# Restarts: stop, go back, play on
# ---------------------------------------------------------------------------


def _bars(bars: int) -> ScoreJson:
    """Each bar a quarter, two eighths and a half — varied, so bars are told
    apart by their place in the take rather than by rhythm alone."""
    return ScoreJson(
        clef="treble",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(
                measure_number=m + 1,
                notes=[
                    Note(pitch="A4", duration="quarter"),
                    Note(pitch="A4", duration="eighth"),
                    Note(pitch="A4", duration="eighth"),
                    Note(pitch="A4", duration="half"),
                ],
            )
            for m in range(bars)
        ],
    )


def _played(start_s: float, bars: int) -> list[float]:
    out: list[float] = []
    for b in range(bars):
        base = start_s + b * 4 * BEAT
        out += [base, base + BEAT, base + 1.5 * BEAT, base + 2 * BEAT]
    return out


@pytest.mark.parametrize(
    ("bars", "stopped_after", "restart_bar", "pause_s"),
    [
        (8, 6, 5, 2.0),  # the one measured: 0.134, "check you're on the right piece"
        (12, 5, 3, 1.5),
        (8, 4, 1, 2.5),  # from the top
    ],
)
def test_a_restart_from_an_earlier_bar_is_read(
    bars: int, stopped_after: int, restart_bar: int, pause_s: float
) -> None:
    first = _played(0.5, stopped_after)
    again = _played(first[-1] + 2 * BEAT + pause_s, bars - restart_bar + 1)
    y = _with_floor(synth_click_track(first + again))

    result = analyze((y, SR), _bars(bars), REPEAT_BPM)

    assert result.status == "ok", result.verdict
    assert result.quality > 0.9
    assert result.n_missed_notes == 0 and result.n_extra_notes == 0
    assert result.verdict.startswith("Steady")


def test_a_pause_that_carried_on_from_where_it_stopped_is_not_a_restart() -> None:
    """A stop that resumes in the next bar is a hesitation, and the reading
    as written already handles it; every note is still read once."""
    first = _played(0.5, 4)
    rest = _played(first[-1] + 2 * BEAT + 2.0, 4)
    y = _with_floor(synth_click_track(first + rest))

    result = analyze((y, SR), _bars(8), REPEAT_BPM)

    assert result.status == "ok"
    assert result.n_missed_notes == 0 and result.n_extra_notes == 0
    assert len(result.per_note) == 32


def test_a_take_that_already_reads_is_never_read_again_for_restarts() -> None:
    """Restarts are only looked for where the page as read cannot explain the
    take, so nothing that reads today can move."""

    class _Fits:
        class alignment:  # noqa: N801 - a stand-in with the one field read
            quality = 0.95

    chosen = (object(), _Fits())
    assert _with_restarts(np.array([0.0, 1.0]), chosen, 60.0, load_audio_config()) is chosen


def test_another_reading_has_to_fit_clearly_better() -> None:
    """The margin is the trim search's, for the trim search's reason."""
    from app.services.alignment import MIN_TRIM_GAIN

    assert MIN_READING_GAIN == MIN_TRIM_GAIN > 0


def test_the_legato_reading_places_every_slurred_note() -> None:
    legato = build_timeline(_slurred_page(1), SLUR_BPM, legato=True)
    written = build_timeline(_slurred_page(1), SLUR_BPM)

    assert legato.onsets.size == 8 and written.onsets.size == 2
    assert [n.under_slur for n in legato.notes] == [
        False, True, True, True, False, True, True, True
    ]
    # Unheard is not missed, and the timing is the player's.
    assert all(n.is_slur_interior for n in legato.notes if n.under_slur)

