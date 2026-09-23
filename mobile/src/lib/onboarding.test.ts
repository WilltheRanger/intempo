import { describe, expect, it } from 'vitest';

import {
  missingFromOnboarding,
  profileUpdateFor,
  reusableAvatarKey,
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
    trainingConsent: false,
    ...overrides,
  };
}

describe('what onboarding still needs', () => {
  it('needs a name and an instrument when nothing has been given', () => {
    expect(missingFromOnboarding(NOTHING)).toEqual(['name', 'instrument']);
  });

  it('is satisfied by a name and an instrument', () => {
    expect(missingFromOnboarding(EVERYTHING)).toEqual([]);
  });

  it('names exactly what is missing, one field at a time', () => {
    expect(missingFromOnboarding({ ...EVERYTHING, name: '' })).toEqual(['name']);
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

  it('does not need a photograph', () => {
    // Optional since 2026-09-23: the redesign's photo step has "Do this
    // later", and the server no longer refuses a finish without one.
    expect(
      missingFromOnboarding({ ...EVERYTHING, avatarKey: null }),
    ).toEqual([]);
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

// --- answers given before the account existed -----------------------------

describe('reusableAvatarKey', () => {
  const uploaded = { uri: 'file:///a.jpg', key: 'u/1.jpg' };

  it('reuses the key for the file it came from', () => {
    expect(reusableAvatarKey({ uri: 'file:///a.jpg' }, uploaded)).toBe('u/1.jpg');
  });

  it('refuses it for a different file', () => {
    // The case a boolean flag gets wrong, and gets wrong silently: the account
    // would end up pointing at the picture they backed out of.
    expect(reusableAvatarKey({ uri: 'file:///b.jpg' }, uploaded)).toBeNull();
  });

  it.each([
    ['nothing chosen', null, uploaded],
    ['nothing uploaded', { uri: 'file:///a.jpg' }, null],
    ['neither', null, null],
  ])('is null with %s', (_what, photo, previous) => {
    expect(reusableAvatarKey(photo, previous)).toBeNull();
  });
});
