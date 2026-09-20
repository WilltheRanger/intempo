import { describe, expect, it } from 'vitest';

import { playheadAt } from './playhead';

/** 120 bpm in 4/4: one beat is 500ms, one bar is 2000ms. */
const base = { bpm: 120, beatsPerBar: 4, startFrom: 1, lastBar: 32 };

describe('playheadAt', () => {
  it('sits at the top of the first bar the instant a take starts', () => {
    expect(playheadAt({ ...base, elapsedMs: 0 })).toEqual({
      measureNumber: 1,
      through: 0,
    });
  });

  it('moves through a bar rather than jumping between them', () => {
    // The whole argument for a mark that slides: at one beat in, it is a
    // quarter of the way across bar one, not still pinned to the barline.
    expect(playheadAt({ ...base, elapsedMs: 500 })?.through).toBeCloseTo(0.25);
    expect(playheadAt({ ...base, elapsedMs: 1000 })?.through).toBeCloseTo(0.5);
    expect(playheadAt({ ...base, elapsedMs: 1999 })?.through).toBeCloseTo(0.9995);
  });

  it('crosses the barline exactly on the downbeat', () => {
    expect(playheadAt({ ...base, elapsedMs: 2000 })).toEqual({
      measureNumber: 2,
      through: 0,
    });
  });

  /**
   * A take started from bar 9 is the case the app already supports through
   * "Start at", and a mark that ignored it would point a musician at the wrong
   * line of the page for the whole take.
   */
  it('counts from the bar the take actually started on', () => {
    expect(playheadAt({ ...base, startFrom: 9, elapsedMs: 0 })?.measureNumber).toBe(9);
    expect(playheadAt({ ...base, startFrom: 9, elapsedMs: 4000 })?.measureNumber).toBe(11);
  });

  it('follows the tempo, not the wall clock', () => {
    // Half the tempo, half the distance in the same time.
    expect(playheadAt({ ...base, bpm: 60, elapsedMs: 2000 })).toEqual({
      measureNumber: 1,
      through: 0.5,
    });
  });

  it('follows the metre', () => {
    // 3/4 at 120: a bar is three beats, 1500ms.
    expect(playheadAt({ ...base, beatsPerBar: 3, elapsedMs: 1500 })).toEqual({
      measureNumber: 2,
      through: 0,
    });
  });

  /**
   * **Not a defensive branch.** A musician who repeats a section, or who
   * simply keeps playing, passes the final barline while the take is still
   * recording. There is nothing left on the page to point at, so nothing is
   * drawn — which is different from pointing at the last bar forever, and the
   * difference is whether the mark lies.
   */
  it('stops at the end of the piece rather than running off it', () => {
    expect(playheadAt({ ...base, lastBar: 2, elapsedMs: 3999 })?.measureNumber).toBe(2);
    expect(playheadAt({ ...base, lastBar: 2, elapsedMs: 4000 })).toBeNull();
  });

  it('draws nothing when the tempo or metre cannot be believed', () => {
    expect(playheadAt({ ...base, bpm: 0, elapsedMs: 1000 })).toBeNull();
    expect(playheadAt({ ...base, bpm: -60, elapsedMs: 1000 })).toBeNull();
    expect(playheadAt({ ...base, beatsPerBar: 0, elapsedMs: 1000 })).toBeNull();
  });

  it('draws nothing for a negative or unusable elapsed time', () => {
    // A count-in is excluded by the caller, and while it runs the elapsed time
    // it passes is negative. Nothing should be on the page yet.
    expect(playheadAt({ ...base, elapsedMs: -1200 })).toBeNull();
    expect(playheadAt({ ...base, elapsedMs: NaN })).toBeNull();
    expect(playheadAt({ ...base, bpm: Infinity, elapsedMs: 10 })).toBeNull();
  });
});
