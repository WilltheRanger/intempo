"""Tests for services/analysis.py — the end-to-end orchestrator."""

from __future__ import annotations

import json

from app.services.analysis import analyze
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
