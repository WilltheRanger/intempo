import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { Instrument } from './types';
import { isInstrument } from './instruments';

/**
 * The onboarding answers, given before there is an account to put them on.
 *
 * Onboarding runs ahead of the sign-up form — the owner's call on 2026-09-08 —
 * and creating an account usually returns **no session**: Supabase emails a
 * confirmation link, and the musician leaves for their inbox. So the answers
 * have to wait somewhere on the device until a session exists, and then be
 * applied. `applyOnboardingDraft` is what applies them.
 *
 * Local, like `preferences` beside it, and for a stronger reason: there is no
 * account to write to yet, and no request that could carry them.
 */

const STORAGE_KEY = 'intempo.onboardingDraft.v1';

/** A photograph chosen from the library, before it has been uploaded. */
export interface PickedPhoto {
  uri: string;
  mimeType: string;
}

export interface OnboardingDraft {
  /** As typed, untrimmed — trimming belongs to `lib/onboarding`. */
  name: string;
  instrument: Instrument | null;
  /**
   * The chosen photograph, **in memory for this run of the app only**.
   *
   * Deliberately not persisted, and the reason is the round trip this store
   * exists for. A picked URI is a cache path on native and a `blob:` URL on
   * the web; neither reliably survives the app being relaunched by a
   * confirmation link, and a persisted URI that no longer resolves is *worse*
   * than none — it fails at the one moment the upload matters, after the
   * account exists and the musician believes they are done.
   *
   * The degrade is graceful because the name and the instrument do persist:
   * they reach the account, and the post-sign-in gate — which is still there —
   * opens with those two already filled and asks only for the photograph.
   */
  photo: PickedPhoto | null;
}

export const EMPTY_DRAFT: OnboardingDraft = {
  name: '',
  instrument: null,
  photo: null,
};

let current: OnboardingDraft = EMPTY_DRAFT;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): OnboardingDraft {
  return current;
}

/** What survives being relaunched: everything that is text. */
function persisted(draft: OnboardingDraft): { name: string; instrument: Instrument | null } {
  return { name: draft.name, instrument: draft.instrument };
}

/**
 * Storage, best-effort in the way `.catch()` alone is not.
 *
 * A rejected promise is not the only way `AsyncStorage` can fail: a stand-in
 * missing the method throws **synchronously**, before there is a promise to
 * attach a `catch` to. That is not hypothetical — `session.test.ts` mocks the
 * module as `{}` on purpose, because sign-out should not depend on the shape
 * of a store — and `signOut` clears this draft, so the throw would have landed
 * in front of somebody trying to leave.
 *
 * A failed write costs the musician re-answering two questions. It must never
 * cost more than that.
 */
function bestEffort(write: () => Promise<unknown>): void {
  try {
    void write().catch(() => {});
  } catch {
    // Storage unavailable. The answers live in memory for this run.
  }
}

function commit(next: OnboardingDraft): void {
  current = next;
  listeners.forEach((listener) => listener());
  bestEffort(() =>
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persisted(next))),
  );
}

/**
 * Loads an unfinished draft. Call once at startup, before the first render
 * that reads it.
 *
 * Validated rather than trusted, the way `preferences` validates: a value
 * written by an older build must not put an instrument the app has no button
 * for onto somebody's account.
 */
export async function hydrateOnboardingDraft(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw) as unknown;
    if (!saved || typeof saved !== 'object') {
      return;
    }
    const { name, instrument } = saved as Partial<OnboardingDraft>;
    current = {
      name: typeof name === 'string' ? name : '',
      instrument: isInstrument(instrument) ? instrument : null,
      // Never restored — see `OnboardingDraft.photo`.
      photo: null,
    };
    listeners.forEach((listener) => listener());
  } catch {
    // Unreadable or malformed: the empty draft is already in place.
  }
}

/** Subscribes a component to the unfinished draft. */
export function useOnboardingDraft(): OnboardingDraft {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const onboardingDraft = {
  /** Synchronous read, for callers that aren't components. */
  current(): OnboardingDraft {
    return current;
  },

  /** Replace the answers wholesale — what the form's Continue does. */
  set(draft: OnboardingDraft): void {
    commit(draft);
  },

  /**
   * Forget it, and forget it on disk.
   *
   * Called once the answers are on the account, and when someone signs out:
   * a draft left behind would be applied to the *next* account signed in on
   * this device, which is somebody else's name and instrument.
   */
  clear(): void {
    current = EMPTY_DRAFT;
    listeners.forEach((listener) => listener());
    bestEffort(() => AsyncStorage.removeItem(STORAGE_KEY));
  },
};
