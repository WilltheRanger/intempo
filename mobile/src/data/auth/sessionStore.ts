import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Where the signed-in session is kept, and why it is not simply `AsyncStorage`.
 *
 * **Measured from the live logs, 2026-09-17.** Three password sign-ins landed
 * at Supabase within twelve seconds, all answered `200` with a session; the
 * backend saw no `/v1/me` until the third. The server signed the musician in
 * three times and the app accepted the third. What they saw each time was the
 * sign-in form again, freshly mounted and empty, with no error on it.
 *
 * The chain, all of it client-side:
 *
 *  1. `supabase.auth.getSession()` keeps **no session in memory** — every call
 *     re-reads the store (`GoTrueClient.__loadSession`).
 *  2. On web, `AsyncStorage` is **IndexedDB** (`@react-native-async-storage`
 *     3.x), and its adapter has no deadline anywhere; its connection promise is
 *     cached process-wide, so one stalled `open` takes every later read with it.
 *  3. A read that comes back empty is indistinguishable, at that layer, from
 *     "signed out" — so `getAccessToken` returned null,
 *  4. and `apiFetch` signs out on a null token, deliberately and with a written
 *     argument. Before any request goes out, which is why the backend log is
 *     silent for the attempts that failed.
 *
 * So a store that hesitated threw away a session the server had just granted.
 * That is the same error the backend already fixed one layer up:
 * `backend/app/auth.py` answers **503, not 401**, when it cannot reach the key
 * server, because *could not check is not the same as not valid*. This module
 * is that rule on the client.
 *
 * Three things it does:
 *
 * - **On web the session goes in `localStorage`**, which is what Supabase uses
 *   when it is given nothing. It is synchronous, it cannot stall, and a session
 *   is about four kilobytes against a five-megabyte budget. IndexedDB stays
 *   where it belongs — the library cache, which is large, and whose failure
 *   costs a refetch rather than an account.
 * - **A session read once is remembered**, and the memory copy answers when the
 *   store fails or comes back empty on a key we have written. A stalled store
 *   can no longer produce a false "signed out".
 * - **Nothing here rejects, and nothing here waits forever.** A write that
 *   fails is a session that will not survive a reload — worth far less than the
 *   sign-in it would otherwise fail.
 *
 * `sessionStoreDegraded()` is the honest half: when the store could not answer,
 * `getAccessToken` says so rather than reporting an empty session.
 */
export interface SessionStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * How long any one storage call may take before it is abandoned.
 *
 * Four seconds. On web the backing store is synchronous, so this only ever
 * fires on the IndexedDB fallback and on native — and there it is guarding the
 * failure this module exists for, where the alternative is not a slow sign-in
 * but a sign-in that never finishes. `useAuthStatus` gives the whole boot eight
 * seconds and `apiFetch` gives the token read ten, so this sits inside both.
 */
const DEADLINE_MS = 4000;

/** Written by this page, so a store that forgets is not believed. */
const mirror = new Map<string, string | null>();

/** Whether the *last* call to the backing store failed or timed out. */
let unhealthy = false;

/** Resolved lazily: `Platform` and `localStorage` are both read at first use. */
let backing: SessionStore | undefined;

/** Keys already looked for in the store this build used to use. */
const inheritedKeys = new Set<string>();

/**
 * True when the store's last call failed.
 *
 * Read by `getAccessToken` to tell "there is no session" from "I could not find
 * out", which are the same value and opposite facts.
 *
 * **The last call, not any call.** A flag that latched would be true for the
 * rest of the page after one hiccup, and the musician who then genuinely signed
 * out would be told their session was unreadable instead of being taken back to
 * the form. A store that is answering again is a store to be believed.
 */
export function sessionStoreDegraded(): boolean {
  return unhealthy;
}

/**
 * Runs `work`, giving up after `ms` and never rejecting.
 *
 * The loser of the race keeps running; there is nothing to undo in a storage
 * read, and the timer is always cleared — an armed timer outlives what it was
 * guarding, which matters under fake timers and on platforms that count
 * pending work.
 */
async function settled<T>(
  work: Promise<T>,
  ms: number,
): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then((value) => ({ ok: true, value }) as const),
      new Promise<{ ok: false }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false }), ms);
      }),
    ]);
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The browser's own store, or null where there is none to have.
 *
 * Probed with a real write rather than a feature check: `localStorage` exists
 * and throws on use in a browser configured to refuse site data, and finding
 * that out here — rather than on the first sign-in — is the difference between
 * falling back and failing.
 */
function browserStore(): SessionStore | null {
  if (Platform.OS !== 'web') {
    return null;
  }
  try {
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    if (!store) {
      return null;
    }
    const probe = 'intempo.session-store.probe';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return {
      getItem: async (key) => store.getItem(key),
      setItem: async (key, value) => store.setItem(key, value),
      removeItem: async (key) => store.removeItem(key),
    };
  } catch {
    return null;
  }
}

function backingStore(): SessionStore {
  if (!backing) {
    backing = browserStore() ?? AsyncStorage;
  }
  return backing;
}

/**
 * The session this build's predecessor left in IndexedDB, once per key.
 *
 * Without it, shipping this module signs out every musician already signed in
 * on the web — a fix for "sign-in is unreliable" whose first act is to make
 * everyone sign in again. Best-effort by construction: a store that cannot
 * answer simply has nothing to inherit, which is the state a new device is in
 * anyway.
 */
async function inherited(key: string): Promise<string | null> {
  if (backingStore() === AsyncStorage || inheritedKeys.has(key)) {
    return null;
  }
  inheritedKeys.add(key);
  const read = await settled(AsyncStorage.getItem(key), DEADLINE_MS);
  if (!read.ok || read.value === null) {
    return null;
  }
  await settled(backingStore().setItem(key, read.value), DEADLINE_MS);
  return read.value;
}

export const sessionStore: SessionStore = {
  /**
   * The stored value, preferring the store and falling back on what we wrote.
   *
   * The store wins when it answers with something, so a sign-out or a token
   * refresh in another tab is seen here rather than shadowed by a stale copy.
   * The memory copy answers only for the two readings that are wrong about
   * this page: a call that failed, and an empty answer for a key this page has
   * written. Both are the bug above.
   */
  async getItem(key) {
    const read = await settled(backingStore().getItem(key), DEADLINE_MS);
    unhealthy = !read.ok;
    if (read.ok && read.value !== null) {
      mirror.set(key, read.value);
      return read.value;
    }
    if (mirror.has(key)) {
      return mirror.get(key) ?? null;
    }
    if (read.ok) {
      return inherited(key);
    }
    return null;
  },

  /**
   * Remembers the value, then writes it. Never rejects.
   *
   * Supabase saves the session *inside* `signInWithPassword`, before it tells
   * anyone the sign-in happened, and a throw from here is rethrown out of that
   * call — so a failed write used to discard a granted session. Remembering
   * first means the sign-in completes either way; what a failed write costs is
   * the next cold start, not the account.
   */
  async setItem(key, value) {
    mirror.set(key, value);
    const write = await settled(backingStore().setItem(key, value), DEADLINE_MS);
    unhealthy = !write.ok;
  },

  /**
   * Forgets the value here first, so a store that refuses cannot keep someone
   * signed in after they have asked to leave.
   */
  async removeItem(key) {
    mirror.set(key, null);
    const removed = await settled(backingStore().removeItem(key), DEADLINE_MS);
    unhealthy = !removed.ok;
  },
};

/**
 * Forget the remembered session, the chosen backing store and the health flag.
 *
 * @test-seam all three live for the life of the process — that is what makes
 * them useful — and no suite can test a second page load without a way to put
 * them back to the first.
 */
export function resetSessionStoreForTests(): void {
  mirror.clear();
  inheritedKeys.clear();
  unhealthy = false;
  backing = undefined;
}
