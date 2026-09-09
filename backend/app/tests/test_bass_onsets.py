"""Can the pipeline hear a double bass?

`double_bass=True` reaches `analyze()` from a stored instrument preference, and
that wiring is tested. What it *does* — a 4th-order high-pass at 80 Hz and a
lower peak-pick threshold — had never been shown a bass. Every audio fixture in
this repo is an 880 Hz decaying sine: five octaves above the instrument the
spec names in its first paragraph, with an attack no bow can produce.

So these are the first tests that put a low, slowly-bowed, room-coloured signal
through the low-register path. They are synthetic and they say so — a
synthesised sawtooth cannot tell you a threshold is *right*, and only the six
real clips in `fixtures/audio/` can. What it can do is fail loudly if a change
makes the bottom of the instrument undetectable, which is the failure a bass
player would experience as "the app says it couldn't hear anything".

Tolerances here are deliberately loose. They are regression guards, not
measurements.

**What these tests cannot do, measured rather than assumed.** Moving the
high-pass corner from 80 Hz to 400 Hz changes nothing here — every test still
passes. That is a property of the signal, not a hole in the assertions: an
idealised sawtooth carries its attack across the whole spectrum, so filtering
half of it away costs nothing. A real bass's high partials are weaker and
noisier than a sawtooth's, which is exactly the difference that would make a
wrong corner audible. Nor can they show the filter *helping*: a linear room
resonance ringing down smoothly produces no flux rise, so it never fakes an
onset here at any gain, while a real room's early reflections are discrete
arrivals. **The corner frequency is settled by the six real clips or not at
all** — see the open question in `TUNING_LOG.md`.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services import audio as audio_svc
from app.services.audio_config import load_audio_config
from app.tests.audio_helpers import (
    OPEN_A1,
    OPEN_E1,
    OPEN_G2,
    bass_scale,
    synth_bowed_take,
)

SR = 22050


def _detect(y: np.ndarray, *, min_gap_s: float, double_bass: bool = True):
    """The exact path `analyze()` takes, filter included."""
    cfg = load_audio_config()
    if double_bass:
        y = audio_svc.high_pass(y, SR, cfg.onset.double_bass_highpass_hz)
    return audio_svc.detect_onsets(
        audio_svc.pre_emphasis(y, config=cfg),
        SR,
        double_bass=double_bass,
        config=cfg,
        min_gap_s=min_gap_s,
    )


def _lags(detected, expected, *, window_s: float):
    """Detection minus truth, paired **in order**.

    Nearest-match pairing looks equivalent and is not: in a fast passage a
    detection can be nearest to the wrong note, which turns a uniform lag into
    a scatter and hides exactly the thing these tests look for.
    """
    out: list[float | None] = []
    index = 0
    for truth in expected:
        while index < len(detected) and detected[index] < truth - window_s:
            index += 1
        if index < len(detected) and abs(detected[index] - truth) <= window_s:
            out.append(float(detected[index] - truth))
            index += 1
        else:
            out.append(None)
    return out


@pytest.mark.parametrize(
    "pitch,name",
    [(OPEN_E1, "open E, the lowest note on the instrument"),
     (OPEN_A1, "open A"),
     (OPEN_G2, "open G, above the filter's corner")],
)
def test_every_open_string_is_heard_through_the_high_pass(pitch: float, name: str) -> None:
    """The corner sits at 80 Hz and three of the four open strings are below it.

    That is on purpose — the attack of a bass note is carried by its partials,
    not its fundamental, and the fundamental is where room modes live. But
    "on purpose" and "works" are different claims, and only this one is tested.
    """
    times = [0.5 + i * 1.0 for i in range(8)]
    detected = _detect(synth_bowed_take(times, freqs_hz=[pitch] * 8), min_gap_s=1.0)

    heard = sum(1 for lag in _lags(detected, times, window_s=0.12) if lag is not None)
    assert heard >= 7, f"{name}: only {heard} of 8 notes detected"


def test_sixteenth_notes_at_a_real_tempo_are_separable() -> None:
    """Sixteenths at 72 BPM are 208 ms apart, and they are most of the writing.

    This is the case the fixed ±464 ms peak window made impossible and the
    derived window fixed (TUNING_LOG, 2026-08-30). That entry proved the
    arithmetic; nothing had yet proved it on a signal.
    """
    gap = 60.0 / 72.0 / 4
    times = [0.5 + i * gap for i in range(16)]
    y = synth_bowed_take(times, freqs_hz=bass_scale(16), note_dur_s=gap * 0.7)

    detected = _detect(y, min_gap_s=gap)
    heard = sum(1 for lag in _lags(detected, times, window_s=0.09) if lag is not None)
    assert heard >= 15, f"only {heard} of 16 sixteenths detected"


def test_the_detection_lag_does_not_move_when_the_writing_gets_faster() -> None:
    """The one result here that could quietly ruin a verdict.

    A bowed attack peaks in the flux tens of milliseconds after the note
    starts, so every onset is reported late. A *constant* lag is harmless:
    `to_timeline_base` shifts the sequence to a zero origin and a uniform
    offset cancels. A lag that changes with note density does not cancel — it
    is reported as the musician speeding up at exactly the bar where the
    writing changes, which is an accusation the app would be inventing.

    Measured on a passage that is dead on the grid: quarters, then sixteenths,
    then quarters.
    """
    spb = 60.0 / 72.0
    times: list[float] = []
    kinds: list[str] = []
    clock = 0.5
    for kind, count, step in (
        ("quarter", 6, spb),
        ("sixteenth", 16, spb / 4),
        ("quarter", 6, spb),
    ):
        for _ in range(count):
            times.append(clock)
            kinds.append(kind)
            clock += step

    durations = [spb * 0.7 if k == "quarter" else spb * 0.175 for k in kinds]
    y = np.zeros(int((times[-1] + 1.5) * SR), dtype=np.float32)
    pitches = bass_scale(len(times))
    for at, dur, pitch in zip(times, durations, pitches, strict=True):
        note = synth_bowed_take([0.0], freqs_hz=[pitch], note_dur_s=dur, noise=0.0)
        start = int(at * SR)
        end = min(start + note.size, y.size)
        y[start:end] += note[: end - start]
    rng = np.random.default_rng(11)
    y = np.clip(
        y / max(1e-9, float(np.abs(y).max())) * 0.6
        + rng.normal(0, 10 ** (-60 / 20), y.size).astype(np.float32),
        -1.0,
        1.0,
    ).astype(np.float32)

    lags = _lags(_detect(y, min_gap_s=spb / 4), times, window_s=0.12)
    quarters = [
        lag for lag, k in zip(lags, kinds, strict=True)
        if k == "quarter" and lag is not None
    ]
    sixteenths = [
        lag for lag, k in zip(lags, kinds, strict=True)
        if k == "sixteenth" and lag is not None
    ]
    assert len(quarters) >= 10 and len(sixteenths) >= 14, "too few notes to compare"

    differential = abs(float(np.median(sixteenths) - np.median(quarters)))
    # As a fraction of one beat, which is the unit the verdict is expressed in.
    # The inner tolerance band is 5%; anything at that scale would be a verdict
    # the detector wrote rather than the playing.
    assert differential / spb < 0.03, (
        f"lag moves {differential * 1000:.0f} ms between quarters and sixteenths "
        f"({differential / spb:.1%} of a beat) — the app would report that as drift"
    )


def test_the_low_register_path_is_not_worse_than_the_default_one() -> None:
    """A filter that removes three fundamentals has to earn it.

    Not a claim that it is better — the room mode here is a single resonance,
    and only real recordings can settle that. This fails if the double-bass
    path ever detects *less* than the untreated one on the instrument it was
    written for, which would mean the flag is a liability.
    """
    times = [0.5 + i * 0.75 for i in range(10)]
    y = synth_bowed_take(times, freqs_hz=bass_scale(10), note_dur_s=0.5)

    with_flag = _lags(_detect(y, min_gap_s=0.75), times, window_s=0.12)
    without = _lags(_detect(y, min_gap_s=0.75, double_bass=False), times, window_s=0.12)

    heard_with = sum(1 for lag in with_flag if lag is not None)
    heard_without = sum(1 for lag in without if lag is not None)
    assert heard_with >= heard_without, (
        f"the double-bass path heard {heard_with} of {len(times)} where the "
        f"default heard {heard_without}"
    )


def test_a_take_that_starts_from_digital_silence_is_a_fixture_bug_not_a_pipeline_one() -> None:
    """Pinning the trap, because it has caught this project three times.

    A clip padded with exact zeros is a step from -inf dB. The mel-flux
    detector reads that as an onset far larger than any note, and librosa's
    `normalize=True` divides the whole envelope by it — so every real note
    falls under `delta` and a perfectly good take reads as empty. A real
    recording always has a floor.

    This is documentation with an assertion attached: if a future fixture
    forgets the floor, the failure looks like a broken detector, and whoever
    reads this will know where to look first.
    """
    times = [0.5 + i * 0.3 for i in range(12)]
    kwargs = dict(freqs_hz=bass_scale(12), note_dur_s=0.32)

    with_floor = _detect(synth_bowed_take(times, **kwargs), min_gap_s=0.3)
    silent_head = _detect(synth_bowed_take(times, noise=0.0, **kwargs), min_gap_s=0.3)

    assert len(with_floor) >= 11, "the realistic clip should be detected normally"
    assert len(silent_head) < len(with_floor), (
        "digital silence no longer suppresses detection — if librosa stopped "
        "normalising, this test is obsolete and so is the warning it carries"
    )
