import { describe, expect, it } from 'vitest';

import {
  DOT_DELAY_MS,
  DRAW_MS,
  MARK,
  PULSE_MS,
  RESTING,
  WAKING_AFTER_MS,
  markFrame,
  markLength,
  markPath,
  openingLine,
} from './mark';

describe('the mark', () => {
  it('draws its curve as one path from the shared geometry', () => {
    const path = markPath();

    expect(path.startsWith(`M ${MARK.curve.start[0]} ${MARK.curve.start[1]} C`)).toBe(true);
    expect(path.match(/C /g)).toHaveLength(MARK.curve.segments.length);
  });

  it('ends where the dot is', () => {
    const last = MARK.curve.segments[MARK.curve.segments.length - 1];

    expect([last[4], last[5]]).toEqual([MARK.dot.x, MARK.dot.y]);
  });

  it('settles: each swing smaller than the last, the last on the centre line', () => {
    const peaks = MARK.curve.segments.map((s) => Math.abs(s[5] - MARK.centre.y));

    for (let i = 1; i < peaks.length; i += 1) expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    expect(peaks[peaks.length - 1]).toBe(0);
  });

  it('measures its length, longer than a straight line and settling on a figure', () => {
    const straight = Math.hypot(
      MARK.dot.x - MARK.curve.start[0],
      MARK.dot.y - MARK.curve.start[1],
    );

    expect(markLength()).toBeGreaterThan(straight);
    expect(markLength(256)).toBeCloseTo(markLength(64), 0);
  });
});

describe('openingLine', () => {
  it('says nothing while the open is quick', () => {
    expect(openingLine(0)).toBeNull();
    expect(openingLine(WAKING_AFTER_MS - 1)).toBeNull();
  });

  it('says it is waking up once it is slow', () => {
    expect(openingLine(WAKING_AFTER_MS)).toBe('Waking up…');
  });
});

describe('markFrame', () => {
  it('starts with nothing drawn and no dot', () => {
    expect(markFrame(0)).toMatchObject({ drawn: 0, band: 0, dotScale: 0, dotOpacity: 0 });
  });

  it('has the line drawn by the end of its draw, and the dot not yet', () => {
    const frame = markFrame(DRAW_MS);

    expect(frame.drawn).toBe(1);
    expect(frame.band).toBe(1);
    expect(DOT_DELAY_MS).toBeLessThan(DRAW_MS);
  });

  it('lands the dot, whole, and then beats in size, never dimming', () => {
    const settled = DOT_DELAY_MS + 260;
    expect(markFrame(settled)).toMatchObject({ drawn: 1, dotScale: 1, dotOpacity: 1 });

    const half = markFrame(settled + PULSE_MS / 2);
    expect(half.dotScale).toBeCloseTo(1.16, 5);
    expect(half.dotOpacity).toBe(1);
    expect(markFrame(settled + PULSE_MS).dotScale).toBeCloseTo(1, 5);
  });

  it('rests whole for reduced motion', () => {
    expect(RESTING).toEqual({ drawn: 1, band: 1, dotScale: 1, dotOpacity: 1 });
  });
});
