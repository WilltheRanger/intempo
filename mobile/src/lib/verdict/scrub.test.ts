import { describe, expect, it } from 'vitest';

import { SCRUB_STEP_S, scrubFraction, scrubSeconds, scrubStep } from './scrub';

/**
 * The arithmetic behind a finger on the playback track.
 *
 * Every case is one where the wrong answer reaches the audio player: a seek
 * past the end, a seek to a negative time, or a seek to `NaN` — which is what
 * a division by an unmeasured width produces and what a player receives as an
 * instruction it cannot refuse cleanly.
 */
describe('scrubFraction', () => {
  it('reads a touch as a position along the track', () => {
    expect(scrubFraction(0, 200)).toBe(0);
    expect(scrubFraction(100, 200)).toBe(0.5);
    expect(scrubFraction(200, 200)).toBe(1);
  });

  it('clamps a drag that left the track', () => {
    // Real, and on both platforms: a drag that starts on the rail and carries
    // on past it keeps reporting, with x outside the element.
    expect(scrubFraction(-40, 200)).toBe(0);
    expect(scrubFraction(260, 200)).toBe(1);
  });

  /**
   * **Null, not zero.** Zero is not the absence of a position, it is the start
   * of the recording — so a touch arriving before `onLayout` would have
   * rewound a take that was playing. The first version of this function
   * returned zero here and the test written to describe the guard found that
   * it did not hold.
   */
  it('refuses a track it has not measured', () => {
    expect(scrubFraction(100, 0)).toBeNull();
    expect(scrubFraction(Number.NaN, 200)).toBeNull();
  });
});

describe('scrubSeconds', () => {
  it('turns a position into a time in the recording', () => {
    expect(scrubSeconds(0.5, 60)).toBe(30);
    expect(scrubSeconds(0, 60)).toBe(0);
    expect(scrubSeconds(1, 60)).toBe(60);
  });

  /**
   * Null, not zero. A recording still loading reports a duration of zero, and
   * seeking to zero is a real instruction — it would rewind a take that had
   * already started, on a touch the musician meant as "go to the middle".
   */
  it('refuses a recording it does not know the length of', () => {
    expect(scrubSeconds(0.5, 0)).toBeNull();
    expect(scrubSeconds(0.5, Number.NaN)).toBeNull();
    expect(scrubSeconds(0.5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('carries an unmeasured track through as nothing to do', () => {
    // The two refusals compose, so the component needs one guard rather than
    // one per source of "we do not know".
    expect(scrubSeconds(scrubFraction(60, 0), 30)).toBeNull();
  });
});

describe('scrubStep', () => {
  it('moves by a step in either direction', () => {
    expect(scrubStep(20, 60, 1)).toBe(20 + SCRUB_STEP_S);
    expect(scrubStep(20, 60, -1)).toBe(20 - SCRUB_STEP_S);
  });

  it('stops at both ends rather than walking past them', () => {
    expect(scrubStep(1, 60, -1)).toBe(0);
    expect(scrubStep(59, 60, 1)).toBe(60);
  });

  it('refuses a recording it does not know the length of', () => {
    expect(scrubStep(10, 0, 1)).toBeNull();
  });
});
