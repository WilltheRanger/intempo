"""BPM calibration from a ~2-second clip (spec §4 calibration flow).

Pure signal logic, deliberately HTTP-free so every edge case can be
tested against a synthesized clip without a request. The router
(`/v1/calibration`) is a thin wrapper: fetch bytes → load → `calibrate`.

Every threshold comes from `config.toml [calibration]`. The result is a
tagged outcome — either a usable BPM (optionally with 2×/0.5× alternates
or a "seems fast" warning) or an error `code` + human `message` the
client shows as a toast. We never surface a garbage number; when we
can't tell, we say so and the UI falls back to manual tap-tempo.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.services import audio as audio_svc
from app.services.audio_config import AudioConfig, load_audio_config


@dataclass
class CalibrationResult:
    ok: bool
    bpm: float | None = None
    alternates: list[float] | None = None  # e.g. [2×, 0.5×] on octave ambiguity
    warning: str | None = None  # non-fatal, e.g. "too_many_onsets"
    code: str | None = None  # error code when ok is False
    message: str | None = None  # human-facing toast text
    n_onsets: int | None = None


def _dbfs(x: float) -> float:
    return 20.0 * float(np.log10(x + 1e-9))


def calibrate(
    y: np.ndarray,
    sr: int,
    *,
    config: AudioConfig | None = None,
) -> CalibrationResult:
    """Infer a tempo from a calibration clip, or explain why we can't."""
    cfg = config or load_audio_config()
    cal = cfg.calibration

    duration = y.size / sr if sr else 0.0
    if duration < cal.min_duration_s:
        return CalibrationResult(
            ok=False, code="too_short",
            message="Hold a bit longer — at least 2 seconds.",
        )
    if duration > cal.max_duration_s:
        y = y[: int(cal.max_duration_s * sr)]  # truncate, then proceed

    peak = float(np.max(np.abs(y))) if y.size else 0.0
    rms = float(np.sqrt(np.mean(y**2))) if y.size else 0.0
    if _dbfs(peak) < cal.min_peak_dbfs or _dbfs(rms) < cal.min_rms_dbfs:
        return CalibrationResult(
            ok=False, code="too_quiet",
            message="Couldn't hear that — move closer to the mic and try again.",
        )

    onsets = audio_svc.detect_onsets(audio_svc.pre_emphasis(y, config=cfg), sr, config=cfg)
    n = int(onsets.size)
    if n < cal.min_onsets:
        return CalibrationResult(
            ok=False, code="too_few_onsets", n_onsets=n,
            message="We didn't hear at least 2 notes — try 3 or 4 quarter notes at your tempo.",
        )

    iois = np.diff(onsets)
    # **Two attacks is arithmetic, not policy.** `min_onsets` lives in
    # `config.toml` because §1.7 puts tuning there, and it is the one value in
    # this block that can be lowered past what the maths allows: at 1 a single
    # onset leaves `np.diff` empty, `np.mean` of that is `nan` with a
    # RuntimeWarning, and every test below it compares false — `nan <= 0`,
    # `nan > ioi_cv_max`, `nan < bpm_min` — so the clip walks the whole
    # function and returns `ok=True` with `bpm=nan` and the message
    # "Detected ♩=nan. Use this?". That number is also not JSON: serialising
    # the response raises `Out of range float values are not JSON compliant`.
    #
    # This module's own docstring is the rule being broken — *"We never
    # surface a garbage number; when we can't tell, we say so and the UI falls
    # back to manual tap-tempo."* So the floor is enforced here rather than
    # trusted to the setting: an interval needs two onsets, whatever the
    # config says, and one onset is `too_few_onsets` for the same reason zero
    # is.
    if iois.size == 0:
        return CalibrationResult(
            ok=False, code="too_few_onsets", n_onsets=n,
            message="We didn't hear at least 2 notes — try 3 or 4 quarter notes at your tempo.",
        )

    mean_ioi = float(np.mean(iois))
    if mean_ioi <= 0:
        return CalibrationResult(
            ok=False, code="out_of_range", n_onsets=n,
            message="That tempo seems out of normal range; try again or enter it manually.",
        )
    cv = float(np.std(iois) / mean_ioi)
    if cv > cal.ioi_cv_max:
        return CalibrationResult(
            ok=False, code="inconsistent", n_onsets=n,
            message="The notes weren't evenly spaced — play a steady quarter-note pulse.",
        )

    bpm = round(60.0 / float(np.median(iois)), 1)
    # **The range test cannot catch a non-finite tempo**, because every
    # comparison against `nan` is false and `inf` only fails one side. Both are
    # reachable from arithmetic rather than from a setting — a median interval
    # of exactly zero divides to `inf` — and the promise in this module's
    # docstring is about the number that leaves here, so it is checked on the
    # number that leaves here.
    if not np.isfinite(bpm) or bpm < cal.bpm_min or bpm > cal.bpm_max:
        return CalibrationResult(
            ok=False, code="out_of_range", n_onsets=n,
            message="That tempo seems out of normal range; try again or enter it manually.",
        )

    # Octave ambiguity: when the pulse is regular enough that half or
    # double time is equally plausible, offer both rather than guess.
    if cv < cal.octave_ambiguity_threshold:
        half, double = round(bpm / 2, 1), round(bpm * 2, 1)
        alternates = [b for b in (double, half) if cal.bpm_min <= b <= cal.bpm_max]
        if alternates:
            return CalibrationResult(
                ok=True, bpm=bpm, alternates=alternates, n_onsets=n,
                message=f"Detected ♩={bpm:g}. Use this?",
            )

    # "Crammed too many notes in" — still usable, but confirm it's not a slip.
    if n > cal.max_onsets:
        return CalibrationResult(
            ok=True, bpm=bpm, warning="too_many_onsets", n_onsets=n,
            message=f"Detected ♩={bpm:g}. That seems fast — is that right?",
        )

    return CalibrationResult(ok=True, bpm=bpm, n_onsets=n, message=f"Detected ♩={bpm:g}. Use this?")
