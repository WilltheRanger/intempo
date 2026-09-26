"""Two mistakes a player makes that the timing verdict could not see.

The owner asked (2026-09-26) what a player can do that the reading misses, and
chose to be told about two of them:

- **A wrong note.** Forgetting the F♯ in the key signature — four notes of
  thirty-two a semitone flat — came back "Steady all the way through." The
  timing was steady; the notes were not the page's.
- **A miscounted rest.** Coming in a bar early after a two-bar rest also came
  back steady: every bar's own tempo was right, and nothing looked at the
  silence between them.

Both are claims about the musician, so both are made only on evidence that
cannot be the recording's fault. A wrong note is named only where two separate
readings of the pitch agree on what was heard and both say it was another note;
a note the microphone could not pitch is never accused. And a take where a
quarter of the notes come out "wrong" is not a take full of mistakes — it is a
page read in the wrong clef or key — so it names none.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

from app.services import pitch_evidence
from app.services.alignment import ExpectedTimeline
from app.services.score_schema import ScoreJson

# **Nothing from `app.services.ocr` here, on purpose.** Importing any module
# under it runs that package's `__init__`, which reaches the MusicXML reader and
# `defusedxml` — and the analysis worker's Modal image does not install it, so
# every take would fail in milliseconds (`test_modal_images.py` caught it). The
# three small walks below are what this needs of those modules.

_SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]


class _PitchReading(Protocol):
    frames: np.ndarray
    sr: int
    steady: float
    track: np.ndarray | None
    transpose: int


@dataclass(frozen=True)
class WrongNote:
    """A note heard clearly as another note than the one written."""

    measure_number: int
    #: What was heard, as a pitch name without an octave: "F", "Bb".
    heard: str
    #: What the page has there, the same way: "F#".
    written: str


@dataclass(frozen=True)
class RestEntry:
    """An entrance after a rest that came in early or late."""

    #: The first bar of the rest — where a musician looks to count it.
    rest_measure: int
    #: The bar the entrance is in.
    measure_number: int
    #: How far off, in quarter beats at the take's own pace: negative is early.
    beats: float
    #: Quarter beats in a bar of the rest, so a whole bar can be said as one.
    bar_beats: float | None


def _name_without_octave(pitch: str) -> str:
    return pitch.rstrip("-0123456789")


_FLAT_MAJORS = {"F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"}
_FLAT_MINORS = {"D", "G", "C", "F", "Bb", "Eb", "Ab"}


def _uses_flats(key: str | None) -> bool:
    """Whether a key name — "Bb major", "G minor", "Eb" — is written in flats."""
    words = (key or "").strip().split()
    if not words:
        return False
    tonic = words[0][:1].upper() + words[0][1:]
    minor = len(words) > 1 and words[1].lower().startswith("min")
    return tonic in (_FLAT_MINORS if minor else _FLAT_MAJORS)


def _heard_name(pitch_class: int, key: str | None) -> str:
    """A heard pitch class spelled the way the key would spell it."""
    return (_FLATS if _uses_flats(key) else _SHARPS)[pitch_class % 12]


def _keys_by_measure(score: ScoreJson) -> dict[int, str | None]:
    """The key each bar is written in: a key holds until another is printed."""
    running = score.key_signature
    out: dict[int, str | None] = {}
    for measure in score.measures:
        if measure.key_signature:
            running = measure.key_signature
        out[measure.measure_number] = running
    return out


def _quarter_beats(time_signature: str | None) -> float | None:
    """Quarter beats in a bar of "3/4", "6/8"; None where it cannot be read."""
    try:
        top, bottom = (int(part) for part in (time_signature or "").split("/"))
    except ValueError:
        return None
    return top * 4.0 / bottom if top > 0 and bottom > 0 else None


def _bar_beats_by_measure(score: ScoreJson) -> dict[int, float | None]:
    """Quarter beats in each bar: a metre holds until another is printed."""
    running = _quarter_beats(score.time_signature)
    out: dict[int, float | None] = {}
    for measure in score.measures:
        if measure.time_signature is not None:
            running = _quarter_beats(measure.time_signature)
        out[measure.measure_number] = running
    return out


def wrong_notes(
    matched: list[tuple[int, int]],
    attacks_s: np.ndarray,
    timeline: ExpectedTimeline,
    pitch: _PitchReading,
    score: ScoreJson,
    *,
    max_share: float,
    min_relative: float,
    clear_semitones: float,
    tuning_semitones: float = 0.0,
) -> list[WrongNote]:
    """The paired notes clearly heard as a different note, in page order.

    Heard two ways, which must agree: the chroma after the attack held one
    pitch class steadily (`pitch_evidence.heard_after`), and the pitch track
    (`heights_at`) sounded that same class.

    **Against the take's own tuning, and on a semitone of its own.** A player
    tuned 25 cents flat plays every note 25 cents flat, and that is the
    instrument, not a mistake (`tuning_semitones`, from the take's
    intonation). What is left is named wrong only when it sits within
    `clear_semitones` of a *different* semitone: F played cleanly where the
    page has F♯. A note half-way between two semitones is out of tune, which
    the pitch chart already says, and is never called another note. The same
    letter an octave away is not a wrong note either.

    Not named where the written note was sounding beside it — a double stop,
    or a written note ringing under an open string.
    """
    if pitch.track is None or not matched:
        return []
    kept = [
        (d, e)
        for d, e in sorted(matched, key=lambda pair: pair[1])
        if 0 <= e < len(timeline.notes)
        and 0 <= d < attacks_s.size
        and not timeline.notes[e].is_grace_note
        and pitch_evidence.midi(timeline.notes[e].pitch) is not None
    ]
    if not kept:
        return []
    times = np.array([attacks_s[d] for d, _ in kept])
    order = np.argsort(times)
    # `heard_after` listens up to the next attack, so it is asked in time order.
    heard_sorted = pitch_evidence.heard_after(pitch.frames, pitch.sr, times[order], steady=pitch.steady)
    heights_sorted = pitch_evidence.heights_at(pitch.track, pitch.sr, times[order])
    heard: list = [None] * len(kept)
    heights = np.full(len(kept), np.nan)
    for rank, index in enumerate(order):
        heard[index] = heard_sorted[rank]
        heights[index] = heights_sorted[rank]

    key_of = _keys_by_measure(score)

    def sounding_class(index: int) -> int | None:
        if not 0 <= index < len(timeline.notes):
            return None
        m = pitch_evidence.midi(timeline.notes[index].pitch)
        return None if m is None else (m + pitch.transpose) % 12

    found: list[WrongNote] = []
    for (_, e), h, height in zip(kept, heard, heights, strict=True):
        note = timeline.notes[e]
        written_midi = pitch_evidence.midi(note.pitch)
        if written_midi is None or h is None or h.pitch_class is None or not np.isfinite(height):
            continue
        tuned = height - tuning_semitones
        nearest = int(round(tuned))
        if abs(tuned - nearest) > clear_semitones:
            continue  # between two notes: out of tune, not another note
        if nearest % 12 != h.pitch_class:
            continue  # the two readings disagree about what was heard
        sounding = written_midi + pitch.transpose
        written_class = sounding % 12
        if nearest % 12 == written_class:
            continue  # the written note, in some octave
        if h.relative and h.relative[written_class] >= min_relative:
            continue  # the written note sounded too
        # **The note before still ringing, or the next one arriving early.** A
        # fifth of the owner's real bass notes read more than a semitone from
        # the page, and listening to them says why: the previous note ringing
        # into the window (`[intonation] not_this_note_cents`). Both readings
        # agree on that pitch, so agreement alone would accuse every one.
        if h.pitch_class in (sounding_class(e - 1), sounding_class(e + 1)):
            continue
        found.append(
            WrongNote(
                measure_number=note.measure_number,
                heard=_heard_name(h.pitch_class, key_of.get(note.measure_number, score.key_signature)),
                written=_name_without_octave(note.pitch or ""),
            )
        )
    if len(found) > max_share * len(kept):
        return []
    return found


def miscounted_rests(
    matched: list[tuple[int, int]],
    onsets_s: np.ndarray,
    timeline: ExpectedTimeline,
    score: ScoreJson,
    *,
    min_beats: float,
) -> list[RestEntry]:
    """Entrances after a rest of a bar or more that came in early or late.

    The gap between the last note before the rest and the first after it,
    against the written gap at the pace the take itself kept around the rest
    — the median seconds per beat of its paired notes nearby — so a take
    played slowly throughout is not told it came in late.

    Left alone: an entrance after a fermata (the page made that length the
    player's), and one under a written tempo change.
    """
    pairs = sorted(
        (e, d) for d, e in matched if 0 <= e < len(timeline.notes) and 0 <= d < onsets_s.size
    )
    if len(pairs) < 4:
        return []
    positions = [timeline.notes[e].written_beats for e, _ in pairs]
    if any(p is None for p in positions):
        return []
    bar_beats_of = _bar_beats_by_measure(score)
    found: list[RestEntry] = []
    for i in range(1, len(pairs)):
        (e0, d0), (e1, d1) = pairs[i - 1], pairs[i]
        before, after = timeline.notes[e0], timeline.notes[e1]
        if e1 != e0 + 1 or after.after_fermata or after.under_tempo_change or before.under_tempo_change:
            continue
        # A whole bar with nothing in it, at least, between the two notes.
        if after.measure_number - before.measure_number < 2:
            continue
        written_gap = float(positions[i]) - float(positions[i - 1])  # type: ignore[arg-type]
        pace = _local_seconds_per_beat(pairs, positions, onsets_s, i)
        if pace is None or written_gap <= 0:
            continue
        played_gap = float(onsets_s[d1] - onsets_s[d0])
        off = played_gap / pace - written_gap
        if abs(off) < min_beats:
            continue
        rest_measure = before.measure_number + 1
        found.append(
            RestEntry(
                rest_measure=rest_measure,
                measure_number=after.measure_number,
                beats=round(off * 2) / 2,
                bar_beats=bar_beats_of.get(rest_measure),
            )
        )
    return found


def _local_seconds_per_beat(
    pairs: list[tuple[int, int]],
    positions: list,
    onsets_s: np.ndarray,
    gap_at: int,
    reach: int = 6,
) -> float | None:
    """The take's own pace either side of a rest, leaving the rest out."""
    ratios = []
    for j in range(max(1, gap_at - reach), min(len(pairs), gap_at + reach + 1)):
        if j == gap_at:
            continue
        written = float(positions[j]) - float(positions[j - 1])
        played = float(onsets_s[pairs[j][1]] - onsets_s[pairs[j - 1][1]])
        if pairs[j][0] == pairs[j - 1][0] + 1 and written > 0 and played > 0:
            ratios.append(played / written)
    return float(np.median(ratios)) if len(ratios) >= 2 else None
