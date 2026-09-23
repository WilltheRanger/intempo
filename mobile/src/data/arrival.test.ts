import { describe, expect, it } from 'vitest';

import { nextArrival } from './arrival';

describe('nextArrival', () => {
  it('walks welcome, then the rise-in, then nothing', () => {
    const welcome = nextArrival('none', 'onboarded');
    expect(welcome).toBe('welcome');
    const rising = nextArrival(welcome, 'started');
    expect(rising).toBe('riseIn');
    expect(nextArrival(rising, 'settled')).toBe('none');
  });

  /**
   * The answers are saved from two places. A second save landing after Today
   * has been reached must not stand the welcome back up in front of it.
   */
  it('ignores a second onboarding once the welcome has begun', () => {
    expect(nextArrival('welcome', 'onboarded')).toBe('welcome');
    expect(nextArrival('riseIn', 'onboarded')).toBe('riseIn');
  });

  it('does not fade Today in for somebody who never saw the welcome', () => {
    expect(nextArrival('none', 'started')).toBe('none');
  });

  it('settles from anywhere, which is what signing out needs', () => {
    expect(nextArrival('welcome', 'settled')).toBe('none');
    expect(nextArrival('none', 'settled')).toBe('none');
  });
});
