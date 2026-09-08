import { describe, expect, it } from 'vitest';

import {
  MISSING_LABELS,
  describeMissing,
  draftIsWorthSending,
  draftUpdateFor,
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

  it('accepts a local photo that is ready to upload on Continue', () => {
    // Choosing is intentionally local. Continue performs the upload and does
    // not save the profile until it has the resulting object key.
    expect(
      missingFromOnboarding({
        ...EVERYTHING,
        avatarKey: null,
        photoSelected: true,
      }),
    ).toEqual([]);
  });

  it('still requires a photo when neither a selection nor an object key exists', () => {
    expect(
      missingFromOnboarding({
        ...EVERYTHING,
        avatarKey: null,
        photoSelected: false,
      }),
    ).toEqual(['photo']);
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
    expect(describeMissing(['photo'])).toBe('Still needed: a profile picture.');
  });

  it('joins two with "and", not a comma', () => {
    expect(describeMissing(['name', 'photo'])).toBe(
      'Still needed: your name and a profile picture.',
    );
  });

  it('joins three the way English does', () => {
    expect(describeMissing(['name', 'photo', 'instrument'])).toBe(
      'Still needed: your name, a profile picture and your instrument.',
    );
  });
});

describe('coming back to a half-answered onboarding', () => {
  /**
   * `PATCH /v1/me` stores what it is given and stamps `onboarded_at` only once
   * the resulting row carries all three answers. So a musician who typed their
   * name, chose a photograph, and was interrupted arrives here again with both
   * on their account — and the screen used to start from nothing and ask for
   * all three, including the one answer that cannot be given by thinking.
   */
  it('does not ask again for a photograph the account already has', () => {
    expect(
      missingFromOnboarding({ name: 'Alex', instrument: 'violin', avatarKey: null, storedPhoto: true }),
    ).toEqual([]);
  });

  it('still asks when there is no photograph anywhere', () => {
    expect(
      missingFromOnboarding({ name: 'Alex', instrument: 'violin', avatarKey: null }),
    ).toEqual(['photo']);
    expect(
      missingFromOnboarding({ name: 'Alex', instrument: 'violin', avatarKey: null, storedPhoto: false }),
    ).toEqual(['photo']);
  });

  it('treats a stored photograph exactly as a chosen or uploaded one', () => {
    // Three ways to satisfy the same requirement, and the screen must not care
    // which: `avatarKey` after an upload, `photoSelected` before one, and this.
    const answers = { name: 'Alex', instrument: 'violin', avatarKey: null } as const;
    expect(missingFromOnboarding({ ...answers, avatarKey: 'k' })).toEqual([]);
    expect(missingFromOnboarding({ ...answers, photoSelected: true })).toEqual([]);
    expect(missingFromOnboarding({ ...answers, storedPhoto: true })).toEqual([]);
  });

  it('does not let a stored photograph excuse the other two', () => {
    expect(missingFromOnboarding({ name: '', instrument: null, avatarKey: null, storedPhoto: true })).toEqual([
      'name',
      'instrument',
    ]);
  });
});

// --- answers given before the account existed -----------------------------

/** A complete set, so each case below changes exactly one thing. */
const COMPLETE = {
  name: 'Arya',
  instrument: 'cello' as const,
  avatarKey: 'u/1.jpg',
};

describe('draftUpdateFor', () => {
  it('claims onboarded when all three answers are there', () => {
    expect(draftUpdateFor(COMPLETE)).toEqual({
      onboarded: true,
      display_name: 'Arya',
      instrument: 'cello',
      avatar_key: 'u/1.jpg',
    });
  });

  it.each([
    ['the photograph', { ...COMPLETE, avatarKey: null }],
    ['the name', { ...COMPLETE, name: '   ' }],
    ['the instrument', { ...COMPLETE, instrument: null }],
  ])('does not claim onboarded without %s', (_what, answers) => {
    /**
     * `PATCH /v1/me` answers 400 to `onboarded: true` against a row still
     * missing one. Claiming it anyway would fail the whole request and land
     * *nothing* — including the answers that were given, which are what stop
     * the gate asking for everything a second time.
     */
    expect(draftUpdateFor(answers)).not.toHaveProperty('onboarded');
  });

  it('sends the answers it does have', () => {
    expect(draftUpdateFor({ ...COMPLETE, avatarKey: null })).toEqual({
      display_name: 'Arya',
      instrument: 'cello',
    });
  });

  it('never sends a null that would erase an answer already on the account', () => {
    // `UpdateMeInput` reads an explicit null as "clear it". A draft with no
    // name must leave a name the account already carries alone.
    expect(draftUpdateFor({ name: '  ', instrument: null, avatarKey: null })).toEqual(
      {},
    );
  });
});

describe('draftIsWorthSending', () => {
  it.each([
    ['a name', { name: 'Arya', instrument: null, avatarKey: null }],
    ['an instrument', { name: '', instrument: 'viola' as const, avatarKey: null }],
    ['an uploaded photo', { name: '', instrument: null, avatarKey: 'u/1.jpg' }],
    [
      'a photo not yet uploaded',
      { name: '', instrument: null, avatarKey: null, photoSelected: true },
    ],
  ])('is true for %s', (_what, answers) => {
    expect(draftIsWorthSending(answers)).toBe(true);
  });

  it('is false when nothing was answered', () => {
    expect(
      draftIsWorthSending({ name: '   ', instrument: null, avatarKey: null }),
    ).toBe(false);
  });
});

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
