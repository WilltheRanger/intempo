import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/session', () => ({
  getAccessToken: async () => 'token',
  signOut: async () => {},
}));

import { ApiError, apiFetch } from './client';

/**
 * The first request after a quiet period.
 *
 * The API is on a host that sleeps when idle, and its own dashboard warns that
 * waking it "can delay requests by 50 seconds or more" — longer than the
 * client's 45-second deadline. So the first request after any pause was
 * reliably a failure the musician had to retry by hand, on every session.
 *
 * The attempt that times out is also the attempt that *wakes the host*. Asking
 * again lands on a running server.
 */
describe('a request that hears nothing back', () => {
  let calls: number;

  beforeEach(() => {
    calls = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A fetch that aborts when its signal says to, as the platform's does. */
  function neverAnswering(succeedOnAttempt: number | null) {
    return vi.fn((_url: string, init: RequestInit) => {
      calls += 1;
      const attempt = calls;
      return new Promise<Response>((resolve, reject) => {
        if (attempt === succeedOnAttempt) {
          resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
          return;
        }
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
  }

  it('is asked again when asking twice is safe', async () => {
    vi.stubGlobal('fetch', neverAnswering(2));

    const pending = apiFetch('/v1/scores', { authenticated: false });
    // The first attempt hits its deadline; the second answers immediately.
    await vi.advanceTimersByTimeAsync(46_000);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('is not asked again when asking twice would mean it twice', async () => {
    // A POST that timed out may have been received and run, with only its
    // answer lost. Resending it submits a second take.
    vi.stubGlobal('fetch', neverAnswering(2));

    const pending = apiFetch('/v1/analyses', {
      authenticated: false,
      method: 'POST',
      body: { score_id: 'x' },
    });
    const settled = pending.catch((error) => error);
    await vi.advanceTimersByTimeAsync(46_000);

    const error = await settled;
    expect(error).toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  it('gives up after the second attempt, in words a person can act on', async () => {
    vi.stubGlobal('fetch', neverAnswering(null));

    const pending = apiFetch('/v1/scores', { authenticated: false });
    const settled = pending.catch((error) => error);
    await vi.advanceTimersByTimeAsync(46_000 * 2);

    const error = await settled;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).message).toContain('waking up');
    expect(calls).toBe(2);
  });

  it('does not retry a request that was answered', async () => {
    // A 500 is an answer. The server heard, ran, and failed — asking again
    // just fails again, and hides the failure behind a longer wait.
    const answered = vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({ detail: 'boom' }), { status: 500 });
    });
    vi.stubGlobal('fetch', answered);

    const settled = apiFetch('/v1/scores', { authenticated: false }).catch((e) => e);
    const error = await settled;

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect(calls).toBe(1);
  });
});
