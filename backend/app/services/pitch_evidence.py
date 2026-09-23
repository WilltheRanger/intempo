"""Whether a take is somebody playing this page, asked of its pitch.

Everything before this module asks *when*. The onset detector reads
log-spectral flux, which is amplitude-invariant by construction — so a sound is
a note to it if something new arrived, whatever that something was and however
quiet. That is what makes a far microphone work, and it is also why, measured
on 2026-09-23 against synthetic takes:

- **a metronome ticking in an empty room** was told "Steady all the way
  through" at quality 1.00, because clicks on the beat are a perfect take of
  any page of even notes;
- **talking, on its own,** reached a verdict at quality 0.47;
- **an empty room, or a bow knocking the stand,** was refused, but with a
  sentence about the wrong piece or the microphone's distance.

(Talking *under* a real take can skew its timing too. This module does not fix
that: a per-note version of the same question was measured and did not find
the mistimed notes. See TUNING_LOG.md, 2026-09-23.)

None of those sounds is the instrument playing the page, and the page says
what the instrument would be playing. So this asks the question the timeline
cannot: right after each attack, is a pitch held, and is it the one written?

**Pitch class, not pitch.** Octave errors are the commonest slip in a
transcription and the commonest thing a phone microphone does to a low string
(it hears the second harmonic, not the fundamental). Folding to twelve
classes makes both invisible, and costs nothing here: the question is whether
this is the page at all, not whether a note was in tune.

**Two numbers, because two different things can be missing.**

- `tonal_share`: of every attack detected, the fraction followed by a steady
  pitch — any pitch. A click and room tone are followed by none. It does not
  consult the page, so a transcription that is wrong everywhere (a misread
  clef) cannot make a real take look silent.
- `page_share`: of the attacks matched to written notes, the fraction whose
  written pitch sounded strongly right after. What tells a take of this page
  from sound that merely has pitch — when the page is right. It is not always:
  fast legato against a correct page can fall to 0.12, because the previous
  note is still ringing where the next one is listened for.

What is decided from them lives in `analysis.py`; this module only measures.
The thresholds are in `config.toml` under `[pitch]`, with the measurements
they came from in `TUNING_LOG.md`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np

#: 11.6 ms between frames at the pipeline's 22.05 kHz: a sixteenth at 144 BPM
#: is nine frames long, which is what the listening window below needs.
HOP = 256

#: **Two ways to hear pitch, and the page says which.** Measured on bowed
#: synthetic takes:
#:
#: - A 93 ms STFT separates semitones from the E2 up, and does not smear a
#:   sixteenth into its neighbours: spiccato sixteenths at 160 held their
#:   written pitch after 1.00 of notes. Below E2 its bins are wider than a
#:   semitone — a scale from the bass's open E held a pitch after 0.35.
#: - A constant-Q transform at 36 bins an octave resolves that bottom octave
#:   (1.00 on the same scale), because its low filters are long — ~260 ms at
#:   G3, and longer below. That is exactly what smears fast high passages:
#:   the same spiccato held a pitch after 0.06.
#:
#: So a page whose written pitches sit low — a bass part — is heard with the
#: constant-Q transform, and anything higher with the STFT. See `[pitch]`
#: `low_register_midi`.
_N_FFT = 2048
_CQT_FMIN_NOTE = "C1"
_CQT_OCTAVES = 7

#: Listen from this long after an attack. Short, because a spiccato note has
#: given most of itself in the first 50 ms; not zero, because the attack
#: itself is broadband and would vote for every class at once.
_SETTLE_S = 0.01

#: Listen for at most this long, and never past this share of the gap to the
#: next attack, so the next note's pitch is not heard as this one's.
_LISTEN_S = 0.12
_LISTEN_SHARE_OF_GAP = 0.6

_STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_ALTER = {"": 0, "#": 1, "##": 2, "b": -1, "bb": -2}
_PITCH = re.compile(r"^([A-G])(##|bb|#|b)?")
_PITCH_WITH_OCTAVE = re.compile(r"^([A-G])(##|bb|#|b)?(-?\d)$")


def midi(pitch: str | None) -> int | None:
    """The MIDI number of a written pitch ("E2" → 40, "B#3" → 60), None for a rest."""
    if not pitch or pitch == "rest":
        return None
    match = _PITCH_WITH_OCTAVE.match(pitch)
    if match is None:
        return None
    step, alter, octave = match.group(1), match.group(2) or "", int(match.group(3))
    return 12 * (octave + 1) + _STEP[step] + _ALTER[alter]


def pitch_class(pitch: str | None) -> int | None:
    """0–11 for a written pitch ("F#4" → 6), None for a rest or no pitch."""
    if not pitch or pitch == "rest":
        return None
    match = _PITCH.match(pitch)
    if match is None:
        return None
    step, alter = match.group(1), match.group(2) or ""
    return (_STEP[step] + _ALTER[alter]) % 12


def chroma(y: np.ndarray, sr: int, *, low_register: bool = False) -> np.ndarray:
    """Pitch-class energy per frame, unnormalised: (12, frames).

    Unnormalised because a quiet frame and a loud one must not look alike;
    each attack's window is judged by its *shares*, below, which is where
    level stops mattering.

    `tuning=0.0`: A = 440, not estimated. Estimating costs a pitch track of the
    whole take, and each class spans a semitone, so an orchestra's 442 — eight
    cents — lands in the same class anyway. A baroque 415 is a whole semitone
    and no estimate within half of one could recover it; such a take holds its
    pitches, just not the written ones, which is the case `nothing_played`
    already has to treat as played.
    """
    import librosa

    if low_register:
        return librosa.feature.chroma_cqt(
            y=y,
            sr=sr,
            hop_length=HOP,
            norm=None,
            tuning=0.0,
            fmin=librosa.note_to_hz(_CQT_FMIN_NOTE),
            n_octaves=_CQT_OCTAVES,
        )
    return librosa.feature.chroma_stft(
        y=y, sr=sr, n_fft=_N_FFT, hop_length=HOP, norm=None, tuning=0.0
    )


@dataclass(frozen=True)
class Heard:
    """What held after one attack."""

    #: The class that held, or None if no class held steadily.
    pitch_class: int | None
    #: That class's share of the window's chroma energy. A flat spectrum gives
    #: every class a twelfth; a bowed string gives its own class a third or
    #: more (its octave harmonics fold onto it).
    share: float
    #: Every class, strongest first, over the window. For asking whether a
    #: written class was among what sounded, which is kinder to a double stop
    #: and to a note whose fifth (its third harmonic) is loud.
    ranking: tuple[int, ...]
    #: Each class's energy over the window, as a fraction of the strongest's.
    relative: tuple[float, ...]


def heard_after(
    frames: np.ndarray, sr: int, attacks_s: np.ndarray, *, steady: float
) -> list[Heard]:
    """For each attack, what pitch held after it.

    `attacks_s` on the recording's clock, ascending. `steady` is the share of
    the window's frames one class must lead in to count as having held.
    """
    out: list[Heard] = []
    n_frames = frames.shape[1]
    for i, t in enumerate(attacks_s):
        gap = (attacks_s[i + 1] - t) if i + 1 < attacks_s.size else _LISTEN_S * 2
        length = min(_LISTEN_S, _LISTEN_SHARE_OF_GAP * gap)
        first = int(round((t + _SETTLE_S) * sr / HOP))
        last = max(first + 2, int(round((t + _SETTLE_S + length) * sr / HOP)))
        window = frames[:, max(0, first) : min(n_frames, last)]
        total = float(window.sum()) if window.size else 0.0
        if window.shape[1] == 0 or total <= 0.0:
            out.append(Heard(pitch_class=None, share=0.0, ranking=(), relative=()))
            continue
        leaders = window.argmax(axis=0)
        mode = int(np.bincount(leaders, minlength=12).argmax())
        held = float(np.mean(leaders == mode))
        energy = window.sum(axis=1)
        share = float(energy[mode] / total)
        ranking = tuple(int(c) for c in np.argsort(-energy))
        strongest = float(energy.max())
        out.append(
            Heard(
                pitch_class=mode if held >= steady else None,
                share=share,
                ranking=ranking,
                relative=tuple(float(e / strongest) for e in energy),
            )
        )
    return out


@dataclass(frozen=True)
class Evidence:
    """The two numbers, and what they were counted over."""

    #: Attacks followed by a steady pitch, of all attacks detected.
    tonal_share: float
    n_attacks: int
    #: Of the attacks that held a pitch, the share holding the commonest one.
    #: A pitched metronome or a ringing stand is one pitch every time; a
    #: performance of a page with several pitches on it is not.
    one_pitch_share: float
    #: How many different classes the page writes. A page of open E is one;
    #: `one_pitch_share` says nothing about such a page. Counted over the whole
    #: page, not the matched notes: three knocks match one note, and every page
    #: looked like a page of one pitch.
    page_classes: int
    #: Matched notes whose written class held after their attack, of the
    #: matched notes that have a written pitch.
    page_share: float
    n_matched: int
    #: How many matched notes held their written pitch — `page_share` as a
    #: count, because a share over eight notes is two notes of chance.
    n_confirmed: int
    #: Per matched note, in the order given: was its written class heard?
    #: None where the note has no written pitch to check.
    confirmed: tuple[bool | None, ...]


def assess(
    y: np.ndarray,
    sr: int,
    attacks_s: np.ndarray,
    matched: list[tuple[float, str | None]],
    *,
    steady: float,
    min_share: float,
    top: int,
    min_relative: float,
    low_register_midi: int,
    low_instrument: bool = False,
    page_pitches: list[str | None] | None = None,
) -> Evidence:
    """Measure both shares for one take.

    `attacks_s`: every attack detected, on the recording's clock.
    `matched`: (time on the recording's clock, written pitch) for each attack
    the alignment matched to a note.
    `low_register_midi`: a page whose middle written pitch is below this is
    heard through the constant-Q transform. See `_N_FFT`.
    `page_pitches`: every pitch the page writes, for `page_classes`. The
    matched notes' pitches when omitted.
    `low_instrument`: the instrument is one whose sound is low whatever the
    page says — a bass part scanned in the wrong clef reads as a treble page,
    and through the STFT a real bass take against it held a pitch after 0.00 of
    attacks and was called not played.
    """
    written_midi = [m for m in (midi(p) for _, p in matched) if m is not None]
    low = low_instrument or (
        bool(written_midi) and float(np.median(written_midi)) < low_register_midi
    )
    frames = chroma(y, sr, low_register=low)
    attacks_s = np.sort(np.asarray(attacks_s, dtype=float))
    heard = heard_after(frames, sr, attacks_s, steady=steady)
    tonal = [h.pitch_class is not None and h.share >= min_share for h in heard]

    times = np.array([t for t, _ in matched], dtype=float)
    order = np.argsort(times)
    at_matched = heard_after(frames, sr, times[order], steady=steady)
    by_time: list[Heard | None] = [None] * len(matched)
    for rank, index in enumerate(order):
        by_time[index] = at_matched[rank]

    confirmed: list[bool | None] = []
    for (_, pitch), h in zip(matched, by_time, strict=True):
        written = pitch_class(pitch)
        if written is None or h is None:
            confirmed.append(None)
            continue
        # **Among the strongest, and strong itself.** Rank alone was not
        # enough: a metronome's beep is one pure class, so the second
        # strongest is noise, and a written class landing there by chance
        # "confirmed" about a fifth of the page — a 1.5 kHz beep against a G
        # major page measured 0.31, over the line. A written class must hold a
        # real part of what sounded.
        confirmed.append(
            h.share >= min_share
            and written in h.ranking[:top]
            and h.relative[written] >= min_relative
        )
    checked = [c for c in confirmed if c is not None]
    held = [h.pitch_class for h, t in zip(heard, tonal, strict=True) if t]
    on_page = page_pitches if page_pitches is not None else [p for _, p in matched]
    written = {pitch_class(p) for p in on_page} - {None}
    return Evidence(
        tonal_share=float(np.mean(tonal)) if tonal else 0.0,
        n_attacks=len(tonal),
        one_pitch_share=(
            float(np.bincount(held, minlength=12).max() / len(held)) if held else 0.0
        ),
        page_classes=len(written),
        page_share=float(np.mean(checked)) if checked else 0.0,
        n_matched=len(checked),
        n_confirmed=int(sum(checked)),
        confirmed=tuple(confirmed),
    )
