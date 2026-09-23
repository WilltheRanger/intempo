import { describe, expect, it } from 'vitest';

import { centringLift } from './centring';

describe('centringLift', () => {
  it('centres on the whole screen when there is room', () => {
    // 844pt phone: 700 above a 144 footer, a 468 block.
    const lift = centringLift(700, 468, 144);
    expect(lift).toBe(144);
    const top = lift + (700 - lift - 468) / 2;
    expect(top + 468 / 2).toBe(844 / 2);
  });

  it('gives up only as much as keeps the block clear of the footer', () => {
    const lift = centringLift(520, 468, 144);
    expect(lift).toBe(52);
    expect(lift + 468).toBeLessThanOrEqual(520);
  });

  it('does not push a block that already fills the space', () => {
    expect(centringLift(400, 468, 144)).toBe(0);
  });

  it('does nothing before anything is measured', () => {
    expect(centringLift(0, 0, 0)).toBe(0);
  });
});
