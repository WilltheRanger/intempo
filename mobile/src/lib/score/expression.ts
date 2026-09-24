import type { Articulation, Dynamics, Hairpin } from '../../data/types';
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

/** The written levels, softest first: the steps a hairpin moves along. */
const LADDER: readonly Level[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

/**
 * How far a hairpin goes when the page does not say where it arrives: two
 * steps, `p` to `mf`. One step is under 3 dB, a change a listener has to be
 * told is there, and a hairpin is written to be heard.
 */
const HAIRPIN_STEPS = 2;

/** The markings on a note that decide its level. */
interface Marked {
  dynamics?: Dynamics | null;
  hairpin?: Hairpin | null;
  hairpin_end?: boolean;
}

/** A hairpin, placed: the level moves in a straight line across these beats. */
interface Ramp {
  fromBeat: number;
  toBeat: number;
  from: number;
  to: number;
}

interface LevelPlan {
  /**
   * What each note is struck at, before accent, metre and variation: its
   * dynamic, or as far as a hairpin has carried the level by its onset.
   */
  attack: number[];
  /** The level in force at each note's onset, without a one-note accent. */
  standing: number[];
  /**
   * The level just before `beat`: where a note held across a hairpin has been
   * carried to by then.
   */
  before(beat: number): number;
}

function isStanding(marking: Dynamics | null | undefined): boolean {
  return !!marking && (isLevel(marking) || marking === 'fp');
}

/** A note that ends the hairpin before it: its end, a new one, or a new level. */
function closesHairpin(note: Marked): boolean {
  return !!note.hairpin_end || !!note.hairpin || isStanding(note.dynamics);
}

/**
 * Where a hairpin arrives: the dynamic written at its end, if it lies the way
 * the hairpin points; otherwise `HAIRPIN_STEPS` along from where it started.
 *
 * "cresc. … subito p" is a crescendo and then a sudden piano, not a
 * diminuendo into one — so a written level on the wrong side is played as the
 * jump it is, after a hairpin that went the way it was drawn.
 */
function arrival(kind: Hairpin, from: number, written: Dynamics | null | undefined): number {
  if (written && isLevel(written)) {
    const level = DYNAMIC_VELOCITY[written];
    if (kind === 'crescendo' ? level > from : level < from) {
      return level;
    }
  }
  let nearest = 0;
  LADDER.forEach((level, index) => {
    if (Math.abs(DYNAMIC_VELOCITY[level] - from) < Math.abs(DYNAMIC_VELOCITY[LADDER[nearest]] - from)) {
      nearest = index;
    }
  });
  const step = kind === 'crescendo' ? HAIRPIN_STEPS : -HAIRPIN_STEPS;
  const to = Math.max(0, Math.min(LADDER.length - 1, nearest + step));
  return DYNAMIC_VELOCITY[LADDER[to]];
}

function along(ramp: Ramp, beat: number): number {
  const t = (beat - ramp.fromBeat) / (ramp.toBeat - ramp.fromBeat);
  return ramp.from + (ramp.to - ramp.from) * Math.max(0, Math.min(1, t));
}

/**
 * The level through a passage: its dynamics, and its hairpins as ramps.
 *
 * `onsets` are the beats each note starts on and `endBeat` where the passage
 * ends, in the order it is played — rests and tied-over notes included,
 * because a hairpin can end on either.
 *
 * **A hairpin runs from the note it starts on to the first that closes it:**
 * the note it is written to end on, the next hairpin, or the next dynamic.
 * The level moves in a straight line across the beats between, so a
 * crescendo over a bar of quarters and one over a held whole note climb at
 * the same rate. One that nothing closes runs to the end of the passage.
 *
 * A sforzando inside a hairpin is one forced note on the way; it does not
 * stop the hairpin, and the level after it carries on from where it was.
 */
export function levelsAlong(
  notes: readonly Marked[],
  onsets: readonly number[],
  endBeat: number,
): LevelPlan {
  const attack: number[] = [];
  const standingAt: number[] = [];
  const ramps: Ramp[] = [];
  // Where the level jumps, in order: `before` reads the last one behind it.
  const jumps: { beat: number; level: number }[] = [];
  let standing = UNMARKED_VELOCITY;
  let open: { end: number; ramp: Ramp } | null = null;

  for (let i = 0; i < notes.length; i += 1) {
    const beat = onsets[i];
    if (open && open.end === i) {
      standing = open.ramp.to;
      open = null;
    }
    const here = open ? along(open.ramp, beat) : standing;
    const dynamic = applyDynamic(notes[i].dynamics, here);
    attack.push(dynamic.note);
    // Inside a hairpin only a one-note accent can be written here; the level
    // it stands on is the hairpin's, and it carries on.
    if (!open && dynamic.standing !== standing) {
      standing = dynamic.standing;
      jumps.push({ beat, level: standing });
    }
    standingAt.push(open ? here : standing);

    const kind = notes[i].hairpin;
    if (kind === 'crescendo' || kind === 'diminuendo') {
      let end: number = i + 1;
      while (end < notes.length && !closesHairpin(notes[end])) {
        end += 1;
      }
      const toBeat = end < notes.length ? onsets[end] : endBeat;
      const to = arrival(kind, standing, notes[end]?.dynamics);
      if (toBeat > beat && to !== standing) {
        const ramp = { fromBeat: beat, toBeat, from: standing, to };
        ramps.push(ramp);
        jumps.push({ beat: toBeat, level: to });
        open = { end, ramp };
      }
    }
  }

  return {
    attack,
    standing: standingAt,
    before(beat: number): number {
      for (const ramp of ramps) {
        if (ramp.fromBeat < beat && beat <= ramp.toBeat) {
          return along(ramp, beat);
        }
      }
      let level = UNMARKED_VELOCITY;
      for (const jump of jumps) {
        if (jump.beat >= beat) break;
        level = jump.level;
      }
      return level;
    },
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
