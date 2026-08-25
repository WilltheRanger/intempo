import { describe, expect, it } from 'vitest';

import { profileUpdateFor, shouldOnboard } from './onboarding';
import type { Musician } from '../data/types';

const NOTHING = { name: '', instrument: null, avatarKey: null };

function musician(overrides: Partial<Musician>): Musician {
  return {
    id: 'u1',
    email: 'a@example.test',
    tier: 'free',
    role: 'student',
    studioId: null,
    usage: null,
    avatarUrl: null,
    displayName: null,
    instrument: null,
    onboarded: true,
    ...overrides,
  };
}

describe('what finishing onboarding sends', () => {
  it('sends only the fields that were given', () => {
    expect(
      profileUpdateFor(
        { name: 'Ada', instrument: 'double_bass', avatarKey: 'u1/a.jpg' },
        { skipping: false },
      ),
    ).toEqual({
      onboarded: true,
      display_name: 'Ada',
      instrument: 'double_bass',
      avatar_key: 'u1/a.jpg',
    });
  });

  it('omits an unanswered field rather than nulling it', () => {
    // `null` in `UpdateMeInput` means *clear this*. Sending it for a field
    // nobody filled in would erase a name or a picture the account already
    // had — set on the web, or by an earlier pass through this screen.
    const body = profileUpdateFor(NOTHING, { skipping: false });

    expect(body).toEqual({ onboarded: true });
    expect('display_name' in body).toBe(false);
    expect('instrument' in body).toBe(false);
    expect('avatar_key' in body).toBe(false);
  });

  it('trims the name, and treats a name of only spaces as no name', () => {
    expect(profileUpdateFor({ ...NOTHING, name: '  Ada  ' }, { skipping: false }))
      .toEqual({ onboarded: true, display_name: 'Ada' });
    expect(profileUpdateFor({ ...NOTHING, name: '   ' }, { skipping: false }))
      .toEqual({ onboarded: true });
  });

  it('sends nothing but the flag when skipping, whatever was filled in', () => {
    // Skip is not a quiet save. Someone who typed a name and then decided not
    // to answer has decided not to answer.
    expect(
      profileUpdateFor(
        { name: 'Ada', instrument: 'cello', avatarKey: 'u1/a.jpg' },
        { skipping: true },
      ),
    ).toEqual({ onboarded: true });
  });

  it('always marks onboarding as shown', () => {
    // Both paths, because the screen must not come back either way.
    for (const skipping of [true, false]) {
      expect(profileUpdateFor(NOTHING, { skipping }).onboarded).toBe(true);
    }
  });
});

describe('whether the screen is shown at all', () => {
  it('is shown to an account that has never been asked', () => {
    expect(shouldOnboard(musician({ onboarded: false }))).toBe(true);
  });

  it('is not shown again to someone who answered — or who skipped', () => {
    expect(shouldOnboard(musician({ onboarded: true }))).toBe(false);
  });

  it('does not gate while the answer is unknown', () => {
    // The query in flight, or failed. A gate that waits on a network request
    // is a blank screen of unknown length in front of someone's own app.
    expect(shouldOnboard(undefined)).toBe(false);
  });

  it('does not gate on an instrument alone', () => {
    // Tempting, and wrong: someone who skipped has no instrument on the
    // account and is entitled to keep it that way. `onboarded` records being
    // asked, which is the only thing that decides this.
    expect(shouldOnboard(musician({ onboarded: true, instrument: null }))).toBe(
      false,
    );
  });
});
