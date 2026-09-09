"""Every check in this suite, run against pages a model actually read.

Everything else that exercises the analysis builds its score by hand, and a
hand-built score is a score shaped like whatever the author was thinking about.
These are the cached responses from real photographs — a printed page, a
handwritten one, one whose header was illegible so the metre reads "unknown" —
and they are the only place the chain runs end to end on shapes nobody chose:

    what a model returned → the beat check → the expected timeline →
    onset detection → matching → the verdict

The performance is synthesised *from the transcription's own timeline*, so it is
by construction exactly what the page asks for. Anything the pipeline says about
it beyond "steady" is the pipeline being wrong.

This exists because a session of changes to the matcher, the tempo estimate, the
confidence measure and the verdict were all validated against six audio clips of
uniform quarter notes and a handful of scores the author wrote. That is a narrow
place to stand.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from app.services.alignment import build_timeline
from app.services.analysis import analyze
from app.services.ocr.validate import validate_measures
from app.services.score_schema import ScoreJson
from app.tests.audio_helpers import MIC_NOISE_FLOOR, bass_scale, synth_bowed_note

SR = 22050
BPM = 72.0

CACHE = Path(__file__).resolve().parents[3] / "fixtures" / "ocr_responses"

#: Below this there is nothing for an alignment to be right or wrong about.
#: One cached response is an empty read, which is a real thing for the pipeline
#: to return and not a thing to analyse.
MIN_ONSETS = 3


def _scores() -> list[tuple[str, ScoreJson]]:
    out = []
    for path in sorted(CACHE.glob("*.json")):
        payload = json.loads(path.read_text())
        response = payload.get("ocr_response")
        if not response or "score" not in response:
            continue
        out.append((path.name[:10], ScoreJson.model_validate(response["score"])))
    return out


def _play_exactly(timeline) -> np.ndarray:
    """The page, performed to the letter, with a lead-in and a room floor."""
    onsets = list(timeline.onsets + 1.0)
    gaps = np.diff(timeline.onsets)
    held = list(gaps) + [float(np.median(gaps))]

    total = onsets[-1] + held[-1] + 1.0
    y = np.zeros(int(total * SR), dtype=np.float32)
    pitches = bass_scale(len(onsets))
    for index, (at, duration) in enumerate(zip(onsets, held, strict=True)):
        note = synth_bowed_note(pitches[index], max(0.08, duration * 0.7), rise_s=0.035)
        start = int(at * SR)
        end = min(start + note.size, y.size)
        y[start:end] += note[: end - start]

    y = y / max(1e-9, float(np.abs(y).max())) * 0.6
    rng = np.random.default_rng(11)
    return np.clip(
        y + rng.normal(0, MIC_NOISE_FLOOR, y.size).astype(np.float32), -1.0, 1.0
    ).astype(np.float32)


ANALYSABLE = [
    pytest.param(name, score, id=name)
    for name, score in _scores()
    if build_timeline(score, BPM).onsets.size >= MIN_ONSETS
]


def test_there_are_pages_to_test_against() -> None:
    """A glob that matches nothing is a suite that passes for the wrong reason."""
    assert len(ANALYSABLE) >= 3


@pytest.mark.parametrize("name,score", ANALYSABLE)
def test_a_real_page_played_exactly_reads_as_exact(name: str, score: ScoreJson) -> None:
    timeline = build_timeline(score, BPM)

    result = analyze((_play_exactly(timeline), SR), score, target_bpm=BPM, double_bass=True)

    assert result.status == "ok"
    assert result.low_confidence is False, f"{name}: quality {result.quality}"
    assert len(result.per_note) == timeline.onsets.size, (
        f"{name}: matched {len(result.per_note)} of {timeline.onsets.size} written notes"
    )
    assert result.n_missed_notes == 0 and result.n_extra_notes == 0
    off = [m.measure_number for m in result.per_measure if m.worst_band != "on"]
    assert off == [], f"{name}: bars {off} called off-tempo in a perfect performance"


@pytest.mark.parametrize("name,score", ANALYSABLE)
def test_a_real_page_is_not_flagged_as_mis_transcribed(name: str, score: ScoreJson) -> None:
    """The beat check, on transcriptions that were accepted as good.

    Not a claim that these readings are *correct* — nobody has checked them
    against the photographs bar by bar. It is a claim that the checks do not
    fire on them, which is what a false-positive regression would break. Two of
    these pages have an illegible metre and are checked against one inferred
    from the music, which is the commonest case for a phone photo.
    """
    flagged = [
        (f.measure_number, f.verdict) for f in validate_measures(score) if f.is_problem
    ]
    assert flagged == [], f"{name}: {flagged}"
