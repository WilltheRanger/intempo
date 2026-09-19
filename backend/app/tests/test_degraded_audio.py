"""What the detector survives, and the one thing it does not.

**Every synthetic fixture in this repository is a clean close-mic recording**
— one room mode, a -60 dBFS floor, no reflections, no limiting. A musician
props a phone on a stand across a room with hard walls and an extractor fan
running, and the detector has to find the same onsets in that. Nothing
measured whether it could, so "is this robust to a worse recording" had no
answer and every threshold was chosen against the easy case.

**The headline is a negative result, and it is worth as much as a fix.** Noise,
clipping and reverb-on-their-own do not break onset detection. At 0 dB SNR,
under hard clipping, and in a 2-second room, all 24 notes are still found with
6–8 ms of jitter. What moves is the *systematic lag* — 42 ms clean to 65 ms
degraded — and a constant lag is free, because `_residuals` fits offset and
rate before quality is measured. Lowering `delta` or adding a denoiser would
be tuning something that is not broken, which is the mistake
`docs/subsystems.md` records from 2026-09-14.

**The first version of this sweep said the opposite**, and the correction is
the lesson. Matching detections to truth within 50 ms, recall fell to 0.00 at
0 dB SNR while `n_detected` stayed at 24 — the detector was finding every note
and the window was measuring the lag rather than the detection. A tolerance
narrower than a known systematic offset measures the offset.

What *does* break it is **dynamic range against a reverberant room**, which no
clean fixture can contain: the tail of a loud note raises the floor under the
attack of a quiet one, and a globally-normalised envelope never lets that
attack clear `delta`. Precision stays at 1.00 while recall halves — the quiet
notes are not mistimed, they are gone.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.audio import detect_onsets
from app.tests.audio_helpers import (
    MIC_NOISE_FLOOR,
    OPEN_D2,
    add_noise_at_snr,
    add_room_reverb,
    apply_clipping,
    bass_scale,
    detection_scores,
    evenly_spaced,
    synth_bowed_note,
    synth_bowed_take,
)

SR = 22050
BPM = 92.0
N_NOTES = 24

#: Wide enough that a systematic lag does not read as a miss — see the module
#: docstring. What survives the offset fit is jitter, which is asserted
#: separately and is the number that actually costs a take.
MATCH_TOLERANCE_S = 0.20


@pytest.fixture(scope="module")
def clean_take() -> tuple[np.ndarray, list[float]]:
    truth = evenly_spaced(N_NOTES, BPM)
    y = synth_bowed_take(
        truth,
        sr=SR,
        freqs_hz=bass_scale(N_NOTES, root_hz=OPEN_D2),
        note_dur_s=0.45,
    )
    return y, truth


def _scores(y: np.ndarray, truth: list[float]) -> dict[str, float]:
    return detection_scores(detect_onsets(y, SR), truth, tol_s=MATCH_TOLERANCE_S)


def test_the_clean_take_is_found_exactly(clean_take):
    """The baseline every case below is compared against."""
    y, truth = clean_take
    s = _scores(y, truth)

    assert s["recall"] == 1.0
    assert s["precision"] == 1.0


@pytest.mark.parametrize("snr_db", [40, 30, 20, 10, 5, 0])
def test_broadband_noise_does_not_lose_notes(clean_take, snr_db):
    """**Down to 0 dB SNR** — noise as loud as the playing.

    The detector differences a dB-scaled mel spectrogram, so a raised floor
    shifts frames by roughly a constant and the differencing removes most of
    it. This is the same property that makes it amplitude-invariant
    (`TUNING_LOG.md`, 2026-09-02), and it is why a noisy room is not the
    problem it sounds like.
    """
    y, truth = clean_take
    s = _scores(add_noise_at_snr(y, snr_db), truth)

    assert s["recall"] == 1.0, f"lost notes at {snr_db} dB SNR"
    # A spurious extra or two is acceptable; doubling every note is not.
    assert s["precision"] >= 0.9


@pytest.mark.parametrize(
    "rt60_s,wet", [(0.4, 0.25), (0.6, 0.35), (0.9, 0.45), (1.5, 0.55), (2.0, 0.65)]
)
def test_reverb_alone_does_not_lose_notes(clean_take, rt60_s, wet):
    """A 2-second room, which is a hall rather than a practice room.

    Reverb alone smears the attack and therefore *delays* the flux peak — 42 ms
    dry to 65 ms at RT60 2.0 — but the peak is still there and still the local
    maximum, because every note is equally loud. Pair it with dynamics and it
    stops being true; see below.
    """
    y, truth = clean_take
    s = _scores(add_room_reverb(y, SR, rt60_s=rt60_s, wet=wet), truth)

    assert s["recall"] == 1.0, f"lost notes at RT60 {rt60_s}s"


@pytest.mark.parametrize("headroom_db", [0, 3, 6, 12, 20])
def test_clipping_does_not_lose_notes(clean_take, headroom_db):
    """A phone's input stage flattening the loudest transients.

    Counter-intuitively the mildest *help*: clipping compresses the peak the
    envelope is normalised against, which lifts every other attack relative to
    it. Nothing here depends on that, and it is asserted only as "does not
    lose notes".
    """
    y, truth = clean_take
    s = _scores(apply_clipping(y, headroom_db), truth)

    assert s["recall"] == 1.0, f"lost notes at -{headroom_db} dB headroom"


def test_the_lag_grows_with_degradation_but_the_jitter_does_not(clean_take):
    """**The measurement that reframed this whole file.**

    Degradation delays the detected onset; it does not scatter it. Lag rises by
    about half again, jitter stays where it was — and `_residuals` fits offset
    and rate per take, so the lag is paid for and the jitter is what is left.
    A take recorded across a room is judged on the same timing evidence as one
    recorded up close.
    """
    y, truth = clean_take
    worst = apply_clipping(
        add_noise_at_snr(add_room_reverb(y, SR, rt60_s=0.9, wet=0.45), 15), 6
    )

    clean, degraded = _scores(y, truth), _scores(worst, truth)

    assert degraded["recall"] == 1.0
    assert degraded["mean_error_ms"] > clean["mean_error_ms"] + 10, "expected more lag"
    # The number that survives the fit. Allowed to move a little, not to double.
    assert degraded["jitter_ms"] < clean["jitter_ms"] * 1.6


def _alternating_dynamics(span_db: float) -> tuple[np.ndarray, list[float]]:
    """Loud, quiet, loud, quiet — what a passage with dynamics does to a
    peak-picker that requires a local maximum."""
    gap = 60.0 / BPM
    truth = [0.3 + i * gap for i in range(N_NOTES)]
    freqs = bass_scale(N_NOTES, root_hz=OPEN_D2)
    y = np.zeros(int((truth[-1] + 1.0) * SR), dtype=np.float32)

    for index, onset in enumerate(truth):
        amp = 1.0 if index % 2 == 0 else 10 ** (-span_db / 20)
        note = synth_bowed_note(freqs[index], 0.45, sr=SR) * amp
        start = int(onset * SR)
        end = min(start + note.size, y.size)
        y[start:end] += note[: end - start]

    y = y / max(1e-9, float(np.abs(y).max())) * 0.6
    noise = np.random.default_rng(3).normal(0, MIC_NOISE_FLOOR, y.size)
    return (y + noise).astype(np.float32), truth


@pytest.mark.parametrize("span_db", [0, 12, 20, 30])
def test_dynamics_alone_are_fine(span_db):
    """30 dB between loud and quiet, in a dry room: every note found.

    Which is what makes the pair below a *reverb* finding rather than a
    dynamics one. Neither ingredient breaks it alone.
    """
    y, truth = _alternating_dynamics(span_db)
    s = _scores(y, truth)

    assert s["recall"] == 1.0, f"lost notes at {span_db} dB range, dry"


@pytest.mark.parametrize(
    "span_db,found_at_most",
    [
        # Measured 2026-09-19. These are a *ceiling on current behaviour*, not
        # a target: the assertion is `<=`, so the day this is fixed these
        # tests fail and have to be raised deliberately rather than silently
        # passing a pipeline that got better.
        (20, 0.75),
        (30, 0.60),
    ],
)
def test_dynamics_under_reverb_silently_lose_the_quiet_notes(span_db, found_at_most):
    """**The open defect this file was written to find.**

    The tail of a loud note raises the floor under the attack of the quiet one
    that follows, and the onset envelope is normalised against the take's
    global maximum — so the quiet attack never clears `delta`. At 20 dB of
    range in a 0.9-second room, 16 of 24 notes are found; at 30 dB, 12 of 24.
    Exactly the quiet ones.

    **Precision stays at 1.00.** Nothing spurious is reported and nothing is
    mistimed. The notes are simply gone, which is the worst shape this failure
    could take: `coverage` falls, `quality` is `timing_quality * coverage`, and
    a musician who played musically in a live room is told the take could not
    be read — or, worse, is shown a verdict computed from half their notes with
    no sign that the other half went missing.

    A musician playing with dynamics, with a phone across the room, is not an
    edge case. It is the product.

    The fix is not a lower `delta` — that would raise the floor everywhere and
    cost precision on every clean take. It is a *local* threshold: judge each
    attack against its own neighbourhood rather than against the loudest moment
    of the take.
    """
    y, truth = _alternating_dynamics(span_db)
    s = _scores(add_room_reverb(y, SR, rt60_s=0.9, wet=0.45), truth)

    assert s["recall"] <= found_at_most, (
        f"detection improved at {span_db} dB under reverb "
        f"({s['recall']:.2f}) — raise this ceiling deliberately"
    )
    # The half of the finding that says what kind of failure it is.
    assert s["precision"] == 1.0, "quiet notes are lost, not mistimed"
