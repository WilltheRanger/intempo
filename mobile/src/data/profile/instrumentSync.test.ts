import { describe, expect, it } from 'vitest';

import { instrumentToSend } from './instrumentSync';

/**
 * Profile's instrument reaches the account, even when it was changed offline.
 *
 * It used to change only this device: the account kept the onboarding answer,
 * so a reinstall or a second phone started a cellist on violin warmups and
 * violin analysis.
 */
describe('instrumentToSend', () => {
  it('sends a change the account has not heard about', () => {
    expect(instrumentToSend('cello', true, 'violin')).toBe('cello');
  });

  it('sends nothing when nothing is owed', () => {
    expect(instrumentToSend('cello', false, 'violin')).toBeNull();
  });

  it('sends nothing when the account already agrees', () => {
    // Another device, or a write whose reply was lost, got there first.
    expect(instrumentToSend('cello', true, 'cello')).toBeNull();
  });

  it('waits for the account to load before deciding', () => {
    expect(instrumentToSend('cello', true, undefined)).toBeNull();
  });

  it('sends to an account that has no instrument yet', () => {
    expect(instrumentToSend('alto_sax', true, null)).toBe('alto_sax');
  });
});
