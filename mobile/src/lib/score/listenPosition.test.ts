import { describe, expect, it } from 'vitest';

import { barAfter, barAt, barStarts, clockLabel, startOfBar } from './listenPosition';
import type { Schedule } from './schedule';

function note(measureNumber: number, startS: number) {
  return { startS, durationS: 0.4, frequency: 440, measureNumber, globalIndex: 0 };
}

const SCHEDULE: Schedule = {
  bpm: 60,
  durationS: 12,
  notes: [
    note(1, 0),
    note(1, 1),
    note(2, 4),
    note(3, 8),
    // A repeat back to bar 2: the player starts a repeated bar at its first
    // time through, so this occurrence is not a start.
    note(2, 10),
  ],
};

describe('barStarts', () => {
  it('lists each bar once, at its first note, in playing order', () => {
    expect(barStarts(SCHEDULE)).toEqual([
      { measure: 1, startS: 0 },
      { measure: 2, startS: 4 },
      { measure: 3, startS: 8 },
    ]);
  });
});

describe('barAt', () => {
  const starts = barStarts(SCHEDULE);

  it('lands on the bar that has started by then', () => {
    expect(barAt(starts, 5.9)?.measure).toBe(2);
    expect(barAt(starts, 8)?.measure).toBe(3);
  });

  it('clamps before the start and past the end', () => {
    expect(barAt(starts, -3)?.measure).toBe(1);
    expect(barAt(starts, 99)?.measure).toBe(3);
  });

  it('answers null for a piece with nothing to play', () => {
    expect(barAt([], 1)).toBeNull();
  });
});

describe('startOfBar', () => {
  it('finds a bar and falls back to the top for one that does not sound', () => {
    const starts = barStarts(SCHEDULE);
    expect(startOfBar(starts, 3)).toBe(8);
    expect(startOfBar(starts, 7)).toBe(0);
  });
});

describe('clockLabel', () => {
  it('reads minutes and zero-padded seconds', () => {
    expect(clockLabel(12)).toBe('0:12');
    expect(clockLabel(108.9)).toBe('1:48');
    expect(clockLabel(725)).toBe('12:05');
  });

  it('never shows a negative or non-finite time', () => {
    expect(clockLabel(-4)).toBe('0:00');
    expect(clockLabel(Number.NaN)).toBe('0:00');
  });
});

describe('barAfter', () => {
  const starts = [
    { measure: 1, startS: 0 },
    { measure: 2, startS: 2 },
    { measure: 3, startS: 4 },
    { measure: 5, startS: 6 },
    { measure: 6, startS: 8 },
  ];

  it('steps one bar at a time, in playing order', () => {
    expect(barAfter(starts, 2, { by: 1 })).toBe(3);
    // Bar 4 does not sound (a rest the schedule skips), so the next is 5.
    expect(barAfter(starts, 3, { by: 1 })).toBe(5);
    expect(barAfter(starts, 3, { by: -1 })).toBe(2);
  });

  it('stops at the first and last bar', () => {
    expect(barAfter(starts, 1, { by: -1 })).toBe(1);
    expect(barAfter(starts, 6, { by: 4 })).toBe(6);
  });

  it('goes to the first and last bar on Home and End', () => {
    expect(barAfter(starts, 3, { to: 'first' })).toBe(1);
    expect(barAfter(starts, 3, { to: 'last' })).toBe(6);
  });

  it('starts from the first bar when the current one does not sound', () => {
    expect(barAfter(starts, 4, { by: 1 })).toBe(1);
  });

  it('has nowhere to go with no bars', () => {
    expect(barAfter([], 1, { by: 1 })).toBeNull();
  });
});
