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
 * fall behind `types.ts` the way `INSTRUMENTS` can.
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
