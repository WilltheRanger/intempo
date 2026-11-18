"""Layer 1 of the audio pipeline: waveform → onset timestamps.

Thin, testable wrappers around librosa. No alignment or classification
here — this module only answers "when did a note attack happen?" and
"what tempo did they play at?" Every tunable number comes from
`audio_config`, never a literal in this file (Batch 3 tuning rule).

Spec references: §4 signal-processing table, §7.5 problem 1 (bass onset
clarity), §4 calibration-clip flow.
"""

from __future__ import annotations

import tempfile
from dataclasses import replace
from pathlib import Path

import librosa
import numpy as np
from scipy.ndimage import maximum_filter1d
from scipy.signal import butter, sosfiltfilt

from app.services.audio_config import (
    AudioConfig,
    InstrumentOnset,
    OnsetConfig,
    load_audio_config,
)


def load_audio(path: str | Path, *, sr: int | None = None) -> tuple[np.ndarray, int]:
    """Load an audio file as mono at the configured sample rate.

    22.05 kHz mono is plenty for onset detection and halves CPU vs 44.1k
    (§4). We deliberately do NOT peak-normalize here — normalization eats
    real onsets (Batch 3 pitfall).
    """
    cfg = load_audio_config()
    target_sr = sr if sr is not None else cfg.onset.sr
    y, out_sr = librosa.load(str(path), sr=target_sr, mono=True)
    return y, int(out_sr)


def load_audio_bytes(
    data: bytes, *, sr: int | None = None, suffix: str = ".audio"
) -> tuple[np.ndarray, int]:
    """Load audio from an in-memory blob (as fetched from storage).

    librosa reads WAV/FLAC/OGG straight from a buffer, but the AAC/m4a
    the mobile client uploads needs a real file on disk for the
    audioread/ffmpeg fallback — so we spill to a temp file and load that.
    (ffmpeg must be present in the deployed image for compressed formats;
    documented in DECISIONS.md.)
    """
    with tempfile.NamedTemporaryFile(suffix=suffix) as fh:
        fh.write(data)
        fh.flush()
        return load_audio(fh.name, sr=sr)


def pre_emphasis(y: np.ndarray, *, config: AudioConfig | None = None) -> np.ndarray:
    """Boost high frequencies before onset detection.

    **This does very little to what the detector reports, and the claim that
    stood here — that it "sharpens note attacks, which especially helps the
    broad, slow-attack onsets of the low register" — was measured false.** The
    onset envelope differences *log* mel spectra, and a fixed filter is a
    constant number of decibels per band, which the difference removes.
    Envelope correlation with and without it is 0.998 on bowed violin and
    cello takes in a 0.8 s room, and the detected onsets are identical.

    What it can still move is the −80 dB floor the envelope is clamped to,
    which is set by the take's loudest moment: where that moment is a
    low-frequency boom, attenuating the boom lowers the reference and the
    correlation falls to about 0.93. That is an effect on the clamp, not a
    sharper attack.

    Kept because the spec's signal chain names it (§4) and removing it moves
    nothing. See `high_pass` for why no filter can reach this detector.
    """
    cfg = config or load_audio_config()
    return librosa.effects.preemphasis(y, coef=cfg.onset.pre_emphasis_coef)


#: Seconds of audio to filter at once, and how much to overlap the blocks.
#:
#: See `high_pass`. The block size trades allocation against loop overhead and
#: nothing else — the result is identical at any value, because the overlap is
#: what makes it identical.
_FILTER_BLOCK_S = 30
_FILTER_OVERLAP_S = 1


def high_pass(y: np.ndarray, sr: int, cutoff_hz: float) -> np.ndarray:
    """Zero-phase Butterworth high-pass.

    Used in double-bass mode: detecting onsets in the high partials of a
    bass note is more reliable than in the boomy fundamental, and it
    rejects room-mode reverb tails that fake onsets (§7.5 problem 1/3).

    **It does neither, and nothing could make a cutoff do either here.**
    Measured 2026-09-22 against the detector this feeds:

      * The flux differences *log* spectra, so a fixed filter is a constant
        number of decibels per band, removed by the difference. Envelope
        correlation with and without 80 Hz on a bowed bass in a room with a
        58 Hz mode: 0.9999, detected onsets byte-identical.
      * Moving the cutoff into the detector — the lowest mel band — does no
        better: 0.9999 dry, 0.9993 in a 0.9 s room. Notes of a pure 50 Hz tone
        are all still found with the floor at 150 Hz, because leakage sixty
        decibels down makes the same log-flux as the note; only a floor at
        300 Hz loses them, which would lose a bass.
      * **And the risk it was for does not arise.** A 45–60 Hz boom between
        bass notes, at up to five times their peak, is not detected with no
        filter at all: the flux is a mean over 128 bands, and a sound confined
        to the bottom two or three barely moves it.

    So `highpass_hz` in `[onset.instrument]` shapes the waveform the dashboard
    draws and nothing the analysis reports; `config.toml` says so beside it.
    `test_onset_placement.py` holds all three facts, so a change that makes any
    of them untrue has to say so.
    """
    nyquist = 0.5 * sr
    normalized = min(cutoff_hz / nyquist, 0.99)
    sos = butter(4, normalized, btype="highpass", output="sos")

    block = _FILTER_BLOCK_S * sr
    overlap = _FILTER_OVERLAP_S * sr
    if y.size <= block + 2 * overlap:
        return sosfiltfilt(sos, y).astype(np.float32, copy=False)

    # A block at a time, with the edges thrown away. `sosfiltfilt` runs the
    # filter forwards and backwards over a padded copy in float64, so a
    # fourteen-minute take costs **377 MB** to filter 75 MB of audio — the
    # largest single allocation in the pipeline, on a 512 MB instance.
    #
    # Safe because an IIR filter forgets. The slowest pole here sits at radius
    # 0.991, so its impulse response is down to a millionth within about 70 ms;
    # a second of overlap either side is more than an order of magnitude beyond
    # that. Measured against filtering the whole signal at once, on real audio:
    # **exactly zero difference** at one second, and 6e-22 at a quarter.
    out = np.empty(y.size, dtype=np.float32)
    start = 0
    while start < y.size:
        end = min(start + block, y.size)
        lo, hi = max(0, start - overlap), min(y.size, end + overlap)
        piece = sosfiltfilt(sos, y[lo:hi])
        out[start:end] = piece[start - lo : start - lo + (end - start)]
        del piece
        start = end
    return out


#: librosa's onset defaults, named because three functions here depend on
#: them agreeing.
_HOP_LENGTH = 512
_N_FFT = 2048

#: The hop, for callers that have to convert frames to seconds themselves.
#: Public because `analysis._recover_missed_onsets` searches the same envelope
#: this module produces, and a second copy of the number is how the two would
#: come to disagree about what a frame is.
HOP_LENGTH = _HOP_LENGTH


def peak_window_frames(
    min_gap_s: float | None, sr: int, *, config: AudioConfig | None = None
) -> int:
    """How wide the local-max window may be, given the closest notes expected.

    `pre_max`/`post_max` require a peak to be the largest in a window, so a
    window wider than the gap between two notes means the quieter of them is
    never reported. At 20 frames — **±464 ms** — that put a hard ceiling on the
    music this app can read at all:

        quarter notes    detectable below 129 BPM
        eighth notes                below  65 BPM
        sixteenth notes             below  32 BPM

    Nobody practises sixteenths at 32 BPM. Most étude and excerpt writing was
    simply invisible, and `librosa`'s own default for this sample rate is **1**
    frame, not 20.

    It could not be fixed by choosing a better constant, and the reason is
    exact. The window is wide because it suppresses a note being detected twice
    — a ringing pizzicato, a vibrato wobble — and a 5.5 Hz ring beat is 182 ms
    apart while sixteenths at 100 BPM are 150 ms apart. **They are the same
    time scale.** Measured, one window cannot have both:

        window 3   ringing pizzicato 8 hits / 8 spurious   sixteenths 32/32 found
        window 20  ringing pizzicato 8 hits / 0 spurious   sixteenths  4/32 found

    So the window is not chosen — it is *derived* from the thing that already
    knows the answer. The score says which note values are written and
    `target_bpm` says how fast, so the smallest gap to expect is known before a
    sample is read. Half of it: wide enough that one note cannot out-peak
    itself, narrow enough that the next note falls outside.

    Capped at the configured `pre_max`, so slow music behaves exactly as it did
    — on the tuning corpus, whose clips are all at 60 BPM, this returns the cap
    and every number is unchanged.
    """
    cfg = config or load_audio_config()
    cap = cfg.onset.pre_max
    if min_gap_s is None or min_gap_s <= 0:
        return cap
    return max(1, min(cap, int(min_gap_s * sr / _HOP_LENGTH / 2)))


#: How many frames of spectrogram to hold at once.
#:
#: The onset envelope is one float per frame — 0.15 MB for a fourteen-minute
#: take — and computing it whole costs **540 MB**, because the STFT it is
#: derived from is 302 MB of complex64 and the power spectrogram another 151.
#: All of it is thrown away. On the 512 MB instance this deploys to, a take
#: over about three minutes was an out-of-memory kill: the worker dies, the row
#: is swept up as stuck, and the musician is told something went wrong.
#:
#: 4096 frames is 95 seconds at the configured hop, and about 34 MB of
#: spectrogram. Measured end to end, a fourteen-minute take falls from 540 MB
#: to 52.
_ENVELOPE_BLOCK_FRAMES = 4096

#: Frames of overlap either side of a block, discarded after.
#:
#: Spectral flux compares each frame with the one before it, and the frames are
#: centred, so the first frames of a block would otherwise be computed against
#: this block's zero-padding rather than the audio that really precedes them.
#: Sixty-four frames is 1.5 seconds — far more than the lag needs and cheap.
_ENVELOPE_OVERLAP_FRAMES = 64

#: The dynamic-range floor `librosa.power_to_db` applies by default.
_TOP_DB = 80.0


def _band_floor(levels: np.ndarray, peak: float, onset: OnsetConfig) -> np.ndarray:
    """Where each mel band stops counting, in dB against `peak`.

    **A band that only ever holds the room still made flux.** Log-spectral flux
    is level-blind by design — a quiet band and a loud one rise by the same
    number of decibels when a note starts — and that is also its weakness: the
    room's noise flickers by a few decibels in every band, every frame, and a
    band the instrument never reaches contributes that flicker and nothing
    else. Measured on a double bass take at 20 dB SNR, every band above 2 kHz
    flickered as much between the notes as at them, half the mel bands were
    pure noise, and the detector reported 101 onsets for 32 notes.

    So each band is held at its own quiet level plus a margin: the
    `envelope_floor_percentile`-th percentile of the band across the take —
    the room, in any take with a pause in it — and `envelope_floor_margin_db`
    above that. A band of room tone is flat under it and adds nothing; a band a
    note reaches rises from the floor exactly as before, less the margin.

    The percentile is of the whole take, every frame once, so it is the same
    number however the take was blocked.
    """
    floor = np.array(
        [np.percentile(row, onset.envelope_floor_percentile) for row in levels],
        dtype=np.float64,
    )
    floor_db = librosa.power_to_db(floor, ref=peak, top_db=None)
    return (np.maximum(floor_db, -_TOP_DB) + onset.envelope_floor_margin_db).astype(
        np.float32
    )


def _vibrato_bands(n_mels: int, sr: int, onset: OnsetConfig) -> np.ndarray:
    """The mel bands whose reference is widened to hold a vibrato.

    **Vibrato made notes inside notes.** A held note's every partial swings a
    quarter of a semitone either way five or six times a second, so its energy
    moves back and forth between neighbouring bands and each swing is a rise
    somewhere — a new onset to plain spectral flux. On a violin take with
    10–24 cents of vibrato in a 20 dB room, the detector heard 62 attacks for
    35 notes.

    The reference a frame is compared with is therefore the loudest of three
    neighbouring bands in the frame before (Böck & Widmer's SuperFlux, 2013):
    a partial that only moved to the next band has not risen. **Only above
    `envelope_vibrato_from_hz`**, because the mel scale is linear below 1 kHz
    with bands 26 Hz apart: at 300 Hz that is more than a semitone, and three
    of them hide a step to the next note. Applied to every band, a bass note
    played over a sounding one went unheard (`test_varied_rhythm`).

    **What it still costs** is a quiet note under a loud one's tail on a low
    instrument, which looks to it like the loud note's partials moving — the
    reason `analysis.analyze` reads a refused take once more without it.
    """
    centres = librosa.mel_frequencies(n_mels=n_mels + 2, fmin=0.0, fmax=sr / 2.0)[1:-1]
    return centres >= onset.envelope_vibrato_from_hz


def without_vibrato_filter(config: AudioConfig) -> AudioConfig | None:
    """`config` with `_vibrato_bands` widening nothing, or None if it already
    widens nothing. For `analysis.analyze`'s second reading of a refused take."""
    onset = config.onset
    if onset.envelope_vibrato_bands <= 1 or onset.envelope_vibrato_from_hz >= onset.sr / 2:
        return None
    return replace(config, onset=replace(onset, envelope_vibrato_from_hz=float("inf")))


def _flux_reference(db: np.ndarray, widened: np.ndarray, size: int) -> np.ndarray:
    """`db`, with each widened band replaced by the loudest of its neighbours."""
    if size <= 1 or not widened.any():
        return db
    ref = db.copy()
    ref[widened] = maximum_filter1d(db, size, axis=0)[widened]
    return ref


def onset_envelope(
    y: np.ndarray, sr: int, *, config: AudioConfig | None = None
) -> np.ndarray:
    """Spectral flux per frame, computed a block at a time.

    Log-mel spectral flux, as `librosa.onset.onset_strength(y=...)` computes
    it, with two changes to what a frame is compared with: each band is held at
    its own noise floor (`_band_floor`), and above `envelope_vibrato_from_hz`
    the reference is the loudest of three neighbouring bands (`_vibrato_bands`).
    With both turned off — a 0th-percentile floor with no margin, and a
    starting frequency above Nyquist — it is librosa's envelope to float32
    rounding, which is what the blocking below was verified against: all six
    corpus clips, exactly the same detected onsets even with pathologically
    small blocks, in a fortieth of the memory.

    **Two references have to be global, and both are easy to miss.** The naive
    block-wise version differs from the whole-signal one by 0.13 on an envelope
    whose maximum is 14, because `power_to_db` defaults to `ref=np.max` *and*
    then clips to `top_db` below the maximum of whatever it was handed. Both
    are the maximum of the block rather than of the recording, so every block
    ends up on its own scale. So the peak is found in a first pass, and the
    floor is applied by hand against it. The band floors are a third, and the
    first pass collects them too: one float per band per frame, 128 rows
    against the STFT's 1025 complex ones.

    One path, not two. A short signal takes a single block and goes through the
    same code — this project has been bitten four times by a second
    implementation that drifted, and a `len(y) < threshold` branch here would be
    a fifth.
    """
    onset = (config or load_audio_config()).onset
    hop, n_fft = _HOP_LENGTH, _N_FFT
    total = 1 + y.size // hop
    spans = []
    start = 0
    while start < total:
        end = min(start + _ENVELOPE_BLOCK_FRAMES, total)
        spans.append((max(0, start - _ENVELOPE_OVERLAP_FRAMES), start, end))
        start = end

    def _mel(lo: int, end: int) -> np.ndarray:
        first = lo * hop
        last = min(y.size, (end + _ENVELOPE_OVERLAP_FRAMES) * hop)
        return librosa.feature.melspectrogram(
            y=y[first:last], sr=sr, hop_length=hop, n_fft=n_fft
        )

    peak = 0.0
    levels: np.ndarray | None = None
    for lo, begin, end in spans:
        mel = _mel(lo, end)
        peak = max(peak, float(mel.max()))
        if levels is None:
            levels = np.empty((mel.shape[0], total), dtype=np.float32)
        own = mel[:, begin - lo : begin - lo + (end - begin)]
        levels[:, begin : begin + own.shape[1]] = own
        del mel, own
    peak = peak or 1e-10
    assert levels is not None
    floor = _band_floor(levels, peak, onset)
    widened = _vibrato_bands(levels.shape[0], sr, onset)
    del levels

    out = np.zeros(total, dtype=np.float32)
    for lo, begin, end in spans:
        mel = _mel(lo, end)
        db = librosa.power_to_db(mel, ref=peak, top_db=None)
        np.maximum(db, floor[:, None], out=db)
        piece = librosa.onset.onset_strength(
            S=db,
            ref=_flux_reference(db, widened, onset.envelope_vibrato_bands),
            sr=sr,
            hop_length=hop,
        )
        take = piece[begin - lo : begin - lo + (end - begin)]
        out[begin : begin + take.size] = take[: out.size - begin]
        del mel, db, piece
    return out


#: The finer look each onset gets once the peak-picker has found it.
#:
#: **Every onset time used to sit on the 23.2 ms analysis hop**, and at the
#: tempos this app is used at that is most of a tolerance band: a steady
#: quarter at 120 BPM is detected 21 and 22 frames apart in turn, so a
#: metronomic take reads as alternating ±12 ms — 2.3% of a beat out of the
#: 5% the inner band allows, before the musician has done anything. At
#: 160 BPM the inner band is 19 ms, narrower than one frame.
#:
#: **And where on the attack it landed depended on the attack.** The 2048-point
#: window is 93 ms long, so the flux peak lags the start of a note by however
#: long the note takes to speak: measured on bowed notes played exactly on the
#: grid, 30 ms after a 5 ms rise and 65 ms after a 120 ms one. A constant lag
#: cancels, since every delta is relative; a lag that varies with the stroke
#: does not, and a bar of martelé against a bar of soft détaché is exactly
#: that.
#:
#: So once a note has been *found* on the coarse grid it is *placed* on a fine
#: one: a 1024-point window (46 ms — still two periods of a bass's open E) at a
#: 64-sample hop (2.9 ms), with the flux differenced over the same 512 samples
#: the detector uses, and the onset put where that flux first reaches half its
#: peak on the rise. Measured on bowed notes at 90 BPM, twelve per take, rise
#: times from 5 to 120 ms:
#:
#:                          spread across rise times   spread within one
#:     violin, dry                 34.8 → 12.6 ms           6.9 →  1.4 ms
#:     violin, 0.8 s room          29.0 → 13.5 ms           8.1 →  2.1 ms
#:     bass, dry                   19.3 →  6.3 ms           8.7 →  4.0 ms
#:     bass, 0.8 s room            50.3 → 32.2 ms          11.0 → 12.7 ms
#:
#: The last row is the honest limit: a bass in a live room is smeared by the
#: room itself, and a finer grid cannot place what the room has blurred.
#:
#: Detection is untouched — which notes are found is still decided on the
#: coarse grid, by the tuned peak-picker. This only moves each one, and never
#: by more than `_REFINE_SEARCH_S` or halfway to a neighbour.
_REFINE_N_FFT = 1024
_REFINE_HOP = 64
#: How far the fine flux peak is looked for either side of the coarse onset.
_REFINE_SEARCH_S = 0.045
#: How far back along the rise the onset may be walked from that peak.
_REFINE_RISE_S = 0.2
#: The share of the peak flux that marks the rise.
_REFINE_RISE_SHARE = 0.5
#: How far under the segment's loudest moment the fine spectrum is floored.
#:
#: **Where on the attack an onset landed depended on what came before it**
#: (2026-11-13). Floored 80 dB down, a note rising out of silence climbs
#: from the floor and its half-peak comes early in the attack; a note rising
#: out of the last one's release — 5 to 15 ms of bow change in a run of
#: sixteenths — climbs from a level the 46 ms window still holds, and comes
#: later. Measured on bowed notes after gaps of 5 ms to 300 ms, with 25–50 ms
#: rises: placed 58.5 ms late after 5 ms, 42.2 ms after 50 ms or more. That
#: is a run of sixteenths read as dragging against the quarters beside it.
#:
#: 50 dB brings the two together — 58.3 ms against 51–52 ms — at the cost of
#: some of what the half-peak bought against the stroke itself: a 120 ms
#: attack lands 16.9 ms after a 5 ms one, where it landed 12.6 ms after, and
#: `test_onset_placement.py` holds that under 20. 45 dB crossed it; 30 dB
#: made the gap irrelevant (1.3 ms) and the stroke matter 33 ms. Accuracy
#: benchmark 95.44% → 96.16%; TUNING_LOG.md, 2026-11-13.
_REFINE_TOP_DB = 50.0


def refine_onset_times(y: np.ndarray, sr: int, times: np.ndarray) -> np.ndarray:
    """Each onset moved onto its attack at 2.9 ms resolution. See `_REFINE_N_FFT`.

    An onset the finer look cannot place — at the very edge of the recording,
    or in a window with no rise in it at all — keeps the time it came with.
    """
    times = np.asarray(times, dtype=float)
    if times.size == 0:
        return times
    lag = max(1, _HOP_LENGTH // _REFINE_HOP)
    # Frames whose window reaches back into the segment's zero padding compare
    # audio against nothing — the same artefact `detect_onsets` silences at the
    # start of a recording — so no onset may be placed on one.
    guard = _REFINE_N_FFT // _REFINE_HOP + lag
    refined = times.copy()
    for i, t in enumerate(times):
        room = _REFINE_SEARCH_S
        back = _REFINE_RISE_S
        if i > 0:
            room = min(room, 0.5 * (t - times[i - 1]))
            back = min(back, 0.5 * (t - times[i - 1]))
        if i + 1 < times.size:
            room = min(room, 0.5 * (times[i + 1] - t))
        start = max(0, int(round((t - back - room) * sr)) - _REFINE_N_FFT)
        stop = min(y.size, int(round((t + room) * sr)) + _REFINE_N_FFT)
        segment = y[start:stop]
        if segment.size < 2 * _REFINE_N_FFT:
            continue
        mel = librosa.feature.melspectrogram(
            y=segment, sr=sr, n_fft=_REFINE_N_FFT, hop_length=_REFINE_HOP
        )
        peak = float(mel.max())
        if peak <= 0:
            continue
        db = librosa.power_to_db(mel, ref=peak, top_db=_REFINE_TOP_DB)
        flux = librosa.onset.onset_strength(
            S=db, sr=sr, hop_length=_REFINE_HOP, lag=lag
        )
        at = start / sr + np.arange(flux.size) * _REFINE_HOP / sr
        # And never into the opening the coarse detector silences, for the
        # same reason: there, the recording beginning looks like a note.
        usable = (np.arange(flux.size) >= guard) & (at > _N_FFT / sr)
        if start + segment.size < y.size:
            # The far edge is padded too; nothing there is a rise either.
            usable &= np.arange(flux.size) < flux.size - _REFINE_N_FFT // _REFINE_HOP
        near = np.flatnonzero(usable & (at >= t - room) & (at <= t + room))
        if near.size == 0:
            continue
        top = int(near[np.argmax(flux[near])])
        if flux[top] <= 0:
            continue
        rise = top
        limit = t - back
        while (
            rise - 1 >= 0
            and usable[rise - 1]
            and at[rise - 1] >= limit
            and flux[rise - 1] >= _REFINE_RISE_SHARE * flux[top]
        ):
            rise -= 1
        refined[i] = float(at[rise])
    # Every move is bounded by half the gap to each neighbour, so order holds;
    # sorting is a guard on that arithmetic rather than a repair it needs.
    return np.sort(refined)


#: The share of a take's frames quieter than its noise floor, by definition.
#:
#: Nearly every take opens on room tone before the first note and closes on it
#: after the last, so its quietest twentieth is the room, not the playing.
_FLOOR_PERCENTILE = 5.0


def _rms_db(y: np.ndarray) -> np.ndarray:
    """RMS per hop in dB, computed a block at a time.

    Blocked for the reason `onset_envelope` gives: framing a long take whole
    allocates a window per frame.
    """
    hop = _HOP_LENGTH
    block = _ENVELOPE_BLOCK_FRAMES * hop
    levels: list[np.ndarray] = []
    for start in range(0, y.size, block):
        piece = y[start : start + block]
        if piece.size == 0:
            continue
        rms = librosa.feature.rms(
            y=piece, frame_length=_N_FFT, hop_length=hop, center=True
        )[0]
        levels.append(rms[: int(np.ceil(piece.size / hop))])
    return 20.0 * np.log10(np.maximum(np.concatenate(levels), 1e-10))


def _frames_of(times: np.ndarray, sr: int, n: int) -> np.ndarray:
    return np.clip(np.round(times * sr / _HOP_LENGTH).astype(int), 0, n - 1)


def level_above_floor_db(y: np.ndarray, sr: int, times: np.ndarray) -> np.ndarray:
    """How far above the take's own noise floor the recording sounds at each time.

    **Relative to the take, so it stays as level-invariant as the detector.** A
    take recorded ten decibels quieter has a floor ten decibels lower, and
    every answer here is the same.

    Each time is read as the loudest frame within one hop of it, so an attack
    that lands between two frames is not judged by the quieter of them.
    """
    times = np.asarray(times, dtype=float)
    if times.size == 0 or y.size == 0:
        return np.zeros(times.size, dtype=float)
    db = _rms_db(y)
    floor = float(np.percentile(db, _FLOOR_PERCENTILE))
    frames = _frames_of(times, sr, db.size)
    near = np.maximum.reduce(
        [db[np.clip(frames + k, 0, db.size - 1)] for k in (-1, 0, 1)]
    )
    return near - floor


#: Frames either side of a time that `level_change_db` compares: 70 ms.
_CHANGE_FRAMES = 3


def level_change_db(y: np.ndarray, sr: int, times: np.ndarray) -> np.ndarray:
    """How much louder the recording is just after each time than just before.

    The loudest of the `_CHANGE_FRAMES` frames after, against the loudest of
    those before. A note starting is a rise, or at least not a fall — even
    under the tail of a louder one, which it adds to. A note *ending* is a
    fall of tens of decibels, and the release is exactly where a cleaner
    envelope leaves a small, isolated peak for the second look to find.
    """
    times = np.asarray(times, dtype=float)
    if times.size == 0 or y.size == 0:
        return np.zeros(times.size, dtype=float)
    db = _rms_db(y)
    frames = _frames_of(times, sr, db.size)
    after = np.maximum.reduce(
        [db[np.clip(frames + k, 0, db.size - 1)] for k in range(1, _CHANGE_FRAMES + 1)]
    )
    before = np.maximum.reduce(
        [db[np.clip(frames - k, 0, db.size - 1)] for k in range(1, _CHANGE_FRAMES + 1)]
    )
    return after - before


def onset_settings_for(config: AudioConfig, instrument: str | None) -> InstrumentOnset:
    """The peak-pick threshold and high-pass cutoff for one instrument.

    **One place decides this, because it used to be decided in three.**
    `detect_onsets` chose the threshold, `prepare_for_alignment` chose whether
    to filter, and `analysis_runner` decided which instrument counted as a
    bass — so the three could disagree, and a caller that forgot the filter
    still got the bass threshold.

    **It lives here rather than on `OnsetConfig` for a reason worth keeping.**
    `test_tuning_knobs.py` proves every value in `config.toml` reaches
    something that reads it, and it does that by looking for attribute access
    in the pipeline modules *excluding the loader* — because the loader writes
    every field and counting it would make the proof vacuous. A resolver on the
    dataclass is read-in-the-loader, so the guard went blind on four knobs the
    moment it was put there. Keeping the decision in the pipeline keeps the
    proof sharp.

    `None` is the honest answer for a take whose row predates the `instrument`
    column, and it resolves to the flat `delta` with no filter: the same
    reading such a take has always had. It is deliberately not guessed at — a
    null instrument silently becoming a violin is the behaviour this replaces,
    and it was wrong for every cellist it touched.
    """
    onset = config.onset
    if instrument and instrument in onset.instruments:
        return onset.instruments[instrument]
    # No table, or a name this build does not know. Reproduce the two branches
    # that existed before exactly, rather than inventing a third.
    if instrument == "double_bass":
        return InstrumentOnset(
            delta=onset.double_bass_delta,
            highpass_hz=onset.double_bass_highpass_hz,
        )
    return InstrumentOnset(delta=onset.delta, highpass_hz=0.0)


def envelope_config(config: AudioConfig, instrument: str | None) -> AudioConfig:
    """`config`, with the vibrato filter as wide as this instrument needs.

    **One width does not fit a double bass.** The filter compares each band
    with the loudest of its neighbours, and how many neighbours a vibrato
    needs depends on how close an instrument's partials sit: a violin's are
    hundreds of hertz apart, so three bands hold each one's swing and a step
    to the next note still shows; a bass's are 41–150 Hz apart, so above
    600 Hz its swing reaches across several, and three bands left it heard
    as 60 attacks at no note in 30 benchmark takes. See
    `[onset.instrument.double_bass] vibrato_bands` and TUNING_LOG.md,
    2026-11-13.
    """
    bands = onset_settings_for(config, instrument).vibrato_bands
    if not bands or bands == config.onset.envelope_vibrato_bands:
        return config
    return replace(config, onset=replace(config.onset, envelope_vibrato_bands=bands))


def detect_onsets(
    y: np.ndarray,
    sr: int,
    *,
    instrument: str | None = None,
    double_bass: bool = False,
    config: AudioConfig | None = None,
    min_gap_s: float | None = None,
) -> np.ndarray:
    """Return onset timestamps (seconds) via `librosa.onset.onset_detect`.

    Uses the peak-pick parameters from config (`delta`, `pre_max`,
    `post_max`, `wait`). `wait` enforces a minimum inter-onset gap, which
    suppresses the double/triple triggers a ringing pizzicato string
    produces (§7 problem 4).

    `instrument` selects the peak-pick threshold through
    `onset_settings_for`. The filtering is the caller's job — this only
    chooses the threshold — and `prepare_for_alignment` reads the same entry
    for the cutoff. **That cutoff changes no onset**, and nothing placed here
    could make it: see `high_pass`.

    Each onset is found on the 23 ms analysis grid and then placed on a 2.9 ms
    one — see `_REFINE_N_FFT`.

    **`double_bass` is the older spelling**, kept because twenty-eight tests
    assert bass behaviour through it and rewriting them all to say the same
    thing differently is a diff nobody would review (`CLAUDE.md` §5). It means
    `instrument="double_bass"`; `instrument` wins when both are given.
    """
    cfg = config or load_audio_config()
    onset = cfg.onset
    named = instrument or ("double_bass" if double_bass else None)
    settings = onset_settings_for(cfg, named)
    delta = settings.delta
    window = peak_window_frames(min_gap_s, sr, config=cfg)
    # librosa wants `wait` in frames; convert from milliseconds.
    hop_length = _HOP_LENGTH
    n_fft = _N_FFT
    wait_frames = max(1, int(round((onset.wait_ms / 1000.0) * sr / hop_length)))

    strength = onset_envelope(y, sr, config=envelope_config(cfg, named))

    # The first frames are silenced because their input is not audio.
    #
    # Onset strength is spectral flux: each frame compared with the one before
    # it. At the very start there is no frame before, so the STFT compares
    # against its own zero-padding, and the step from padding into the room's
    # noise floor is a large positive flux — the *recording beginning* looks
    # exactly like a note starting.
    #
    # It is not subtle and it is not rare. On a take with any noise floor at
    # all it fires at 0.070 s, every time, three frames in, at 41% of the
    # envelope's maximum. Only a signal beginning in perfect digital silence
    # escapes it, which is why the synthetic fixtures never showed it and why
    # every real recording will.
    #
    # It is the first onset, so it became the alignment origin, and everything
    # downstream inherited the error: on a dead-on-time bass take it took the
    # place of the first note, pushed the remaining notes onto the wrong bars
    # and reported "you dragged by 74 BPM" to somebody playing perfectly.
    #
    # `n_fft // hop_length` frames — 93 ms here — is exactly the region the
    # padding reaches and no more. Nobody starts playing within 93 ms of
    # tapping record; a synthetic fixture that does is what the tests below
    # cover explicitly.
    contaminated = n_fft // hop_length
    strength[:contaminated] = 0.0

    frames = librosa.onset.onset_detect(
        onset_envelope=strength,
        sr=sr,
        units="frames",
        hop_length=hop_length,
        delta=delta,
        pre_max=window,
        post_max=window,
        wait=wait_frames,
        backtrack=False,
    )
    times = librosa.frames_to_time(frames, sr=sr, hop_length=hop_length)
    # Found on the coarse grid, placed on a fine one. See `_REFINE_N_FFT`.
    return refine_onset_times(y, sr, np.asarray(times, dtype=float))
