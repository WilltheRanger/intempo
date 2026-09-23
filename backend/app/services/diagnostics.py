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

from itertools import pairwise

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.services.alignment import (
    align_dtw,
    apply_fuzzy_match,
    is_alignment_broken,
    to_timeline_base,
)
from app.services.analysis import Reading, prepare_for_alignment
from app.services.audio_config import AudioConfig, load_audio_config
from app.services.classification import (
    Delta,
    compute_deltas,
    generate_verdict,
    rolling_trend,
)
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
    # `pairwise`, not `zip(edges[:-1], edges[1:])`. The two slices differ in
    # length by one *on purpose*, so `strict=` has no right answer here —
    # and the intent is consecutive pairs, which is what this says.
    peaks = [float(magnitude[a:b].max()) if b > a else 0.0 for a, b in pairwise(edges)]
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
    instrument: str | None = None

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
    instrument: str | None = None,
    config: AudioConfig | None = None,
) -> Diagnostics:
    """`analyze()`, with the intermediate state kept instead of discarded.

    Returns rather than raises on the two graceful failures, exactly as
    `analyze()` does — a clip with no detectable onsets is a thing the
    dashboard has to be able to *show*, since that is the failure being tuned
    away.
    """
    cfg = config or load_audio_config()
    # `analyze()`'s own preamble, called rather than copied. It used to be
    # copied, and the copy passed `closest_expected_gap(expected)` without the
    # `optional=` the real one passes — so on any page with an ornament the
    # dashboard sized the detector's window off the acciaccatura and showed
    # onsets the pipeline would never have produced.
    heard = prepare_for_alignment(
        audio,
        score,
        target_bpm,
        instrument=instrument,
        double_bass=double_bass,
        config=cfg,
    )
    y, sr = heard.y, heard.sr
    timeline = heard.timeline
    expected = heard.expected
    onsets = heard.onsets

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
        base.verdict = (
            "Nothing to compare. No notes were detected, or the score has none."
        )
        return base

    # `base.detected_onsets` above stays in the recording's clock, because the
    # envelope plot is drawn in that clock and the marks have to sit on the
    # waveform. Everything downstream of here works in the timeline's clock,
    # exactly as `analyze()` does.
    onsets = to_timeline_base(onsets)

    # The same masks `analyze()` reads off a `Reading`, so a diagnostic run and
    # a real one do not disagree about a page with ornaments on it. This is the
    # page as written: the dashboard shows what the detector made of the page
    # a musician is tuning against, not which other reading `analyze()` may
    # have preferred for a take.
    as_written = Reading(name="as written", timeline=timeline)
    optional = as_written.optional
    steady = as_written.steady
    raw = align_dtw(
        onsets,
        expected,
        target_bpm=target_bpm,
        config=cfg,
        steady=steady,
        optional=optional,
    )
    base.quality = round(raw.quality, 3)
    base.raw_pairs = list(raw.mapping)

    if is_alignment_broken(raw.quality, config=cfg):
        base.status = "alignment_failed"
        base.verdict = (
            f"Alignment broke: quality {raw.quality:.3f} is under the broken threshold."
        )
        return base

    cleaned = apply_fuzzy_match(
        raw, onsets, expected, optional=optional, reclaimable=as_written.reclaimable
    )
    deltas = compute_deltas(cleaned, onsets, timeline, target_bpm, config=cfg)

    base.matched = list(cleaned.matched)
    base.missed_expected = list(cleaned.missed_expected)
    base.extra_detected = list(cleaned.extra_detected)
    base.deltas = deltas
    base.trend = rolling_trend(deltas, config=cfg)
    base.low_confidence = raw.quality < cfg.alignment.warn_quality
    base.verdict = generate_verdict(deltas, target_bpm, config=cfg).text
    return base
