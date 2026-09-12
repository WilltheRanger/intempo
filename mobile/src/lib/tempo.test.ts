import { describe, expect, it } from 'vitest';

import type { Tolerance } from '../data/types';
import {
  displayTempoBpm,
  formatTempo,
  formatWorkingTempo,
  fullScaleFor,
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

describe('fullScaleFor', () => {
  it('takes the threshold for the side the deviation fell on', () => {
    // Rush-positive, the convention everything downstream of `toTake` uses.
    expect(fullScaleFor(TUNED, 5)).toBe(14);
    expect(fullScaleFor(TUNED, -5)).toBe(18);
  });

  it('puts a note on the beat on the rushing side rather than nowhere', () => {
    // Zero has no side. It also has no deflection, so which scale it picks
    // cannot change a pixel — this only pins the behaviour so a later reader
    // does not have to wonder whether the boundary was thought about.
    expect(fullScaleFor(TUNED, 0)).toBe(14);
  });

  it('falls back to the shipped default when a take carries no thresholds', () => {
    // Takes analysed before the pipeline recorded them. 20 is what those were
    // actually judged by, so the fallback is right for exactly those rows.
    expect(fullScaleFor(null, 5)).toBe(20);
    expect(fullScaleFor(null, -5)).toBe(20);
  });

  it('pins at full deflection exactly at the outer threshold', () => {
    // Beyond the outer threshold the pipeline calls a take severe, so a pinned
    // bar has to mean that and nothing else.
    expect(Math.min(1, 14 / fullScaleFor(TUNED, 14))).toBe(1);
    expect(Math.min(1, 13 / fullScaleFor(TUNED, 13))).toBeLessThan(1);
  });
});

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

  it('falls back to the same default as the bar', () => {
    // The two must not disagree: the same take is drawn by both, and a trend
    // line scaled differently from the bars beneath it would invent a
    // discrepancy in a take the pipeline judged consistently.
    expect(sharedFullScaleFor(null)).toBe(fullScaleFor(null, 1));
  });
});

describe('symmetric thresholds', () => {
  it('draw exactly as the hard-coded scale did', () => {
    // The shipped defaults are symmetric, so nothing on screen moves today.
    // This change is about what happens the first time they are tuned.
    const shipped: Tolerance = {
      rushing_inner_pct: 5,
      rushing_mid_pct: 10,
      rushing_outer_pct: 20,
      dragging_inner_pct: 5,
      dragging_mid_pct: 10,
      dragging_outer_pct: 20,
    };
    expect(fullScaleFor(shipped, 7)).toBe(20);
    expect(fullScaleFor(shipped, -7)).toBe(20);
    expect(sharedFullScaleFor(shipped)).toBe(20);
  });
});

describe('printed tempo units', () => {
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

  it('keeps old scores on the quarter-note display they already used', () => {
    expect(formatTempo(80, null)).toBe('80 BPM');
    expect(formatWorkingTempo(76, 92)).toBe('Working at 76  ·  marked 92 BPM');
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
