/**
 * Where a take has got to on the page, so a musician who loses their place
 * can find it.
 *
 * **What this knows and what it cannot.** It follows the *click*, not the
 * playing: nothing analyses audio live, so this is where the beat says you
 * should be, not where you are. That distinction is the whole reason the
 * position is computed from elapsed time and tempo rather than from anything
 * heard, and it is why the mark must never be drawn as though it were
 * listening. A musician who has drifted will see the mark move away from them,
 * which is the useful thing; a musician who thinks it is tracking them will
 * read that as the app being wrong.
 *
 * A module with tests rather than a calculation inside the screen, per
 * `CLAUDE.md` §3: there is no React Native testing library here, so arithmetic
 * inside a `.tsx` is arithmetic nothing checks. This is the kind that is wrong
 * by one bar for a month before anyone notices.
 */

export interface PlayheadInput {
  /** Milliseconds since the take started. Count-in has already been excluded. */
  elapsedMs: number;
  /** The tempo the take is set to. */
  bpm: number;
  /** Beats in a bar, from the metronome's own pulse plan. */
  beatsPerBar: number;
  /** The bar the take began on, 1-based, as `measureNumber` counts. */
  startFrom: number;
  /** The last bar on the piece, so the mark stops rather than running off. */
  lastBar: number;
}

export interface Playhead {
  /** The bar it is in, 1-based, matching `Stave`'s `measureNumber`. */
  measureNumber: number;
  /** How far through that bar, 0 at the barline and approaching 1 at the next. */
  through: number;
}

const MS_PER_MINUTE = 60_000;

/**
 * The mark's position, or `null` when there should not be one.
 *
 * `null` rather than a position at bar one for everything that is not a
 * running take, because "no mark" and "the mark is at the start" are different
 * states and drawing the second for the first puts a playhead on a screen
 * nobody is playing to. That covers a take that has not begun, a count-in
 * still running (the caller passes elapsed time that excludes it), a tempo or
 * metre that cannot be believed, and a take that has run past the last bar.
 *
 * Running past the end is a real case rather than a defensive one: a musician
 * who repeats a section, or simply keeps playing, will pass the final barline
 * while the take is still recording. The mark stops being drawn, which is
 * honest — the page has nothing left to point at.
 */
export function playheadAt({
  elapsedMs,
  bpm,
  beatsPerBar,
  startFrom,
  lastBar,
}: PlayheadInput): Playhead | null {
  if (
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(bpm) ||
    !Number.isFinite(beatsPerBar) ||
    elapsedMs < 0 ||
    bpm <= 0 ||
    beatsPerBar <= 0
  ) {
    return null;
  }

  const beats = elapsedMs / (MS_PER_MINUTE / bpm);
  const barsIn = beats / beatsPerBar;
  const measureNumber = startFrom + Math.floor(barsIn);

  if (measureNumber > lastBar) {
    return null;
  }

  return { measureNumber, through: barsIn - Math.floor(barsIn) };
}
