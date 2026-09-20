"""Tests for services/alignment.py — expected onsets, DTW, fuzzy matching."""

from __future__ import annotations

import numpy as np
import pytest

from app.services.alignment import (
    AlignmentResult,
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


def test_a_note_under_the_bow_is_not_expected_at_all() -> None:
    """A slur is one bow stroke, so the notes inside it are never attacked and
    no onset will ever be detected for them. Expecting one anyway is not a
    cosmetic error — quality is weighted by coverage, so on the corpus's own
    slurred clip the detector found **all 8** attacks that exist, a perfect
    reading, and the pipeline scored it 0.196 and called it `alignment_failed`.
    Slurred playing could not be analysed at all.

    This asserted the opposite: that all four notes appeared with the middle
    two flagged.
    """
    notes = [Note(pitch="A4", duration="quarter")] * 4
    measure = Measure(measure_number=1, notes=notes, slurs=[Slur(start_note_index=0, end_note_index=3)])
    timeline = build_timeline(_score([measure]), target_bpm=120.0)

    assert [n.note_index_in_measure for n in timeline.notes] == [0], (
        "only the bow change is attacked"
    )
    assert not timeline.notes[0].is_slur_interior


def test_the_clock_still_advances_for_notes_under_the_bow() -> None:
    """Dropping the expectation must not drop the time. The note after a
    four-quarter slur is four beats in, not one."""
    slurred = Measure(
        measure_number=1,
        notes=[Note(pitch="A4", duration="quarter")] * 4,
        slurs=[Slur(start_note_index=0, end_note_index=2)],
    )
    timeline = build_timeline(_score([slurred]), target_bpm=60.0)
    assert np.allclose(timeline.onsets, [0.0, 3.0])


def test_the_note_after_a_slur_is_attacked_and_expected() -> None:
    """The bow changes on it, so it sounds and it counts."""
    notes = [Note(pitch="A4", duration="quarter")] * 4
    measure = Measure(
        measure_number=1, notes=notes, slurs=[Slur(start_note_index=0, end_note_index=2)]
    )
    timeline = build_timeline(_score([measure]), target_bpm=120.0)
    assert [n.note_index_in_measure for n in timeline.notes] == [0, 3]
    assert [n.is_slur_boundary for n in timeline.notes] == [True, True]


def test_two_slurs_in_a_measure_expect_two_bow_changes() -> None:
    notes = [Note(pitch="A4", duration="eighth")] * 6
    measure = Measure(
        measure_number=1,
        notes=notes,
        slurs=[Slur(start_note_index=0, end_note_index=1), Slur(start_note_index=3, end_note_index=4)],
    )
    timeline = build_timeline(_score([measure]), target_bpm=120.0)
    # 0 starts the first slur; 1 is under it. 2 is attacked. 3 starts the
    # second; 4 is under it. 5 is attacked.
    assert [n.note_index_in_measure for n in timeline.notes] == [0, 2, 3, 5]


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


def test_dtw_no_longer_needs_the_shift_but_fuzzy_matching_still_does() -> None:
    """Where the lead-in still bites, now that matching is tempo-invariant.

    This test used to assert that a five-second lead-in sank `align_dtw`, and
    it was written to fire the day that stopped being true. It fired: putting
    each sequence on its own unit span subtracts the origin, so DTW absorbs a
    constant offset by construction.

    `apply_fuzzy_match` is a different matter, and it is why
    `to_timeline_base` stays. It breaks a many-to-one tie by "closest in time"
    against raw expected seconds, so a large constant offset swamps the
    comparison and it stops choosing the closest candidate and starts choosing
    the earliest — which on a re-attacked note is the wrong one.
    """
    expected = np.arange(32, dtype=float)
    assert align_dtw(expected + 5.0, expected, target_bpm=60.0).quality == pytest.approx(1.0)

    # Two candidates for written note 3: one 100ms early, one 50ms late. The
    # closest is the late one, and that must not depend on the lead-in.
    exp = np.arange(8, dtype=float)
    mapping = [(0, 0), (1, 1), (2, 2), (3, 3), (4, 3), (5, 4), (6, 5), (7, 6), (8, 7)]
    played = np.array([0, 1, 2, 2.90, 3.05, 4, 5, 6, 7], dtype=float)
    alignment = AlignmentResult(
        mapping=mapping, cost=0.0, quality=1.0, n_detected=played.size, n_expected=exp.size
    )

    def note_three_from(detected: np.ndarray) -> int:
        cleaned = apply_fuzzy_match(alignment, detected, exp)
        return {written: det for det, written in cleaned.matched}[3]

    assert note_three_from(played) == 4, "with no lead-in it picks the closest"
    assert note_three_from(played + 5.0) == 3, "raw times pick the earliest instead"
    assert note_three_from(to_timeline_base(played + 5.0)) == 4


# --- matching must not depend on how fast it was played --------------------

def test_a_steady_take_at_a_different_tempo_still_aligns() -> None:
    """The bug that mattered most: DTW ran on raw seconds, so a uniform tempo
    difference made the cheapest path one that *slid* rather than one that
    matched note to note. 64 notes played 2% fast had 39% of their notes
    attributed to the wrong written note; at 10% it was 8%. A musician who
    rushes is the entire audience for this app."""
    for n in (16, 32, 64):
        expected = np.arange(n, dtype=float)
        for drift in (0.02, 0.05, 0.10, 0.20):
            played = to_timeline_base(expected * (1 - drift))
            result = align_dtw(played, expected, target_bpm=60.0)
            assert result.mapping == [(i, i) for i in range(n)], (
                f"{n} notes at {drift:.0%} fast matched to the wrong notes"
            )
            assert result.quality == pytest.approx(1.0), (
                "a steady take at a different tempo is the right piece played "
                "recognisably, and the tempo is the verdict, not a failure"
            )


def test_the_tempo_difference_still_reaches_the_verdict() -> None:
    """Matching ignores tempo; measuring must not. If this ever passes while
    the deltas come back at zero, the normalisation has leaked downstream and
    the app has stopped being able to say anyone rushed."""
    from app.services.classification import compute_deltas

    score = _score([
        Measure(
            measure_number=bar + 1,
            notes=[Note(pitch="A4", duration="quarter") for _ in range(4)],
        )
        for bar in range(4)
    ])
    timeline = build_timeline(score, target_bpm=60.0)
    played = to_timeline_base(timeline.onsets * 0.90)  # 10% fast, dead steady

    raw = align_dtw(played, timeline.onsets, target_bpm=60.0)
    cleaned = apply_fuzzy_match(raw, played, timeline.onsets)
    deltas = compute_deltas(cleaned, played, timeline, 60.0)

    assert raw.quality == pytest.approx(1.0), "matching should not care"
    assert deltas[-1].delta_ms < -1000, "measuring very much should"
    assert all(d.delta_pct <= 0 for d in deltas), "every note early, none late"


def test_a_take_missing_every_other_note_is_not_read_as_a_slow_one() -> None:
    """The hazard that decided *how* to normalise.

    Scaling by a tempo ratio from median inter-onset intervals rescales a
    sparse take until it looks complete — a musician who dropped half the notes
    would get note *i* matched to written note *i*, and a confident analysis of
    bars they never played. Normalising by span keeps the real correspondence
    (i to 2i) and scores it poorly, which is the honest answer."""
    expected = np.arange(32, dtype=float)
    played = to_timeline_base(expected[::2])

    result = align_dtw(played, expected, target_bpm=60.0)
    written = [e for _, e in result.mapping]

    # The guarantee is rejection, and it got stronger when the matcher stopped
    # being allowed to stretch without limit: 0.301 under span normalisation,
    # 0.119 now.
    assert result.quality < 0.2, "half a performance is not a good alignment"
    # And it is not read as a complete performance played slowly. Reading it
    # that way needs a 0.5x rescale, which `MIN_TEMPO_RATIO` puts out of reach —
    # that is the whole reason the bound exists, and this is what it buys.
    assert written != list(range(16))


def test_a_different_piece_is_still_rejected() -> None:
    """Tempo-invariance must not become piece-invariance."""
    rng = np.random.default_rng(0)
    expected = np.arange(32, dtype=float)
    played = to_timeline_base(np.sort(rng.uniform(0, 32, 32)))
    assert align_dtw(played, expected, target_bpm=60.0).quality < 0.4


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


# --- slurred music, end to end ---------------------------------------------

def _slurred_score(notes_per_bar: int = 8, bars: int = 4) -> ScoreJson:
    """Eighths slurred in fours: two bow changes a bar, six notes under them."""
    return _score([
        Measure(
            measure_number=bar + 1,
            notes=[Note(pitch="E2", duration="eighth") for _ in range(notes_per_bar)],
            slurs=[
                Slur(start_note_index=0, end_note_index=3),
                Slur(start_note_index=4, end_note_index=7),
            ],
        )
        for bar in range(bars)
    ])


def test_a_slurred_passage_played_as_written_aligns_perfectly() -> None:
    """The clip the corpus keeps for this could not pass before: 32 written
    notes, 8 of them attacked, and coverage-weighted quality capped at 8/32."""
    timeline = build_timeline(_slurred_score(), target_bpm=60.0)
    assert len(timeline.notes) == 8, "eight bow changes in four bars"

    played = to_timeline_base(timeline.onsets.copy())
    result = align_dtw(played, timeline.onsets, target_bpm=60.0)
    assert result.quality == pytest.approx(1.0)


def test_playing_detache_against_written_slurs_is_told_apart_from_a_wrong_piece() -> None:
    """The cost of the change above, and the one thing that makes it bearable.

    A musician who bows every note separately produces an attack for each one,
    against a timeline expecting only the bow changes — so it fails. That is a
    real mismatch between the page and the playing, but "check you're on the
    right piece" is the wrong advice for it, and would send someone to
    re-photograph a score that is fine.

    Told apart by covering *every* expected onset while carrying far more
    detected ones. A wrong piece misses expected onsets, which is why the
    branch requires none missing.
    """
    from app.services.analysis import _why_alignment_failed

    timeline = build_timeline(_slurred_score(), target_bpm=60.0)
    expected = timeline.onsets

    detache = to_timeline_base(np.arange(32, dtype=float) * (expected[1] - expected[0]) / 4)
    raw = align_dtw(detache, expected, target_bpm=60.0)
    # The claim is the discrimination, not the opening words: this branch has
    # to name the slurs, and must not send anyone to re-photograph a score
    # that is fine. Asserted the same way the wrong-piece case below is.
    detache_why = _why_alignment_failed(raw, detache, expected)
    assert "slurs" in detache_why
    assert "right piece" not in detache_why

    rng = np.random.default_rng(1)
    wrong = to_timeline_base(np.sort(rng.uniform(0, float(expected[-1]), 8)))
    other = align_dtw(wrong, expected, target_bpm=60.0)
    assert "right piece" in _why_alignment_failed(other, wrong, expected)


# ---------------------------------------------------------------------------
# Sections nest, and the inner one is expanded first
# ---------------------------------------------------------------------------


def _minuet() -> ScoreJson:
    """`|: A :| |: B :|` then *D.C. al Fine* — ordinary form, not an edge case.

    Two spans inside a third: the A repeat, the B repeat, and the da capo,
    whose "first ending" is the B section because it is played once, before
    the jump back.
    """
    def bar(number: int) -> Measure:
        return Measure(
            measure_number=number,
            notes=[Note(pitch="D3", duration="whole")],
        )

    return ScoreJson(
        time_signature="4/4",
        clef="bass",
        measures=[bar(n) for n in (1, 2, 3, 4)],
        repeats=[
            Repeat(start_measure=1, end_measure=2, type="repeat"),
            Repeat(start_measure=3, end_measure=4, type="repeat"),
            Repeat(start_measure=1, end_measure=4, type="repeat"),
            Repeat(start_measure=3, end_measure=4, type="first_ending"),
        ],
        ocr_confidence=1.0,
    )


def test_a_repeat_inside_a_da_capo_is_taken_on_both_passes() -> None:
    """**Measured before this was recursive: six bars against a player's
    twelve.** Two faults produced that one number and both are the same shape.

    The outer span never fired at all, because the first span *starting* at bar
    1 consumed bars 1–2 and marked them done. And the da capo's first ending —
    bars 3–4 — was applied to the inner B repeat as well, deleting its second
    pass. A rule right about its own span and wrong beside its neighbour, for
    the fifth time this session.
    """
    played = [m.measure_number for m in expand_repeats(_minuet())]

    assert played == [1, 2, 1, 2, 3, 4, 3, 4, 1, 2, 1, 2]


def test_an_ending_that_starts_where_its_section_starts_is_not_its_ending() -> None:
    """The scoping rule, on its own.

    A first ending cannot begin where its section begins — there would be
    nothing before it to repeat. That is what separates the da capo's tail
    (bars 3–4 of a span starting at 1) from the inner B repeat, whose span
    *is* bars 3–4.
    """
    score = ScoreJson(
        time_signature="4/4",
        clef="bass",
        measures=[
            Measure(measure_number=n, notes=[Note(pitch="D3", duration="whole")])
            for n in (1, 2)
        ],
        repeats=[
            Repeat(start_measure=1, end_measure=2, type="repeat"),
            Repeat(start_measure=1, end_measure=2, type="first_ending"),
        ],
        ocr_confidence=1.0,
    )

    # The bracket covers the whole span, so it is not this span's ending and
    # both bars are played twice.
    assert [m.measure_number for m in expand_repeats(score)] == [
        1, 2, 1, 2
    ]


def test_two_spans_naming_the_same_bars_terminate() -> None:
    """The recursion excludes a span identical to the one being expanded, and
    caps depth regardless. A duplicate is what a mis-read repeat sign produces,
    and hanging the analysis worker on one would cost the whole take."""
    score = _minuet()
    score.repeats.append(Repeat(start_measure=1, end_measure=4, type="repeat"))

    assert len(expand_repeats(score)) == 12


def test_one_sections_ending_does_not_reach_into_another() -> None:
    """**Found by a mutation that survived.** `bracketed` filters on the span's
    start, and also on the ending lying inside the span's own bars. Without the
    second half, a bracket printed over section B is applied to section A —
    deleting bars from a pass that never had an ending at all.

    Two independent repeated sections, each with its own first and second
    ending, is what a strophic piece looks like.
    """
    def bar(number: int) -> Measure:
        return Measure(
            measure_number=number, notes=[Note(pitch="D3", duration="whole")]
        )

    score = ScoreJson(
        time_signature="4/4",
        clef="bass",
        measures=[bar(n) for n in range(1, 9)],
        repeats=[
            # A: bars 1-3, first ending 3, second ending 4.
            Repeat(start_measure=1, end_measure=3, type="repeat"),
            Repeat(start_measure=3, end_measure=3, type="first_ending"),
            Repeat(start_measure=4, end_measure=4, type="second_ending"),
            # B: bars 5-7, first ending 7, second ending 8.
            Repeat(start_measure=5, end_measure=7, type="repeat"),
            Repeat(start_measure=7, end_measure=7, type="first_ending"),
            Repeat(start_measure=8, end_measure=8, type="second_ending"),
        ],
        ocr_confidence=1.0,
    )

    assert [m.measure_number for m in expand_repeats(score)] == [
        1, 2, 3, 1, 2, 4,
        5, 6, 7, 5, 6, 8,
    ]


def test_an_ending_that_overruns_its_section_is_ignored_rather_than_obeyed() -> None:
    """**The remaining half of that mutation, and a decision rather than a
    guard.** `bracketed` requires the whole bracket to lie inside the span. Drop
    that and a bracket straddling the span's last bar still removes its opening
    bars from the second pass.

    A bracket that does not fit inside the section it belongs to is a
    misreading — precisely what OCR produces from a bracket line that runs on.
    Ignoring it costs one repeat's worth of nuance; obeying it deletes bars the
    musician plays, from a section that reads perfectly otherwise. The same
    trade `expand_repeats` already makes for a repeat naming bars that do not
    exist.
    """
    def bar(number: int) -> Measure:
        return Measure(
            measure_number=number, notes=[Note(pitch="D3", duration="whole")]
        )

    score = ScoreJson(
        time_signature="4/4",
        clef="bass",
        measures=[bar(n) for n in range(1, 6)],
        repeats=[
            Repeat(start_measure=1, end_measure=3, type="repeat"),
            # Runs past bar 3, where the section ends.
            Repeat(start_measure=3, end_measure=5, type="first_ending"),
        ],
        ocr_confidence=1.0,
    )

    assert [m.measure_number for m in expand_repeats(score)] == [
        1, 2, 3, 1, 2, 3, 4, 5
    ]


def test_a_repeat_naming_bars_that_do_not_exist_is_ignored_not_fatal() -> None:
    """**The promise five dead guards were there to keep.**

    `expand_repeats` says it: *"OCR produces those, and losing the whole take
    to a mis-read repeat sign would be the wrong trade."* Nothing tested it,
    and the conditions enforcing it had been dead since the recursion replaced
    the iterative version — `play` only ever selects a span whose end appears
    in the bars after its start, so a span naming a bar that is not there, or
    running backwards, is never chosen at all.

    Removing the guards was safe. Leaving the promise unchecked was not.
    """
    def bar(number: int) -> Measure:
        return Measure(
            measure_number=number, notes=[Note(pitch="D3", duration="whole")]
        )

    def played(repeats: list[Repeat]) -> list[int]:
        score = ScoreJson(
            time_signature="4/4",
            clef="bass",
            measures=[bar(n) for n in (1, 2, 3)],
            repeats=repeats,
            ocr_confidence=1.0,
        )
        return [m.measure_number for m in expand_repeats(score)]

    assert played([Repeat(start_measure=1, end_measure=9, type="repeat")]) == [1, 2, 3]
    assert played([Repeat(start_measure=7, end_measure=9, type="repeat")]) == [1, 2, 3]
    assert played([Repeat(start_measure=3, end_measure=1, type="repeat")]) == [1, 2, 3]
    assert played([Repeat(start_measure=2, end_measure=2, type="first_ending")]) == [
        1, 2, 3
    ]


def test_the_played_order_is_never_empty() -> None:
    """The fifth dead guard, and why it could not fire.

    A span's **first** bar survives both passes: an ending only applies to a
    span that starts strictly before it, so a bracket on the opening bar is not
    that span's ending and filters nothing. Even a bar marked as both endings
    at once — what a misread pair of brackets looks like — only costs that bar.
    """
    def bar(number: int) -> Measure:
        return Measure(
            measure_number=number, notes=[Note(pitch="D3", duration="whole")]
        )

    score = ScoreJson(
        time_signature="4/4",
        clef="bass",
        measures=[bar(1), bar(2)],
        repeats=[
            Repeat(start_measure=1, end_measure=2, type="repeat"),
            Repeat(start_measure=2, end_measure=2, type="first_ending"),
            Repeat(start_measure=2, end_measure=2, type="second_ending"),
        ],
        ocr_confidence=1.0,
    )

    assert [m.measure_number for m in expand_repeats(score)] == [1, 1]


# ---------------------------------------------------------------------------
# A fermata: the one length a page deliberately does not state
# ---------------------------------------------------------------------------


def _held(numbers: list[int], fermata_on: tuple[int, int] | None = None) -> ScoreJson:
    """Four quarters per bar, optionally with a fermata at `(bar, note)`."""
    measures = []
    for number in numbers:
        notes = []
        for index in range(4):
            notes.append(
                Note(
                    pitch="D3",
                    duration="quarter",
                    fermata=fermata_on == (number, index),
                )
            )
        measures.append(Measure(measure_number=number, notes=notes))
    return ScoreJson(
        time_signature="4/4", clef="bass", measures=measures, ocr_confidence=1.0
    )


def test_the_note_after_a_fermata_is_the_one_marked() -> None:
    """**The fermata's own attack is on time.**

    It arrives when the previous note ends, like any other. What the hold moves
    is the arrival of the note *after* it, and that is what gets judged — so
    that is what carries the mark.
    """
    timeline = build_timeline(_held([1, 2], fermata_on=(1, 3)), 60.0)

    assert [n.after_fermata for n in timeline.notes] == [
        False, False, False, False,   # bar 1, the fourth of which is held
        True, False, False, False,    # bar 2 opens on the moved note
    ]


def test_a_fermata_at_a_barline_marks_the_next_bar() -> None:
    """Which is where fermatas mostly are — at the end of a phrase — and why
    the flag is carried across the measure loop rather than reset per bar."""
    timeline = build_timeline(_held([1, 2, 3], fermata_on=(2, 3)), 60.0)

    marked = [i for i, n in enumerate(timeline.notes) if n.after_fermata]

    assert marked == [8]
    assert timeline.notes[8].measure_number == 3


def test_a_take_with_no_fermata_marks_nothing() -> None:
    timeline = build_timeline(_held([1, 2]), 60.0)

    assert not any(n.after_fermata for n in timeline.notes)


def test_the_note_after_a_fermata_is_not_told_it_dragged() -> None:
    """**The point of all of it.**

    `pulse_anchors` re-anchors after a run that departs from the take's habit,
    so a hold does not poison the rest of the piece — but it deliberately
    *keeps* the drift on the notes inside the run, because a bar genuinely
    played slow is dragging and has to say so. It cannot tell a hold from a
    hesitation.

    So without the mark, a musician who held a fermata exactly as printed is
    told they dragged, on the note the page told them to arrive late on. The
    band is refused there, the same way it is under a written `rit.` — not a
    softening, a refusal to answer a question the page declined to ask.
    """
    import numpy as np

    from app.services.classification import Band, compute_deltas

    score = _held([1, 2], fermata_on=(1, 3))
    timeline = build_timeline(score, 60.0)

    # Played exactly, except the fermata is held half a beat longer — so every
    # note from the next one on arrives 0.5s late until the pulse re-anchors.
    detected = np.array(
        [t + (0.5 if i >= 4 else 0.0) for i, t in enumerate(timeline.onsets)]
    )
    cleaned = apply_fuzzy_match(
        align_dtw(detected, timeline.onsets), detected, timeline.onsets
    )

    found = compute_deltas(cleaned, detected, timeline, target_bpm=60.0)
    after = [d for d in found if d.measure_number == 2 and d.expected_ms == 4000.0]

    assert after, "the note after the fermata was not judged at all"
    assert all(d.band is Band.on for d in after), [
        (d.expected_ms, d.band, d.delta_pct) for d in after
    ]


def test_a_fermata_over_a_rest_moves_the_next_note_too() -> None:
    """**A held silence is a hold.**

    A pause before an entry is written as a fermata over a rest, and the note
    after it arrives just as late as one after a held note — the clock advances
    by the written rest while the musician waits longer.

    This was wrong: the flag was set only for a fermata on a *sounding* note.
    A mutation removing that guard survived, and looking at why showed the
    mutation was the correct version.
    """
    score = ScoreJson(
        time_signature="4/4",
        clef="bass",
        measures=[
            Measure(
                measure_number=1,
                notes=[
                    Note(pitch="D3", duration="half"),
                    Note(pitch="rest", duration="half", fermata=True),
                ],
            ),
            Measure(
                measure_number=2,
                notes=[Note(pitch="D3", duration="whole")],
            ),
        ],
        ocr_confidence=1.0,
    )

    timeline = build_timeline(score, 60.0)

    # The rest sounds nothing, so only two notes are expected — and the second
    # of them is the one the held silence moves.
    assert [n.after_fermata for n in timeline.notes] == [False, True]


def test_the_mark_survives_the_bar_it_was_printed_in() -> None:
    """A fermata sits at the end of a phrase, so it is usually the last note of
    a bar — and the note it moves is the first of the next one. Resetting the
    flag per measure would make it do nothing in exactly the place it is
    always printed."""
    timeline = build_timeline(_held([1, 2], fermata_on=(1, 3)), 60.0)

    assert timeline.notes[4].measure_number == 2
    assert timeline.notes[4].after_fermata is True
