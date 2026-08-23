"""Tests for services/alignment.py — expected onsets, DTW, fuzzy matching."""

from __future__ import annotations

import numpy as np
import pytest

from app.services.alignment import (
    expand_repeats,
    align_dtw,
    apply_fuzzy_match,
    build_timeline,
    compute_expected_onsets,
    is_alignment_broken,
    to_timeline_base,
)
from app.services.score_schema import Measure, Note, Repeat, ScoreJson, Slur


def _score(measures: list[Measure]) -> ScoreJson:
    return ScoreJson(clef="treble", time_signature="4/4", ocr_confidence=0.9, measures=measures)


def test_expected_onsets_quarter_notes_at_120() -> None:
    # 4 quarter notes at 120 BPM → 0.5s apart, starting at 0.
    score = _score([Measure(measure_number=1, notes=[Note(pitch="A4", duration="quarter")] * 4)])
    onsets = compute_expected_onsets(score, target_bpm=120.0)
    assert np.allclose(onsets, [0.0, 0.5, 1.0, 1.5])


def test_expected_onsets_mixed_durations() -> None:
    # half (2 beats) + two eighths (0.5 each) + quarter, at 120 BPM.
    notes = [
        Note(pitch="A4", duration="half"),
        Note(pitch="B4", duration="eighth"),
        Note(pitch="C4", duration="eighth"),
        Note(pitch="D4", duration="quarter"),
    ]
    score = _score([Measure(measure_number=1, notes=notes)])
    onsets = compute_expected_onsets(score, target_bpm=120.0)
    # onsets at beats 0, 2, 2.5, 3 → seconds 0, 1.0, 1.25, 1.5
    assert np.allclose(onsets, [0.0, 1.0, 1.25, 1.5])


def test_rests_advance_clock_but_emit_no_onset() -> None:
    notes = [
        Note(pitch="A4", duration="quarter"),
        Note(pitch="rest", duration="quarter"),
        Note(pitch="B4", duration="quarter"),
    ]
    score = _score([Measure(measure_number=1, notes=notes)])
    onsets = compute_expected_onsets(score, target_bpm=120.0)
    # Two sounded notes; the rest occupies beat 1 so the second lands at 1.0s.
    assert np.allclose(onsets, [0.0, 1.0])


def test_tied_note_is_not_reattacked() -> None:
    notes = [
        Note(pitch="A4", duration="quarter", tied_to_next=True),
        Note(pitch="A4", duration="quarter"),
        Note(pitch="B4", duration="quarter"),
    ]
    score = _score([Measure(measure_number=1, notes=notes)])
    onsets = compute_expected_onsets(score, target_bpm=120.0)
    # First+second are tied → one onset at 0; B4 at beat 2 → 1.0s.
    assert np.allclose(onsets, [0.0, 1.0])


def test_slur_interior_is_flagged() -> None:
    """Spec: the boundaries are the first note of the slur and the first note
    *after* it ends. Every note in between — including the slur's own last
    note — is interior and is not timed individually.

    This asserted that the slur's last note was a boundary, which is what the
    code did and what the spec does not say. That note is played under the same
    bow stroke as the ones before it, so it has no attack for the onset
    detector to find, and timing it produced phantom "dragging" on the last
    note of every slur.
    """
    notes = [Note(pitch="A4", duration="quarter")] * 4
    measure = Measure(measure_number=1, notes=notes, slurs=[Slur(start_note_index=0, end_note_index=3)])
    timeline = build_timeline(_score([measure]), target_bpm=120.0)
    flags = [(n.is_slur_boundary, n.is_slur_interior) for n in timeline.notes]
    assert flags == [(True, False), (False, True), (False, True), (False, True)]


def test_the_note_after_a_slur_is_a_boundary_and_is_timed() -> None:
    """The bow changes direction on it, so it is attacked and it counts."""
    notes = [Note(pitch="A4", duration="quarter")] * 4
    measure = Measure(
        measure_number=1, notes=notes, slurs=[Slur(start_note_index=0, end_note_index=2)]
    )
    timeline = build_timeline(_score([measure]), target_bpm=120.0)
    flags = [(n.is_slur_boundary, n.is_slur_interior) for n in timeline.notes]
    assert flags == [(True, False), (False, True), (False, True), (True, False)]


def test_two_slurs_in_a_measure_each_keep_their_own_boundary() -> None:
    notes = [Note(pitch="A4", duration="eighth")] * 6
    measure = Measure(
        measure_number=1,
        notes=notes,
        slurs=[Slur(start_note_index=0, end_note_index=1), Slur(start_note_index=3, end_note_index=4)],
    )
    timeline = build_timeline(_score([measure]), target_bpm=120.0)
    # 0 starts the first slur, 1 is under it; 2 is the note after it and is
    # timed; 3 starts the second slur, 4 is under it; 5 is after it and timed.
    assert [n.is_slur_interior for n in timeline.notes] == [
        False, True, False, False, True, False,
    ]


def test_align_dtw_perfect_is_identity() -> None:
    expected = np.array([0.0, 0.5, 1.0, 1.5, 2.0])
    result = align_dtw(expected.copy(), expected, target_bpm=120.0)
    assert result.mapping == [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4)]
    assert result.quality > 0.95


def test_align_dtw_uniform_rush_keeps_monotonic_mapping() -> None:
    expected = np.array([0.0, 0.5, 1.0, 1.5, 2.0])
    detected = expected * 0.95  # rushed 5%
    result = align_dtw(detected, expected, target_bpm=120.0)
    assert result.mapping == [(0, 0), (1, 1), (2, 2), (3, 3), (4, 4)]


def test_fuzzy_match_flags_extra_detected_note() -> None:
    expected = np.array([0.0, 0.5, 1.0])
    # An extra false-trigger onset near the first note.
    detected = np.array([0.0, 0.05, 0.5, 1.0])
    result = align_dtw(detected, expected, target_bpm=120.0)
    cleaned = apply_fuzzy_match(result, detected, expected)
    assert len(cleaned.matched) == 3
    assert len(cleaned.extra_detected) == 1
    assert not cleaned.missed_expected


def test_fuzzy_match_flags_missed_note() -> None:
    expected = np.array([0.0, 0.5, 1.0, 1.5])
    detected = np.array([0.0, 0.5, 1.5])  # skipped the note at 1.0
    result = align_dtw(detected, expected, target_bpm=120.0)
    cleaned = apply_fuzzy_match(result, detected, expected)
    assert 2 in cleaned.missed_expected  # expected index 2 (t=1.0) unmatched


def test_is_alignment_broken_threshold() -> None:
    assert is_alignment_broken(0.3) is True
    assert is_alignment_broken(0.5) is False


def test_align_empty_inputs_are_broken() -> None:
    result = align_dtw(np.array([]), np.array([0.0, 0.5]), target_bpm=120.0)
    assert result.quality == 0.0
    assert is_alignment_broken(result.quality) is True


# ---- repeats -----------------------------------------------------------------
#
# `build_timeline` walked `score.measures` once and ignored `score.repeats`
# entirely. A musician taking an eight-bar repeat plays sixteen bars and
# produces roughly twice the onsets, against a timeline holding eight — so DTW
# matched a doubled performance to a single pass and every delta after the
# repeat sign was meaningless. Silent, because alignment still produced *a*
# number.


def _bar(number: int, notes: int = 4) -> Measure:
    return Measure(
        measure_number=number,
        notes=[Note(pitch="C3", duration="quarter") for _ in range(notes)],
    )


def _score_with(repeats: list[Repeat], bars: int = 4) -> ScoreJson:
    return ScoreJson(
        clef="bass",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[_bar(n) for n in range(1, bars + 1)],
        repeats=repeats,
    )


def test_a_repeated_section_is_played_twice() -> None:
    """The whole point: the expected timeline has to hold what was played."""
    score = _score_with([Repeat(start_measure=1, end_measure=2, type="repeat")])
    played = [m.measure_number for m in expand_repeats(score)]
    assert played == [1, 2, 1, 2, 3, 4]


def test_a_score_with_no_repeats_is_unchanged() -> None:
    """The common case must cost nothing and change nothing."""
    score = _score_with([])
    assert [m.measure_number for m in expand_repeats(score)] == [1, 2, 3, 4]


def test_the_timeline_doubles_when_a_section_repeats() -> None:
    """The observable consequence, not just the measure list.

    Sixteen quarter notes at 60 BPM is sixteen seconds; eight is eight. Getting
    this wrong is what made every delta after a repeat sign meaningless.
    """
    plain = build_timeline(_score_with([]), 60.0)
    repeated = build_timeline(
        _score_with([Repeat(start_measure=1, end_measure=2, type="repeat")]), 60.0
    )
    assert len(repeated.onsets) == len(plain.onsets) + 8
    assert repeated.onsets[-1] > plain.onsets[-1]


def test_first_and_second_endings_are_read_the_way_a_player_reads_them() -> None:
    """First time through take the first ending and go back; second time skip
    it and take the second."""
    score = ScoreJson(
        clef="bass", time_signature="4/4", ocr_confidence=0.9,
        measures=[_bar(n) for n in range(1, 5)],
        repeats=[
            Repeat(start_measure=1, end_measure=3, type="repeat"),
            Repeat(start_measure=3, end_measure=3, type="first_ending"),
            Repeat(start_measure=4, end_measure=4, type="second_ending"),
        ],
    )
    # 1, 2, 3 (first ending) → back → 1, 2, 4 (second ending).
    assert [m.measure_number for m in expand_repeats(score)] == [1, 2, 3, 1, 2, 4]


def test_a_repeat_naming_measures_that_do_not_exist_is_ignored() -> None:
    """OCR produces these. Losing the whole take to a mis-read repeat sign
    would be the wrong trade."""
    score = _score_with([Repeat(start_measure=7, end_measure=9, type="repeat")])
    assert [m.measure_number for m in expand_repeats(score)] == [1, 2, 3, 4]


def test_a_backwards_repeat_is_ignored() -> None:
    score = _score_with([Repeat(start_measure=3, end_measure=1, type="repeat")])
    assert [m.measure_number for m in expand_repeats(score)] == [1, 2, 3, 4]


def test_measure_numbers_are_not_renumbered_across_passes() -> None:
    """The musician's part says bar 2 once and they play it twice, so both
    passes stay bar 2 — the verdict then names a bar they can find on the page.

    The honest consequence is that a repeated bar's two passes are averaged
    together: nothing downstream distinguishes them, and inventing bar numbers
    printed nowhere would be worse.
    """
    score = _score_with([Repeat(start_measure=1, end_measure=2, type="repeat")])
    timeline = build_timeline(score, 60.0)
    twos = [n for n in timeline.notes if n.measure_number == 2]
    assert len(twos) == 8, "bar 2 should appear twice, four notes each"


# --- the recording's clock vs the score's clock -----------------------------

def test_a_lead_in_does_not_break_alignment() -> None:
    """A perfect take is perfect whenever the player started.

    `build_timeline` returns "seconds since start of the first note";
    `detect_onsets` returns seconds since the recording started. Nothing put
    them on the same clock before DTW, so a musician who tapped record, picked
    up the bow and then played was compared against a score that assumed they
    began instantly. Five seconds of that scored 0.053 — "check you're on the
    right piece" — on a take with nothing wrong with it.
    """
    expected = np.arange(32, dtype=float)  # 32 quarters at 60bpm, played perfectly

    for lead_in in (0.0, 0.5, 2.0, 5.0, 30.0):
        played = expected + lead_in
        result = align_dtw(to_timeline_base(played), expected, target_bpm=60.0)
        assert result.quality == pytest.approx(1.0), f"lead-in {lead_in}s"


def test_the_lead_in_was_what_broke_it() -> None:
    """The regression this guards against, stated as the thing that used to
    happen. If DTW ever stops caring about a constant offset on its own, this
    test is the one that says the shift is no longer load-bearing."""
    expected = np.arange(32, dtype=float)
    unshifted = align_dtw(expected + 5.0, expected, target_bpm=60.0)
    assert unshifted.quality < 0.4, "a five-second lead-in used to align fine?"


def test_to_timeline_base_is_a_shift_and_nothing_else() -> None:
    """Only the origin moves. Gaps carry the performance and must survive."""
    played = np.array([4.0, 4.5, 5.1, 5.4, 6.9])
    shifted = to_timeline_base(played)
    assert shifted[0] == 0.0
    assert np.allclose(np.diff(shifted), np.diff(played))


def test_to_timeline_base_tolerates_an_empty_recording() -> None:
    assert to_timeline_base(np.array([])).size == 0


def test_the_verdict_does_not_depend_on_when_you_started(tmp_path) -> None:
    """The same playing, recorded with different amounts of dead air in front,
    has to produce the same per-note deltas — not merely the same verdict."""
    from app.services.analysis import analyze
    from app.tests.audio_helpers import synth_click_track, write_wav

    score = ScoreJson.model_validate(
        {
            "time_signature": "4/4",
            "key_signature": "C major",
            "tempo_marking": None,
            "bpm_hint": None,
            "clef": "treble",
            "measures": [
                {
                    "measure_number": bar + 1,
                    "notes": [
                        {"pitch": "A4", "duration": "quarter", "tied_to_next": False}
                        for _ in range(4)
                    ],
                    "slurs": [],
                }
                for bar in range(2)
            ],
            "repeats": [],
            "ocr_confidence": 0.9,
            "notes_to_human": "",
        }
    )

    results = []
    for lead_in in (0.2, 3.0):
        times = [lead_in + i * 0.6 for i in range(8)]  # 100bpm, target 100
        path = write_wav(
            tmp_path / f"lead{lead_in}.wav", synth_click_track(times, sr=22050), sr=22050
        )
        results.append(analyze(path, score, target_bpm=100.0))

    early, late = results
    assert early.status == "ok" and late.status == "ok"
    assert len(early.per_note) == len(late.per_note) == 8
    assert early.verdict_direction == late.verdict_direction

    # Within one analysis frame. Onsets are reported at frame boundaries —
    # hop 512 at 22.05 kHz is 23.2 ms — and shifting the audio by 2.8 s is not
    # a whole number of frames, so the same click snaps to a different frame.
    # That residue is the detector's time resolution, not the lead-in leaking
    # through: before the fix these two takes did not both reach "ok" at all.
    #
    # Worth knowing when reading a verdict: 23.2 ms is 2.3% of a beat at 60 BPM
    # and 4.6% at 120, against an "on tempo" band of ±5%. The measurement grid
    # is roughly half the width of the tightest band it is asked to resolve.
    one_frame_ms = 512 / 22050 * 1000
    for a, b in zip(early.per_note, late.per_note, strict=True):
        assert a.delta_ms == pytest.approx(b.delta_ms, abs=one_frame_ms + 1)
