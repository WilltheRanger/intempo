"""How in tune a take was, in cents, against the musician's own tuning.

The owner's request (2026-09-25): "for insights let's add pitch variation as a
graph", and, asked, what that should mean — how sharp or flat each bar sat
against the written note, measured from where the player tuned, on each take's
verdict and across takes on Insights.

**Against their own tuning, because the reference is theirs.** An instrument
tuned a little high reads sharp on every note against A = 440, and a chart of
that is one number drawn twenty-five times. So the take's own median offset is
its tuning — reported once, when it is worth saying — and each bar is how far
its notes sat from *that*. The owner's two bass takes were tuned 25 cents sharp
and 25 flat; their notes sat a median 14 and 15 cents from those tunings.

**Pitch class, not pitch.** A double bass sounds an octave below the page and a
phone microphone often hears a string's second harmonic rather than its
fundamental; YIN slips an octave on a few notes in a hundred. None of that is
intonation. Every distance is folded into the nearest octave, ±600 cents,
before anything is read from it.

**By written note too, because which note is the lesson.** A bar that is flat
says where; that every E-flat in the piece sits sharp says what to fix — the
finger that reaches for it. The owner's two bass takes, tuned 25 cents apart,
put their E-flats 20 and 17 cents above the rest of the take and their Ds and
Fs within 2 (2026-09-30). Grouped by the note as written, octave and all: an
open string and the same letter stopped an octave up are different fingers,
and folding them together hides both.

**Per bar, by median, with the far notes left out.** On the owner's bass take a
fifth of the notes read more than a semitone from their written pitch — the
previous note still ringing into the window, far more often than a wrong note.
A note further than `not_this_note_cents` from the take's tuning is not a
reading of that note and is dropped; a bar is the median of what remains.

What is measured lives here; the thresholds are `[intonation]` in config.toml.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

import numpy as np

from app.services.audio_config import IntonationConfig
from app.services.pitch_evidence import HOP, midi

#: Listen from this long after an attack: a bow's first 60 ms is noise and
#: scrape before it is a pitch.
SETTLE_S = 0.06
#: ...and stop this long before the next attack, whose own noise starts early.
RELEASE_S = 0.03
#: The last note has no next attack to end at; listen this long.
LAST_NOTE_S = 0.6
#: Fewer voiced frames than this in a note's window and it is not measured —
#: at 11.6 ms a frame, 35 ms of pitch.
MIN_FRAMES = 3


def fold_cents(cents: np.ndarray) -> np.ndarray:
    """Into the nearest octave: -600 up to (not including) +600."""
    return ((np.asarray(cents, dtype=float) + 600.0) % 1200.0) - 600.0


def note_cents(
    track: np.ndarray,
    sr: int,
    attacks_s: np.ndarray,
    written_midi: np.ndarray,
) -> np.ndarray:
    """How far each note sounded from its written pitch, in cents, octave-folded.

    `track` is `pitch_evidence.pitch_track` — fractional MIDI, one value per
    `HOP` — and `attacks_s` the notes' attacks on the same clock, in the order
    they were played. Each note is listened to from `SETTLE_S` after its attack
    to `RELEASE_S` before the next, and read as the median of what was voiced
    there. NaN where there is too little to read, or no written pitch.
    """
    attacks_s = np.asarray(attacks_s, dtype=float)
    written_midi = np.asarray(written_midi, dtype=float)
    out = np.full(attacks_s.size, np.nan)
    order = np.argsort(attacks_s, kind="stable")
    for rank, i in enumerate(order):
        if not np.isfinite(written_midi[i]):
            continue
        start = attacks_s[i] + SETTLE_S
        end = (
            attacks_s[order[rank + 1]] - RELEASE_S
            if rank + 1 < order.size
            else attacks_s[i] + LAST_NOTE_S
        )
        first = int(round(start * sr / HOP))
        last = int(round(end * sr / HOP))
        if last - first < MIN_FRAMES:
            continue
        window = track[max(0, first) : min(track.size, last)]
        window = window[np.isfinite(window)]
        if window.size < MIN_FRAMES:
            continue
        out[i] = float(np.median(window) - written_midi[i]) * 100.0
    return fold_cents(out)


@dataclass(frozen=True)
class NoteIntonation:
    """How one written note sat across the take, against the take's tuning."""

    #: The note as the page spells it — "Eb3", "F#4" — the most common spelling
    #: where the page writes it two ways.
    pitch: str
    midi: int
    #: The median of its readings, against the take's tuning. Positive is sharp.
    cents: float
    #: Readings kept.
    notes: int
    #: The bars it was read in, in order.
    bars: tuple[int, ...]


@dataclass(frozen=True)
class Intonation:
    """A take's pitch, against the player's own tuning."""

    #: Where the take was tuned: its notes' median distance from A = 440 equal
    #: temperament, in cents. Positive is sharp.
    tuning_cents: float | None = None
    #: The typical note's distance from that tuning: the median of how far
    #: each note sat, either way. Lower is more in tune.
    spread_cents: float | None = None
    #: Each bar's median note, against the tuning, keyed by bar number.
    #: Positive is sharp.
    by_bar: dict[int, float] = field(default_factory=dict)
    #: Notes measured and kept.
    notes: int = 0
    #: Each written note read at least `by_note_min_notes` times, low to high.
    by_note: tuple[NoteIntonation, ...] = ()


def intonation_of(
    cents: np.ndarray,
    bars: list[int],
    config: IntonationConfig,
    pitches: list[str | None] | None = None,
) -> Intonation:
    """The take's tuning, its spread, each bar's pitch and each note's.

    `pitches` is each note as written, in the order of `cents`; without it
    there is nothing to group by note and `by_note` is empty.

    Nothing at all when fewer than `min_notes` notes were measured: a pitch
    chart of three notes is three notes' noise.
    """
    cents = np.asarray(cents, dtype=float)
    measured = np.isfinite(cents)
    if int(measured.sum()) < config.min_notes:
        return Intonation()
    tuning = float(np.median(cents[measured]))
    relative = cents - tuning
    kept = measured & (np.abs(relative) <= config.not_this_note_cents)
    if int(kept.sum()) < config.min_notes:
        return Intonation()

    per_bar: dict[int, list[float]] = defaultdict(list)
    for bar, value, keep in zip(bars, relative, kept, strict=True):
        if keep:
            per_bar[int(bar)].append(float(value))
    return Intonation(
        tuning_cents=round(tuning, 1),
        spread_cents=round(float(np.median(np.abs(relative[kept]))), 1),
        by_bar={bar: round(float(np.median(v)), 1) for bar, v in sorted(per_bar.items())},
        notes=int(kept.sum()),
        by_note=_by_note(relative, measured, bars, pitches, config) if pitches else (),
    )


def _by_note(
    relative: np.ndarray,
    measured: np.ndarray,
    bars: list[int],
    pitches: list[str | None],
    config: IntonationConfig,
) -> tuple[NoteIntonation, ...]:
    """Each written note's median, where it was read often enough to mean it.

    **Within half a semitone, not the bars' semitone.** A bar is the median of
    every note in it and absorbs one reading that was the last note still
    ringing; a written note may have four readings, and one of them decides
    the median. The owner's 0313 take read its E-flats +20, +29, -20 and -98
    — the -98 the D before it — and kept, it put the E-flats in tune. A reading
    `by_note_within_cents` or further off is nearer another note than this one.

    Grouped by MIDI number, so an E-flat the page also writes as D-sharp is one
    note, named the way the page writes it most. Every note read at least
    `by_note_min_notes` times is reported, so Insights can pool a note across
    takes that each read it a few times; the take's own screen shows only
    those read `by_note_show_notes` times, which travels with the take.
    """
    readings: dict[int, list[float]] = defaultdict(list)
    where: dict[int, set[int]] = defaultdict(set)
    spellings: dict[int, Counter[str]] = defaultdict(Counter)
    near = measured & (np.abs(relative) < config.by_note_within_cents)
    for value, keep, bar, pitch in zip(relative, near, bars, pitches, strict=True):
        number = midi(pitch) if keep and pitch else None
        if number is None:
            continue
        readings[number].append(float(value))
        where[number].add(int(bar))
        spellings[number][pitch] += 1
    return tuple(
        NoteIntonation(
            pitch=spellings[number].most_common(1)[0][0],
            midi=number,
            cents=round(float(np.median(values)), 1),
            notes=len(values),
            bars=tuple(sorted(where[number])),
        )
        for number, values in sorted(readings.items())
        if len(values) >= config.by_note_min_notes
    )
