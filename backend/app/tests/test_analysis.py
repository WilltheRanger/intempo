"""Tests for services/analysis.py — the end-to-end orchestrator."""

from __future__ import annotations

import json

from app.services.analysis import analyze
from app.services.classification import Band, Direction, classify_band
from app.services.score_schema import Measure, Note, ScoreJson
from app.tests.audio_helpers import evenly_spaced, synth_click_track, write_wav

SR = 22050


def _eight_quarter_note_score() -> ScoreJson:
    return ScoreJson(
        clef="treble",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[
            Measure(measure_number=1, notes=[Note(pitch="A4", duration="quarter")] * 4),
            Measure(measure_number=2, notes=[Note(pitch="A4", duration="quarter")] * 4),
        ],
    )


def test_ornaments_the_musician_did_not_play_are_not_missed_notes(tmp_path) -> None:
    """A page with grace notes, played straight — the common case.

    An acciaccatura sits inside the onset detector's own resolution, and plenty
    of musicians do not play the printed ornaments at all. The timeline carries
    an onset for each of them, so without the `optional` mask reaching
    `align_dtw` and `apply_fuzzy_match` this take is reported as skipped notes
    and its quality falls by the coverage they cost.

    Two ornaments over eight notes. **A page where half the notes carry one and
    none of them is heard is still refused** — measured at 0.16 with seven
    notes called skipped — and that is a real limit rather than a tuning
    accident: the timeline then alternates a 0.425 s gap with a 0.075 s one,
    which is not a stretched version of anything the musician played. The
    honest range is in `EDIT_LOG.md`, 2026-08-27.
    """
    score = _eight_quarter_note_score()
    for measure in score.measures:
        measure.notes[1] = measure.notes[1].model_copy(update={"grace_notes": 1})
    times = evenly_spaced(8, bpm=120.0)
    path = write_wav(tmp_path / "straight.wav", synth_click_track(times, sr=SR), sr=SR)

    result = analyze(path, score, target_bpm=120.0)

    assert result.status == "ok"
    assert result.n_missed_notes == 0
    assert result.n_extra_notes == 0
    # The same take without ornaments printed scores above 0.9. What is lost is
    # the two decorated notes, which are excluded from the straight-line fit
    # quality is measured against — see `analyze`'s `steady`. Comfortably above
    # `warn_quality`, so no caveat reaches the musician.
    assert result.quality > 0.8
    assert result.low_confidence is False
    assert len(result.per_note) == 8


def test_analyze_clean_recording_is_ok_and_steady(tmp_path) -> None:
    score = _eight_quarter_note_score()
    # Play exactly on the 120 BPM grid the score expects.
    times = evenly_spaced(8, bpm=120.0)
    path = write_wav(tmp_path / "clean.wav", synth_click_track(times, sr=SR), sr=SR)

    result = analyze(path, score, target_bpm=120.0)

    assert result.status == "ok"
    assert result.quality > 0.9
    assert result.low_confidence is False
    assert len(result.per_note) == 8
    assert result.verdict_direction.value == "on"


def test_analyze_rushing_recording_reports_rushed(tmp_path) -> None:
    """A take played faster than the target reads as rushing.

    Played at 110 against a target of 100, not 132 against 120. Both of those
    are the same 10% overshoot, but 132 BPM quarter notes are 455 ms apart and
    the peak-picking window is `pre_max`/`post_max` = 20 frames — **±464 ms** at
    hop 512 and 22.05 kHz. A window wider than the gap means adjacent notes
    suppress each other, so the detector found 5 of these 8 clicks and the test
    was really measuring the peak-picker, not the verdict. It passed on quality
    0.430 against a 0.400 broken-threshold: one nudge from red either way.

    Detection is complete to 120 BPM in quarters and collapses at 132 — a
    ceiling of roughly 64 BPM in eighth notes. That is a real limit on real
    repertoire and it is a *threshold* question, so it is recorded for the
    tuning session rather than fixed by moving a number here to make a test
    green.
    """
    score = _eight_quarter_note_score()
    times = evenly_spaced(8, bpm=110.0)  # 10% faster than target → rushing
    path = write_wav(tmp_path / "rush.wav", synth_click_track(times, sr=SR), sr=SR)

    result = analyze(path, score, target_bpm=100.0)

    assert result.status == "ok"
    assert len(result.per_note) == 8, "every click should be detected at this rate"
    assert "rushed" in result.verdict
    assert result.verdict_direction.value == "rush"


def test_analyze_result_serializes_to_json(tmp_path) -> None:
    score = _eight_quarter_note_score()
    times = evenly_spaced(8, bpm=120.0)
    path = write_wav(tmp_path / "clip.wav", synth_click_track(times, sr=SR), sr=SR)

    result = analyze(path, score, target_bpm=120.0)

    payload = json.loads(result.model_dump_json())
    assert payload["status"] == "ok"
    assert isinstance(payload["per_note"], list)
    assert isinstance(payload["trend"], list)
    assert isinstance(payload["verdict"], str)


def test_analyze_silence_returns_no_onsets(tmp_path) -> None:
    import numpy as np

    score = _eight_quarter_note_score()
    silence = np.zeros(SR * 2, dtype="float32")
    path = write_wav(tmp_path / "silent.wav", silence, sr=SR)

    result = analyze(path, score, target_bpm=120.0)

    assert result.status == "no_onsets"
    assert result.n_detected_onsets == 0


def test_analyze_partial_take_fails_alignment_gracefully(tmp_path) -> None:
    # Score expects 8 notes; the player got two notes in and stopped
    # (wrong page, or gave up). Coverage is far too low to trust, so we
    # refuse to report rather than inventing a verdict from two onsets.
    score = _eight_quarter_note_score()
    times = [0.2, 0.7]
    path = write_wav(tmp_path / "partial.wav", synth_click_track(times, sr=SR), sr=SR)

    result = analyze(path, score, target_bpm=120.0)

    assert result.status == "alignment_failed"
    assert result.quality < 0.4


def test_analyze_runs_well_under_15_seconds(tmp_path) -> None:
    import time

    score = _eight_quarter_note_score()
    times = evenly_spaced(8, bpm=120.0)
    path = write_wav(tmp_path / "perf.wav", synth_click_track(times, sr=SR), sr=SR)

    started = time.perf_counter()
    analyze(path, score, target_bpm=120.0)
    assert time.perf_counter() - started < 15.0  # DoD: <15s per fixture pair


def _tuned_config():
    """A config whose bands are nothing like the defaults, and asymmetric."""
    import dataclasses

    from app.services.audio_config import ToleranceConfig, load_audio_config

    cfg = load_audio_config()
    return dataclasses.replace(
        cfg,
        tolerance=ToleranceConfig(
            rushing_inner_pct=3.0,
            rushing_mid_pct=7.0,
            rushing_outer_pct=14.0,
            dragging_inner_pct=4.0,
            dragging_mid_pct=9.0,
            dragging_outer_pct=18.0,
        ),
    )


def test_the_result_records_the_thresholds_it_was_judged_by(tmp_path) -> None:
    """Otherwise a reader has to assume they match its own copy of them.

    Two places in the app draw a take against the outer threshold — the
    deviation bar and the trend chart — and both held a hard-coded 20. The
    moment these are tuned against real recordings, which is the entire purpose
    of `TUNING_LOG.md`, those charts start lying about takes the pipeline judged
    correctly. Sending the numbers with the result is what stops that.
    """
    score = _eight_quarter_note_score()
    times = evenly_spaced(8, bpm=120.0)
    path = write_wav(tmp_path / "clean.wav", synth_click_track(times, sr=SR), sr=SR)

    result = analyze(path, score, target_bpm=120.0, config=_tuned_config())

    assert result.tolerance is not None
    assert result.tolerance.rushing_outer_pct == 14.0
    assert result.tolerance.dragging_outer_pct == 18.0, (
        "the two sides are independent — a reader that assumes one number "
        "mis-scales whichever side it guessed wrong"
    )


def test_a_take_with_nothing_to_hear_still_says_what_it_would_have_used(
    tmp_path,
) -> None:
    """The thresholds are a property of the run, not of its outcome.

    A failed take is still drawn on a screen, and a reader that has to branch
    on status to know whether it can trust the scale will get that branch wrong
    exactly once.
    """
    import numpy as np

    score = _eight_quarter_note_score()
    path = write_wav(tmp_path / "silent.wav", np.zeros(SR * 2, dtype="float32"), sr=SR)

    result = analyze(path, score, target_bpm=120.0, config=_tuned_config())

    assert result.status == "no_onsets"
    assert result.tolerance is not None
    assert result.tolerance.rushing_inner_pct == 3.0


def test_alignment_failure_carries_them_too(tmp_path) -> None:
    score = _eight_quarter_note_score()
    path = write_wav(
        tmp_path / "partial.wav", synth_click_track([0.2, 0.7], sr=SR), sr=SR
    )

    result = analyze(path, score, target_bpm=120.0, config=_tuned_config())

    assert result.status == "alignment_failed"
    assert result.tolerance is not None
    assert result.tolerance.dragging_mid_pct == 9.0


def test_the_thresholds_survive_the_round_trip_into_result_json(tmp_path) -> None:
    """`result_json` is a jsonb column, and this is what the app actually reads."""
    score = _eight_quarter_note_score()
    times = evenly_spaced(8, bpm=120.0)
    path = write_wav(tmp_path / "clean.wav", synth_click_track(times, sr=SR), sr=SR)

    result = analyze(path, score, target_bpm=120.0, config=_tuned_config())
    payload = json.loads(result.model_dump_json())

    assert payload["tolerance"] == {
        "rushing_inner_pct": 3.0,
        "rushing_mid_pct": 7.0,
        "rushing_outer_pct": 14.0,
        "dragging_inner_pct": 4.0,
        "dragging_mid_pct": 9.0,
        "dragging_outer_pct": 18.0,
    }


def test_a_result_stored_before_this_existed_still_loads() -> None:
    """Rows already in the table have no `tolerance`, and must not fail to parse.

    The app falls back to its own copy for those. That fallback is the reason
    the field is nullable rather than required, and deleting it later needs a
    backfill, not a schema edit.
    """
    from app.services.analysis import AnalysisResult

    old = AnalysisResult(status="ok", quality=0.9, verdict="You held the tempo")
    assert old.tolerance is None


def test_a_page_shorter_than_the_take_says_bars_are_missing(tmp_path) -> None:
    """The likeliest transcription failure in an orchestral part, and the one
    nothing else can see.

    A multi-measure rest — a bar with a number over it — read as a single bar
    of rest leaves the timeline short by every bar the number stood for. The
    beat-sum check passes, because one whole rest in 4/4 adds up. The alignment
    then fails at quality 0.000 and the musician used to be told to check they
    were on the right piece, which is the wrong place to look: the recording is
    fine and the page is short.
    """
    from app.tests.audio_helpers import bass_scale, synth_bowed_take

    def page(rest_bars: int) -> ScoreJson:
        measures = [
            Measure(
                measure_number=1, notes=[Note(pitch="E2", duration="quarter")] * 4
            )
        ]
        for _ in range(rest_bars):
            measures.append(
                Measure(
                    measure_number=len(measures) + 1,
                    notes=[Note(pitch="rest", duration="whole")],
                )
            )
        for _ in range(4):
            measures.append(
                Measure(
                    measure_number=len(measures) + 1,
                    notes=[Note(pitch="E2", duration="quarter")] * 4,
                )
            )
        return ScoreJson(
            clef="bass", time_signature="4/4", ocr_confidence=0.9, measures=measures
        )

    # The musician plays the page as printed: one bar, eight bars' rest, four bars.
    times: list[float] = []
    clock = 1.0
    for measure in page(8).measures:
        for note in measure.notes:
            beats = 4.0 if note.duration == "whole" else 1.0
            if note.pitch != "rest":
                times.append(clock)
            clock += beats
    y = synth_bowed_take(times, freqs_hz=bass_scale(len(times)), note_dur_s=0.55)

    good = analyze((y, SR), page(8), target_bpm=60.0, double_bass=True)
    assert good.status == "ok", "the correctly-read page has to still work"

    short = analyze((y, SR), page(1), target_bpm=60.0, double_bass=True)
    assert short.status == "alignment_failed"
    assert "longer than this page" in short.verdict
    assert "rest bar with a number over it" in short.verdict
    assert "right piece" not in short.verdict, "that is the wrong place to send them"


def test_playing_slowly_is_not_called_a_missing_page(tmp_path) -> None:
    """The thing that message must never accuse.

    Practising under tempo makes the take longer than the page too, and it is
    the most ordinary thing a musician does. The threshold sits past the tempo
    clamp for exactly this reason: inside it, a longer take is a slower tempo
    by definition.
    """
    import numpy as np

    from app.services.analysis import _take_is_much_longer_than_the_page

    page = np.arange(20, dtype=float)
    assert not _take_is_much_longer_than_the_page(page * 1.5, page)
    assert not _take_is_much_longer_than_the_page(page * 1.7, page)
    assert _take_is_much_longer_than_the_page(page * 3.0, page)


def test_a_take_too_short_to_compare_is_not_accused(tmp_path) -> None:
    import numpy as np

    from app.services.analysis import _take_is_much_longer_than_the_page

    assert not _take_is_much_longer_than_the_page(np.array([1.0]), np.arange(20.0))
    assert not _take_is_much_longer_than_the_page(np.arange(20.0), np.array([1.0]))


def test_a_bars_average_leaves_out_the_notes_that_were_not_timed() -> None:
    """One grace note used to move a whole bar's reading.

    `compute_deltas` refuses to band four kinds of note — under a `rit.`, after
    a fermata, an ornament, and the note an ornament decorates — because in
    each the deviation is real and is not an error. `worst_band` was already
    safe, since an untimed note's band is `on`. `avg_delta_pct` was not, and it
    is the number the app draws as the bar's deviation bar.

    An ornament is the sharpest case: its "expected" time is `ORNAMENT_SHARE`
    splitting the difference between two readings an engraver may have meant —
    a number this code invented — so a delta measured against it can move a bar
    a musician played perfectly.
    """
    from app.services.analysis import _summarize_measures
    from app.services.classification import Delta

    def delta(pct: float, idx: int, timed: bool = True) -> Delta:
        return Delta(
            global_index=idx,
            measure_number=1,
            expected_ms=0.0,
            actual_ms=0.0,
            delta_ms=pct * 5.0,
            delta_pct=pct,
            band=classify_band(pct) if timed else Band.on,
            direction=Direction.on,
            is_slur_interior=False,
            timed=timed,
        )

    steady = [delta(2.0, i) for i in range(3)]
    ornament = delta(90.0, 3, timed=False)

    (bar,) = _summarize_measures(steady + [ornament])

    assert bar.note_count == 4
    assert bar.timed_note_count == 3
    # 2.0, not the 24.0 that averaging the ornament in gives.
    assert bar.avg_delta_pct == 2.0


def test_a_bar_with_nothing_timed_still_reports_a_number() -> None:
    """A bar that is entirely a `rit.` has to say something.

    Falling back to the whole bar keeps `avg_delta_pct` a number on every
    measure — a field that is sometimes absent is worse than one that is
    sometimes not a verdict. `timed_note_count == 0` is what says so, and the
    app reads that rather than the average.
    """
    from app.services.analysis import _summarize_measures
    from app.services.classification import Delta

    rit = [
        Delta(
            global_index=i,
            measure_number=1,
            expected_ms=0.0,
            actual_ms=0.0,
            delta_ms=200.0,
            delta_pct=40.0,
            band=Band.on,
            direction=Direction.on,
            is_slur_interior=False,
            under_tempo_change=True,
            timed=False,
        )
        for i in range(3)
    ]

    (bar,) = _summarize_measures(rit)

    assert bar.timed_note_count == 0
    assert bar.avg_delta_pct == 40.0
    assert bar.under_tempo_change is True


def test_a_wholly_held_bar_reports_why_it_was_not_timed() -> None:
    """**"Not timed" reads as the app failing; "held" reads as the page.**

    A bar that is one held chord — the commonest last bar there is — went
    unjudged for a reason the pipeline knew and dropped one field short of the
    screen. The app then had a single sentence covering a fermata, an ornament
    and a `rit.`, which are three different things and only one of them is a
    limitation of this code.
    """
    from app.services.analysis import _summarize_measures
    from app.services.classification import Delta

    def held(idx: int, reason: str) -> Delta:
        return Delta(
            global_index=idx,
            measure_number=1,
            expected_ms=0.0,
            actual_ms=0.0,
            delta_ms=0.0,
            delta_pct=40.0,
            band=Band.on,
            direction=Direction.on,
            is_slur_interior=False,
            timed=False,
            untimed_reason=reason,  # type: ignore[arg-type]
        )

    (bar,) = _summarize_measures([held(0, "fermata"), held(1, "fermata")])

    assert bar.timed_note_count == 0
    assert bar.untimed_reason == "fermata"


def test_a_bar_whose_untimed_notes_disagree_names_no_reason() -> None:
    """A fermata *and* an ornament in one bar has no single answer, and
    inventing a headline for it would be worse than the honest silence the app
    already falls back to."""
    from app.services.analysis import _summarize_measures
    from app.services.classification import Delta

    def untimed(idx: int, reason: str) -> Delta:
        return Delta(
            global_index=idx,
            measure_number=1,
            expected_ms=0.0,
            actual_ms=0.0,
            delta_ms=0.0,
            delta_pct=10.0,
            band=Band.on,
            direction=Direction.on,
            is_slur_interior=False,
            timed=False,
            untimed_reason=reason,  # type: ignore[arg-type]
        )

    (bar,) = _summarize_measures([untimed(0, "fermata"), untimed(1, "ornament")])

    assert bar.untimed_reason is None


def test_a_bar_with_any_timed_note_names_no_reason() -> None:
    """The reason captions the whole row, so it may only be given when it
    explains the whole row. A bar with measured notes in it has a verdict, and
    that verdict is what the row should say."""
    from app.services.analysis import _summarize_measures
    from app.services.classification import Delta

    def note(idx: int, timed: bool, reason: str | None = None) -> Delta:
        return Delta(
            global_index=idx,
            measure_number=1,
            expected_ms=0.0,
            actual_ms=0.0,
            delta_ms=0.0,
            delta_pct=2.0,
            band=Band.on,
            direction=Direction.on,
            is_slur_interior=False,
            timed=timed,
            untimed_reason=reason,  # type: ignore[arg-type]
        )

    (bar,) = _summarize_measures([note(0, True), note(1, False, "fermata")])

    assert bar.timed_note_count == 1
    assert bar.untimed_reason is None


def test_a_silent_take_is_told_the_microphone_heard_nothing(tmp_path) -> None:
    """Not "record louder" — that is the one thing that cannot help here.

    A muted input produces the same zeros however hard the musician plays, so
    the old advice sent them to repeat the take and get the identical file. See
    `_why_nothing_to_compare` for the measurement.
    """
    import numpy as np

    score = _eight_quarter_note_score()
    path = write_wav(tmp_path / "silent.wav", np.zeros(SR * 2, dtype="float32"), sr=SR)

    result = analyze(path, score, target_bpm=120.0)

    assert result.status == "no_onsets"
    assert "microphone" in result.verdict
    assert "louder" not in result.verdict


def test_an_empty_transcription_is_not_blamed_on_the_playing(tmp_path) -> None:
    """A page with no notes read off it says so, and names where to look.

    Both conditions are true when a silent take meets an empty score, and the
    score is named first on purpose: no amount of re-recording makes a page
    with nothing on it analysable, so pointing at the microphone would cost a
    second take and change nothing.
    """
    empty = ScoreJson(
        clef="treble",
        time_signature="4/4",
        ocr_confidence=0.9,
        measures=[Measure(measure_number=1, notes=[])],
    )
    times = evenly_spaced(8, bpm=120.0)
    path = write_wav(tmp_path / "played.wav", synth_click_track(times, sr=SR), sr=SR)

    played = analyze(path, empty, target_bpm=120.0)
    import numpy as np

    silent = analyze(
        write_wav(tmp_path / "silent.wav", np.zeros(SR * 2, dtype="float32"), sr=SR),
        empty,
        target_bpm=120.0,
    )

    for result in (played, silent):
        assert result.status == "no_onsets"
        assert "transcription" in result.verdict
        assert "microphone" not in result.verdict


def test_the_detector_hears_the_same_notes_however_quiet_the_take_is(tmp_path) -> None:
    """The measurement behind "louder" being useless advice.

    `onset_strength` differences a dB-scaled mel spectrogram, so scaling the
    waveform shifts every frame by a constant that the differencing removes.
    A take at the bottom of 16-bit resolution therefore analyses exactly as
    well as a loud one — which is why the only recording that reaches
    `no_onsets` is a digitally silent one, and why the advice for it has to
    name the input rather than the playing.

    This is the claim `_why_nothing_to_compare`'s docstring rests on. If it
    ever stops holding, that docstring is wrong and so is the message.
    """
    import numpy as np

    from app.services import audio as audio_svc
    from app.services.audio_config import load_audio_config

    cfg = load_audio_config()
    times = evenly_spaced(8, bpm=120.0)
    loud = synth_click_track(times, sr=SR)
    loud = loud / float(np.max(np.abs(loud)))

    counts = []
    for dbfs in (0, -40, -80, -90):
        # Requantised to 16 bit, because that is what the app uploads: a float
        # scaled to -90 dBFS is not the same thing as one that survived a WAV.
        scaled = loud * (10 ** (dbfs / 20))
        pcm = np.clip(np.round(scaled * 32767.0), -32768, 32767).astype(np.int16)
        y = pcm.astype(np.float32) / 32768.0
        onsets = audio_svc.detect_onsets(
            audio_svc.pre_emphasis(y, config=cfg), SR, config=cfg
        )
        counts.append(int(onsets.size))

    assert counts[0] == 8, "the loud take is the control"
    assert len(set(counts)) == 1, f"level changed the reading: {counts}"
