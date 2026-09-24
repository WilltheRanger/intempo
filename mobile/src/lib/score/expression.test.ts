import { describe, expect, it } from 'vitest';

import { metronomePulse } from '../metronome/beats';
import {
  DYNAMIC_VELOCITY,
  UNMARKED_VELOCITY,
  applyDynamic,
  levelsAlong,
  metricLift,
  swell,
  variation,
  velocityOf,
} from './expression';

describe('dynamics', () => {
  it('stand until the next marking', () => {
    expect(applyDynamic('p', UNMARKED_VELOCITY)).toEqual({
      note: DYNAMIC_VELOCITY.p,
      standing: DYNAMIC_VELOCITY.p,
    });
    expect(applyDynamic(null, DYNAMIC_VELOCITY.p)).toEqual({
      note: DYNAMIC_VELOCITY.p,
      standing: DYNAMIC_VELOCITY.p,
    });
  });

  it('are ordered, softest to loudest', () => {
    const order = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'] as const;
    const velocities = order.map((level) => DYNAMIC_VELOCITY[level]);
    expect(velocities).toEqual([...velocities].sort((a, b) => a - b));
    expect(new Set(velocities).size).toBe(order.length);
  });

  it('describe one attack when they are fp or a sforzando', () => {
    // fp: this note forte, everything after it piano.
    expect(applyDynamic('fp', UNMARKED_VELOCITY)).toEqual({
      note: DYNAMIC_VELOCITY.f,
      standing: DYNAMIC_VELOCITY.p,
    });
    // A sforzando in a piano passage is still forced, and the passage stays piano.
    for (const marking of ['sfz', 'sf', 'fz'] as const) {
      const hit = applyDynamic(marking, DYNAMIC_VELOCITY.p);
      expect(hit.note).toBeGreaterThan(DYNAMIC_VELOCITY.f);
      expect(hit.standing).toBe(DYNAMIC_VELOCITY.p);
    }
  });

  /**
   * **The reason the numbers are where they are.** GeneralUser's cello is
   * three recordings, chosen by velocity: 0–79, 80–102, 103–127. A phrase at
   * one dynamic that straddled a boundary would alternate between two
   * recordings of the instrument on strong and weak beats.
   */
  it.each([
    ['mf', 0, 79],
    ['f', 80, 102],
    ['ff', 103, 127],
  ] as const)('keep a phrase at %s inside one cello recording', (level, low, high) => {
    for (const metric of [-3, 0, 2, 5]) {
      for (let index = 0; index < 20; index += 1) {
        const velocity = velocityOf({
          dynamic: DYNAMIC_VELOCITY[level],
          metric,
          slurredFrom: false,
          index,
        });
        expect(velocity).toBeGreaterThanOrEqual(low);
        expect(velocity).toBeLessThanOrEqual(high);
      }
    }
  });
});

describe('where a note falls in the bar', () => {
  const common = metronomePulse('4/4');
  const compound = metronomePulse('6/8');

  it('leans on the downbeat, then the middle of a four-beat bar', () => {
    expect(metricLift(0, common)).toBeGreaterThan(metricLift(2, common));
    expect(metricLift(2, common)).toBeGreaterThan(metricLift(1, common));
    expect(metricLift(1, common)).toBe(metricLift(3, common));
  });

  it('is lightest between beats', () => {
    expect(metricLift(0.5, common)).toBeLessThan(metricLift(1, common));
  });

  it('counts a 6/8 bar in two dotted-quarter pulses, not six eighths', () => {
    // Beat two of 6/8 is the fourth eighth — 1.5 quarters in.
    expect(metricLift(1.5, compound)).toBe(0);
    // The second eighth is between pulses, not on one.
    expect(metricLift(0.5, compound)).toBeLessThan(0);
  });

  it('knows only the downbeat when the meter cannot be read', () => {
    expect(metricLift(0, null)).toBeGreaterThan(0);
    expect(metricLift(1, null)).toBe(0);
    expect(metricLift(0.5, null)).toBe(0);
  });
});

describe('the difference between one note and the next', () => {
  it('is small, varied and the same every time Listen is pressed', () => {
    const values = Array.from({ length: 50 }, (_, index) => variation(index));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(-2);
    expect(Math.max(...values)).toBeLessThanOrEqual(2);
    expect(new Set(values).size).toBeGreaterThan(2);
    expect(Array.from({ length: 50 }, (_, index) => variation(index))).toEqual(values);
  });
});

describe('touch', () => {
  const plain = { dynamic: UNMARKED_VELOCITY, metric: 0, slurredFrom: false, index: 3 };

  it('leans on an accent and softens under a slur', () => {
    const base = velocityOf(plain);
    expect(velocityOf({ ...plain, articulation: 'accent' })).toBeGreaterThan(base);
    expect(velocityOf({ ...plain, slurredFrom: true })).toBeLessThan(base);
  });

  it('stays a MIDI velocity at the extremes', () => {
    expect(
      velocityOf({ ...plain, dynamic: 127, articulation: 'accent', metric: 5 }),
    ).toBe(127);
    expect(velocityOf({ ...plain, dynamic: 0, slurredFrom: true, metric: -3 })).toBe(1);
  });
});

describe('a held note', () => {
  it('blooms, then eases before it ends', () => {
    const start = swell(0);
    const peak = swell(0.35);
    const end = swell(1);
    expect(peak).toBe(127);
    expect(start).toBeLessThan(peak);
    expect(end).toBeLessThan(start);
  });

  it('moves without a corner', () => {
    let previous = swell(0);
    for (let step = 1; step <= 100; step += 1) {
      const next = swell(step / 100);
      expect(Math.abs(next - previous)).toBeLessThanOrEqual(2);
      previous = next;
    }
  });
});

describe('a hairpin', () => {
  const { p, mp, mf, f, ff, fff } = DYNAMIC_VELOCITY;
  /** Quarters, one beat each, in a row. */
  const along = (notes: Parameters<typeof levelsAlong>[0]) =>
    levelsAlong(notes, notes.map((_, beat) => beat), notes.length);

  it('climbs in a straight line to the dynamic written at its end', () => {
    const levels = along([
      { dynamics: 'p', hairpin: 'crescendo' },
      {},
      {},
      {},
      { dynamics: 'f', hairpin_end: true },
      {},
    ]);
    expect(levels.attack).toEqual([p, p + 8, p + 16, p + 24, f, f]);
    expect(levels.standing).toEqual(levels.attack);
  });

  it('goes two steps when nothing is written where it ends', () => {
    const levels = along([{ dynamics: 'p', hairpin: 'crescendo' }, {}, { hairpin_end: true }, {}]);
    expect(levels.attack.at(-2)).toBe(mf);
    expect(levels.attack.at(-1)).toBe(mf);
    const falling = along([{ dynamics: 'f', hairpin: 'diminuendo' }, {}, { hairpin_end: true }]);
    expect(falling.attack.at(-1)).toBe(mp);
  });

  it('runs to the next dynamic when its end was not written', () => {
    // "cresc." has no end mark: it runs until the page says where it went.
    const levels = along([{ hairpin: 'crescendo' }, {}, {}, { dynamics: 'ff' }]);
    expect(levels.attack[0]).toBe(mf);
    expect(levels.attack[3]).toBe(ff);
    expect(levels.attack[1]).toBeGreaterThan(mf);
  });

  it('runs to the end of the passage when nothing ends it', () => {
    const levels = levelsAlong([{ dynamics: 'p', hairpin: 'crescendo' }], [0], 4);
    expect(levels.before(4)).toBe(mf);
    expect(levels.before(2)).toBeCloseTo((p + mf) / 2);
  });

  it('plays a dynamic on the wrong side of it as the sudden change it is', () => {
    // cresc. … subito p: up, and then down at once, not a diminuendo.
    const levels = along([{ dynamics: 'mp', hairpin: 'crescendo' }, {}, { dynamics: 'p' }, {}]);
    expect(levels.attack[1]).toBeGreaterThan(mp);
    expect(levels.attack[2]).toBe(p);
    expect(levels.before(2)).toBe(f);
    expect(levels.before(2.5)).toBe(p);
  });

  it('carries on through a sforzando', () => {
    const levels = along([
      { dynamics: 'p', hairpin: 'crescendo' },
      { dynamics: 'sfz' },
      {},
      { dynamics: 'f' },
    ]);
    expect(levels.attack[1]).toBeGreaterThan(f);
    expect(levels.standing[1]).toBeCloseTo(p + (f - p) / 3);
    expect(levels.attack[2]).toBeCloseTo(p + (2 * (f - p)) / 3);
  });

  it('swells and returns under a < >', () => {
    const levels = along([
      { dynamics: 'p', hairpin: 'crescendo' },
      {},
      { hairpin_end: true, hairpin: 'diminuendo' },
      {},
      { hairpin_end: true },
    ]);
    expect(levels.attack).toEqual([p, (p + mf) / 2, mf, (p + mf) / 2, p]);
  });

  it('is carried by a note held across it', () => {
    // A whole note under a crescendo: nothing is struck on the way, and the
    // level is still meant to rise.
    const levels = levelsAlong(
      [{ dynamics: 'p', hairpin: 'crescendo' }, { dynamics: 'f', hairpin_end: true }],
      [0, 4],
      5,
    );
    expect(levels.before(0)).toBe(mf);
    expect(levels.before(2)).toBeCloseTo((p + f) / 2);
    expect(levels.before(4)).toBe(f);
  });

  it('changes nothing when there is none', () => {
    const plain = along([{ dynamics: 'p' }, {}, { dynamics: 'fp' }, {}, { dynamics: 'sf' }]);
    let standing = UNMARKED_VELOCITY;
    const expected = ['p', null, 'fp', null, 'sf'].map((marking) => {
      const next = applyDynamic(marking as Parameters<typeof applyDynamic>[0], standing);
      standing = next.standing;
      return next.note;
    });
    expect(plain.attack).toEqual(expected);
  });

  it('has nowhere to go past the loudest level', () => {
    const levels = along([{ dynamics: 'fff', hairpin: 'crescendo' }, {}, {}]);
    expect(levels.attack).toEqual([fff, fff, fff]);
  });
});
