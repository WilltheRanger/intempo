"""The pipeline's internals, exposed for the tuning dashboard.

`analyze()` returns a verdict. Tuning needs the working: which onsets the
detector actually fired on, where the score said they should be, which pairs
DTW matched, and what fell out the sides. This module runs the same steps in
the same order and keeps all of it.

It is deliberately not a second implementation. Everything here calls the same
functions `analyze()` calls, with the same config object, so a number on the
dashboard is the number the pipeline used. The one thing it adds is a waveform
envelope for the plot, which the pipeline has no reason to compute.

See "Batch 3 Tuning Appendix" in `intempo-combined.md` for why this exists and
how it is meant to be used.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.services import audio as audio_svc
from app.services.alignment import (
    align_dtw,
    apply_fuzzy_match,
    build_timeline,
    is_alignment_broken,
    to_timeline_base,
    closest_expected_gap,
)
from app.services.audio_config import AudioConfig, load_audio_config
from app.services.classification import Delta, compute_deltas, generate_verdict, rolling_trend
from app.services.score_schema import ScoreJson


@dataclass(frozen=True)
class Envelope:
    """A peak envelope of the waveform, downsampled for drawing.

    Peak rather than mean: an attack is one or two samples wide at 22 kHz, and
    averaging a 5 ms bucket flattens exactly the transient the tuning is about.
    Each bucket keeps its largest absolute sample so onsets stay visible.
    """

    peaks: list[float]  # 0..1, one per bucket
    duration_s: float
    sample_rate: int


def envelope_of(y: np.ndarray, sr: int, *, buckets: int = 900) -> Envelope:
    duration = float(y.size) / sr if sr else 0.0
    if y.size == 0:
        return Envelope(peaks=[], duration_s=0.0, sample_rate=sr)

    edges = np.linspace(0, y.size, num=min(buckets, y.size) + 1, dtype=int)
    magnitude = np.abs(y)
    peaks = [float(magnitude[a:b].max()) if b > a else 0.0 for a, b in zip(edges[:-1], edges[1:])]
    ceiling = max(peaks) or 1.0
    return Envelope(
        peaks=[p / ceiling for p in peaks],
        duration_s=duration,
        sample_rate=sr,
    )


@dataclass
class Diagnostics:
    """Everything the dashboard draws, for one clip at one set of parameters."""

    status: str
    verdict: str
    quality: float
    low_confidence: bool

    envelope: Envelope
    detected_onsets: list[float]  # seconds
    expected_onsets: list[float]  # seconds, scaled to target_bpm

    # DTW's own opinion, before fuzzy matching cleans it up.
    raw_pairs: list[tuple[int, int]] = field(default_factory=list)
    matched: list[tuple[int, int]] = field(default_factory=list)
    missed_expected: list[int] = field(default_factory=list)
    extra_detected: list[int] = field(default_factory=list)

    deltas: list[Delta] = field(default_factory=list)
    trend: list[float] = field(default_factory=list)

    config: AudioConfig | None = None
    target_bpm: float = 0.0
    double_bass: bool = False

    @property
    def n_detected(self) -> int:
        return len(self.detected_onsets)

    @property
    def n_expected(self) -> int:
        return len(self.expected_onsets)

    @property
    def deviations_ms(self) -> list[float]:
        return [d.delta_ms for d in self.deltas]

    @property
    def worst_ms(self) -> float:
        """Largest absolute deviation, the number that moves first when tuning."""
        return max((abs(d.delta_ms) for d in self.deltas), default=0.0)

    @property
    def mean_abs_ms(self) -> float:
        if not self.deltas:
            return 0.0
        return sum(abs(d.delta_ms) for d in self.deltas) / len(self.deltas)


def analyze_with_diagnostics(
    audio: str | Path | tuple[np.ndarray, int],
    score: ScoreJson,
    target_bpm: float,
    *,
    double_bass: bool = False,
    config: AudioConfig | None = None,
) -> Diagnostics:
    """`analyze()`, with the intermediate state kept instead of discarded.

    Returns rather than raises on the two graceful failures, exactly as
    `analyze()` does — a clip with no detectable onsets is a thing the
    dashboard has to be able to *show*, since that is the failure being tuned
    away.
    """
    cfg = config or load_audio_config()

    if isinstance(audio, tuple):
        y, sr = audio
    else:
        y, sr = audio_svc.load_audio(audio, sr=cfg.onset.sr)

    if double_bass:
        y = audio_svc.high_pass(y, sr, cfg.onset.double_bass_highpass_hz)

    # Same order as `analyze()`: the score is read first so the detector knows
    # how close together the notes it is looking for are.
    timeline = build_timeline(score, target_bpm)
    expected = timeline.onsets

    onsets = audio_svc.detect_onsets(
        audio_svc.pre_emphasis(y, config=cfg),
        sr,
        double_bass=double_bass,
        config=cfg,
        min_gap_s=closest_expected_gap(expected),
    )

    # The envelope is of the signal as loaded, not as pre-emphasised: the plot
    # should look like the recording, while the onset marks show what the
    # detector made of it.
    base = Diagnostics(
        status="ok",
        verdict="",
        quality=0.0,
        low_confidence=False,
        envelope=envelope_of(y, sr),
        detected_onsets=[float(t) for t in onsets],
        expected_onsets=[float(t) for t in expected],
        config=cfg,
        target_bpm=target_bpm,
        double_bass=double_bass,
    )

    if onsets.size == 0 or expected.size == 0:
        base.status = "no_onsets"
        base.verdict = "No onsets to work with — nothing detected, or the score has no notes."
        return base

    # `base.detected_onsets` above stays in the recording's clock, because the
    # envelope plot is drawn in that clock and the marks have to sit on the
    # waveform. Everything downstream of here works in the timeline's clock,
    # exactly as `analyze()` does.
    onsets = to_timeline_base(onsets)

    raw = align_dtw(onsets, expected, target_bpm=target_bpm, config=cfg)
    base.quality = round(raw.quality, 3)
    base.raw_pairs = list(raw.mapping)

    if is_alignment_broken(raw.quality, config=cfg):
        base.status = "alignment_failed"
        base.verdict = f"Alignment broke: quality {raw.quality:.3f} is under the broken threshold."
        return base

    cleaned = apply_fuzzy_match(raw, onsets, expected)
    deltas = compute_deltas(cleaned, onsets, timeline, target_bpm, config=cfg)

    base.matched = list(cleaned.matched)
    base.missed_expected = list(cleaned.missed_expected)
    base.extra_detected = list(cleaned.extra_detected)
    base.deltas = deltas
    base.trend = rolling_trend(deltas, config=cfg)
    base.low_confidence = raw.quality < cfg.alignment.warn_quality
    base.verdict = generate_verdict(deltas, target_bpm, config=cfg).text
    return base
