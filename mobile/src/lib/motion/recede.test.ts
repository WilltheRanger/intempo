import { describe, expect, it } from 'vitest';

import { RECEDE_DROP, RECEDE_INSET, RECEDE_MIN_SHARE, recedeGeometry, recedesBehind } from './recede';

describe('the screen behind a tall sheet', () => {
  it('narrows by 13 points each side', () => {
    const { scale } = recedeGeometry({ width: 390, height: 844 }, 0);
    expect(390 * scale).toBeCloseTo(390 - RECEDE_INSET * 2);
  });

  it('puts its top edge 14 points under the inset', () => {
    for (const insetTop of [0, 47, 59]) {
      const { scale, translateY } = recedeGeometry({ width: 390, height: 844 }, insetTop);
      // Scaled about the centre, then moved: where the top edge lands.
      const top = ((1 - scale) * 844) / 2 + translateY;
      expect(top).toBeCloseTo(insetTop + RECEDE_DROP);
    }
  });

  it('does not invert on a window narrower than its margins', () => {
    expect(recedeGeometry({ width: 20, height: 400 }, 0).scale).toBe(1);
  });
});

describe('which sheets push it back', () => {
  it('is the tall ones only', () => {
    expect(recedesBehind(844 * RECEDE_MIN_SHARE, 844)).toBe(true);
    expect(recedesBehind(300, 844)).toBe(false);
  });

  it('is none before the window is known', () => {
    expect(recedesBehind(500, 0)).toBe(false);
  });
});
