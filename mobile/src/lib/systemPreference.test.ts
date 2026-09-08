import { describe, expect, it, vi } from 'vitest';

import { systemPreference } from './systemPreference';

describe('systemPreference', () => {
  it('reads false until the platform says otherwise', () => {
    const store = systemPreference(() => {});
    expect(store.getSnapshot()).toBe(false);
  });

  it('starts watching once, however many subscribe', () => {
    const watch = vi.fn();
    const store = systemPreference(watch);

    const stop = store.subscribe(() => {});
    store.subscribe(() => {});
    store.subscribe(() => {});

    expect(watch).toHaveBeenCalledTimes(1);

    // And not again after the first subscriber leaves. The app's answer to
    // "is Reduce Motion on" outlives any one screen; re-reading on every
    // navigation is the cost this shape exists to avoid.
    stop();
    store.subscribe(() => {});
    expect(watch).toHaveBeenCalledTimes(1);
  });

  it('does not watch at all until something subscribes', () => {
    const watch = vi.fn();
    systemPreference(watch);
    expect(watch).not.toHaveBeenCalled();
  });

  it('tells every listener when the value changes', () => {
    let publish = (_value: boolean) => {};
    const store = systemPreference((p) => {
      publish = p;
    });
    const first = vi.fn();
    const second = vi.fn();
    store.subscribe(first);
    store.subscribe(second);

    publish(true);

    expect(store.getSnapshot()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('says nothing when the value has not moved', () => {
    /**
     * `reduceTransparencyChanged` and its neighbours are not promised to fire
     * only for their own setting, and a store that re-rendered the app on
     * every accessibility change would undo the point of having one listener.
     */
    let publish = (_value: boolean) => {};
    const store = systemPreference((p) => {
      publish = p;
    });
    const listener = vi.fn();
    store.subscribe(listener);

    publish(false);
    expect(listener).not.toHaveBeenCalled();

    publish(true);
    publish(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops telling a listener that has unsubscribed', () => {
    let publish = (_value: boolean) => {};
    const store = systemPreference((p) => {
      publish = p;
    });
    const staying = vi.fn();
    const leaving = vi.fn();
    store.subscribe(staying);
    const stop = store.subscribe(leaving);

    stop();
    publish(true);

    expect(staying).toHaveBeenCalledTimes(1);
    expect(leaving).not.toHaveBeenCalled();
  });

  it('keeps its snapshot function usable when passed unbound', () => {
    /** `useSyncExternalStore(store.subscribe, store.getSnapshot, …)` passes
     * both without a receiver, so neither may depend on `this`. */
    let publish = (_value: boolean) => {};
    const store = systemPreference((p) => {
      publish = p;
    });
    const { subscribe, getSnapshot } = store;

    subscribe(() => {});
    publish(true);

    expect(getSnapshot()).toBe(true);
  });
});
