import { describe, expect, it } from 'vitest';

import { beatAt, beatsPerBar, secondsPerBeat } from './beats';

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
    ['2/2', 4],
    ['3/2', 6],
    ['6/8', 3],
    ['12/8', 6],
    ['5/4', 5],
  ])('reads %s as %s quarter beats', (signature, expected) => {
    expect(beatsPerBar(signature)).toBe(expected);
  });

  it.each([
    ['unknown', 'what OCR returns for an illegible header'],
    ['', 'nothing read at all'],
    ['4/0', 'a denominator that would divide by zero'],
    ['0/4', 'a bar of no beats'],
    ['9/8', 'four and a half quarters — "one" would land halfway through a click'],
    ['7/8', 'three and a half, the same problem'],
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

/**
 * **A finding, written down rather than changed.**
 *
 * 6/8 comes to three quarters, so the accent lands every three quarters — and
 * the downbeat is right. The other two clicks are not: 6/8 is six eighths felt
 * in two groups of three, so the beats are at eighths 0 and 3, while quarters
 * fall at 0, 2 and 4. Two of every three clicks sit off the felt beat, which is
 * exactly the metronome "that quietly fights the player" from the docstring.
 *
 * It is left alone on purpose. "A beat is a quarter note, everywhere in this
 * app" is load-bearing: `scheduleScore` scales by `quarter: 1` and
 * `alignment.build_timeline` does the same server-side, so what a bpm *means*
 * is one decision shared across both trees and the analysis. Changing the
 * metronome alone would make the clicks and the reference playback disagree
 * about the number on screen — a worse fault than the one being fixed — and
 * changing all three is a `DECISIONS.md` call about compound metre, not a
 * quiet edit.
 *
 * Pinned so the behaviour is deliberate rather than merely current.
 */
describe('compound metre', () => {
  it('accents the downbeat of a 6/8 bar and clicks quarters between', () => {
    const perBar = beatsPerBar('6/8');
    expect(perBar).toBe(3);

    const bar = [0, 1, 2, 3, 4, 5].map((i) => beatAt(i, perBar));

    expect(bar.map((b) => b.downbeat)).toEqual([true, false, false, true, false, false]);
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
