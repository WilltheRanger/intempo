import { FALLBACK_BPM } from '../lib/score/schedule';
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
// Re-exported, not redefined: `lib/score/schedule` owns it because that module
// has no dependencies and can be imported by anything, this one cannot.
export { FALLBACK_BPM };

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

/**
 * A number this app is allowed to offer, from any number at all.
 *
 * **`NaN` used to pass straight through.** `Math.round(NaN)` is `NaN`, and so
 * are `Math.max` and `Math.min` of it, so the one function whose stated job is
 * that "the UI can't offer an invalid one" returned the most invalid value
 * there is. It would have reached `target_bpm`, become `null` in the JSON, and
 * come back as a 422 on the one request a musician makes after playing.
 *
 * Not reachable today — `markedBpm` is read straight from JSON, which has no
 * `NaN` — so this is a contract being kept rather than a bug being fixed. The
 * contract is worth keeping because every caller believes it.
 *
 * `FALLBACK_BPM` for `NaN`, because "no usable tempo" is exactly the situation
 * the fallback exists for. **Only `NaN`** — an infinity still says which
 * direction it went, and `Math.max`/`Math.min` already turn it into the bound
 * it was heading for, which is a better answer than a default.
 */
export function clampBpm(bpm: number): number {
  if (Number.isNaN(bpm)) {
    return FALLBACK_BPM;
  }
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
  // **Clamped on the way out as well as on the way in.** The load path filters
  // non-finite values and `set` clamps, so this should be redundant — but
  // `typeof NaN === 'number'`, so the guard above admits one, and a `NaN`
  // reaching `scheduleScore` used to become a `NaN` note time and an exception
  // from Web Audio in the middle of scheduling. Cheap here, unrecoverable
  // there.
  if (typeof remembered === 'number') {
    return clampBpm(remembered);
  }
  return clampBpm(markedBpm ?? FALLBACK_BPM);
}

/** Subscribes a component to the remembered tempos. */
export function usePracticeTempos(): Tempos {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface TempoRung {
  bpm: number;
  label: 'Warm up' | 'Current' | 'Next' | 'Marked' | 'Build' | 'Stretch';
  selected: boolean;
}

/** Four BPM is two deliberate stepper taps: audible, but not a leap. */
export const TEMPO_LADDER_STEP = 4;

function rung(
  bpm: number,
  label: TempoRung['label'],
  workingBpm: number,
): TempoRung {
  const clamped = clampBpm(bpm);
  return { bpm: clamped, label, selected: clamped === workingBpm };
}

function uniqueRungs(rungs: TempoRung[]): TempoRung[] {
  return rungs.filter(
    (rung, index) => rungs.findIndex((candidate) => candidate.bpm === rung.bpm) === index,
  );
}

/**
 * Three useful tempos around the musician's current working tempo.
 *
 * The score's marked tempo is a destination when it is above the current
 * tempo, an anchor when it is below it, and the top rung when the musician has
 * reached it. With no marking, the ladder is explicitly a suggestion rather
 * than pretending the page supplied a goal.
 */
export function tempoLadderFor(
  workingBpm: number,
  markedBpm: number | null,
): TempoRung[] {
  const working = clampBpm(workingBpm);
  const marked = markedBpm === null ? null : clampBpm(markedBpm);

  if (marked === null) {
    return uniqueRungs([
      rung(working, 'Current', working),
      rung(working + TEMPO_LADDER_STEP, 'Next', working),
      rung(working + TEMPO_LADDER_STEP * 2, 'Stretch', working),
    ]);
  }

  if (marked === working) {
    return uniqueRungs([
      rung(working - TEMPO_LADDER_STEP * 2, 'Warm up', working),
      rung(working - TEMPO_LADDER_STEP, 'Build', working),
      rung(working, 'Marked', working),
    ]);
  }

  if (marked > working) {
    const next = Math.min(working + TEMPO_LADDER_STEP, marked);
    return uniqueRungs(
      next === marked
        ? [
            rung(working - TEMPO_LADDER_STEP, 'Warm up', working),
            rung(working, 'Current', working),
            rung(marked, 'Marked', working),
          ]
        : [
            rung(working, 'Current', working),
            rung(next, 'Next', working),
            rung(marked, 'Marked', working),
          ],
    );
  }

  const build = Math.max(marked, working - TEMPO_LADDER_STEP);
  return uniqueRungs(
    build === marked
      ? [
          rung(marked, 'Marked', working),
          rung(working, 'Current', working),
          rung(working + TEMPO_LADDER_STEP, 'Stretch', working),
        ]
      : [
          rung(marked, 'Marked', working),
          rung(build, 'Build', working),
          rung(working, 'Current', working),
        ],
  );
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
