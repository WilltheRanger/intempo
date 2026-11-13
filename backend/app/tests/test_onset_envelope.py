"""What each frame of the onset envelope is compared with.

Plain log-mel spectral flux compares every band with itself a frame earlier,
and two things a musician does not hear as notes made it report notes: the
room's noise flickering in bands the instrument never reaches, and a held
note's vibrato moving its partials between neighbouring bands. `audio.py`
answers each — `_band_floor` and `_vibrato_bands` — and each test here holds
one answer with a take on which the plain envelope gets it wrong, so the test
cannot pass by the defect having gone away on its own. TUNING_LOG.md,
2026-11-13, has every number.

The costs are held where they were found, not repeated here: a step to the
next note on a low string (`test_varied_rhythm`'s extra note, the 2-second
room in `test_degraded_audio`), and a quiet note under a loud one's tail, which
is why `analysis.analyze` reads a refused take once more without the filter.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from app.services import audio as audio_svc
from app.services.audio_config import AudioConfig, load_audio_config
from app.tests.audio_helpers import (
    OPEN_E1,
    add_noise_at_snr,
    bass_scale,
    detection_scores,
    evenly_spaced,
    synth_bowed_note,
    synth_bowed_take,
    synth_plucked_take,
)

SR = 22050
CFG = load_audio_config()

#: A G major line high on the violin: every partial a band or more apart.
G_MAJOR = [
    392.0,
    440.0,
    493.9,
    523.3,
    587.3,
    659.3,
    740.0,
    784.0,
    740.0,
    659.3,
    587.3,
    523.3,
]


def _with(**fields) -> AudioConfig:
    return dataclasses.replace(CFG, onset=dataclasses.replace(CFG.onset, **fields))


NO_FLOOR = _with(envelope_floor_percentile=0.0, envelope_floor_margin_db=0.0)
NO_VIBRATO_FILTER = _with(envelope_vibrato_from_hz=float("inf"))


def _violin(y: np.ndarray, config: AudioConfig, bpm: float) -> np.ndarray:
    return audio_svc.detect_onsets(
        audio_svc.pre_emphasis(y, config=config),
        SR,
        instrument="violin",
        config=config,
        min_gap_s=60.0 / bpm,
    )


def _bass(y: np.ndarray, config: AudioConfig, bpm: float) -> np.ndarray:
    filtered = audio_svc.high_pass(y, SR, config.onset.double_bass_highpass_hz)
    return audio_svc.detect_onsets(
        audio_svc.pre_emphasis(filtered, config=config),
        SR,
        instrument="double_bass",
        config=config,
        min_gap_s=60.0 / bpm,
    )


def test_a_held_note_with_vibrato_is_one_note() -> None:
    """Twelve notes of a second each, 25 cents either way at 5.5 Hz.

    Compared band by band, each swing of the pitch is a rise in the band the
    partials swing into: the plain envelope hears fifteen notes. Compared with
    the loudest of three neighbouring bands, a partial that only moved over has
    not risen.
    """
    truth = evenly_spaced(12, 60.0, start_s=0.6)
    y = synth_bowed_take(truth, freqs_hz=G_MAJOR, note_dur_s=0.9, vibrato_cents=25.0)

    unfiltered = _violin(y, NO_VIBRATO_FILTER, 60.0)
    assert unfiltered.size > len(truth), "the defect no longer reproduces; re-base"

    heard = detection_scores(_violin(y, CFG, 60.0), truth, tol_s=0.2)
    assert heard["recall"] == 1.0
    assert heard["precision"] == 1.0


def test_noise_the_instrument_never_reaches_adds_no_onsets() -> None:
    """A plucked bass line in broadband noise at 15 dB SNR.

    A bass sounds nowhere near the top half of the mel bands, so there they
    hold only the room — and the room flickers by a few decibels every frame,
    which log-spectral flux counts in full. The plain envelope hears 21 notes
    for 16; held at each band's own floor, a band of room tone is flat.
    """
    truth = evenly_spaced(16, 60.0, start_s=0.8)
    clean = synth_plucked_take(
        truth, bass_scale(16, root_hz=OPEN_E1 * 2 ** (5 / 12)), ring_s=0.6
    )
    y = add_noise_at_snr(clean, 15.0)

    unfloored = _bass(y, NO_FLOOR, 60.0)
    assert unfloored.size > len(truth), "the defect no longer reproduces; re-base"

    heard = detection_scores(_bass(y, CFG, 60.0), truth, tol_s=0.2)
    assert heard["recall"] == 1.0
    assert heard["precision"] == 1.0


def test_the_band_floors_are_the_same_however_the_take_is_blocked(monkeypatch) -> None:
    """The third global reference, after the peak and the −80 dB clamp.

    A floor read per block would be each block's own quiet level: three
    seconds of room tone and then playing puts the blocks inside the playing on
    a floor far above the take's. So the take here has exactly that, and is
    forced into 64-frame blocks against one block for the whole.
    """
    truth = evenly_spaced(10, 72.0, start_s=3.0)
    y = add_noise_at_snr(
        synth_bowed_take(
            truth, freqs_hz=G_MAJOR[:10], note_dur_s=0.7, vibrato_cents=20.0
        ),
        25.0,
    )

    whole = audio_svc.onset_envelope(y, SR, config=CFG)
    monkeypatch.setattr(audio_svc, "_ENVELOPE_BLOCK_FRAMES", 64)
    blocked = audio_svc.onset_envelope(y, SR, config=CFG)

    assert blocked.shape == whole.shape
    assert float(np.abs(blocked - whole).max()) < 1e-4


def test_turned_off_the_floor_moves_nothing() -> None:
    """A 0th-percentile floor with no margin is each band's own minimum, which
    nothing in the band is below. Off means off, which is what lets the
    envelope be checked against librosa's (`test_audio.py`)."""
    truth = evenly_spaced(8, 90.0, start_s=0.5)
    y = add_noise_at_snr(synth_bowed_take(truth, freqs_hz=G_MAJOR[:8]), 20.0)
    off = _with(
        envelope_floor_percentile=0.0,
        envelope_floor_margin_db=0.0,
        envelope_vibrato_from_hz=float("inf"),
    )
    plain = audio_svc.onset_envelope(y, SR, config=off)

    import librosa

    mel = librosa.feature.melspectrogram(y=y, sr=SR, hop_length=512, n_fft=2048)
    db = np.maximum(librosa.power_to_db(mel, ref=float(mel.max()), top_db=None), -80.0)
    theirs = librosa.onset.onset_strength(S=db, sr=SR, hop_length=512)
    assert float(np.abs(plain - theirs).max()) < 1e-4


@pytest.mark.parametrize("from_hz", [600.0, 2000.0])
def test_the_filter_widens_only_the_bands_above_where_it_starts(from_hz: float) -> None:
    widened = audio_svc._vibrato_bands(
        128, SR, _with(envelope_vibrato_from_hz=from_hz).onset
    )
    import librosa

    centres = librosa.mel_frequencies(n_mels=130, fmin=0.0, fmax=SR / 2.0)[1:-1]
    assert widened.tolist() == (centres >= from_hz).tolist()
    assert not widened[0] and widened[-1]


def test_a_config_with_the_filter_off_has_nothing_to_retry_without() -> None:
    assert audio_svc.without_vibrato_filter(NO_VIBRATO_FILTER) is None
    assert audio_svc.without_vibrato_filter(_with(envelope_vibrato_bands=1)) is None
    unfiltered = audio_svc.without_vibrato_filter(CFG)
    assert unfiltered is not None
    assert not audio_svc._vibrato_bands(128, SR, unfiltered.onset).any()
    # Nothing else moves: the second reading differs from the first in the
    # filter alone.
    assert (
        dataclasses.replace(
            unfiltered.onset,
            envelope_vibrato_from_hz=CFG.onset.envelope_vibrato_from_hz,
        )
        == CFG.onset
    )


def test_a_release_is_a_fall_and_an_attack_is_not() -> None:
    """What `analysis._recover_missed_onsets` reads to refuse a note's end.

    One bowed note from 1.0 s to 1.6 s over the room. The RMS window is 93 ms,
    so the frames either side of the attack already hold some of the note and
    the rise reads smaller than the fall; both are far from the 12 dB the
    second look allows (`[onset.recovery] max_fall_db`).
    """
    y = np.random.default_rng(5).normal(0, 1e-3, 3 * SR).astype(np.float32)
    note = synth_bowed_note(440.0, 0.6) * 0.5
    y[SR : SR + note.size] += note

    start, end = audio_svc.level_change_db(y, SR, np.array([1.0, 1.62]))
    assert start > 10.0
    assert end < -CFG.onset.recovery_max_fall_db - 10.0
