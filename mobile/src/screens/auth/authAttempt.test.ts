import { afterEach, describe, expect, it, vi } from 'vitest';

import { ATTEMPT_STALLED, settleAuthCall } from './authAttempt';

/**
 * The rule that decides whether a musician is told their sign-in failed.
 *
 * Every case here is one of the two ways a session the server granted was
 * reported as a failure — see the module's own docstring for the measurement.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('settleAuthCall', () => {
  it('believes a call that returned', async () => {
    const settled = await settleAuthCall({
      run: async () => ({ awaitingConfirmation: true }),
      signedIn: async () => {
        throw new Error('never asked — the call had the answer');
      },
    });

    expect(settled).toEqual({ kind: 'done', value: { awaitingConfirmation: true } });
  });

  it('does not report a failure when the session exists anyway', async () => {
    // Supabase saves the session and notifies its listeners inside the sign-in
    // call. A throw from either step is rethrown at the caller, over a session
    // that is already on disk.
    const settled = await settleAuthCall({
      run: async () => {
        throw new Error('the store refused to write');
      },
      signedIn: async () => true,
    });

    expect(settled).toEqual({ kind: 'signedIn' });
  });

  it('passes the error on when there is no session to show for it', async () => {
    const credentials = new Error('Invalid login credentials');

    const settled = await settleAuthCall({
      run: async () => {
        throw credentials;
      },
      signedIn: async () => false,
    });

    expect(settled).toEqual({ kind: 'failed', error: credentials });
  });

  it('stops waiting on a call that never comes back', async () => {
    vi.useFakeTimers();

    const settled = settleAuthCall({
      run: () => new Promise(() => {}),
      signedIn: async () => false,
      deadlineMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1500);

    expect(await settled).toEqual({ kind: 'stalled' });
  });

  it('checks for a session before calling a stall a failure', async () => {
    // The write landed and the listeners fired; only the promise is stuck. The
    // app is already showing the library behind this screen.
    vi.useFakeTimers();

    const settled = settleAuthCall({
      run: () => new Promise(() => {}),
      signedIn: async () => true,
      deadlineMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1500);

    expect(await settled).toEqual({ kind: 'signedIn' });
  });

  it('treats a session check that throws as no session', async () => {
    const cause = new Error('the store is unreadable');

    const settled = await settleAuthCall({
      run: async () => {
        throw cause;
      },
      signedIn: async () => {
        throw new Error('and the check cannot reach it either');
      },
    });

    // The call's own error, not the check's: one of them is a sentence the
    // musician can act on.
    expect(settled).toEqual({ kind: 'failed', error: cause });
  });

  it('never leaves its deadline armed', async () => {
    vi.useFakeTimers();

    await settleAuthCall({
      run: async () => 'done',
      signedIn: async () => false,
      deadlineMs: 1000,
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('has something to say when it gives up', () => {
    expect(ATTEMPT_STALLED).toMatch(/try again/i);
  });
});
