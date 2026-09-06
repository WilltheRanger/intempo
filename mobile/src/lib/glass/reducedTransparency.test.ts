import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Reduce Transparency store — the half of the fallback that `material.ts`
 * cannot cover.
 *
 * `glassMaterial` is a pure function and was tested from the start; this is the
 * part that talks to two platforms and holds module-level state, which is
 * exactly where a silent failure lives. It shipped untested, which is the gap
 * this closes.
 *
 * Driven through `useSyncExternalStore` rather than around it: mocking `react`
 * hands back the `subscribe` and `getSnapshot` the hook actually passes, so
 * these tests exercise the wiring the app uses instead of a private copy of it.
 * `vi.resetModules()` before each case is not optional — `listening` and the
 * cached preference are module-level singletons, and a test that inherited them
 * would pass without running the code it names.
 */

interface Store {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => boolean;
}

let store: Store | null = null;

vi.mock('react', () => ({
  useSyncExternalStore: (
    subscribe: Store['subscribe'],
    getSnapshot: Store['getSnapshot'],
  ) => {
    store = { subscribe, getSnapshot };
    return getSnapshot();
  },
}));

const native = {
  isReduceTransparencyEnabled: vi.fn(),
  addEventListener: vi.fn(),
};
let platform = 'ios';

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceTransparencyEnabled: () => native.isReduceTransparencyEnabled(),
    addEventListener: (...args: unknown[]) => native.addEventListener(...args),
  },
  get Platform() {
    return { OS: platform };
  },
}));

/**
 * Fresh module, fresh singletons. Returns the hook's store.
 *
 * **The hook is called from `Probe`, and that is not cosmetic.**
 * `react-hooks/rules-of-hooks` rejects a hook called from a plain helper, and
 * then — once the helper is renamed `use…` — rejects it again for being called
 * in an `async` function. Both objections are correct, and this is the rule
 * `CLAUDE.md` §1 says the linter was installed for, so it is satisfied rather
 * than switched off for tests. `Probe` is a real (if minimal) function
 * component: the module import stays in the async helper, and the hook call
 * happens where a hook call belongs.
 */
async function mountProbe(): Promise<Store> {
  vi.resetModules();
  const module = await import('./reducedTransparency');
  const Probe = () => module.useReducedTransparency();
  Probe();
  const mounted = store;
  if (!mounted) throw new Error('the hook did not reach useSyncExternalStore');
  return mounted;
}

beforeEach(() => {
  store = null;
  platform = 'ios';
  native.isReduceTransparencyEnabled.mockReset();
  native.addEventListener.mockReset();
  native.isReduceTransparencyEnabled.mockResolvedValue(false);
});

describe('useReducedTransparency — native', () => {
  it('starts false, so a surface renders as glass before the read lands', async () => {
    const { getSnapshot } = await mountProbe();
    expect(getSnapshot()).toBe(false);
  });

  it('publishes the platform read to subscribers', async () => {
    native.isReduceTransparencyEnabled.mockResolvedValue(true);
    const { subscribe, getSnapshot } = await mountProbe();
    const listener = vi.fn();
    subscribe(listener);
    await vi.waitFor(() => expect(getSnapshot()).toBe(true));
    expect(listener).toHaveBeenCalled();
  });

  it('follows the setting being turned on after launch', async () => {
    const { subscribe, getSnapshot } = await mountProbe();
    const listener = vi.fn();
    subscribe(listener);
    const [event, handler] = native.addEventListener.mock.calls[0] as [
      string,
      (value: boolean) => void,
    ];
    expect(event).toBe('reduceTransparencyChanged');
    handler(true);
    expect(getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalled();
  });

  it('reads the platform once however many surfaces subscribe', async () => {
    // The reason this is a shared store at all. A tab bar plus four buttons
    // each doing its own accessibility read is work on the main thread at
    // exactly the moment a screen is arriving.
    const { subscribe } = await mountProbe();
    subscribe(vi.fn());
    subscribe(vi.fn());
    subscribe(vi.fn());
    expect(native.isReduceTransparencyEnabled).toHaveBeenCalledTimes(1);
    expect(native.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the value has not changed', async () => {
    const { subscribe } = await mountProbe();
    const listener = vi.fn();
    subscribe(listener);
    const [, handler] = native.addEventListener.mock.calls[0] as [
      string,
      (value: boolean) => void,
    ];
    handler(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying a listener that unsubscribed', async () => {
    const { subscribe, getSnapshot } = await mountProbe();
    const listener = vi.fn();
    subscribe(listener)();
    const [, handler] = native.addEventListener.mock.calls[0] as [
      string,
      (value: boolean) => void,
    ];
    handler(true);
    expect(getSnapshot()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('survives a platform that rejects the read', async () => {
    // Android has no such switch. A material that cannot ask should stay glass,
    // not take the screen down with it.
    native.isReduceTransparencyEnabled.mockRejectedValue(new Error('no such API'));
    const { subscribe, getSnapshot } = await mountProbe();
    expect(() => subscribe(vi.fn())).not.toThrow();
    expect(getSnapshot()).toBe(false);
  });
});

describe('useReducedTransparency — web', () => {
  const media = (matches: boolean) => {
    const listeners: ((event: { matches: boolean }) => void)[] = [];
    return {
      query: null as string | null,
      list: {
        matches,
        addEventListener: (_: string, fn: (event: { matches: boolean }) => void) =>
          listeners.push(fn),
      },
      fire: (value: boolean) => listeners.forEach((fn) => fn({ matches: value })),
    };
  };

  beforeEach(() => {
    platform = 'web';
  });

  it('reads prefers-reduced-transparency and never touches the native API', async () => {
    const m = media(true);
    vi.stubGlobal('window', {
      matchMedia: (query: string) => {
        m.query = query;
        return m.list;
      },
    });
    const { subscribe, getSnapshot } = await mountProbe();
    subscribe(vi.fn());
    expect(m.query).toBe('(prefers-reduced-transparency: reduce)');
    expect(getSnapshot()).toBe(true);
    expect(native.isReduceTransparencyEnabled).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('follows the query changing', async () => {
    const m = media(false);
    vi.stubGlobal('window', { matchMedia: () => m.list });
    const { subscribe, getSnapshot } = await mountProbe();
    const listener = vi.fn();
    subscribe(listener);
    m.fire(true);
    expect(getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('stays glass in a browser with no matchMedia', async () => {
    vi.stubGlobal('window', {});
    const { subscribe, getSnapshot } = await mountProbe();
    expect(() => subscribe(vi.fn())).not.toThrow();
    expect(getSnapshot()).toBe(false);
    vi.unstubAllGlobals();
  });
});
