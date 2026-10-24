import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextTask } from './nextTask';

describe('nextTask', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('resolves after the work already queued, not in the middle of it', async () => {
    const order: string[] = [];
    const done = nextTask().then(() => order.push('next task'));
    void Promise.resolve().then(() => order.push('microtask'));
    order.push('now');

    await done;
    expect(order).toEqual(['now', 'microtask', 'next task']);
  });

  it('posts itself a message in a browser, which has no setImmediate', async () => {
    // Timers are faked and never fire, so this resolves only if no timer is used.
    vi.stubGlobal('setImmediate', undefined);
    vi.useFakeTimers({ toFake: ['setTimeout'] });

    await expect(nextTask()).resolves.toBeUndefined();
  });

  it('uses setImmediate where there is one, as on React Native', async () => {
    const setImmediate = vi.fn((callback: () => void) => callback());
    vi.stubGlobal('setImmediate', setImmediate);

    await nextTask();
    expect(setImmediate).toHaveBeenCalledTimes(1);
  });

  it('falls back to a timer where there is neither', async () => {
    vi.stubGlobal('MessageChannel', undefined);
    vi.stubGlobal('setImmediate', undefined);
    const setTimeout = vi.fn((callback: () => void) => callback());
    vi.stubGlobal('setTimeout', setTimeout);

    await nextTask();
    expect(setTimeout).toHaveBeenCalledTimes(1);
  });
});
