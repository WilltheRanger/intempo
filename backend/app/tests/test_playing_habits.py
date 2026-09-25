"""What real playing does between the notes, and what the app said about it.

Asked by the owner (2026-09-25): "what are some other natural human playing
styles or mistakes that can mess up the engine — perhaps if they rest too
long". Twenty habits were run through `analyze()`; these are the ones it got
wrong, and the ones next to them that must stay right.

    habit                          before                               now
    holds a note a beat too long   1 note "missed", first half paired   0 missed
                                   one note early
    tunes after the last note      last 2 notes "missed"                0 missed
    retunes in the middle          "You dragged bars 4–5 by 35 BPM"     steady, 4 extra
    plays half the page            16 notes "missed"                    0 missed
    skips a bar                    last bar "missed", bars 4–8 timed    bar 4 missed, steady
                                   against the wrong notes
    plays a bar twice              0 extra, 29 notes paired wrongly     4 extra, steady

See TUNING_LOG.md 2026-09-25 (second entry).
"""

from __future__ import annotations

import numpy as np

from app.services.alignment import CleanedAlignment, ExpectedNote, ExpectedTimeline
from app.services.analysis import _not_reached, analyze
from app.services.classification import skipped_ahead
from app.tests.audio_helpers import synth_bowed_take
from app.tests.test_note_chain import BEAT, BPM, SR, _hz, _page, _tune

TUNE = _tune(101)  # 32 quarter notes, 8 bars of G major
N = len(TUNE)
GRID = 0.6 + np.arange(N) * BEAT
PAGE = _page(TUNE)
OPEN_STRINGS = [55, 62, 69, 76]  # G D A E


def _analyse(notes: list[int], times: np.ndarray) -> tuple[object, dict]:
    y = synth_bowed_take(list(times), freqs_hz=[_hz(m) for m in notes], sr=SR)
    trace: dict = {}
    return analyze((y, SR), PAGE, BPM, instrument="violin", trace=trace), trace


def _late_from(at: int, by_s: float) -> np.ndarray:
    times = GRID.copy()
    times[at:] += by_s
    return times


# ---- held notes and stops ------------------------------------------------------


def test_a_note_held_a_beat_too_long_is_not_a_missed_note() -> None:
    """Timing discarded the first note as noise and paired the whole first
    half one note early, which lined the hold up with the grid: quality 0.966,
    "Steady", note 16 "missed", and every note before it timed against the
    attack of the note after. Half of them were heard at the wrong pitch."""
    for beats in (1, 2):
        result, _ = _analyse(TUNE, _late_from(16, beats * BEAT))
        assert result.status == "ok"
        assert result.n_missed_notes == 0, f"held {beats} beat(s)"
        assert result.verdict_direction == "on"


# ---- tuning --------------------------------------------------------------------


def test_tuning_after_the_last_note_costs_no_note() -> None:
    times = np.concatenate([GRID, GRID[-1] + 3.0 + np.arange(4) * 0.8])
    result, _ = _analyse(TUNE + OPEN_STRINGS, times)

    assert result.status == "ok"
    assert result.n_missed_notes == 0
    assert result.quality >= 0.7


def test_retuning_in_the_middle_is_not_dragging() -> None:
    """Four open strings and a five-second stop, read as "restarted at bar 4"
    — three of the four heard at another pitch — and the stop as dragging."""
    times = np.concatenate(
        [GRID[:16], GRID[15] + 1.5 + np.arange(4) * 0.8, GRID[16:] + 5.5]
    )
    result, trace = _analyse(TUNE[:16] + OPEN_STRINGS + TUNE[16:], times)

    assert result.status == "ok"
    assert result.verdict_direction == "on", result.verdict
    assert result.n_missed_notes == 0
    assert result.n_extra_notes == 4, "the open strings"
    assert "restarted" not in trace["reading"]


def test_a_real_restart_is_still_read_as_one() -> None:
    """The replay check must not refuse the thing restarts exist for."""
    notes = TUNE[:20] + TUNE[8:]
    times = np.concatenate([GRID[:20], GRID[19] + 2.0 + BEAT + np.arange(N - 8) * BEAT])
    result, trace = _analyse(notes, times)

    assert result.status == "ok"
    assert "restarted at bar 3" in trace["reading"]
    assert result.n_missed_notes == 0
    assert result.n_extra_notes == 0


# ---- part of the page ------------------------------------------------------------


def test_half_the_page_is_not_sixteen_missed_notes() -> None:
    first, _ = _analyse(TUNE[:16], GRID[:16])
    assert first.status == "ok"
    assert first.n_missed_notes == 0
    assert [m.measure_number for m in first.per_measure] == [1, 2, 3, 4]

    second, _ = _analyse(TUNE[16:], GRID[:16])
    assert second.status == "ok"
    assert second.n_missed_notes == 0
    assert [m.measure_number for m in second.per_measure] == [5, 6, 7, 8]


def _cleaned(matched: list[int], n: int) -> CleanedAlignment:
    pairs = [(k, e) for k, e in enumerate(matched)]
    return CleanedAlignment(
        matched=pairs, missed_expected=[e for e in range(n) if e not in matched]
    )


def _timeline(n: int, per_bar: int = 4) -> ExpectedTimeline:
    return ExpectedTimeline(
        onsets=np.arange(n, dtype=float),
        notes=[
            ExpectedNote(
                onset_s=float(e),
                measure_number=e // per_bar + 1,
                note_index_in_measure=e % per_bar,
                global_index=e,
                is_slur_interior=False,
                is_slur_boundary=False,
            )
            for e in range(n)
        ],
    )


def test_a_note_unheard_inside_the_bars_played_is_still_missed() -> None:
    """Only whole bars before the first or after the last are not reached:
    a final note nobody heard, in a bar the take played, is what the missed
    count exists for."""
    assert _not_reached(_cleaned(list(range(15)), 16), _timeline(16)) == set()
    assert _not_reached(_cleaned(list(range(1, 16)), 16), _timeline(16)) == set()


def test_the_rest_of_the_bar_a_take_stopped_in_goes_with_the_bars_after() -> None:
    assert _not_reached(_cleaned(list(range(9)), 16), _timeline(16)) == set(range(9, 16))
    assert _not_reached(_cleaned(list(range(6, 16)), 16), _timeline(16)) == set(range(6))


# ---- skipped and repeated bars -------------------------------------------------------


def test_a_skipped_bar_is_missed_and_is_not_rushing() -> None:
    """Every note after a skipped bar arrives a bar early against the page.
    Timing had paired straight through — the last bar "missed", bars 4–8
    timed against the wrong notes — and the pairing that got the notes right
    then said "You rushed bars 4–5 by 171 BPM"."""
    notes = TUNE[:12] + TUNE[16:]
    result, _ = _analyse(notes, GRID[: len(notes)])

    assert result.status == "ok"
    assert result.n_missed_notes == 4
    assert result.verdict_direction == "on", result.verdict
    assert 4 not in {m.measure_number for m in result.per_measure}


def test_a_bar_played_twice_is_four_extra_notes() -> None:
    notes = TUNE[:12] + TUNE[8:12] + TUNE[12:]
    result, _ = _analyse(notes, 0.6 + np.arange(len(notes)) * BEAT)

    assert result.status == "ok"
    assert result.n_missed_notes == 0
    assert result.n_extra_notes == 4
    assert result.verdict_direction == "on"


def test_a_skip_is_told_from_a_note_played_and_not_heard() -> None:
    """Gone past: the next attack comes one interval later. Waited through:
    it comes when the page says. At half speed as much as at tempo."""
    onsets = np.arange(8, dtype=float)
    skipped = np.array([0, 1, 2, 3, 4, 5], dtype=float)  # notes 3-4 gone past
    waited = np.array([0, 1, 2, 5, 6, 7], dtype=float)
    pairs = [(0, 0), (1, 1), (2, 2), (3, 5), (4, 6), (5, 7)]

    assert skipped_ahead(pairs, skipped, onsets) == [3]
    assert skipped_ahead(pairs, waited, onsets) == []
    assert skipped_ahead(pairs, skipped * 2, onsets) == [3]
    assert skipped_ahead(pairs, waited * 2, onsets) == []


def _replayed(notes: list[int]) -> tuple[object, dict]:
    return _analyse(notes, 0.6 + np.arange(len(notes)) * BEAT)


def test_a_passage_played_twice_is_read_as_played_twice() -> None:
    """Bars 1–4, then bars 1–4 again, with no pause between. On an even rhythm
    timing reads that as bars 1–8, and there is no pause to look for a
    restart at; pitch hears the second time through fall to chance."""
    result, trace = _replayed(TUNE[:16] + TUNE[:16])

    assert result.status == "ok"
    assert "restarted at bar 1" in trace["reading"]
    assert result.n_missed_notes == 0
    assert result.n_extra_notes == 0
    assert [m.measure_number for m in result.per_measure] == [1, 2, 3, 4]


def test_going_back_mid_take_is_read_as_going_back() -> None:
    """Bars 1–6, then back to bar 5 and on. Chained straight through, the
    first time through bars 5–6 was left as eight extra attacks."""
    result, trace = _replayed(TUNE[:24] + TUNE[16:])

    assert "restarted at bar 5" in trace["reading"]
    assert result.n_missed_notes == 0
    assert result.n_extra_notes == 0


def test_the_last_bars_played_again_are_read_as_played_again() -> None:
    result, trace = _replayed(TUNE + TUNE[16:])

    assert "restarted at bar 5" in trace["reading"]
    assert result.n_extra_notes == 0


def test_a_passage_played_twice_on_other_pages_too() -> None:
    from app.tests.test_note_chain import _page, _tune

    for seed in range(5):
        tune = _tune(100 + seed)
        notes = tune[:16] + tune[:16]
        y = synth_bowed_take(
            list(0.6 + np.arange(32) * BEAT), freqs_hz=[_hz(m) for m in notes], sr=SR
        )
        trace: dict = {}
        result = analyze((y, SR), _page(tune), BPM, instrument="violin", trace=trace)
        assert result.n_missed_notes == 0, seed
        assert "restarted at bar 1" in trace["reading"], seed


def test_a_stretch_of_the_page_is_held_to_the_take_s_own_attacks() -> None:
    """A passage is chosen to fit, so the share of its notes heard can be
    high by luck; the share of the take's attacks cannot be chosen."""
    from app.services.analysis import _Confirmed, _placed_by_pitch
    from app.services.audio_config import load_audio_config

    cfg = load_audio_config()
    fits = _Confirmed(notes=12, paired=12, pitches=6, asked=32, asked_in_passage=13, attacks=14)
    lucky = _Confirmed(notes=12, paired=12, pitches=6, asked=32, asked_in_passage=13, attacks=24)
    assert _placed_by_pitch(fits, cfg)
    assert not _placed_by_pitch(lucky, cfg)
