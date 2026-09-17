import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The store Supabase is handed, held to the four things that make it one.
 *
 * Every test here is a shape of the 2026-09-17 failure: a store that hesitated
 * produced an empty answer, an empty answer read as "signed out", and a session
 * the server had just granted was thrown away. The module's docstring has the
 * measurement; these are the rules that came out of it.
 */

const asyncStorage = {
  getItem: vi.fn<(key: string) => Promise<string | null>>(),
  setItem: vi.fn<(key: string, value: string) => Promise<void>>(),
  removeItem: vi.fn<(key: string) => Promise<void>>(),
};

let platformOS = 'web';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorage,
}));
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return platformOS;
    },
  },
}));

const KEY = 'sb-stub-auth-token';

/** A `localStorage` that works, so the web path has something real to write to. */
function workingLocalStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

/** A promise that never settles, which is exactly what a wedged store gives. */
function forever<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

async function load() {
  vi.resetModules();
  const module = await import('./sessionStore');
  module.resetSessionStoreForTests();
  return module;
}

beforeEach(() => {
  platformOS = 'web';
  asyncStorage.getItem.mockReset().mockResolvedValue(null);
  asyncStorage.setItem.mockReset().mockResolvedValue(undefined);
  asyncStorage.removeItem.mockReset().mockResolvedValue(undefined);
  (globalThis as { localStorage?: unknown }).localStorage = workingLocalStorage();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('sessionStore', () => {
  it('keeps the web session in localStorage, not in IndexedDB', async () => {
    const browser = workingLocalStorage();
    (globalThis as { localStorage?: unknown }).localStorage = browser;
    const { sessionStore, sessionStoreDegraded } = await load();

    await sessionStore.setItem(KEY, 'session');

    expect(browser.map.get(KEY)).toBe('session');
    expect(asyncStorage.setItem).not.toHaveBeenCalled();
    expect(await sessionStore.getItem(KEY)).toBe('session');
    expect(sessionStoreDegraded()).toBe(false);
  });

  it('falls back to AsyncStorage where there is no browser to store in', async () => {
    platformOS = 'ios';
    delete (globalThis as { localStorage?: unknown }).localStorage;
    const { sessionStore } = await load();

    await sessionStore.setItem(KEY, 'session');

    expect(asyncStorage.setItem).toHaveBeenCalledWith(KEY, 'session');
  });

  it('falls back when the browser refuses to store anything at all', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('The quota has been exceeded.');
      },
      removeItem: () => {},
    };
    const { sessionStore } = await load();

    await sessionStore.setItem(KEY, 'session');

    expect(asyncStorage.setItem).toHaveBeenCalledWith(KEY, 'session');
  });

  it('answers with what it wrote when the store comes back empty', async () => {
    // The failure itself: the write landed nowhere, or the read missed it, and
    // the session Supabase had just saved read as "signed out".
    const blackHole = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    (globalThis as { localStorage?: unknown }).localStorage = blackHole;
    const { sessionStore } = await load();

    await sessionStore.setItem(KEY, 'session');

    expect(await sessionStore.getItem(KEY)).toBe('session');
  });

  it('never hangs on a wedged store, and says it is degraded', async () => {
    vi.useFakeTimers();
    platformOS = 'ios';
    delete (globalThis as { localStorage?: unknown }).localStorage;
    asyncStorage.getItem.mockReturnValue(forever<string | null>());
    const { sessionStore, sessionStoreDegraded } = await load();

    const read = sessionStore.getItem(KEY);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await read).toBeNull();
    expect(sessionStoreDegraded()).toBe(true);
  });

  it('serves the session it wrote even after the store stops answering', async () => {
    vi.useFakeTimers();
    platformOS = 'ios';
    delete (globalThis as { localStorage?: unknown }).localStorage;
    const { sessionStore } = await load();
    await sessionStore.setItem(KEY, 'session');
    asyncStorage.getItem.mockReturnValue(forever<string | null>());

    const read = sessionStore.getItem(KEY);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await read).toBe('session');
  });

  it('never rejects when the store does, so a sign-in still completes', async () => {
    platformOS = 'ios';
    delete (globalThis as { localStorage?: unknown }).localStorage;
    asyncStorage.setItem.mockRejectedValue(new Error('IndexedDB error'));
    const { sessionStore, sessionStoreDegraded } = await load();

    await expect(sessionStore.setItem(KEY, 'session')).resolves.toBeUndefined();
    expect(sessionStoreDegraded()).toBe(true);
    expect(await sessionStore.getItem(KEY)).toBe('session');
  });

  it('forgets a signed-out session even when the store refuses to', async () => {
    platformOS = 'ios';
    delete (globalThis as { localStorage?: unknown }).localStorage;
    asyncStorage.removeItem.mockRejectedValue(new Error('IndexedDB error'));
    const { sessionStore } = await load();
    await sessionStore.setItem(KEY, 'session');

    await sessionStore.removeItem(KEY);

    expect(await sessionStore.getItem(KEY)).toBeNull();
  });

  it('forgets that it stumbled once the store answers again', async () => {
    // A latched flag would leave `getAccessToken` calling every later sign-out
    // unreadable, and the musician who really did sign out stuck on a sentence
    // about their connection.
    platformOS = 'ios';
    delete (globalThis as { localStorage?: unknown }).localStorage;
    asyncStorage.getItem.mockRejectedValueOnce(new Error('IndexedDB error'));
    const { sessionStore, sessionStoreDegraded } = await load();

    expect(await sessionStore.getItem(KEY)).toBeNull();
    expect(sessionStoreDegraded()).toBe(true);

    expect(await sessionStore.getItem(KEY)).toBeNull();
    expect(sessionStoreDegraded()).toBe(false);
  });

  it('lets the store overrule what we remember, so another tab is heard', async () => {
    const browser = workingLocalStorage();
    (globalThis as { localStorage?: unknown }).localStorage = browser;
    const { sessionStore } = await load();
    await sessionStore.setItem(KEY, 'old-session');

    browser.map.set(KEY, 'refreshed-session');

    expect(await sessionStore.getItem(KEY)).toBe('refreshed-session');
  });

  it('inherits a session left in IndexedDB, once, rather than signing anyone out', async () => {
    const browser = workingLocalStorage();
    (globalThis as { localStorage?: unknown }).localStorage = browser;
    asyncStorage.getItem.mockResolvedValue('session-from-the-old-store');
    const { sessionStore } = await load();

    expect(await sessionStore.getItem(KEY)).toBe('session-from-the-old-store');
    expect(browser.map.get(KEY)).toBe('session-from-the-old-store');

    // Copied across, so the old store is asked exactly once per key and every
    // later read is the synchronous one.
    browser.map.delete(KEY);
    expect(await sessionStore.getItem(KEY)).toBeNull();
    expect(asyncStorage.getItem).toHaveBeenCalledTimes(1);
  });
});
