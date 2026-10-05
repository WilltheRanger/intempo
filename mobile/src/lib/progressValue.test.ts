import { describe, expect, it } from 'vitest';

import { progressValue } from './progressValue';

describe('what a progress bar says it is at', () => {
  it('is a whole percentage', () => {
    expect(progressValue(0.3)).toEqual({
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': 30,
    });
    expect(progressValue(1 / 3)['aria-valuenow']).toBe(33);
  });

  it('stays between empty and full when the count overshoots', () => {
    // A transfer can report more bytes sent than it announced.
    expect(progressValue(1.2)['aria-valuenow']).toBe(100);
    expect(progressValue(-0.1)['aria-valuenow']).toBe(0);
  });

  it('says nothing when there is nothing to measure yet', () => {
    expect(progressValue(null)).toEqual({});
    expect(progressValue(Number.NaN)).toEqual({});
  });
});
