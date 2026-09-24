import type { Articulation, Dynamics } from '../../data/types';
import type { MetronomePulse } from '../metronome/beats';

/**
 * How a note is played, as distinct from when: the part of Listen that makes
 * it sound like a player rather than a sequencer.
 *
 * **Never the timing.** Everything here changes how hard a note is struck and
 * how its level moves while it sounds. No rule moves an onset: the reference
 * a musician copies must put each note exactly where the analysis will look
 * for it (`schedule.ts`, and `alignment.build_timeline` on the server), so
 * "natural" stops at the clock. A human player's rubato would be the one
 * expressive thing this app cannot afford to imitate.
 *
 * Velocity is what a soundfont turns into both level *and* timbre — the
 * engine darkens a soft note's filter, and GeneralUser's cello has three
 * recorded layers (0–79, 80–102, 103–127) where a harder note is a different
 * recording. That is why the numbers below are placed where they are rather
 * than spaced evenly: see `DYNAMIC_VELOCITY`.
 */

type Level = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';

/**
 * The velocity each written dynamic plays at.
 *
 * **Chosen so that a dynamic stays in one recording.** Within a dynamic a note
 * moves by the metric accent and the variation below, −5 to +7 in all; these
 * centres keep that whole window inside one of the cello's velocity layers at
 * `mf` (67–79 < 80), `f` (83–95) and `ff` (103–115), so a phrase at one level
 * does not flip between two recordings of the instrument on alternate beats.
 * An accent is meant to cross into the next layer, and does.
 *
 * `mf` is also the level of an unmarked score. It was a fixed 76 before any
 * of this existed; 72 is 0.8 dB quieter, the price of the layer above.
 */
export const DYNAMIC_VELOCITY: Record<Level, number> = {
  ppp: 34,
  pp: 44,
  p: 56,
  mp: 66,
  mf: 72,
  f: 88,
  ff: 108,
  fff: 118,
};

/** A score with no dynamics is played mezzo-forte throughout. */
export const UNMARKED_VELOCITY = DYNAMIC_VELOCITY.mf;

/** An accent: the note leans, and the phrase around it does not. */
const ACCENT_LIFT = 12;
/** A sforzando: at least forte, and then some. */
const SFORZANDO_LIFT = 16;
/** The first beat of the bar, the other strong beat, and between beats. */
const DOWNBEAT_LIFT = 5;
const MIDBAR_LIFT = 2;
const OFFBEAT_LIFT = -3;
/** A note under a slur is not a new bow stroke, so it does not bite. */
const SLURRED_LIFT = -6;

function isLevel(marking: Dynamics): marking is Level {
  return marking in DYNAMIC_VELOCITY;
}

/**
 * This note's own dynamic, and the one in force for the notes after it.
 *
 * A dynamic is a standing instruction — `p` means every note from here until
 * the next marking — except for the two kinds that describe one attack:
 * `fp` (this note forte, then piano) and the sforzandi (this note forced, the
 * level around it unchanged).
 */
export function applyDynamic(
  marking: Dynamics | null | undefined,
  standing: number,
): { note: number; standing: number } {
  if (!marking) {
    return { note: standing, standing };
  }
  if (isLevel(marking)) {
    const velocity = DYNAMIC_VELOCITY[marking];
    return { note: velocity, standing: velocity };
  }
  if (marking === 'fp') {
    return { note: DYNAMIC_VELOCITY.f, standing: DYNAMIC_VELOCITY.p };
  }
  return {
    note: Math.max(standing, DYNAMIC_VELOCITY.f) + SFORZANDO_LIFT,
    standing,
  };
}

/**
 * The weight of where a note falls in its bar.
 *
 * Read from the felt pulse (`metronomePulse`), not the written beat, so a 6/8
 * bar leans on its two dotted-quarter beats rather than on every eighth. A bar
 * whose meter cannot be read gets the downbeat and nothing else.
 */
export function metricLift(
  offsetQuarters: number,
  pulse: MetronomePulse | null,
): number {
  if (Math.abs(offsetQuarters) < 1e-6) {
    return DOWNBEAT_LIFT;
  }
  if (!pulse) {
    return 0;
  }
  const pulses = offsetQuarters / pulse.quarterBeats;
  const nearest = Math.round(pulses);
  if (Math.abs(pulses - nearest) > 1e-6) {
    return OFFBEAT_LIFT;
  }
  const half = pulse.pulsesPerBar / 2;
  return pulse.pulsesPerBar >= 4 && nearest === half ? MIDBAR_LIFT : 0;
}

/**
 * A small, repeatable difference between one note and the next, −2 to +2.
 *
 * **Deterministic, by position.** Identical velocities are what make a
 * sampled scale sound typed; a random number would make two presses of Listen
 * sound different, which a musician comparing their take to the reference
 * would reasonably read as the app being unreliable.
 */
export function variation(index: number): number {
  return (Math.imul(index + 1, 2654435761) >>> 0) % 5 - 2;
}

interface Touch {
  /** The dynamic this note is played at, from `applyDynamic`. */
  dynamic: number;
  articulation?: Articulation | null;
  /** From `metricLift`. */
  metric: number;
  /** Reached under a slur from the note before it: no new bow. */
  slurredFrom: boolean;
  /** Position among sounded notes, for `variation`. */
  index: number;
}

/** How hard the note is played, 1–127. */
export function velocityOf(touch: Touch): number {
  const velocity =
    touch.dynamic +
    (touch.articulation === 'accent' ? ACCENT_LIFT : 0) +
    touch.metric +
    (touch.slurredFrom ? SLURRED_LIFT : 0) +
    variation(touch.index);
  return Math.max(1, Math.min(127, Math.round(velocity)));
}

/** A long note breathes; a short one does not have time to. */
export const SWELL_MIN_S = 0.9;
/** Where a note starts, peaks and ends, as MIDI expression (CC 11). */
export const EXPRESSION_NEUTRAL = 120;
const SWELL_START = 116;
const SWELL_PEAK = 127;
const SWELL_END = 110;
/** How far into the note the bloom peaks. */
const SWELL_PEAK_AT = 0.35;

/**
 * The expression a held note has at `fraction` of the way through it.
 *
 * A bowed note that is held does not sit at one level: it blooms as the bow
 * settles and eases before the bow changes. Here that is about +1 dB and −2
 * dB (CC 11 at 116 → 127 → 110, measured against the engine), shaped with a
 * half-cosine on each side so there is no corner to hear.
 */
export function swell(fraction: number): number {
  const x = Math.max(0, Math.min(1, fraction));
  const ease = (from: number, to: number, t: number) =>
    from + (to - from) * (1 - Math.cos(Math.PI * t)) / 2;
  const value =
    x < SWELL_PEAK_AT
      ? ease(SWELL_START, SWELL_PEAK, x / SWELL_PEAK_AT)
      : ease(SWELL_PEAK, SWELL_END, (x - SWELL_PEAK_AT) / (1 - SWELL_PEAK_AT));
  return Math.round(value);
}
