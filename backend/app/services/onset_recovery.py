"""A second look for notes the first pass was not confident enough to report.

**Why a second pass rather than a lower threshold.** The detector misses quiet
notes in a live room — measured, 30 dB of dynamic range at RT60 0.9 s loses
half the take, and `test_degraded_audio.py` holds the numbers. The obvious fix
is to make detection more sensitive, and it does not work: an attempt on
2026-09-19 replaced the absolute threshold with a local one, fixed exactly that
case, and broke thirteen other tests — chiefly every varied-rhythm assertion,
because a local baseline is raised by dense passages and lowered by sparse ones
and so moves with the rhythm it is supposed to be a reference for. It was
reverted before it left the working tree. `TUNING_LOG.md` and the scratch
design note carry the sweep.

**So this changes nothing about detection.** It runs *after* alignment, looks
only where the score says a note belongs and the alignment found nothing, and
can only ever add an onset there. Two properties follow, and both are the
reason this shape was chosen:

  * A take where nothing was missed is **byte-identical**. `missed_expected` is
    empty, this returns nothing, and no existing reading can move.
  * A phantom cannot be invented anywhere the page does not write a note. The
    worst case is a note added at a written position where the musician was
    actually silent — which is what `coverage` already tolerates in the other
    direction, and which is bounded by requiring a real local maximum rather
    than merely a level.

The rule lives in its own module with its own tests rather than inside
`analyze`, for the reason `CLAUDE.md` §3 gives about rules in components: "does
this recover a note when it should" is exactly the kind of thing that is wrong
in one direction for a month without anyone noticing.
"""

from __future__ import annotations

import numpy as np


def predict_audio_times(
    matched: list[tuple[int, int]],
    detected: np.ndarray,
    expected: np.ndarray,
    wanted: list[int],
) -> np.ndarray:
    """Where in the recording each unmatched expected note should have landed.

    A straight line through the pairs the alignment *did* match — the take's
    own offset and pace — evaluated at the written time of each note it did
    not. This is the same fit `_residuals` makes for a different purpose, and
    it is deliberately the same shape: a take is allowed to sit at its own
    tempo, and a note is looked for where that tempo says it belongs rather
    than where the metronome would have put it.

    Fewer than two matched pairs means there is no line to fit and no take to
    speak of, so nothing is predicted. A take that matched one note is not one
    this should be rescuing.
    """
    if len(matched) < 2 or not wanted:
        return np.array([], dtype=float)

    det = np.array([detected[d] for d, _ in matched], dtype=float)
    exp = np.array([expected[e] for _, e in matched], dtype=float)
    if float(np.ptp(exp)) <= 0:
        return np.array([], dtype=float)

    rate, offset = np.polyfit(exp, det, 1)
    return np.asarray(rate * np.array([expected[i] for i in wanted]) + offset)


def recover_onsets(
    strength: np.ndarray,
    *,
    hop_length: int,
    sr: int,
    detected: np.ndarray,
    predicted_s: np.ndarray,
    search_s: float,
    floor_ratio: float,
    min_separation_s: float,
) -> np.ndarray:
    """Local maxima near predicted times that the first pass did not report.

    For each predicted time, the envelope is searched within `search_s` either
    side. A candidate is taken only if it is

      * the largest frame in that window — a level is not an attack, and
        requiring a maximum is what stops a reverb tail or a noise plateau
        from being read as a note;
      * above `floor_ratio` of the envelope's own maximum, which is the one
        absolute guard kept, so that searching near a written note in a
        passage the musician simply did not play finds nothing;
      * at least `min_separation_s` from anything already detected and from
        anything else recovered, so a single broad attack cannot be reported
        twice by being predicted twice.

    The search window is what bounds the damage: `search_s` is a fraction of a
    beat, so a recovered note is near where the page and the take's own pace
    agree it should be. Widening it past half the closest written gap would
    let one note be recovered onto its neighbour's position, which is why the
    caller derives it from the score rather than passing a constant.
    """
    if strength.size == 0 or predicted_s.size == 0:
        return np.array([], dtype=float)

    peak = float(strength.max())
    if peak <= 0:
        return np.array([], dtype=float)
    floor = floor_ratio * peak

    taken = list(np.asarray(detected, dtype=float))
    found: list[float] = []

    for predicted in np.sort(predicted_s):
        lo = max(0, int(round((predicted - search_s) * sr / hop_length)))
        hi = min(strength.size, int(round((predicted + search_s) * sr / hop_length)) + 1)
        if hi - lo < 3:
            continue

        window = strength[lo:hi]
        best = int(np.argmax(window))
        # An edge maximum is the shoulder of something outside the window, not
        # a peak inside it. Requiring an interior maximum is cheap and is what
        # keeps a decaying tail from being recovered as an attack.
        if best == 0 or best == window.size - 1:
            continue
        if float(window[best]) < floor:
            continue

        at = (lo + best) * hop_length / sr
        if any(abs(at - other) < min_separation_s for other in taken):
            continue

        taken.append(at)
        found.append(at)

    return np.array(sorted(found), dtype=float)


#: Doubling the windows either side of a change may read a step at most this
#: much larger than the narrow windows did. A true step reads the same two
#: notes at both widths (1.0); a steady glide reads twice as far (2.0). 1.5 is
#: the midpoint, and nothing here has yet heard a real slide — it is a shape
#: argument, not a measurement, and `TUNING_LOG.md` says so.
_SLIDE_GROWTH = 1.5


def pitch_change_times(
    track: np.ndarray,
    *,
    hop_length: int,
    sr: int,
    min_semitones: float,
    steady_frames: int,
) -> np.ndarray:
    """Where the pitch track steps from one settled note to another.

    **The attack a flux detector cannot hear.** Spectral flux measures how much
    the spectrum changed in *energy*, so it reads a bow articulating a new note
    as an attack only when that articulation is loud. Two notes slurred under
    one bow, or a soft détaché in the middle of a phrase, change the spectrum's
    *shape* without a step in its energy: the envelope stays flat and the note
    is simply not reported. The pitch, meanwhile, moves a semitone or more and
    stays there, which is what this looks for. Measured on URMP, a third to a
    half of the onsets `detect_onsets` misses have a pitch change within 50 ms
    — see `tools/eval/onset_bakeoff.py` and `TUNING_LOG.md`, 2026-11-02.

    A frame is a candidate when the `steady_frames` before it and the
    `steady_frames` after it each hold a settled reading — a median whose own
    frames all sit within half of `min_semitones` of it, so vibrato is not read
    as a step — and the two medians differ by at least `min_semitones`.

    **A slide is rejected by measuring the same step twice, at two widths.** A
    portamento has no settled frame to point at, but it does pass the test
    above: over a short enough window a steep glide looks flat, and four frames
    of it differ from the next four by a semitone. The two cases come apart on
    how the step grows with the window — across a real step, widening the
    windows reads the same two notes and the same distance; across a glide it
    reads further along the slide and the distance grows with it. A candidate
    is kept only when doubling the windows leaves the step below
    `_SLIDE_GROWTH` times what the narrow windows read.

    Where several adjacent frames qualify, the largest step wins, so one change
    is one time and not three.

    This reports *every* such step, the ones the first pass already found
    included: a note both loud and newly pitched is in both lists. Thinning
    that to the ones worth adding is the caller's job — the same division
    `recover_onsets` makes, and for the same reason: nothing here may invent a
    note the page does not write. **Nothing in the pipeline calls this yet.**
    On URMP a quarter of the changes it reports land nowhere near a labelled
    onset, which is fine inside a score-chosen window and not fine as a
    detector; wiring it into the recovery pass is JERA-565's follow-up, not
    this change.

    NaN frames (a tracker reporting nothing, or silence) break a window — a
    settled reading either side has to be settled in frames that exist.
    """
    track = np.asarray(track, dtype=float)
    span = int(steady_frames)
    if span < 1 or min_semitones <= 0 or track.size < 2 * span + 1:
        return np.array([], dtype=float)

    settle = min_semitones / 2.0
    steps = np.zeros(track.size)

    def _step(index: int, width: int) -> float | None:
        """How far the track moves across `index`, read over `width` frames
        either side. `None` where the window runs off the track or over a
        frame the tracker did not report."""
        if index - width < 0 or index + width > track.size:
            return None
        before, after = track[index - width : index], track[index : index + width]
        if not (np.isfinite(before).all() and np.isfinite(after).all()):
            return None
        return abs(float(np.median(after)) - float(np.median(before)))

    for i in range(span, track.size - span):
        before, after = track[i - span : i], track[i : i + span]
        if not (np.isfinite(before).all() and np.isfinite(after).all()):
            continue
        low, high = float(np.median(before)), float(np.median(after))
        if np.max(np.abs(before - low)) > settle or np.max(np.abs(after - high)) > settle:
            continue
        narrow = abs(high - low)
        if narrow < min_semitones:
            continue
        wide = _step(i, 2 * span)
        if wide is not None and wide > _SLIDE_GROWTH * narrow:
            continue
        steps[i] = narrow

    # One time per change: a frame counts only where it is the largest step in
    # its own neighbourhood — the same "a level is not an attack" rule the
    # envelope pass applies to peaks.
    found: list[int] = []
    for index in np.flatnonzero(steps):
        index = int(index)
        if steps[index] < steps[max(0, index - span) : index + span + 1].max():
            continue
        if found and (index - found[-1]) < span:
            continue
        found.append(index)
    return np.array([i * hop_length / sr for i in found], dtype=float)
