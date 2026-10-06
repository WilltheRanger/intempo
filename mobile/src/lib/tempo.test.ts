import { describe, expect, it } from 'vitest';

import type { MeasureVerdict, Tolerance } from '../data/types';
import {
  displayTempoBpm,
  formatTakeVerdict,
  formatTempo,
  quarterBpmFromDisplay,
  sharedFullScaleFor,
  tempoDisplayRange,
} from './tempo';

/**
 * The charts used to hold their own copy of `20`, with a comment admitting it
 * was a copy. These thresholds are the one number in the pipeline the project
 * expects to *change* — tuning them against real recordings is what
 * `TUNING_LOG.md` is for — so a client copy was guaranteed to go stale, and
 * would have gone stale silently: the bar would still draw, just against a
 * scale the verdict beside it no longer agreed with.
 */

/** Asymmetric on purpose: dragging sits wider, as the tuning appendix says. */
const TUNED: Tolerance = {
  rushing_inner_pct: 3,
  rushing_mid_pct: 7,
  rushing_outer_pct: 14,
  dragging_inner_pct: 4,
  dragging_mid_pct: 9,
  dragging_outer_pct: 18,
};

describe('sharedFullScaleFor', () => {
  it('uses one scale for both sides, the wider of the two', () => {
    // A line crossing zero has to stay straight. Scaling the halves
    // independently would bend a steady drift at the origin, which reads as a
    // change in the playing rather than in the axis.
    expect(sharedFullScaleFor(TUNED)).toBe(18);
  });

  it('never clips a value the per-side scale would have shown', () => {
    const worst = Math.max(TUNED.rushing_outer_pct, TUNED.dragging_outer_pct);
    expect(sharedFullScaleFor(TUNED)).toBeGreaterThanOrEqual(worst);
  });

  it('falls back to the default outer band when nothing was tuned', () => {
    expect(sharedFullScaleFor(null)).toBe(20);
  });

  it('draws the shipped, symmetric thresholds as the hard-coded scale did', () => {
    // The shipped defaults are symmetric, so nothing on screen moves today.
    const shipped = {
      rushing_inner_pct: 5,
      rushing_mid_pct: 10,
      rushing_outer_pct: 20,
      dragging_inner_pct: 5,
      dragging_mid_pct: 10,
      dragging_outer_pct: 20,
    };
    expect(sharedFullScaleFor(shipped)).toBe(20);
  });
});

describe('printed tempo units', () => {
  it('keeps old scores on the quarter-note display they already used', () => {
    expect(formatTempo(80, null)).toBe('80 BPM');
  });

  it('shows a dotted-quarter mark without changing the quarter-note clock', () => {
    expect(displayTempoBpm(90, 'dotted_quarter')).toBe(60);
    expect(quarterBpmFromDisplay(60, 'dotted_quarter')).toBe(90);
    expect(formatTempo(90, 'dotted_quarter')).toBe('60 dotted-quarter-note BPM');
  });

  it('converts eighth- and half-note marks in both directions', () => {
    expect(displayTempoBpm(60, 'eighth')).toBe(120);
    expect(quarterBpmFromDisplay(120, 'eighth')).toBe(60);
    expect(displayTempoBpm(120, 'half')).toBe(60);
    expect(quarterBpmFromDisplay(60, 'half')).toBe(120);
  });

  it('derives safe displayed bounds from the quarter-BPM contract', () => {
    expect(tempoDisplayRange('dotted_quarter')).toEqual({ min: 14, max: 200 });
    expect(tempoDisplayRange('eighth')).toEqual({ min: 40, max: 600 });
  });

  it('never lets a stepper at its limit store a tempo outside the real one', () => {
    // **What the conversion is for.** `PlaybackSettings` steps in the page's
    // printed unit and stores quarters, so a stepper handed the raw 20–300
    // would let a dotted-quarter tempo reach 300, which is **450** on the clock
    // the score and the analysis run on. Both ends, every unit the pipeline
    // can report.
    const units = [
      'whole', 'dotted_half', 'half', 'dotted_quarter', 'quarter',
      'dotted_eighth', 'eighth', 'sixteenth',
    ] as const;

    for (const unit of units) {
      const { min, max } = tempoDisplayRange(unit, 20, 300);
      expect(quarterBpmFromDisplay(max, unit), `${unit} max`).toBeLessThanOrEqual(300);
      expect(quarterBpmFromDisplay(min, unit), `${unit} min`).toBeGreaterThanOrEqual(20);
      expect(min, `${unit} range`).toBeLessThan(max);
    }
  });
});

describe('the title over one take', () => {
  function bar(measure: number, band: MeasureVerdict['band']): MeasureVerdict {
    return {
      measure,
      playedBpm: null,
      pitchCents: null,
      targetBpm: null,
      noteCount: 4,
      deviationPct: band === 'on' ? 0 : 40,
      band,
      direction: band === 'on' ? 'on' : 'drag',
      verdict: band === 'on' ? 'on_tempo' : 'dragging',
      underTempoChange: false,
      uneven: false,
      timedNoteCount: 4,
      untimedReason: null,
    };
  }

  // Came in slow, then kept time: every bar after the entrance sits late
  // against the grid, and the band says so.
  const settled = [bar(1, 'severe'), bar(2, 'severe'), bar(3, 'severe'), bar(4, 'severe')];

  it('reads the bars when the sentence under it named a stretch', () => {
    expect(formatTakeVerdict(settled, 'drag')).toBe('You dragged throughout');
    expect(formatTakeVerdict(settled)).toBe('You dragged throughout');
  });

  it('agrees with the sentence when it found nothing to name', () => {
    expect(formatTakeVerdict(settled, 'on')).toBe('You held the tempo');
  });

  // The owner circled "You rushed in the / middle" on a phone (2026-09-29): a
  // title that breaks leaves one word under it. 25 characters is what fits the
  // 342 points of a 390pt phone at the result title's 31pt.
  it('fits one line, wherever the take went wrong and whichever way', () => {
    const titles = new Set<string>();
    for (const direction of ['rush', 'drag'] as const) {
      for (const bad of [[1], [2, 3], [5], [1, 2, 3, 4, 5]]) {
        const measures = [1, 2, 3, 4, 5].map((n) => {
          const m = bar(n, bad.includes(n) ? 'severe' : 'on');
          return bad.includes(n) ? { ...m, direction } : m;
        });
        titles.add(formatTakeVerdict(measures, direction));
      }
    }
    titles.add(formatTakeVerdict(settled, 'on'));
    expect(titles.size).toBeGreaterThanOrEqual(8);
    for (const title of titles) expect(title.length, title).toBeLessThanOrEqual(25);
  });
});
