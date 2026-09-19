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
