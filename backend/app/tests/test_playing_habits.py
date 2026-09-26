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

Asked again (2026-09-26), "what can the player do that can mess up the
reading", on a bass as well:

    habit                          before                               now
    stops after a few notes        "Only 6 of 32 notes came through.    "Only 6 notes. Play a little
                                   Move the mic closer."                further to be timed."

A plucked bass stopped after two bars looked like a third finding and was not:
the synthetic pluck was cut off dead, and the click was the "note". Faded
out, the take reads correctly — and is kept below as a guard.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.alignment import CleanedAlignment, ExpectedNote, ExpectedTimeline
from app.services.analysis import _not_reached, analyze
from app.services.classification import skipped_ahead
from app.tests.audio_helpers import synth_bowed_take, synth_plucked_take
from app.services.score_schema import ScoreJson
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


# ---- stopping early ---------------------------------------------------------------


def test_a_take_that_stops_after_a_few_notes_is_told_so_not_to_move_the_mic() -> None:
    """Six clean notes of the opening, in time, then a stop: too few to time,
    and every one of them heard — the microphone is not what went wrong."""
    result, _ = _analyse(TUNE[:6], GRID[:6])

    assert result.status == "alignment_failed"
    assert result.verdict == "Only 6 notes. Play a little further to be timed."


def test_a_short_take_that_did_not_come_through_still_names_the_mic() -> None:
    """The sentence the short take was given is still right for a take that
    ran the length of the page and was half heard."""
    notes = TUNE[::5]
    result, _ = _analyse(notes, GRID[: len(TUNE)][::5])

    assert result.status == "alignment_failed"
    assert "Move the mic closer" in (result.verdict or "")


# ---- a plucked bass, stopped part-way ---------------------------------------------------

_BASS_STEPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _bass_page(sounding: list[int], per_bar: int, duration: str) -> ScoreJson:
    """A bass part, written an octave above where it sounds."""
    written = [m + 12 for m in sounding]
    return ScoreJson.model_validate(
        {
            "time_signature": "4/4",
            "clef": "bass",
            "repeats": [],
            "ocr_confidence": 1.0,
            "measures": [
                {
                    "measure_number": k + 1,
                    "notes": [
                        {"pitch": f"{_BASS_STEPS[m % 12]}{m // 12 - 1}", "duration": duration}
                        for m in written[per_bar * k : per_bar * (k + 1)]
                    ],
                    "slurs": [],
                }
                for k in range(len(written) // per_bar)
            ],
        }
    )


def test_two_plucked_bars_of_a_page_are_judged_on_the_bars_played() -> None:
    """Pizzicato, fast, and stopped halfway: the last note rings on over the
    bars that were never played, and none of that ring may become their notes."""
    rng = np.random.default_rng(7)
    scale = [m for m in range(29, 51) if m % 12 in (10, 0, 2, 3, 5, 7, 9)]
    at, sounding = 6, []
    for _ in range(32):
        sounding.append(scale[at])
        at = int(np.clip(at + rng.choice([-2, -1, -1, 1, 1, 2, 3, -3]), 0, len(scale) - 1))
    bpm = 131.0
    eighth = 60.0 / bpm / 2
    played = sounding[:16]  # two of four bars
    y = synth_plucked_take(
        list(0.5 + np.arange(16) * eighth), [_hz(m) for m in played], sr=SR
    )

    result = analyze((y, SR), _bass_page(sounding, 8, "eighth"), bpm, instrument="double_bass")

    assert result.status == "ok", result.verdict
    assert [m.measure_number for m in result.per_measure] == [1, 2]
    assert result.n_missed_notes == 0


# ---- wrong notes (the owner, 2026-09-26: "name them") ------------------------------


def _wrong(result) -> list[tuple[int, str, str]]:
    return [(w.measure_number, w.heard, w.written) for w in result.wrong_notes]


def test_a_clean_take_names_no_wrong_notes() -> None:
    result, _ = _analyse(TUNE, GRID[:N])
    assert result.wrong_notes == []


def test_forgetting_a_sharp_in_the_key_is_named_note_by_note() -> None:
    """Every F♯ played as F: four notes, a semitone flat, and "Steady all the
    way through." was all the take was told."""
    forgot = [m - 1 if m % 12 == 6 else m for m in TUNE]
    sharps = [k // 4 + 1 for k, m in enumerate(TUNE) if m % 12 == 6]

    result, _ = _analyse(forgot, GRID[:N])

    assert _wrong(result) == [(bar, "F", "F#") for bar in sharps]


def test_one_wrong_note_is_named_in_its_bar() -> None:
    notes = list(TUNE)
    notes[13] += 3  # bar 4
    result, _ = _analyse(notes, GRID[:N])

    assert [w.measure_number for w in result.wrong_notes] == [4]


def test_an_octave_is_not_a_wrong_note() -> None:
    result, _ = _analyse([m + 12 for m in TUNE], GRID[:N])
    assert result.wrong_notes == []


@pytest.mark.parametrize("sharp", [0.5, 0.72])
def test_a_note_out_of_tune_is_not_called_another_note(sharp: float) -> None:
    """Half-way between two semitones is out of tune — the pitch chart's to
    say — and not a claim that the player played another note.

    0.72 is the owner's own: a B♭ in bar 14 of a real bass take, 72 cents
    sharp in a fast chromatic run, which the first version of this rule told
    them was a B. Nearer B than B♭, but no nearer it than a right note sits to
    its own, which is what "clearly another note" has to mean."""
    y = synth_bowed_take(
        list(GRID[:N]),
        freqs_hz=[_hz(m + (sharp if k == 13 else 0.0)) for k, m in enumerate(TUNE)],
        sr=SR,
    )
    result = analyze((y, SR), PAGE, BPM, instrument="violin")
    assert result.wrong_notes == []


def test_the_note_before_heard_again_is_not_named() -> None:
    """On a real bass a fifth of the notes read as the previous one, still
    ringing into the window. A note heard as its neighbour is never accused."""
    notes = list(TUNE)
    k = next(i for i in range(1, N - 1) if TUNE[i] % 12 != TUNE[i - 1] % 12)
    notes[k] = TUNE[k - 1]
    result, _ = _analyse(notes, GRID[:N])
    assert result.wrong_notes == []


def test_a_page_read_in_the_wrong_key_names_nothing() -> None:
    """Every note a tone high is not thirty-two mistakes; it is a page read in
    the wrong clef or key, and naming them would send the player the wrong way."""
    result, _ = _analyse([m + 2 for m in TUNE], GRID[:N])
    assert result.wrong_notes == []


# ---- miscounted rests (the owner, 2026-09-26: "say it") -----------------------------


def _page_with_rest() -> ScoreJson:
    """Bars 1–4 of the tune, two bars' rest, then bars 5–8 as bars 7–10."""
    d = PAGE.model_dump()
    rest = [{"measure_number": n, "notes": [{"pitch": "rest", "duration": "whole"}], "slurs": []} for n in (5, 6)]
    after = [dict(m, measure_number=m["measure_number"] + 2) for m in d["measures"][4:]]
    return ScoreJson.model_validate({**d, "measures": d["measures"][:4] + rest + after})


def _entering(shift_beats: float, pace: float = 1.0) -> list:
    grid = 0.6 + np.arange(N) * BEAT * pace
    times = np.concatenate([grid[:16], grid[16:] + shift_beats * BEAT * pace])
    y = synth_bowed_take(list(times), freqs_hz=[_hz(m) for m in TUNE], sr=SR)
    result = analyze((y, SR), _page_with_rest(), BPM, instrument="violin")
    return [(e.rest_measure, e.measure_number, e.beats, e.bar_beats) for e in result.rest_entries]


def test_a_rest_counted_right_is_not_named() -> None:
    assert _entering(8) == []


def test_coming_in_a_bar_early_after_a_rest_is_named() -> None:
    assert _entering(4) == [(5, 7, -4.0, 4.0)]


def test_coming_in_a_beat_late_after_a_rest_is_named() -> None:
    assert _entering(9) == [(5, 7, 1.0, 4.0)]


def test_half_a_beat_is_phrasing_not_a_miscount() -> None:
    assert _entering(8.5) == []


def test_a_slow_take_counts_its_rest_at_its_own_pace() -> None:
    """Played at two-thirds of the tempo, rest and all: in proportion, and so
    counted right."""
    assert _entering(8, pace=1.5) == []
