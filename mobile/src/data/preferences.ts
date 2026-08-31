import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { Instrument, MetronomeMode } from './types';

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
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw) as Partial<Preferences>;
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

const INSTRUMENTS: Instrument[] = ['violin', 'viola', 'cello', 'double_bass'];

function isInstrument(value: unknown): value is Instrument {
  return INSTRUMENTS.includes(value as Instrument);
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
    commit({ ...current, instrument });
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
