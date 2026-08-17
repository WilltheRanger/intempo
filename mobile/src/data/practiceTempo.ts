import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * The tempo a musician is working a piece at, remembered per piece.
 *
 * Practising a passage slower than written and bringing it up is the oldest
 * technique there is, and it only works if the app remembers where you left
 * off. Coming back tomorrow to a screen that has reset to the marked tempo —
 * or worse, to a hard-coded 96 — makes you do the arithmetic again every day.
 *
 * Local, like `preferences`. A tempo is about where *this* musician is with
 * *this* piece on *this* device; it isn't account data, and it doesn't need a
 * round trip to be right.
 *
 * The stored value is absolute BPM rather than a percentage of the written
 * tempo, per the owner's call: BPM is what a metronome speaks, and a score
 * whose `bpm_hint` is corrected later shouldn't silently move every practice
 * tempo derived from it.
 */

const STORAGE_KEY = 'intempo.practiceTempo.v1';

/** The range the backend accepts, mirrored so the UI can't offer an invalid one. */
export const MIN_BPM = 20;
export const MAX_BPM = 300;

/**
 * Where a piece with no marked tempo starts.
 *
 * Only used when OCR found no tempo at all. It is a moderate walking pace —
 * slow enough to be a sane default for something unknown, fast enough not to
 * feel like a statement about the piece.
 */
export const FALLBACK_BPM = 80;

type Tempos = Record<string, number>;

let current: Tempos = {};
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Tempos {
  return current;
}

function commit(next: Tempos): void {
  current = next;
  listeners.forEach((listener) => listener());
  // Best-effort, like preferences: a failed write costs one remembered tempo,
  // and there is nothing useful to tell a musician about it.
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
}

/** Loads saved tempos. Call once at startup, before anything reads them. */
export async function hydratePracticeTempos(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw) as unknown;
    if (!saved || typeof saved !== 'object') {
      return;
    }
    // Validate rather than trust: a value written by an older build, or a
    // corrupted entry, must not put the recorder outside the range the backend
    // will accept.
    const clean: Tempos = {};
    for (const [pieceId, value] of Object.entries(saved as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        clean[pieceId] = clampBpm(value);
      }
    }
    current = clean;
    listeners.forEach((listener) => listener());
  } catch {
    // Unreadable or malformed: an empty map is already in place.
  }
}

export function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

/**
 * The tempo to start this piece at.
 *
 * The remembered one, or the piece's own marked tempo, or the fallback — in
 * that order, because a musician's own choice outranks the score and the score
 * outranks a guess.
 */
export function tempoFor(pieceId: string, markedBpm: number | null): number {
  const remembered = current[pieceId];
  if (typeof remembered === 'number') {
    return remembered;
  }
  return clampBpm(markedBpm ?? FALLBACK_BPM);
}

/** Subscribes a component to the remembered tempos. */
export function usePracticeTempos(): Tempos {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const practiceTempo = {
  /** Synchronous read, for callers that aren't components. */
  for(pieceId: string, markedBpm: number | null): number {
    return tempoFor(pieceId, markedBpm);
  },

  set(pieceId: string, bpm: number): void {
    commit({ ...current, [pieceId]: clampBpm(bpm) });
  },

  /** Forget a piece's tempo — for when it's deleted from the library. */
  clear(pieceId: string): void {
    if (!(pieceId in current)) {
      return;
    }
    const next = { ...current };
    delete next[pieceId];
    commit(next);
  },
};
