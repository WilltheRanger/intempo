"""The three numbers a musician gets that the verdict cannot carry.

Each one is checked against a take built to have a known answer, because the
failure mode here is not a crash — it is a plausible number that is wrong by a
factor, shown confidently on a screen nobody can check it against.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.insights import (
    MIN_NOTES_FOR_INSIGHT,
    Insights,
    NoteValueTiming,
    insights_for,
    lead_finding,
    played_tempo,
    standout_note_value,
    steadiness,
    tempo_across_bars,
    tempo_by_bar,
    tempo_drift,
    timing_by_note_value,
)

TARGET = 60.0
N = 24


def _take(factor: float, *, n: int = N):
    """A take of `n` notes played `factor` times the written duration.

    `factor` below 1 is faster than written: every gap is shorter, so the take
    finishes early.
    """
    expected = np.arange(n, dtype=float)  # one written second per note
    detected = 0.4 + expected * factor
    matched = [(i, i) for i in range(n)]
    return matched, detected, expected


class TestPlayedTempo:
    @pytest.mark.parametrize(
        "factor,expected_bpm",
        [(0.8, 75.0), (0.9, 66.7), (1.0, 60.0), (1.1, 54.5), (1.25, 48.0)],
    )
    def test_the_pace_is_recovered_exactly(self, factor, expected_bpm):
        """The measurement this module was written from: against takes
        synthesised at known tempi the recovered figure is exact, not an
        estimate that needs hedging."""
        matched, detected, expected = _take(factor)

        assert played_tempo(matched, detected, expected, TARGET) == pytest.approx(
            expected_bpm, abs=0.1
        )

    def test_a_take_that_starts_late_still_reports_its_pace(self):
        """Offset is not pace. A musician who came in a bar late played the
        piece at the speed they played it, and reporting them slow for
        starting late would be reporting the count-in."""
        matched, detected, expected = _take(1.0)
        detected = detected + 5.0

        assert played_tempo(matched, detected, expected, TARGET) == pytest.approx(
            TARGET, abs=0.1
        )

    def test_too_few_notes_reports_nothing(self):
        matched, detected, expected = _take(1.0, n=MIN_NOTES_FOR_INSIGHT - 1)

        assert played_tempo(matched, detected, expected, TARGET) is None

    def test_a_take_matched_onto_one_written_instant_has_no_pace(self):
        """`polyfit` will return a slope for a vertical set of points. A
        number is not better than nothing when it means nothing."""
        matched = [(i, i) for i in range(N)]
        detected = np.arange(N, dtype=float)
        expected = np.zeros(N)

        assert played_tempo(matched, detected, expected, TARGET) is None


class TestTempoDrift:
    def test_a_take_that_speeds_up_is_reported_as_speeding_up(self):
        """The insight the verdict cannot give: not "you were fast" but
        "you got faster"."""
        n = 30
        expected = np.arange(n, dtype=float)
        # Each gap shrinks steadily: an accelerando across the take.
        gaps = np.linspace(1.15, 0.85, n)
        detected = 0.4 + np.cumsum(np.concatenate([[0.0], gaps[:-1]]))
        matched = [(i, i) for i in range(n)]

        drift = tempo_drift(matched, detected, expected, TARGET)

        assert drift is not None and drift > 5.0

    def test_an_even_take_has_no_drift(self):
        matched, detected, expected = _take(1.0, n=30)

        assert tempo_drift(matched, detected, expected, TARGET) == pytest.approx(
            0.0, abs=0.5
        )

    def test_playing_fast_evenly_is_not_drift(self):
        """**The distinction the whole function exists for.** A take played
        evenly at 75 against a target of 60 has a large tempo *difference* and
        no drift at all. Conflating them would tell a musician who held a
        steady, deliberately brisk tempo that they were accelerating."""
        matched, detected, expected = _take(0.8, n=30)

        assert played_tempo(matched, detected, expected, TARGET) == pytest.approx(
            75.0, abs=0.1
        )
        assert tempo_drift(matched, detected, expected, TARGET) == pytest.approx(
            0.0, abs=0.5
        )

    def test_a_take_too_short_to_have_two_ends_reports_nothing(self):
        """Three windows of eight, or nothing. A drift computed from four
        notes at each end moves with any one mistimed note."""
        matched, detected, expected = _take(1.0, n=20)

        assert tempo_drift(matched, detected, expected, TARGET) is None


class TestSteadiness:
    def test_two_takes_with_the_same_average_are_told_apart(self):
        """The reason this number exists. Both average zero; only one of them
        is control."""
        even = [1.0, -1.0] * 12
        swinging = [40.0, -40.0] * 12

        assert steadiness(even) is not None
        assert steadiness(swinging) > steadiness(even) * 10

    def test_a_consistent_offset_is_not_unsteady(self):
        """Playing consistently 8% behind the beat is a tempo finding, not a
        steadiness one — the notes are perfectly even with each other."""
        assert steadiness([8.0] * 24) == pytest.approx(0.0, abs=0.01)

    def test_playing_evenly_at_a_different_tempo_is_steady(self):
        """**The bug the first version shipped with, caught by measuring.**

        A take played perfectly evenly at 75 against a target of 60 has a
        delta that grows note after note, so an undetrended spread is
        dominated by that slope: it scored 138.5, against 6.0 for a take with
        genuine ±60 ms swings. The figure was ranking an even performance as
        the least steady thing in the set, and merely restating
        `tempo_difference_bpm` in another unit.
        """
        even_but_fast = [i * 2.0 for i in range(24)]

        assert steadiness(even_but_fast) == pytest.approx(0.0, abs=0.01)

    def test_an_accelerando_is_not_hidden_by_detrending(self):
        """Detrending removes a *constant* pace difference, not a changing
        one. A take that accelerates departs from any straight line, which is
        what keeps it visible here as well as in `drift_bpm`."""
        accelerating = [i * i * 0.5 for i in range(24)]

        assert steadiness(accelerating) > 5.0

    def test_too_few_notes_reports_nothing(self):
        assert steadiness([1.0, -1.0, 2.0]) is None


class TestInsightsFor:
    def test_each_field_is_independently_unknowable(self):
        """A twelve-note take has a pace and a spread but no trustworthy
        drift. Reporting nothing because one of three cannot be computed
        would throw away the two that can."""
        matched, detected, expected = _take(0.8, n=12)

        out = insights_for(matched, detected, expected, TARGET, [2.0] * 12)

        assert out.played_bpm == pytest.approx(75.0, abs=0.1)
        assert out.steadiness_pct is not None
        assert out.drift_bpm is None

    def test_the_difference_is_signed_from_the_musicians_point_of_view(self):
        """Positive means faster than asked for, which is the direction a
        musician reads it in."""
        matched, detected, expected = _take(0.8, n=N)

        out = insights_for(matched, detected, expected, TARGET, [1.0] * N)

        assert out.tempo_difference_bpm == pytest.approx(15.0, abs=0.1)

    def test_a_take_too_small_to_describe_says_nothing_rather_than_zero(self):
        """Zero is a claim. `None` is the absence of one, and a screen can
        tell them apart."""
        out = insights_for([], np.array([]), np.array([]), TARGET, [])

        assert out.as_dict() == {
            "by_note_value": [],
            "standout_value": None,
            "lead": None,
            "played_bpm": None,
            "tempo_difference_bpm": None,
            "drift_bpm": None,
            "steadiness_pct": None,
        }


class TestTimingByNoteValue:
    """The insight a metronome cannot give: not "you were fast" but "your
    quarters are fine and your sixteenths run away"."""

    def _mixed(self, sixteenth_delta: float):
        """A page of quarters, eighths and sixteenths, only one of which is
        mistimed."""
        return (
            [(1.0, 0.5)] * 32
            + [(0.5, -0.3)] * 36
            + [(0.25, sixteenth_delta)] * 16
        )

    def test_the_take_is_split_by_what_was_written(self):
        values = timing_by_note_value(self._mixed(-12.0))

        assert [v.label for v in values] == [
            "quarter notes",
            "eighth notes",
            "sixteenth notes",
        ]
        assert [v.note_count for v in values] == [32, 36, 16]

    def test_longest_value_first(self):
        """A musician reads a page from the long notes down, and a table that
        jumps between note values is a table nobody scans."""
        values = timing_by_note_value(self._mixed(-12.0))

        assert [v.beats for v in values] == sorted(
            [v.beats for v in values], reverse=True
        )

    def test_a_value_with_too_few_notes_is_not_reported(self):
        """Telling somebody they rush their sixteenths off four sixteenths is
        telling them about four notes."""
        values = timing_by_note_value([(1.0, 0.0)] * 20 + [(0.25, -30.0)] * 4)

        assert [v.beats for v in values] == [1.0]

    def test_a_length_with_no_plain_name_is_reported_without_one(self):
        """Inventing a name for 1.75 beats would be worse than the number.
        The count is still true and still groupable."""
        values = timing_by_note_value([(1.75, 2.0)] * 8 + [(1.0, 0.0)] * 8)

        odd = next(v for v in values if v.beats == 1.75)
        assert odd.label is None
        assert odd.note_count == 8


class TestStandoutNoteValue:
    def test_the_value_that_behaves_differently_is_named(self):
        """Measured end to end on a real page: with only the sixteenths
        pulled early, halves, quarters and eighths sit within ±1% and the
        sixteenths read −11.9%. The verdict for that take names a single
        measure; this names the habit."""
        values = timing_by_note_value(
            [(1.0, 0.9)] * 32 + [(0.5, -0.3)] * 36 + [(0.25, -11.9)] * 16
        )

        standout = standout_note_value(values)

        assert standout is not None
        assert standout.label == "sixteenth notes"

    def test_a_take_that_rushed_throughout_names_nothing(self):
        """**The distinction the rule exists for.** Every value rushing
        equally is the verdict's finding, and repeating it under a new heading
        as "your quarters rush" would be telling a musician to practise the
        thing they already know while implying the others are fine."""
        values = timing_by_note_value(
            [(1.0, -14.0)] * 32 + [(0.5, -14.0)] * 36 + [(0.25, -14.0)] * 16
        )

        assert standout_note_value(values) is None

    def test_an_even_take_names_nothing(self):
        values = timing_by_note_value(
            [(1.0, 0.2)] * 32 + [(0.5, -0.1)] * 36 + [(0.25, 1.3)] * 16
        )

        assert standout_note_value(values) is None

    def test_one_value_alone_cannot_stand_out(self):
        """There is nothing to stand out *from*. A page of nothing but
        quarters that rushed is a take that rushed."""
        values = timing_by_note_value([(1.0, -20.0)] * 32)

        assert standout_note_value(values) is None

    def test_a_dominant_value_is_measured_against_the_others_not_itself(self):
        """The baseline excludes the candidate. Without that, a value
        supplying most of the page would be compared against an average it
        mostly *is*, so it could never stand out however far it drifted —
        which is exactly backwards, since the commonest note value is the one
        a musician most needs told about."""
        values = timing_by_note_value([(1.0, -12.0)] * 60 + [(0.5, 0.0)] * 10)

        standout = standout_note_value(values)

        assert standout is not None and standout.beats == 1.0


class TestLeadFinding:
    """Which single thing a take is told about, when several are true."""

    def _insights(self, **kw) -> Insights:
        return Insights(**kw)

    def test_a_take_with_nothing_unusual_says_nothing(self):
        """**The common case, and the one that protects the rest.** A musician
        who played at the tempo they set, evenly, has already been told so by
        the verdict. A second line saying it again in other words teaches them
        this part of the screen is furniture, and then the line that matters
        is not read either."""
        clean = self._insights(
            played_bpm=92.0,
            tempo_difference_bpm=0.4,
            drift_bpm=0.3,
            steadiness_pct=0.7,
        )

        assert lead_finding(clean, 92.0) is None

    def test_the_tempo_gap_leads_when_it_is_the_biggest_thing(self):
        out = lead_finding(
            self._insights(
                played_bpm=75.0, tempo_difference_bpm=15.0, steadiness_pct=0.7
            ),
            60.0,
        )

        assert out is not None and out.kind == "tempo"
        assert "75" in out.text and "60" in out.text

    def test_the_note_value_beats_a_tempo_gap_nobody_would_notice(self):
        """**The reason this ranks rather than following a fixed order.** A
        2 BPM difference at 92 and a note value 12% of a beat adrift are both
        true; only one of them is worth the line, and a fixed priority list
        with tempo first would show the other."""
        out = lead_finding(
            self._insights(
                played_bpm=94.0,
                tempo_difference_bpm=2.0,
                by_note_value=[
                    NoteValueTiming(
                        beats=1.0, label="quarter notes", note_count=30,
                        mean_delta_pct=0.5,
                    ),
                    NoteValueTiming(
                        beats=0.25, label="sixteenth notes", note_count=16,
                        mean_delta_pct=-12.0,
                    ),
                ],
                standout_value=NoteValueTiming(
                    beats=0.25, label="sixteenth notes", note_count=16,
                    mean_delta_pct=-12.0,
                ),
            ),
            92.0,
        )

        assert out is not None and out.kind == "note_value"
        assert "sixteenth notes" in out.text
        assert "ran ahead" in out.text

    def test_a_lagging_value_is_described_as_lagging(self):
        out = lead_finding(
            self._insights(
                by_note_value=[
                    NoteValueTiming(beats=1.0, label="quarter notes",
                                    note_count=30, mean_delta_pct=0.0),
                    NoteValueTiming(beats=2.0, label="half notes",
                                    note_count=10, mean_delta_pct=14.0),
                ],
                standout_value=NoteValueTiming(
                    beats=2.0, label="half notes", note_count=10,
                    mean_delta_pct=14.0,
                ),
            ),
            92.0,
        )

        assert out is not None and "lagged" in out.text

    def test_drift_is_named_in_the_direction_it_happened(self):
        speeding = lead_finding(self._insights(drift_bpm=12.0), 92.0)
        slowing = lead_finding(self._insights(drift_bpm=-12.0), 92.0)

        assert speeding is not None and "sped up" in speeding.text
        assert slowing is not None and "slowed down" in slowing.text
        # The figure is unsigned in the sentence; the word carries direction.
        assert "-" not in slowing.text

    def test_drift_is_easier_to_report_than_a_tempo_difference(self):
        """Changing speed within one take is a worse habit than holding a
        different one, and harder to feel from inside — so the same number of
        BPM counts for more as drift. Asserted because the two thresholds
        being different is deliberate and looks like an inconsistency."""
        same_bpm = 5.0
        drift = lead_finding(self._insights(drift_bpm=same_bpm), 92.0)
        tempo = lead_finding(
            self._insights(played_bpm=97.0, tempo_difference_bpm=same_bpm), 92.0
        )

        assert drift is not None and tempo is not None
        assert drift.weight > tempo.weight

    def test_the_same_bpm_as_drift_wins_when_both_are_present(self):
        """The consequence of the line above, on one take rather than two:
        five BPM of drift and five BPM of tempo difference both clear, and
        drift is what gets said."""
        out = lead_finding(
            self._insights(
                played_bpm=97.0, tempo_difference_bpm=5.0, drift_bpm=5.0
            ),
            92.0,
        )

        assert out is not None and out.kind == "drift"

    def test_a_steadiness_finding_does_not_contradict_the_verdict(self):
        """It is shown on takes the verdict calls steady, so it has to agree
        that the average was fine and say what the average cannot."""
        out = lead_finding(self._insights(steadiness_pct=14.0), 92.0)

        assert out is not None and out.kind == "steadiness"
        assert "on average" in out.text

    def test_the_weight_is_carried_so_the_ranking_is_inspectable(self):
        out = lead_finding(
            self._insights(played_bpm=75.0, tempo_difference_bpm=15.0), 60.0
        )

        # 15 BPM against a 5%-of-60 threshold is five times over.
        assert out is not None and out.weight == pytest.approx(5.0, abs=0.1)

    def test_a_nonsense_target_reports_nothing(self):
        assert lead_finding(self._insights(tempo_difference_bpm=20.0), 0.0) is None


    def test_right_on_average_is_not_said_of_a_take_that_was_off_tempo(self):
        """The owner's take at 90 against 104 (2026-09-25) was told "Right on
        average, uneven note to note": its spread outweighed the tempo."""
        out = lead_finding(
            self._insights(
                played_bpm=90.0, tempo_difference_bpm=-14.0, steadiness_pct=36.0
            ),
            104.0,
        )

        assert out is not None and out.kind == "tempo"
        assert out.text == "You played at 90, not 104."


class TestSteadinessPerStretch:
    """Deltas are drift within a stretch of the pulse and jump where it
    re-anchors; one line through a take with a pause measured the jump."""

    def test_a_steady_take_with_a_pause_in_it_is_steady(self):
        # Two stretches, each drifting evenly at the same slow pace, the
        # second starting again from zero after the pause.
        first = [i * 12.0 for i in range(12)]
        second = [i * 12.0 for i in range(12)]
        positions = [float(i) for i in range(24)]
        pulses = [0] * 12 + [1] * 12

        per_stretch = steadiness(first + second, positions=positions, pulses=pulses)
        one_line = steadiness(first + second)

        assert per_stretch is not None and per_stretch < 0.5
        assert one_line is not None and one_line > 30

    def test_note_values_are_read_against_the_players_own_pace(self):
        """Steady at 90 against 104, the notes late in the page are the most
        behind the target — so half notes placed there "lagged" by 210% of a
        beat. Against the take's own line, nothing stands out."""
        n = 24
        written = np.arange(n, dtype=float)
        deltas = list(written * 15.0)  # a steady drift, note after note
        beats = [1.0] * 16 + [2.0] * 8  # the long notes come last
        out = insights_for(
            [(i, i) for i in range(n)],
            0.4 + written * 1.15,
            written,
            104.0,
            deltas,
            list(zip(beats, deltas, strict=True)),
            positions=list(written * 1000),
            pulses=[0] * n,
        )

        assert out.standout_value is None


class TestTempoByBar:
    """The tempo each bar was played at — what the verdict's charts plot."""

    @staticmethod
    def _bars(per_bar_bpm: list[float], notes_per_bar: int = 4, target: float = 104.0):
        """Quarter notes, each bar played at its own tempo."""
        written, played, bars = [], [], []
        t_w = t_p = 0.0
        for b, bpm in enumerate(per_bar_bpm, start=1):
            for _ in range(notes_per_bar):
                written.append(t_w)
                played.append(t_p)
                bars.append(b)
                t_w += 60.0 / target
                t_p += 60.0 / bpm
        return written, played, bars

    def test_a_steady_take_under_the_target_is_that_tempo_in_every_bar(self):
        """The take whose chart floored: steady at 90 against 104."""
        written, played, bars = self._bars([90.0] * 8)

        tempi = tempo_by_bar(written, played, bars, 104.0)

        assert set(tempi) == set(range(1, 9))
        assert all(v == pytest.approx(90.0, abs=0.2) for v in tempi.values())

    def test_a_take_that_slows_shows_where(self):
        written, played, bars = self._bars([104.0] * 4 + [80.0] * 4)

        tempi = tempo_by_bar(written, played, bars, 104.0)

        assert tempi[2] == pytest.approx(104.0, abs=0.2)
        assert tempi[7] == pytest.approx(80.0, abs=0.2)

    def test_a_bar_of_one_note_borrows_the_bar_before(self):
        """A tempo from one interval is one note's timing: the owner's last
        bar, one note paired early, read 264 BPM."""
        written, played, bars = self._bars([100.0] * 3)
        written.append(written[-1] + 60.0 / 104.0)
        played.append(played[-1] + 0.1)  # the last note, far too early
        bars.append(4)

        tempi = tempo_by_bar(written, played, bars, 104.0)

        assert tempi[4] < 200
        assert tempi[1] == pytest.approx(100.0, abs=0.2)

    def test_a_fermata_is_not_read_as_the_bar_dragging(self):
        written, played, bars = self._bars([104.0] * 4)
        # The first note of bar 3 comes after a hold the page does not time.
        cut = bars.index(3)
        played = played[:cut] + [p + 2.0 for p in played[cut:]]
        new_stretch = [i == cut for i in range(len(written))]

        tempi = tempo_by_bar(written, played, bars, 104.0, new_stretch=new_stretch)

        assert tempi[2] == pytest.approx(104.0, abs=0.2)

    def test_nothing_to_say_is_an_empty_answer(self):
        assert tempo_by_bar([], [], [], 104.0) == {}
        assert tempo_by_bar([0.0, 1.0], [0.0, 1.0], [1, 1], 0.0) == {}

    def test_a_skip_to_the_last_note_is_not_read_as_a_fast_bar(self):
        """The owner's take went from bar 24 to its last note with two notes
        unheard between: least squares read the last bar as 142 BPM."""
        written, played, bars = self._bars([96.0] * 6)
        # Bar 7: its first note on time, then the final note far too early —
        # the notes between were never played.
        step = 60.0 / 104.0
        written += [written[-1] + step, written[-1] + 5 * step]
        played += [played[-1] + 60.0 / 96.0, played[-1] + 60.0 / 96.0 + 0.6]
        bars += [7, 8]

        tempi = tempo_by_bar(written, played, bars, 104.0)

        assert all(v < 120 for v in tempi.values()), tempi

    def test_one_stray_attack_does_not_spike_its_bar(self):
        written, played, bars = self._bars([100.0] * 6)
        played[13] -= 0.25  # one note of bar 4 heard a quarter-second early

        tempi = tempo_by_bar(written, played, bars, 104.0)

        assert tempi[4] == pytest.approx(100.0, abs=5.0)

    def test_thin_bars_read_true_under_a_good_players_spread(self):
        """**Filtered where the number is made, not smoothed after.**

        The owner asked whether the chart should be smoothed (2026-09-25). A
        bar of two notes timed from three points is close to two notes'
        timing: sixteen such bars at 90, each note a normal 25 ms either side,
        read 1.8 BPM off on average over six takes. Five points — the bar
        before lends its notes — read 0.8.
        """
        errors = []
        for seed in range(6):
            written, played, bars = self._bars([90.0] * 16, notes_per_bar=2)
            rng = np.random.default_rng(seed)
            played = list(np.asarray(played) + rng.normal(0.0, 0.025, len(played)))
            tempi = tempo_by_bar(written, played, bars, 104.0)
            errors += [abs(v - 90.0) for v in tempi.values()]

        assert np.mean(errors) < 1.2

    def test_a_bar_with_notes_enough_of_its_own_keeps_a_real_change(self):
        """What smoothing the drawn line would have cost: a real slowing
        spread over the bars beside it. A bar of four is read from itself and
        the next downbeat, so the step lands where it was played."""
        written, played, bars = self._bars([104.0] * 4 + [80.0] * 4)

        tempi = tempo_by_bar(written, played, bars, 104.0)

        assert tempi[4] == pytest.approx(104.0, abs=0.5)
        assert tempi[5] == pytest.approx(80.0, abs=0.5)

    def test_an_opening_held_note_borrows_the_bars_after(self):
        """Nothing comes before bar 1, so a piece that opens on a whole note
        would have its chart start at bar 3."""
        step = 60.0 / 104.0
        written, played, bars = [0.0], [0.0], [1]
        more_w, more_p, more_b = self._bars([96.0] * 4)
        written += [4 * step + w for w in more_w]
        played += [4 * 60.0 / 96.0 + p for p in more_p]
        bars += [b + 1 for b in more_b]

        tempi = tempo_by_bar(written, played, bars, 104.0)

        assert tempi[1] == pytest.approx(96.0, abs=0.5)


class TestTempoAcrossBars:
    """The tempo of a run of bars — the figure the verdict line quotes."""

    def test_a_run_is_read_at_its_own_tempo(self):
        written, played, bars = TestTempoByBar._bars([104.0] * 4 + [80.0] * 4)

        assert tempo_across_bars(written, played, bars, 104.0, 5, 8) == pytest.approx(
            80.0, abs=0.5
        )
        assert tempo_across_bars(written, played, bars, 104.0, 1, 4) == pytest.approx(
            104.0, abs=0.5
        )

    def test_too_little_to_say_is_none(self):
        written, played, bars = TestTempoByBar._bars([90.0] * 4, notes_per_bar=1)

        assert tempo_across_bars(written, played, bars, 104.0, 2, 3) is None
        assert tempo_across_bars(written, played, bars, 104.0, 9, 12) is None
        assert tempo_across_bars([], [], [], 104.0, 1, 2) is None
