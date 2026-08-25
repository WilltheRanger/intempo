import { describe, expect, it } from 'vitest';

import {
  describeMissing,
  MISSING_LABELS,
  missingFromOnboarding,
  profileUpdateFor,
  shouldOnboard,
} from './onboarding';
import type { Musician } from '../data/types';

const NOTHING = { name: '', instrument: null, avatarKey: null };
const EVERYTHING = {
  name: 'Ada',
  instrument: 'double_bass' as const,
  avatarKey: 'u1/a.jpg',
};

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

describe('what onboarding still needs', () => {
  it('needs all three when nothing has been given', () => {
    expect(missingFromOnboarding(NOTHING)).toEqual([
      'name',
      'photo',
      'instrument',
    ]);
  });

  it('is satisfied only when all three are there', () => {
    expect(missingFromOnboarding(EVERYTHING)).toEqual([]);
  });

  it('names exactly what is missing, one field at a time', () => {
    expect(missingFromOnboarding({ ...EVERYTHING, name: '' })).toEqual(['name']);
    expect(missingFromOnboarding({ ...EVERYTHING, avatarKey: null })).toEqual([
      'photo',
    ]);
    expect(missingFromOnboarding({ ...EVERYTHING, instrument: null })).toEqual([
      'instrument',
    ]);
  });

  it('does not accept a name of only spaces', () => {
    // The server strips and writes NULL, so this would let someone through to
    // an account with no name on it — the exact state the rule forbids.
    expect(missingFromOnboarding({ ...EVERYTHING, name: '   ' })).toEqual([
      'name',
    ]);
  });

  it('does not accept a chosen photo that never uploaded', () => {
    // The screen shows a preview from the local file the moment it is picked.
    // The preview is not the requirement — the object key is, because that is
    // the only thing the account can be pointed at.
    expect(missingFromOnboarding({ ...EVERYTHING, avatarKey: null })).toEqual([
      'photo',
    ]);
  });

  it('has a human label for every requirement it can report', () => {
    for (const requirement of missingFromOnboarding(NOTHING)) {
      expect(MISSING_LABELS[requirement]).toBeTruthy();
    }
  });
});

describe('what finishing onboarding sends', () => {
  it('sends all three and the flag', () => {
    expect(profileUpdateFor(EVERYTHING)).toEqual({
      onboarded: true,
      display_name: 'Ada',
      instrument: 'double_bass',
      avatar_key: 'u1/a.jpg',
    });
  });

  it('trims the name', () => {
    expect(profileUpdateFor({ ...EVERYTHING, name: '  Ada  ' }).display_name).toBe(
      'Ada',
    );
  });

  it('omits a blank field rather than nulling it', () => {
    // Unreachable through the button, which `missingFromOnboarding` disables —
    // and guarded anyway, because the two failures are not the same size. A
    // request that does too little is recoverable; `display_name: null` erases
    // a name the account already carried.
    const body = profileUpdateFor(NOTHING);

    expect(body).toEqual({ onboarded: true });
    expect('display_name' in body).toBe(false);
    expect('instrument' in body).toBe(false);
    expect('avatar_key' in body).toBe(false);
  });

  it('always marks onboarding as shown', () => {
    expect(profileUpdateFor(EVERYTHING).onboarded).toBe(true);
  });
});

describe('whether the screen is shown at all', () => {
  it('is shown to an account that has never been asked', () => {
    expect(shouldOnboard(musician({ onboarded: false }))).toBe(true);
  });

  it('is not shown again once the account has been through it', () => {
    expect(shouldOnboard(musician({ onboarded: true }))).toBe(false);
  });

  it('does not gate while the answer is unknown', () => {
    // The query in flight, or failed. A gate that waits on a network request
    // is a blank screen of unknown length in front of someone's own app.
    expect(shouldOnboard(undefined)).toBe(false);
  });

  it('does not gate on a missing instrument alone', () => {
    // `onboarded` records being asked, and it is the only thing that decides
    // this. An account onboarded before the fields were required has no
    // instrument and must not be sent back through the screen.
    expect(shouldOnboard(musician({ onboarded: true, instrument: null }))).toBe(
      false,
    );
  });
});

describe('saying what is still needed', () => {
  it('says nothing at all when nothing is', () => {
    // Not an empty string: "Still needed:" with nothing after it is worse than
    // no line, and null is the only shape a screen cannot render by accident.
    expect(describeMissing([])).toBeNull();
  });

  it('names one', () => {
    expect(describeMissing(['photo'])).toBe('Still needed: a photo.');
  });

  it('joins two with "and", not a comma', () => {
    expect(describeMissing(['name', 'photo'])).toBe(
      'Still needed: your name and a photo.',
    );
  });

  it('joins three the way English does', () => {
    expect(describeMissing(['name', 'photo', 'instrument'])).toBe(
      'Still needed: your name, a photo and your instrument.',
    );
  });
});
