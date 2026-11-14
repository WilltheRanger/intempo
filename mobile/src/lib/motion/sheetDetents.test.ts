import { describe, expect, it } from 'vitest';

import {
  DETENT_TRAVEL_FRACTION,
  DETENT_VELOCITY,
  detentDragOffset,
  mediumOffset,
  settleDetent,
} from './sheetDetents';
import { UPWARD_RESISTANCE } from './sheetDrag';

// A full-height sheet on a 390×844 phone: 844 less the inset and the strip.
const height = 800;
const offset = mediumOffset(height, 844);

describe('the medium height', () => {
  it('shows half the window', () => {
    expect(offset).toBe(800 - 422);
  });

  it('is no height at all when half the window shows the whole sheet', () => {
    expect(mediumOffset(300, 844)).toBe(0);
  });
});

describe('dragging a long sheet', () => {
  it('travels freely from medium up to large', () => {
    expect(detentDragOffset(-200, 'medium', offset)).toBe(-200);
    expect(detentDragOffset(-offset, 'medium', offset)).toBe(-offset);
  });

  it('resists past the large height', () => {
    expect(detentDragOffset(-offset - 100, 'medium', offset)).toBeCloseTo(
      -offset - 100 * UPWARD_RESISTANCE,
    );
    expect(detentDragOffset(-100, 'large', offset)).toBeCloseTo(-100 * UPWARD_RESISTANCE);
  });

  it('goes down freely from either', () => {
    expect(detentDragOffset(120, 'medium', offset)).toBe(120);
    expect(detentDragOffset(120, 'large', offset)).toBe(120);
  });
});

describe('letting go at medium', () => {
  it('rises to large past the threshold, or on a flick up', () => {
    const between = offset * DETENT_TRAVEL_FRACTION;
    expect(settleDetent({ at: 'medium', dy: -between, vy: 0, offset, height })).toBe('large');
    expect(settleDetent({ at: 'medium', dy: -20, vy: -DETENT_VELOCITY, offset, height })).toBe(
      'large',
    );
    expect(settleDetent({ at: 'medium', dy: -20, vy: -0.1, offset, height })).toBe('medium');
  });

  it('closes on a drag down measured against what is showing', () => {
    expect(settleDetent({ at: 'medium', dy: 200, vy: 0, offset, height })).toBe('dismiss');
    expect(settleDetent({ at: 'medium', dy: 30, vy: 0.1, offset, height })).toBe('medium');
  });
});

describe('letting go at large', () => {
  it('stays when pushed up', () => {
    expect(settleDetent({ at: 'large', dy: -40, vy: -1, offset, height })).toBe('large');
  });

  it('comes down to medium past the threshold, or on a flick down', () => {
    expect(settleDetent({ at: 'large', dy: 200, vy: 0, offset, height })).toBe('medium');
    expect(settleDetent({ at: 'large', dy: 20, vy: DETENT_VELOCITY, offset, height })).toBe(
      'medium',
    );
    expect(settleDetent({ at: 'large', dy: 20, vy: 0.1, offset, height })).toBe('large');
  });

  it('closes when dragged past medium and most of the way down', () => {
    expect(settleDetent({ at: 'large', dy: offset + 200, vy: 0, offset, height })).toBe('dismiss');
  });
});
