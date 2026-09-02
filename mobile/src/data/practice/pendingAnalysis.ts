import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * The server-side analysis that was accepted but whose verdict the musician
 * has not opened yet.
 *
 * The WAV itself does not belong here: once an analysis id exists the upload
 * and the row are durable on the server. Persisting only these small,
 * non-secret identifiers is enough to recover after a refresh without trying
 * to serialise a Blob or enqueue the take twice.
 */
export interface PendingAnalysis {
  analysisId: string;
  scoreId: string;
  createdAt: number;
}

const STORAGE_KEY = 'intempo.pending-analysis.v1';

let current: PendingAnalysis | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): PendingAnalysis | null {
  return current;
}

function valid(value: unknown): value is PendingAnalysis {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<PendingAnalysis>;
  return (
    typeof item.analysisId === 'string' &&
    item.analysisId.length > 0 &&
    typeof item.scoreId === 'string' &&
    item.scoreId.length > 0 &&
    typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt)
  );
}

/** Load the unfinished hand-off before signed-in screens begin reading it. */
export async function hydratePendingAnalysis(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    current = valid(parsed) ? parsed : null;
    if (raw && current === null) {
      void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    }
  } catch {
    current = null;
  }
  emit();
}

/**
 * Remember immediately after POST /analyses succeeds and before polling.
 *
 * Memory is updated even when device storage refuses the write, so the current
 * session still recovers on Today. A storage problem must never turn an
 * already-accepted recording into a failed submission.
 */
export async function rememberPendingAnalysis(item: PendingAnalysis): Promise<void> {
  current = item;
  emit();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(item)).catch(() => {});
}

/**
 * Forget only the id the caller finished.
 *
 * The expected id prevents an older request finishing late from clearing a
 * newer take that has already replaced it.
 */
export async function forgetPendingAnalysis(expectedId?: string): Promise<void> {
  if (expectedId && current?.analysisId !== expectedId) {
    return;
  }
  current = null;
  emit();
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

export function usePendingAnalysis(): PendingAnalysis | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Synchronous access for tests and event handlers. */
export const pendingAnalysis = {
  current: snapshot,
};
