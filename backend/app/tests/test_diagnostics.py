"""The diagnostics layer must agree with `analyze()`, not approximate it.

The dashboard's whole value is that a number on screen is the number the
pipeline used. If these two ever drift apart, tuning is being done against a
model of the pipeline rather than the pipeline, and every threshold that comes
out of it is suspect. That is the property worth a test.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.analysis import analyze
from app.services.diagnostics import analyze_with_diagnostics, envelope_of
from app.services.score_schema import ScoreJson
from app.tests.audio_helpers import evenly_spaced, synth_click_track

SR = 22050
BPM = 60.0


def _score(n_notes: int) -> ScoreJson:
    per_measure = 4
    measures = [
        {
            "measure_number": m + 1,
            "notes": [{"pitch": "E2", "duration": "quarter"} for _ in range(per_measure)],
            "slurs": [],
        }
        for m in range(n_notes // per_measure)
    ]
    return ScoreJson.model_validate(
        {
            "time_signature": "4/4",
            "clef": "bass",
            "measures": measures,
            "repeats": [],
            "ocr_confidence": 1.0,
        }
    )


@pytest.fixture
def clean_take() -> tuple[np.ndarray, int]:
    return synth_click_track(evenly_spaced(8, BPM), sr=SR), SR


def test_diagnostics_matches_analyze(clean_take):
    """Same verdict, same counts, same quality — one pipeline, two views of it."""
    score = _score(8)
    result = analyze(clean_take, score, BPM)
    diag = analyze_with_diagnostics(clean_take, score, BPM)

    assert diag.status == result.status
    assert diag.verdict == result.verdict
    assert diag.quality == result.quality
    assert diag.n_detected == result.n_detected_onsets
    assert diag.n_expected == result.n_expected_onsets
    assert len(diag.missed_expected) == result.n_missed_notes
    assert len(diag.extra_detected) == result.n_extra_notes
    assert diag.trend == result.trend
    assert [d.delta_ms for d in diag.deltas] == [n.delta_ms for n in result.per_note]
    assert [d.band for d in diag.deltas] == [n.band for n in result.per_note]


def test_diagnostics_keeps_the_working(clean_take):
    """The intermediate state `analyze()` throws away is what the dashboard draws."""
    diag = analyze_with_diagnostics(clean_take, _score(8), BPM)

    assert diag.status == "ok"
    assert len(diag.detected_onsets) == 8
    assert len(diag.expected_onsets) == 8
    assert diag.raw_pairs, "DTW's mapping should survive to the diagnostics"
    assert len(diag.matched) == 8
    assert diag.envelope.peaks
    assert diag.envelope.sample_rate == SR
    assert diag.config is not None
    assert diag.target_bpm == BPM


def test_a_config_override_actually_changes_the_result(clean_take):
    """The sidebar's override has to reach the pipeline, or the page lies."""
    import dataclasses

    from app.services.audio_config import load_audio_config

    base = load_audio_config()
    # A delta this high should suppress detection entirely on a quiet-ish click
    # track — the point is only that the value is *used*, not what it does.
    deaf = dataclasses.replace(
        base, onset=dataclasses.replace(base.onset, delta=5.0)
    )

    normal = analyze_with_diagnostics(clean_take, _score(8), BPM)
    overridden = analyze_with_diagnostics(clean_take, _score(8), BPM, config=deaf)

    assert normal.n_detected == 8
    assert overridden.n_detected < normal.n_detected


def test_no_onsets_is_returned_not_raised():
    """Silence is a thing the dashboard has to be able to show, not a crash."""
    silence = (np.zeros(SR * 2, dtype=np.float32), SR)
    diag = analyze_with_diagnostics(silence, _score(8), BPM)

    assert diag.status == "no_onsets"
    assert diag.detected_onsets == []
    # The expected grid still comes back — it's what the clip failed to match.
    assert len(diag.expected_onsets) == 8
    assert diag.envelope.duration_s == pytest.approx(2.0, abs=0.01)


def test_envelope_keeps_peaks_not_averages():
    """A one-sample transient must survive downsampling, or onsets vanish from the plot."""
    y = np.zeros(SR, dtype=np.float32)
    y[SR // 2] = 1.0

    env = envelope_of(y, SR, buckets=100)

    assert max(env.peaks) == pytest.approx(1.0)
    assert len(env.peaks) == 100
    # Everything except the spike's bucket is silent.
    assert sum(1 for p in env.peaks if p > 0.01) == 1


def test_envelope_of_empty_audio():
    env = envelope_of(np.array([], dtype=np.float32), SR)
    assert env.peaks == []
    assert env.duration_s == 0.0
