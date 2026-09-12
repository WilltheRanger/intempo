import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  },
}));

import type { Instrument } from './types';
import {
  EMPTY_DRAFT,
  hydrateOnboardingDraft,
  onboardingDraft,
} from './onboardingDraft';

/**
 * The answers given before there is an account to put them on.
 *
 * The property this file exists for is the round trip through a **confirmation
 * link**: onboarding runs ahead of the sign-up form, creating an account
 * usually returns no session, and the musician leaves for their inbox. What
 * comes back has to still be there — except the photograph, which deliberately
 * does not, because a persisted `blob:` URL that no longer resolves would fail
 * at the one moment it matters.
 */

const KEY = 'intempo.onboardingDraft.v1';

beforeEach(async () => {
  store.clear();
  onboardingDraft.clear();
  await hydrateOnboardingDraft();
});

describe('the draft', () => {
  it('starts empty', () => {
    expect(onboardingDraft.current()).toEqual(EMPTY_DRAFT);
  });

  it('survives being relaunched', async () => {
    onboardingDraft.set({ name: 'Arya', instrument: 'cello', photo: null });

    // A fresh launch reads what is on disk.
    await hydrateOnboardingDraft();

    expect(onboardingDraft.current().name).toBe('Arya');
    expect(onboardingDraft.current().instrument).toBe('cello');
  });

  it.each<Instrument>(['violin', 'viola', 'cello', 'double_bass'])(
    'round-trips %s',
    async (instrument) => {
      onboardingDraft.set({ name: 'A', instrument, photo: null });
      await hydrateOnboardingDraft();
      expect(onboardingDraft.current().instrument).toBe(instrument);
    },
  );

  it('never restores a photograph, however it was stored', async () => {
    /**
     * The whole reason the photo is memory-only. A picked URI is a cache path
     * on native and a `blob:` URL on the web; restoring one that no longer
     * resolves would fail the upload *after* the account exists and the
     * musician believes they are done.
     */
    onboardingDraft.set({
      name: 'Arya',
      instrument: 'cello',
      photo: { uri: 'blob:https://app.example/abc', mimeType: 'image/jpeg' },
    });
    expect(onboardingDraft.current().photo).not.toBeNull();

    await hydrateOnboardingDraft();

    expect(onboardingDraft.current().photo).toBeNull();
    expect(store.get(KEY)).not.toContain('blob:');
  });

  it('forgets an instrument the app has no button for', async () => {
    store.set(KEY, JSON.stringify({ name: 'Arya', instrument: 'theremin' }));
    await hydrateOnboardingDraft();
    expect(onboardingDraft.current().instrument).toBeNull();
    expect(onboardingDraft.current().name).toBe('Arya');
  });

  it.each(['', 'not json', '"a string"', 'null', '[]'])(
    'survives %s on disk',
    async (raw) => {
      store.set(KEY, raw);
      await hydrateOnboardingDraft();
      expect(onboardingDraft.current()).toEqual(EMPTY_DRAFT);
    },
  );

  it('is forgotten on disk as well as in memory', async () => {
    onboardingDraft.set({ name: 'Arya', instrument: 'cello', photo: null });

    onboardingDraft.clear();

    expect(onboardingDraft.current()).toEqual(EMPTY_DRAFT);
    // Left behind, it would be applied to the *next* account signed in on this
    // device — somebody else's name and instrument.
    await hydrateOnboardingDraft();
    expect(onboardingDraft.current()).toEqual(EMPTY_DRAFT);
  });
});

describe('storage that misbehaves', () => {
  it('does not throw out of set or clear when the method is missing', async () => {
    /**
     * `signOut` clears the draft, so a throw here lands in front of somebody
     * trying to leave. `.catch()` alone does not cover it: a stand-in without
     * the method throws **synchronously**, before there is a promise to catch
     * on — which is exactly how `session.test.ts` mocks the module.
     */
    const storage = (await import('@react-native-async-storage/async-storage'))
      .default as unknown as Record<string, unknown>;
    const realSet = storage.setItem;
    const realRemove = storage.removeItem;
    storage.setItem = undefined;
    storage.removeItem = undefined;

    try {
      expect(() =>
        onboardingDraft.set({ name: 'Arya', instrument: 'cello', photo: null }),
      ).not.toThrow();
      expect(() => onboardingDraft.clear()).not.toThrow();
    } finally {
      storage.setItem = realSet;
      storage.removeItem = realRemove;
    }
  });
});
