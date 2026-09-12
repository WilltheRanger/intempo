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

import type { Instrument, MetronomeMode } from './types';
import { hydratePreferences, preferences } from './preferences';

/**
 * Device preferences, and the two lists inside them that mirror server enums.
 *
 * `preferences.ts` validates a stored instrument against a local
 * `INSTRUMENTS` array and a stored metronome mode against `METRONOME_MODES`.
 * Both are typed `Instrument[]` / `MetronomeMode[]`, which stops a *wrong*
 * member going in and does nothing at all about a **missing** one: drop
 * `double_bass` from the array and it still compiles.
 *
 * What that costs is specific. `analyses.instrument` is what the pipeline
 * reads to decide how to look for onsets — a double bass needs a lower
 * threshold, because the note swells in rather than snapping in and most of
 * its energy sits where the detector is weakest. A bassist whose stored
 * preference silently reset to violin on every launch would be analysed with
 * settings tuned for a treble string, and nothing anywhere would say so.
 *
 * So the tests below go through storage rather than reading the arrays: every
 * member of each union has to survive a round trip.
 */

const KEY = 'intempo.preferences.v1';

/**
 * Every instrument, as a type-checked map.
 *
 * A `Record` rather than an array on purpose — TypeScript rejects this object
 * if the union gains a member or loses one, so the list below cannot silently
 * fall behind `types.ts`.
 *
 * This used to end "the way `INSTRUMENTS` can", naming a hazard in the real
 * list and fixing it only here, in the test's own copy. `data/instruments.ts`
 * is built the same way now, so the hazard is closed where it was rather than
 * worked around where it was noticed.
 */
const EVERY_INSTRUMENT: Record<Instrument, true> = {
  violin: true,
  viola: true,
  cello: true,
  double_bass: true,
};

const EVERY_METRONOME_MODE: Record<MetronomeMode, true> = {
  off: true,
  visual: true,
  haptic: true,
  audio_with_headphones: true,
};

beforeEach(async () => {
  store.clear();
  store.set(KEY, '{}'); // hydrate leaves memory alone when storage holds nothing
  await hydratePreferences();
});

describe('defaults', () => {
  it('starts on violin, silent, with haptics and motion on', () => {
    // "Violin by default because it is the commonest of the four, not because
    // it is the assumed case."
    expect(preferences.current()).toEqual({
      instrument: 'violin',
      metronomeMode: 'off',
      haptics: true,
      reduceMotion: false,
      practiceSetupSeen: false,
    });
  });
});

describe('every instrument survives a round trip', () => {
  it.each(Object.keys(EVERY_INSTRUMENT) as Instrument[])('%s', async (instrument) => {
    preferences.setInstrument(instrument);
    await vi.waitFor(() => expect(store.get(KEY)).toContain(instrument));

    await hydratePreferences();

    expect(preferences.current().instrument).toBe(instrument);
  });
});

describe('every metronome mode survives a round trip', () => {
  it.each(Object.keys(EVERY_METRONOME_MODE) as MetronomeMode[])('%s', async (mode) => {
    preferences.setMetronomeMode(mode);
    await vi.waitFor(() => expect(store.get(KEY)).toContain(mode));

    await hydratePreferences();

    expect(preferences.current().metronomeMode).toBe(mode);
  });
});

describe('reading storage it does not trust', () => {
  it('falls back per field, not for the whole record', async () => {
    // A build that adds a preference has to read the ones already saved. If
    // one bad field reset everything, upgrading would silently return a
    // bassist to violin.
    store.set(
      KEY,
      JSON.stringify({ instrument: 'cello', metronomeMode: 'telepathy', haptics: 'yes' }),
    );
    await hydratePreferences();

    expect(preferences.current()).toEqual({
      instrument: 'cello',
      metronomeMode: 'off',
      haptics: true,
      reduceMotion: false,
      practiceSetupSeen: false,
    });
  });

  it('refuses an instrument this build does not know', async () => {
    store.set(KEY, JSON.stringify({ instrument: 'theremin' }));
    await hydratePreferences();

    expect(preferences.current().instrument).toBe('violin');
  });

  it('survives storage holding something that is not JSON', async () => {
    store.set(KEY, '}{ not json');

    await expect(hydratePreferences()).resolves.toBeUndefined();
    expect(preferences.current().instrument).toBe('violin');
  });

  it('keeps a saved false rather than reading it as absent', async () => {
    // `saved.haptics || DEFAULTS.haptics` would turn a deliberate `false` back
    // into `true` on every launch — the switch that will not stay off.
    store.set(KEY, JSON.stringify({ haptics: false, reduceMotion: true }));
    await hydratePreferences();

    expect(preferences.current().haptics).toBe(false);
    expect(preferences.current().reduceMotion).toBe(true);
  });
});

describe('first-take setup', () => {
  it('persists that this device has seen the guide', async () => {
    preferences.setPracticeSetupSeen(true);
    await vi.waitFor(() => expect(store.get(KEY)).toContain('"practiceSetupSeen":true'));

    await hydratePreferences();

    expect(preferences.current().practiceSetupSeen).toBe(true);
  });

  it('does not trust a non-boolean stored value', async () => {
    store.set(KEY, JSON.stringify({ practiceSetupSeen: 'yes' }));
    await hydratePreferences();

    expect(preferences.current().practiceSetupSeen).toBe(false);
  });
});

describe('setting one preference', () => {
  it('leaves the others alone', () => {
    // Order matters here. With `setInstrument` first, everything else is still
    // at its default, so a mutation replacing `...current` with `...DEFAULTS`
    // is invisible — which is exactly what happened when this was written the
    // other way round. The non-default settings go in *before* the one under
    // test.
    preferences.setHaptics(false);
    preferences.setMetronomeMode('visual');

    preferences.setInstrument('double_bass');

    expect(preferences.current()).toEqual({
      instrument: 'double_bass',
      metronomeMode: 'visual',
      haptics: false,
      reduceMotion: false,
      practiceSetupSeen: false,
    });
  });
});

/**
 * Taking the account's instrument onto a device that has none.
 *
 * **The account is the source of truth and this cache was never filled from
 * it.** Onboarding writes both, so the first device is right; a reinstall or a
 * second device starts at `DEFAULTS.instrument` — violin — with nothing to
 * correct it, and *everything that acts on an instrument reads this cache*:
 * the warmup, the labels, and `submitTake`, which the server turns into
 * `analyze(double_bass=...)`. A cellist on a new phone got violin warmups and
 * violin onset thresholds.
 *
 * The safety of it is the "only when nothing is stored" clause. A device with
 * a stored instrument has one because somebody chose it *here*, and the
 * Profile control does not write that back to the account — so adopting on
 * every load would revert their choice from a value the server was never told
 * about.
 */
describe('adopting the account instrument', () => {
  it('fills a device that has never stored one', async () => {
    await hydratePreferences();
    expect(preferences.current().instrument).toBe('violin');

    expect(preferences.adoptAccountInstrument('cello')).toBe(true);
    expect(preferences.current().instrument).toBe('cello');
  });

  it('fills one whose storage is genuinely empty, which is the real case', async () => {
    // The shared `beforeEach` writes `'{}'` so that hydration runs its whole
    // body. A **fresh install** returns null and takes the early return — the
    // one path a reinstalled cellist actually follows, and the one where the
    // stored-flag could have been left over from a previous hydrate.
    store.clear();
    await hydratePreferences();

    expect(preferences.adoptAccountInstrument('double_bass')).toBe(true);
    expect(preferences.current().instrument).toBe('double_bass');
  });

  it('forgets a previous device\u2019s stored instrument when storage is cleared', async () => {
    store.set(KEY, JSON.stringify({ instrument: 'viola' }));
    await hydratePreferences();
    expect(preferences.adoptAccountInstrument('cello')).toBe(false);

    // Signing out and back in, or reinstalling: nothing stored any more, so
    // the account may fill it again. Without clearing the flag on the early
    // return this stayed true and the account was ignored forever.
    store.clear();
    await hydratePreferences();

    expect(preferences.adoptAccountInstrument('cello')).toBe(true);
    expect(preferences.current().instrument).toBe('cello');
  });

  it('leaves a stored choice alone', async () => {
    store.set(KEY, JSON.stringify({ instrument: 'viola' }));
    await hydratePreferences();

    // The case that makes overwriting unsafe: this device says viola because
    // somebody chose viola on it, and the account has not been told.
    expect(preferences.adoptAccountInstrument('cello')).toBe(false);
    expect(preferences.current().instrument).toBe('viola');
  });

  it('leaves a stored choice alone even when it matches the default', async () => {
    // The one a `current().instrument === DEFAULTS.instrument` test would get
    // wrong: a violinist who really did choose violin here.
    store.set(KEY, JSON.stringify({ instrument: 'violin' }));
    await hydratePreferences();

    expect(preferences.adoptAccountInstrument('double_bass')).toBe(false);
    expect(preferences.current().instrument).toBe('violin');
  });

  it('does nothing for an account that was never asked', async () => {
    await hydratePreferences();

    // Accounts onboarded before the instrument was required keep their gaps
    // and are never sent back through — `users.instrument` stays null.
    expect(preferences.adoptAccountInstrument(null)).toBe(false);
    expect(preferences.adoptAccountInstrument(undefined)).toBe(false);
    expect(preferences.current().instrument).toBe('violin');
  });

  it('refuses a value the app has no name for', async () => {
    await hydratePreferences();

    // A server that grows a fifth instrument reaches this before it reaches
    // any screen. Storing it would put an unrenderable key in the cache.
    expect(
      preferences.adoptAccountInstrument('theremin' as unknown as Instrument),
    ).toBe(false);
    expect(preferences.current().instrument).toBe('violin');
  });

  it('adopts once and then stops', async () => {
    await hydratePreferences();

    expect(preferences.adoptAccountInstrument('cello')).toBe(true);
    // Idempotent: the caller re-runs it whenever the account value changes,
    // and after the first time the device has a choice of its own.
    expect(preferences.adoptAccountInstrument('viola')).toBe(false);
    expect(preferences.current().instrument).toBe('cello');
  });

  it('stops adopting once someone sets one by hand', async () => {
    await hydratePreferences();
    preferences.setInstrument('double_bass');

    expect(preferences.adoptAccountInstrument('cello')).toBe(false);
    expect(preferences.current().instrument).toBe('double_bass');
  });
});
