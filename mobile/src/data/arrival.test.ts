import { describe, expect, it } from 'vitest';

import { nextArrival } from './arrival';

describe('nextArrival', () => {
  it('walks welcome, then the first piece, then nothing', () => {
    const welcome = nextArrival('none', 'onboarded');
    expect(welcome).toBe('welcome');
    const adding = nextArrival(welcome, 'started');
    expect(adding).toBe('firstPiece');
    expect(nextArrival(adding, 'settled')).toBe('none');
  });

  /**
   * The answers are saved from two places. A second save landing after the
   * Library has been reached must not stand the welcome back up in front of it.
   */
  it('ignores a second onboarding once the welcome has begun', () => {
    expect(nextArrival('welcome', 'onboarded')).toBe('welcome');
    expect(nextArrival('firstPiece', 'onboarded')).toBe('firstPiece');
  });

  it('does not open the add sheet for somebody who never saw the welcome', () => {
    expect(nextArrival('none', 'started')).toBe('none');
  });

  it('settles from anywhere, which is what signing out needs', () => {
    expect(nextArrival('welcome', 'settled')).toBe('none');
    expect(nextArrival('none', 'settled')).toBe('none');
  });
});
