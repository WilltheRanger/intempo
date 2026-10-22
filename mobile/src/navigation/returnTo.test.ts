import { describe, expect, it } from 'vitest';

import { howToReach } from './returnTo';

describe('howToReach', () => {
  it('goes back to a screen that is already under this one', () => {
    // Review → Retake, with the viewfinder still mounted below.
    expect(howToReach([{ name: 'Tabs' }, { name: 'Scanner' }, { name: 'CapturedPages' }], 'Scanner')).toBe('pop');
  });

  it('opens a screen that is not in the stack', () => {
    // The first "Done" in the scanner, and pages that arrived through Import,
    // which have no scanner below them.
    expect(howToReach([{ name: 'Tabs' }, { name: 'Scanner' }], 'CapturedPages')).toBe('push');
    expect(howToReach([{ name: 'Tabs' }, { name: 'CapturedPages' }], 'Scanner')).toBe('push');
  });

  it('opens it when there is no stack to look in', () => {
    expect(howToReach(undefined, 'Scanner')).toBe('push');
  });
});
