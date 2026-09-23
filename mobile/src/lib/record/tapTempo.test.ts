import { describe, expect, it } from 'vitest';

import {
  clampTempo,
  fractionOf,
  quickPicks,
  recordTap,
  tapLabel,
  tappedBpm,
  tempoAtFraction,
  tempoBounds,
} from './tapTempo';

const BOUNDS = { min: 40, max: 160 };

describe('tempoBounds', () => {
  it('is 40 to 160, as the redesign draws it', () => {
    expect(tempoBounds(92, 76)).toEqual({ min: 40, max: 160 });
  });

  it('widens to reach a tempo the piece actually has, to a round ten', () => {
    expect(tempoBounds(176)).toEqual({ min: 40, max: 180 });
    expect(tempoBounds(33)).toEqual({ min: 30, max: 160 });
  });

  it('ignores a missing value', () => {
    expect(tempoBounds(null, undefined, Number.NaN)).toEqual({ min: 40, max: 160 });
  });
});

describe('the bar', () => {
  it('maps its ends and middle to tempos, and back', () => {
    expect(tempoAtFraction(0, BOUNDS)).toBe(40);
    expect(tempoAtFraction(1, BOUNDS)).toBe(160);
    expect(tempoAtFraction(0.5, BOUNDS)).toBe(100);
    expect(fractionOf(100, BOUNDS)).toBeCloseTo(0.5);
  });

  it('clamps a drag past either end', () => {
    expect(tempoAtFraction(-0.3, BOUNDS)).toBe(40);
    expect(tempoAtFraction(1.4, BOUNDS)).toBe(160);
    expect(clampTempo(212, BOUNDS)).toBe(160);
  });
});

describe('tap tempo', () => {
  it('needs two taps before it names a tempo', () => {
    expect(tappedBpm([1000], BOUNDS)).toBeNull();
    expect(tappedBpm([1000, 1500], BOUNDS)).toBe(120);
  });

  it('averages the intervals, not the last one', () => {
    // 500, 600, 700 → 600ms → 100 BPM.
    expect(tappedBpm([0, 500, 1100, 1800], BOUNDS)).toBe(100);
  });

  it('keeps only the last six taps', () => {
    let taps: number[] = [];
    for (let t = 0; t <= 9 * 500; t += 500) {
      taps = recordTap(taps, t);
    }
    expect(taps).toHaveLength(6);
    expect(taps[0]).toBe(2000);
  });

  it('starts a new count after two seconds without a tap', () => {
    const taps = recordTap([0, 500, 1000], 3100);
    expect(taps).toEqual([3100]);
  });

  it('carries on within two seconds', () => {
    expect(recordTap([0, 500], 2400)).toEqual([0, 500, 2400]);
  });

  it('clamps a tapped tempo to the bar', () => {
    expect(tappedBpm([0, 200], BOUNDS)).toBe(160);
  });

  it('says what to do next', () => {
    expect(tapLabel(0)).toBe('Tap tempo');
    expect(tapLabel(1)).toBe('Keep tapping');
    expect(tapLabel(4)).toBe('Tapping');
  });
});

describe('quickPicks', () => {
  it('offers half, three quarters and the marking', () => {
    expect(quickPicks(92, BOUNDS)).toEqual([
      { key: 'half', label: 'Half · 46', bpm: 46 },
      { key: 'threeQuarters', label: '¾ · 69', bpm: 69 },
      { key: 'marked', label: 'Marked · 92', bpm: 92 },
    ]);
  });

  it('offers nothing when the page marks no tempo', () => {
    expect(quickPicks(null, BOUNDS)).toEqual([]);
  });

  it('keeps each pick on the bar', () => {
    expect(quickPicks(60, BOUNDS)[0].bpm).toBe(40);
  });
});
