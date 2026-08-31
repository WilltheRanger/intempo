import { describe, expect, it } from 'vitest';

import { beatAt, beatsPerBar, metronomePulse, secondsPerBeat } from './beats';

/**
 * Where the bar lines fall, which had no test either.
 *
 * Its own docstring says why that matters: *"getting this wrong is silent — an
 * accent on the wrong beat still sounds like a metronome, just one that
 * quietly fights the player."*
 */

describe('beatsPerBar', () => {
  it.each([
    ['4/4', 4],
    ['3/4', 3],
    ['2/4', 2],
    ['2/2', 2],
    ['3/2', 3],
    ['6/8', 2],
    ['9/8', 3],
    ['12/8', 4],
    ['7/8', 7],
    ['5/4', 5],
  ])('reads %s as %s felt pulses', (signature, expected) => {
    expect(beatsPerBar(signature)).toBe(expected);
  });

  it.each([
    ['unknown', 'what OCR returns for an illegible header'],
    ['', 'nothing read at all'],
    ['4/0', 'a denominator that would divide by zero'],
    ['0/4', 'a bar of no beats'],
    ['4-4', 'not a time signature'],
  ])('gives no accent for %s (%s)', (signature) => {
    expect(beatsPerBar(signature)).toBeNull();
  });

  it.each([[null], [undefined]])('gives no accent for %s', (signature) => {
    expect(beatsPerBar(signature)).toBeNull();
  });

  it('tolerates the spacing a header might be read with', () => {
    expect(beatsPerBar(' 3 / 4 ')).toBe(3);
  });
});

describe('musical pulse', () => {
  it.each([
    ['4/4', { quarterBeats: 1, pulsesPerBar: 4, unitLabel: 'quarter' }],
    ['2/2', { quarterBeats: 2, pulsesPerBar: 2, unitLabel: 'half' }],
    ['6/8', { quarterBeats: 1.5, pulsesPerBar: 2, unitLabel: 'dotted quarter' }],
    ['9/8', { quarterBeats: 1.5, pulsesPerBar: 3, unitLabel: 'dotted quarter' }],
    ['7/8', { quarterBeats: 0.5, pulsesPerBar: 7, unitLabel: 'eighth' }],
  ])('translates %s without changing the quarter-note clock', (signature, expected) => {
    expect(metronomePulse(signature)).toEqual(expected);
  });

  it('counts 6/8 in two and accents each new bar', () => {
    const perBar = beatsPerBar('6/8');
    expect(perBar).toBe(2);

    const pulses = [0, 1, 2, 3, 4, 5].map((i) => beatAt(i, perBar));
    expect(pulses.map((beat) => beat.downbeat)).toEqual([
      true, false, true, false, true, false,
    ]);
  });
});
describe('secondsPerBeat', () => {
  it('is a minute divided by the tempo', () => {
    expect(secondsPerBeat(60)).toBe(1);
    expect(secondsPerBeat(120)).toBe(0.5);
  });

  it.each([[0], [-40], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'survives a tempo of %s',
    (bpm) => {
      // `Math.max(1, bpm)` covered zero and negatives and not `NaN`, which it
      // propagates. `periodMs` then becomes NaN, `next * periodMs <= elapsed`
      // is false forever so no beat ever fires, and the poll interval is NaN
      // too — which `setInterval` reads as zero. A dead metronome spinning a
      // timer as fast as the thread allows.
      //
      // Not reachable from the app: `practiceTempo.clampBpm` refuses NaN
      // before it gets here. This pins the guard to what its comment claims,
      // because the next caller of `startBeatClock` inherits that boundary
      // check only by accident.
      const seconds = secondsPerBeat(bpm);
      expect(Number.isFinite(seconds)).toBe(true);
      expect(seconds).toBeGreaterThan(0);
    },
  );
});

describe('beatAt', () => {
  it('counts around the bar', () => {
    expect([0, 1, 2, 3, 4].map((i) => beatAt(i, 4).beatInBar)).toEqual([0, 1, 2, 3, 0]);
  });

  it('places nothing when there is no bar to place it in', () => {
    const beat = beatAt(7, null);

    expect(beat).toEqual({ index: 7, beatInBar: null, downbeat: false });
  });
});
