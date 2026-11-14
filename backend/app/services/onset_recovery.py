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


#: The level `recover_by_bow_change` reads: RMS over 23 ms windows, every
#: 5.8 ms at 22,050 Hz. Finer than the take's own level (`audio._rms_db`,
#: 93 ms windows), which smooths a bow change of 30–80 ms nearly flat.
_BOW_LEVEL_WINDOW = 512
_BOW_LEVEL_HOP = 128

#: How far either side of a dip the level it dips from is read, in seconds.
BOW_CHANGE_SIDE_S = 0.12


def _level_db(y: np.ndarray, sr: int, start_s: float, end_s: float) -> tuple[np.ndarray, float]:
    """The level from `start_s` to `end_s`, in dB, and the time of its first value."""
    first = max(0, int(start_s * sr))
    last = min(y.size, int(np.ceil(end_s * sr)))
    piece = np.asarray(y[first:last], dtype=float)
    if piece.size < _BOW_LEVEL_WINDOW:
        return np.array([], dtype=float), first / sr
    power = np.convolve(
        piece**2, np.ones(_BOW_LEVEL_WINDOW) / _BOW_LEVEL_WINDOW, mode="same"
    )[::_BOW_LEVEL_HOP]
    return 10.0 * np.log10(np.maximum(power, 1e-20)), first / sr


def recover_by_bow_change(
    y: np.ndarray,
    sr: int,
    *,
    predicted_s: np.ndarray,
    reach_s: np.ndarray,
    min_dip_db: float,
    side_s: float = BOW_CHANGE_SIDE_S,
) -> list[float | None]:
    """Where the sound dips and comes back near each predicted time.

    **For a note at the pitch of the note before it, bowed again.** Its pitch
    does not change, so the legato look cannot hear it (`recover_by_pitch`),
    and the bow change makes only a small rise in the onset envelope, which
    the first pass often lets through: on URMP's 72 real takes (2026-11-14)
    113 of the 288 played notes reported missing were such notes. What the
    bow change does leave is a dip in the level as the bow stops and turns:
    a median 8.5 dB at the labelled onsets of those 113, 11 dB at the
    repeated notes the first pass did hear, and 1.4 dB in the middle of a
    held note.

    For each prediction, the deepest local minimum of the level within
    `reach_s[i]` of it. Its depth is read against the quieter of the loudest
    levels `side_s` before and after it, so the sound must come back: a note
    ending is not a bow change. Kept if at least `min_dip_db` deep, at the time
    the level has come halfway back up (in dB): on the URMP labels 12–41 ms
    after the labelled onset. The caller moves it onto the attack clock
    (`analysis._recover_bow_changes`). None where there is no such dip.
    """
    out: list[float | None] = []
    for centre, reach in zip(np.asarray(predicted_s, float), np.asarray(reach_s, float), strict=True):
        db, base = _level_db(y, sr, centre - reach - side_s - 0.2, centre + reach + side_s + 0.2)
        if db.size < 3 or reach <= 0:
            out.append(None)
            continue

        def frame(t: float) -> int:
            return int(round((t - base) * sr / _BOW_LEVEL_HOP))

        best: tuple[float, float] | None = None
        for c in range(max(1, frame(centre - reach)), min(db.size - 1, frame(centre + reach) + 1)):
            if not (db[c] <= db[c - 1] and db[c] <= db[c + 1]):
                continue
            t = base + c * _BOW_LEVEL_HOP / sr
            before = float(db[max(0, frame(t - side_s)) : c].max())
            after = float(db[c : frame(t + side_s) + 1].max())
            depth = min(before, after) - float(db[c])
            if depth < min_dip_db or (best is not None and depth <= best[0]):
                continue
            halfway = float(db[c]) + 0.5 * (after - float(db[c]))
            rise = c
            while rise < db.size - 1 and db[rise] < halfway:
                rise += 1
            best = (depth, base + rise * _BOW_LEVEL_HOP / sr)
        out.append(None if best is None else best[1])
    return out


def recover_by_pitch(
    track: np.ndarray,
    *,
    frame_s: float,
    windows: list[tuple[float, float]],
    targets: list[float],
    hold_s: float,
    tolerance_st: float,
) -> list[float | None]:
    """Where each wanted note's pitch first takes over, inside its window.

    **For the note no attack marks: a slurred one.** Under one bow a player
    changes notes with the fingers alone, so nothing the onset envelope
    measures has to rise — and on real bowed strings it often does not.
    Measured on URMP's 61 string tracks (2026-11-13): 5.3% of the notes
    played were reported missing, three in four of them with no attack within
    110 ms, and five in six a different pitch from the note before. The pitch
    track hears them: the written pitch arrives and stays.

    So for each window — after the note before it, before the note after it —
    this returns the start of the first stretch, at least `hold_s` long, in
    which the sounding pitch (`pitch_evidence.pitch_track`, fractional MIDI,
    one value per `frame_s`) stays within `tolerance_st` of `targets[i]`.
    None where it never does, which is what a note that was not played leaves.

    **A stretch that takes over, not one already under way.** One the window
    opens inside belongs to whatever sounded before it — an earlier note at
    this pitch, still ringing — so it counts only once something else, or
    nothing, has sounded in between.

    The caller chooses which notes may be asked — not one whose note before
    has its pitch, nor one whose note after has it while that note's attack is
    unknown, since the pitch would be found there whether this note sounded or
    not — and moves the time onto the attack clock: a pitch takes over where
    the label puts the note, an attack is placed a few tens of milliseconds
    into it.
    """
    out: list[float | None] = []
    hold = max(1, int(np.ceil(hold_s / frame_s - 1e-9)))
    for (start_s, end_s), target in zip(windows, targets, strict=True):
        first = max(0, int(np.ceil(start_s / frame_s)))
        last = min(track.size, int(np.floor(end_s / frame_s)) + 1)
        if last - first < hold:
            out.append(None)
            continue
        window = track[first:last]
        near = np.isfinite(window) & (np.abs(window - target) <= tolerance_st)
        found: float | None = None
        armed = False
        run = 0
        for k in range(near.size):
            if not near[k]:
                armed, run = True, 0
                continue
            if armed:
                run += 1
                if run >= hold:
                    found = (first + k - hold + 1) * frame_s
                    break
        out.append(found)
    return out
