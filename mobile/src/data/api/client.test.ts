import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A mutable token reader, so one test can make it hang without changing the
// others. `vi.hoisted` because `vi.mock`'s factory is lifted above the imports.
const session = vi.hoisted(() => ({
  token: (): Promise<string | null> => Promise.resolve('token'),
}));

vi.mock('../auth/session', () => ({
  getAccessToken: () => session.token(),
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


/**
 * Two awaits in `apiFetch` had no deadline on them, and either one hangs
 * **forever**.
 *
 * Forever is not a state this app renders. `TodayScreen` shows its skeleton
 * while `currentPiece.isPending` and its error message while `isError`, and a
 * promise that never settles is permanently the first of those — so the screen
 * that has an error branch, and a pull-to-refresh, and a sentence explaining
 * what went wrong, shows none of them. A musician sees grey placeholder bars
 * and nothing else, with no way to act.
 *
 * Reported from a real device: "it always gets stuck in this skeleton screen".
 */
describe('a request that never settles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    session.token = () => Promise.resolve('token');
  });

  it('gives up when the session cannot be read', async () => {
    // `getAccessToken` calls `supabase.auth.getSession`, which refreshes over
    // the network when the token is near expiry. Unbounded, it hangs before
    // the request is sent: nothing on the wire, nothing to time out.
    session.token = () => new Promise(() => {});
    const fetching = vi.fn((_url: string) =>
      Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetching);

    const pending = apiFetch('/v1/scores');
    const settled = expect(pending).rejects.toBeInstanceOf(ApiError);
    await vi.advanceTimersByTimeAsync(11_000);
    await settled;

    // The wake goes out — it is unauthenticated and does not need the token.
    // The request that needed one never does, so nothing was sent twice and
    // nothing was sent without a credential.
    const asked = fetching.mock.calls.map(([url]) => String(url));
    expect(asked.every((url) => url.endsWith('/v1/health'))).toBe(true);
  });

  it('says the session was unreadable rather than that it ended', async () => {
    // Signing someone out here would throw away a session that is probably
    // fine and merely unreachable.
    session.token = () => new Promise(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 })),
      ),
    );

    const pending = apiFetch('/v1/scores');
    const settled = expect(pending).rejects.toThrow(/could not read your session/i);
    await vi.advanceTimersByTimeAsync(11_000);
    await settled;
  });

  /**
   * A response whose headers have arrived and whose body never finishes.
   *
   * The abort is wired to the stream by hand because a `Response` built here
   * is not connected to anything — the platform's `fetch` errors the body when
   * its signal aborts, and that wiring is the behaviour under test. Without
   * it the stub hangs whether the fix is present or not, which would make the
   * test pass by timing out rather than by aborting.
   */
  function headersThenNothing() {
    return vi.fn((_url: string, init: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'));
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
  }

  it('gives up when the headers arrive and the body never does', async () => {
    // The deadline used to be cleared the moment `fetch` resolved — which is
    // when the *headers* land. Everything after that was unguarded.
    vi.stubGlobal('fetch', headersThenNothing());

    const pending = apiFetch('/v1/scores', { authenticated: false });
    const settled = expect(pending).rejects.toBeInstanceOf(ApiError);
    await vi.advanceTimersByTimeAsync(46_000);
    await settled;
  });

  it('blames the body, not the connection, when the body is what stopped', async () => {
    // The server was reached and did answer. "Could not reach the server"
    // would send someone to check a connection that demonstrably works.
    vi.stubGlobal('fetch', headersThenNothing());

    const pending = apiFetch('/v1/scores', { authenticated: false });
    const settled = expect(pending).rejects.toThrow(
      /started answering and then stopped/i,
    );
    await vi.advanceTimersByTimeAsync(46_000);
    await settled;
  });

  it('does not retry a stalled body, even on a GET', async () => {
    // `send`'s retry is for a request that was never *answered*. This one was:
    // headers came back, so the server has it and is working on it. Asking
    // again would double the work on a server that is already struggling.
    const fetching = headersThenNothing();
    vi.stubGlobal('fetch', fetching);

    const pending = apiFetch('/v1/scores', { authenticated: false });
    const settled = expect(pending).rejects.toBeInstanceOf(ApiError);
    await vi.advanceTimersByTimeAsync(46_000);
    await settled;

    expect(fetching).toHaveBeenCalledTimes(1);
  });

  it('still reports a body that is simply not JSON as itself', async () => {
    // A different fault with a different fix. Checked on the abort signal
    // rather than on the error's shape precisely so these stay apart.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>502</html>', { status: 200 }))),
    );

    await expect(
      apiFetch('/v1/scores', { authenticated: false }),
    ).rejects.not.toThrow(/started answering and then stopped/i);
  });
});


describe('the deadlines themselves', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    session.token = () => Promise.resolve('token');
  });

  it('leave nothing armed behind a request that succeeded', async () => {
    // Two timers guard every authenticated request — one on the session read,
    // one on the exchange. Both have to be disarmed when the request is done,
    // and neither failure is visible from the result: a timer left running
    // still rejects, later, into a promise nobody is listening to any more.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
      ),
    );

    await expect(apiFetch('/v1/scores')).resolves.toEqual({ ok: true });

    expect(vi.getTimerCount(), 'a deadline outlived the request it guarded').toBe(0);
  });

  it('leave nothing armed behind an attempt that failed outright', async () => {
    // A connection refused rejects *immediately*, so its deadline has not
    // fired and is still armed. The two timed-out cases hide this: their
    // timers went off on their own, so a missing `clearTimeout` in the catch
    // costs nothing there and the mutation survives. A GET makes two attempts,
    // so a leak here leaves two.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    await expect(
      apiFetch('/v1/scores', { authenticated: false }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('leave nothing armed behind a request that failed', async () => {
    // The error path has its own `clearTimeout` calls, and they are the ones
    // most easily lost in a refactor: nothing downstream reads them.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: 'nope' }), { status: 400 }),
        ),
      ),
    );

    await expect(apiFetch('/v1/scores')).rejects.toBeInstanceOf(ApiError);

    expect(vi.getTimerCount()).toBe(0);
  });
});

/**
 * Waking a host that sleeps, before anything that needs a preflight.
 *
 * Measured against the deployment on 2026-08-25. Every authenticated request
 * costs **two serial round trips**: `Authorization` is not CORS-safelisted, so
 * the browser sends an `OPTIONS` preflight and waits for it before sending
 * anything else. Warm, the Render log shows them 2 seconds apart, all 200, the
 * whole screen in 4 seconds.
 *
 * Cold, the log for a musician opening the app shows **seven `OPTIONS` and not
 * one `GET`**. The preflights queued behind a 75-second boot, the client's
 * 45-second deadline expired while they were still queued, and the browser
 * therefore never sent the real requests at all. `send`'s retry cannot help:
 * the thing stuck in the queue is the browser's preflight, not our request,
 * and aborting ours is what stops the browser proceeding.
 *
 * `/v1/health` is unauthenticated, so it is a *simple* request — one round
 * trip, no preflight, nothing for the browser to give up on.
 *
 * Own module instance per test: the wake is cached across calls on purpose, so
 * without this the first test in the file would decide the rest.
 */
describe('waking the host', () => {
  let mod: typeof import('./client');

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mod = await import('./client');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    session.token = () => Promise.resolve('token');
  });

  function answering() {
    return vi.fn((_url: string) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  }

  it('wakes on a request that carries no credential, so no preflight is needed', async () => {
    const fetching = answering();
    vi.stubGlobal('fetch', fetching);

    await mod.apiFetch('/v1/scores');

    const asked = fetching.mock.calls.map(([url]) => String(url));
    expect(asked[0], 'the wake must go first, and must be the unauthenticated one')
      .toMatch(/\/v1\/health$/);
    expect(asked[1]).toMatch(/\/v1\/scores$/);
  });

  it('wakes once, however many screens ask at the same time', async () => {
    // Today fires five queries on mount. Five wakes would be five cold starts'
    // worth of queueing to save one.
    const fetching = answering();
    vi.stubGlobal('fetch', fetching);

    await Promise.all([
      mod.apiFetch('/v1/scores'),
      mod.apiFetch('/v1/analyses'),
      mod.apiFetch('/v1/me'),
    ]);

    const wakes = fetching.mock.calls.filter(([url]) =>
      String(url).endsWith('/v1/health'),
    );
    expect(wakes).toHaveLength(1);
  });

  it('does not wake for an unauthenticated request, which never needed one', async () => {
    // It carries no `Authorization`, so it has no preflight to be queued
    // behind — and waking from inside the wake would not terminate.
    const fetching = answering();
    vi.stubGlobal('fetch', fetching);

    await mod.apiFetch('/v1/health', { authenticated: false });

    expect(fetching).toHaveBeenCalledTimes(1);
  });

  it('lets the request through even when the wake fails', async () => {
    // **Fails open.** The server may be perfectly awake and the health check
    // merely unlucky. A gate that turns one failed request into every failed
    // request is worse than the cold start it was added for.
    const fetching = vi.fn((url: string) =>
      String(url).endsWith('/v1/health')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetching);

    await expect(mod.apiFetch('/v1/scores')).resolves.toEqual({ ok: true });
  });

  it('tries the wake again after one that failed', async () => {
    // Holding a failed answer for the life of the process would mean one bad
    // moment costs every cold start afterwards.
    // `/v1/health` is a GET, so `send` tries it twice on its own. Both of the
    // first wake's attempts have to fail for the *wake* to have failed —
    // failing only the first lets the retry succeed, the wake is cached, and a
    // mutation that never clears the cache survives. That is what happened.
    //
    // Nothing reaches the host here, the request behind the wake included.
    // That matters: a request that *does* get through is itself proof the host
    // is awake, and the next wake is then skipped rather than cached — see the
    // test below. Only a run in which nothing was heard from leaves the
    // question genuinely unanswered.
    let health = 0;
    const fetching = vi.fn((url: string) => {
      if (String(url).endsWith('/v1/health')) {
        health += 1;
      }
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    vi.stubGlobal('fetch', fetching);

    await expect(mod.apiFetch('/v1/scores')).rejects.toThrow();
    expect(health, 'both attempts of the first wake should have run').toBe(2);

    await expect(mod.apiFetch('/v1/scores')).rejects.toThrow();
    expect(health, 'the failed wake was cached instead of retried').toBe(4);
  });

  it('does not wake again while the API has just been heard from', async () => {
    // The wake answers "might the host be asleep". A request that came back a
    // moment ago answers it better than a health check can, so asking costs a
    // round trip in front of a screen to learn something already known.
    const fetching = answering();
    vi.stubGlobal('fetch', fetching);

    await mod.apiFetch('/v1/scores');
    await mod.apiFetch('/v1/analyses');
    await mod.apiFetch('/v1/me');

    const wakes = fetching.mock.calls.filter(([url]) =>
      String(url).endsWith('/v1/health'),
    );
    expect(wakes, 'the host was awake throughout').toHaveLength(1);
  });

  it('wakes again once the host has been idle long enough to sleep', async () => {
    // **The bug this is here for.** The wake used to be a promise that
    // resolved once and stood for the life of the process, so it protected the
    // first screen of a session and nothing after it. The host sleeps after
    // about fifteen minutes; leave the app open through a lesson and come
    // back, and the first request is exactly what the wake exists to prevent —
    // an authenticated request with a preflight in front of it, queued behind
    // a cold start, abandoned at the deadline before the browser ever sends
    // the real one.
    const fetching = answering();
    vi.stubGlobal('fetch', fetching);

    await mod.apiFetch('/v1/scores');
    expect(
      fetching.mock.calls.filter(([url]) => String(url).endsWith('/v1/health')),
    ).toHaveLength(1);

    // Long enough for the host to have gone back to sleep, and nothing asked
    // in between to keep it up.
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    await mod.apiFetch('/v1/scores');

    expect(
      fetching.mock.calls.filter(([url]) => String(url).endsWith('/v1/health')),
      'a host that has had time to sleep must be woken again',
    ).toHaveLength(2);
  });

  it('gives the wake longer than a normal request, because a cold start is longer', async () => {
    // The measured boot was 75 seconds. A wake held to the ordinary 45 would
    // abort in the same place the preflight did, which is the whole bug.
    let resolveHealth: ((r: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/v1/health')
          ? new Promise<Response>((resolve) => {
              resolveHealth = resolve;
            })
          : Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
      ),
    );

    const pending = mod.apiFetch('/v1/scores');

    // Past the ordinary 45-second deadline and still waiting. Asserted on the
    // *ordering*, not on the eventual result: the wake fails open, so a wake
    // held to 45 seconds still lets the request through and still resolves —
    // it just lets it through into the same queue the preflight died in, which
    // is the entire bug. A mutation shortening this survived a test that only
    // checked the result.
    await vi.advanceTimersByTimeAsync(50_000);
    const early = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => String(call[0]),
    );
    expect(
      early.some((url) => url.endsWith('/v1/scores')),
      'the request went out before the host had finished waking',
    ).toBe(false);

    resolveHealth?.(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    await expect(pending).resolves.toEqual({ ok: true });
  });
});
