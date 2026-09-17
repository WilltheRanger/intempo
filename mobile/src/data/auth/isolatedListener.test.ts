import { describe, expect, it, vi } from 'vitest';

import { isolatedListener } from './isolatedListener';

describe('isolatedListener', () => {
  it('passes every argument through untouched', () => {
    const listener = vi.fn();

    isolatedListener(listener)('SIGNED_IN', { user: 'someone' });

    expect(listener).toHaveBeenCalledWith('SIGNED_IN', { user: 'someone' });
  });

  it('swallows a throw, because the caller is a sign-in', () => {
    const listener = (_event: string) => {
      throw new Error('a screen blew up while being told about a session');
    };

    expect(() => isolatedListener(listener)('SIGNED_IN')).not.toThrow();
  });

  it('lets the listeners after it run', () => {
    // auth-js maps over its subscribers and rethrows the first error, so one
    // that escapes takes the sign-in with it whichever listener it came from.
    const after = vi.fn();
    const notify = () => {
      for (const listener of [
        isolatedListener(() => {
          throw new Error('first');
        }),
        isolatedListener(after),
      ]) {
        listener();
      }
    };

    expect(notify).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
  });
});
