import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { Instrument, MetronomeMode } from './types';
import { isInstrument } from './instruments';

export interface Preferences {
  /**
   * The instrument this musician plays.
   *
   * Chooses the clef and range of the daily excerpt, and will choose the
   * reference voice once there is more than one. Violin by default because it
   * is the commonest of the four, not because it is the assumed case — the
   * control sits in the profile and the excerpt names the instrument it is
   * written for, so a violist sees immediately that it needs changing.
   */
  instrument: Instrument;
  /**
   * How the metronome marks the beat while recording. Mirrors the
   * `metronome_mode` column on `analyses`, so this is the default a recording
   * starts from rather than a display-only choice.
   */
  metronomeMode: MetronomeMode;
  /** Gates the impact feedback on buttons and on capture. */
  haptics: boolean;
  /**
   * Turns animation down regardless of the OS setting. The system switch still
   * wins when it's on — this can only add restraint, never override someone
   * who has already asked for it.
   */
  reduceMotion: boolean;
  /**
   * Whether this device has shown the first-take microphone and count-in guide.
   *
   * Device-local because microphone placement and permission belong to the
   * hardware, not to a score or an account.
   */
  practiceSetupSeen: boolean;
}

const DEFAULTS: Preferences = {
  instrument: 'violin',
  metronomeMode: 'off',
  haptics: true,
  reduceMotion: false,
  practiceSetupSeen: false,
};

const STORAGE_KEY = 'intempo.preferences.v1';

/**
 * Whether this device has an instrument of its own, as opposed to the default.
 *
 * `DEFAULTS.instrument` is `violin`, so "the stored value is violin" and
 * "nobody has said" are indistinguishable from `current` alone — and the whole
 * point of `adoptAccountInstrument` is to tell them apart. False until
 * hydration finds a stored one or someone sets one.
 */
let instrumentIsStored = false;

/**
 * Device preferences.
 *
 * Module-level and synchronous to read, like `captureSession` — a preference
 * is consulted inside a button's press handler, where awaiting storage isn't
 * an option. Reads come from memory; writes go to memory and then to disk.
 *
 * These are genuinely local. Nothing here belongs to the account, so none of
 * it round-trips through the backend or follows a musician to another device.
 */
let current: Preferences = DEFAULTS;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Preferences {
  return current;
}

function commit(next: Preferences): void {
  current = next;
  listeners.forEach((listener) => listener());
  // Persisting is best-effort: a failed write costs one setting on next
  // launch, and there is nothing useful to tell the musician about it.
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
}

/**
 * Loads saved preferences. Call once at startup, before the first render that
 * reads them.
 *
 * Unknown and missing keys fall back to their defaults rather than being
 * trusted, so a value written by an older build — or a corrupted entry — can't
 * put the app into a state it has no UI for.
 */
export async function hydratePreferences(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    // Cleared here rather than only in the branch below, so the fresh-install
    // path — `raw` null, early return — states the answer instead of relying
    // on the initialiser being untouched.
    instrumentIsStored = false;
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw) as Partial<Preferences>;
    instrumentIsStored = isInstrument(saved.instrument);
    current = {
      instrument: isInstrument(saved.instrument)
        ? saved.instrument
        : DEFAULTS.instrument,
      metronomeMode: isMetronomeMode(saved.metronomeMode)
        ? saved.metronomeMode
        : DEFAULTS.metronomeMode,
      haptics:
        typeof saved.haptics === 'boolean' ? saved.haptics : DEFAULTS.haptics,
      reduceMotion:
        typeof saved.reduceMotion === 'boolean'
          ? saved.reduceMotion
          : DEFAULTS.reduceMotion,
      practiceSetupSeen:
        typeof saved.practiceSetupSeen === 'boolean'
          ? saved.practiceSetupSeen
          : DEFAULTS.practiceSetupSeen,
    };
    listeners.forEach((listener) => listener());
  } catch {
    // Unreadable or malformed: the defaults are already in place.
  }
}

const METRONOME_MODES: MetronomeMode[] = [
  'off',
  'visual',
  'haptic',
  'audio_with_headphones',
];

function isMetronomeMode(value: unknown): value is MetronomeMode {
  return METRONOME_MODES.includes(value as MetronomeMode);
}

/** Subscribes a component to the current preferences. */
export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const preferences = {
  /** Synchronous read, for callers that aren't components. */
  current(): Preferences {
    return current;
  },

  setInstrument(instrument: Instrument): void {
    instrumentIsStored = true;
    commit({ ...current, instrument });
  },

  /**
   * Take the account's instrument, but only on a device that has none.
   *
   * **The account is the source of truth and this cache was never filled from
   * it.** Onboarding writes both, so the first device is right; a reinstall or
   * a second device starts at `DEFAULTS.instrument` — `violin` — with nothing
   * to correct it. Everything that acts on an instrument reads this cache:
   * the warmup, the labels, and `submitTake`, which the server turns into
   * `analyze(double_bass=...)`. So a cellist signing in on a new phone was
   * given violin warmups and analysed with violin onset thresholds.
   *
   * **Only when nothing is stored, which is what makes this safe.** A device
   * that has an instrument has one because somebody chose it here, and the
   * Profile control does not write it back to the account — so overwriting on
   * every load would revert their choice from a value the server was never
   * told about. Seeding an empty cache cannot conflict with anything.
   *
   * Null does nothing: an account from before the instrument was required has
   * no answer to copy, and `violin` is then a default rather than a mistake.
   *
   * Idempotent, so a caller may run it on every change of the account value.
   */
  adoptAccountInstrument(fromAccount: Instrument | null | undefined): boolean {
    if (instrumentIsStored || !fromAccount || !isInstrument(fromAccount)) {
      return false;
    }
    instrumentIsStored = true;
    commit({ ...current, instrument: fromAccount });
    return true;
  },

  setMetronomeMode(metronomeMode: MetronomeMode): void {
    commit({ ...current, metronomeMode });
  },

  setHaptics(haptics: boolean): void {
    commit({ ...current, haptics });
  },

  setReduceMotion(reduceMotion: boolean): void {
    commit({ ...current, reduceMotion });
  },

  setPracticeSetupSeen(practiceSetupSeen: boolean): void {
    commit({ ...current, practiceSetupSeen });
  },
};
