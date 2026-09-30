import { GoTrueClient } from '@supabase/auth-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SKEW_TOLERANCE_MS,
  clockAwareFetch,
  clockAwareStore,
  clockSkewMs,
  correctStoredSession,
  recordTokenResponse,
  resetClockSkewForTests,
} from './clockSkew';
import type { SessionStore } from './sessionStore';

const HOUR_MS = 3_600_000;

afterEach(() => {
  resetClockSkewForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('recordTokenResponse', () => {
  it('reads the clocks from when the server says it issued the token', () => {
    // Issued at server second 1000, received at device second 4600.
    recordTokenResponse({ expires_at: 4600, expires_in: 3600 }, 4_600_000);
    expect(clockSkewMs()).toBe(HOUR_MS);
  });

  it('reads a slow clock as negative', () => {
    recordTokenResponse({ expires_at: 8200, expires_in: 3600 }, 1_000_000);
    expect(clockSkewMs()).toBe(-HOUR_MS);
  });

  it('treats a difference under a minute as a right clock', () => {
    recordTokenResponse({ expires_at: 4600, expires_in: 3600 }, 1_000_000 + SKEW_TOLERANCE_MS - 1);
    expect(clockSkewMs()).toBe(0);
  });

  it('learns nothing from a body that is not a session', () => {
    recordTokenResponse({ id: 'u1', email: 'a@b.c' }, 99_000_000);
    recordTokenResponse(null, 99_000_000);
    recordTokenResponse('expires_at', 99_000_000);
    expect(clockSkewMs()).toBe(0);
  });
});

describe('correctStoredSession', () => {
  const stored = JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 5000 });

  it('moves expiry into the device’s time', () => {
    const corrected = JSON.parse(correctStoredSession(stored, HOUR_MS)!);
    expect(corrected.expires_at).toBe(8600);
    expect(corrected.refresh_token).toBe('r');
  });

  it('is never applied twice to a session the client writes back', () => {
    const once = correctStoredSession(stored, HOUR_MS);
    const twice = JSON.parse(correctStoredSession(once, HOUR_MS)!);
    expect(twice.expires_at).toBe(8600);
  });

  it('hands back the server’s expiry once the clock is right again', () => {
    const corrected = correctStoredSession(stored, HOUR_MS);
    expect(JSON.parse(correctStoredSession(corrected, 0)!).expires_at).toBe(5000);
  });

  it('leaves a session on a right clock exactly as stored', () => {
    expect(correctStoredSession(stored, 0)).toBe(stored);
  });

  it('passes anything else through untouched', () => {
    expect(correctStoredSession(null, HOUR_MS)).toBeNull();
    expect(correctStoredSession('not json', HOUR_MS)).toBe('not json');
    expect(correctStoredSession('"a string"', HOUR_MS)).toBe('"a string"');
    const pkce = JSON.stringify({ code_verifier: 'x' });
    expect(correctStoredSession(pkce, HOUR_MS)).toBe(pkce);
  });
});

describe('clockAwareFetch', () => {
  it('reads a session off an auth response and hands the body back unread', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(4_600_000);
    const body = { access_token: 'a', expires_at: 4600, expires_in: 3600 };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)));
    const response = await clockAwareFetch('https://x.supabase.co/auth/v1/token?grant_type=password');
    expect(await response.json()).toEqual(body);
    expect(clockSkewMs()).toBe(HOUR_MS);
  });

  it('does not read other responses', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(4_600_000);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ expires_at: 4600, expires_in: 3600 })));
    await clockAwareFetch('https://api.example.com/v1/me');
    expect(clockSkewMs()).toBe(0);
  });

  it('survives a response with no body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    const response = await clockAwareFetch('https://x.supabase.co/auth/v1/logout');
    expect(response.status).toBe(204);
  });
});

/**
 * The real auth client, against a stand-in auth server, on a device whose clock
 * is wrong. This is the reproduction behind the module (2026-09-30): each
 * `getSession()` is what `getAccessToken` does before an API request.
 */
describe('the auth client on a wrong clock', () => {
  let serverSeconds: number;
  let deviceAheadMs: number;
  let refreshes: number;
  let issued: number;

  function tokenResponse() {
    issued += 1;
    return {
      access_token: `token-${issued}`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: serverSeconds + 3600,
      refresh_token: `refresh-${issued}`,
      user: { id: 'u1', aud: 'authenticated', email: 'a@b.c' },
    };
  }

  beforeEach(() => {
    serverSeconds = 2_000_000_000;
    refreshes = 0;
    issued = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => serverSeconds * 1000 + deviceAheadMs);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('grant_type=refresh_token')) {
          refreshes += 1;
          // Supabase's answer to a storm, which is where the session was lost.
          if (refreshes > 30) {
            return Response.json({ error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' }, { status: 429 });
          }
        }
        return Response.json(tokenResponse());
      }),
    );
  });

  function memoryStore(): SessionStore {
    const items = new Map<string, string>();
    return {
      getItem: async (key) => items.get(key) ?? null,
      setItem: async (key, value) => {
        items.set(key, value);
      },
      removeItem: async (key) => {
        items.delete(key);
      },
    };
  }

  function client(storage: SessionStore, storageKey: string, corrected = true) {
    return new GoTrueClient({
      url: 'https://x.supabase.co/auth/v1',
      storageKey,
      storage: corrected ? clockAwareStore(storage) : storage,
      fetch: corrected ? clockAwareFetch : (input, init) => fetch(input, init),
      autoRefreshToken: false,
      persistSession: true,
      lock: async (_name, _timeout, fn) => fn(),
    });
  }

  async function signedIn(corrected: boolean) {
    const auth = client(memoryStore(), `sb-test-${Math.random()}`, corrected);
    await auth.initialize();
    await auth.signInWithPassword({ email: 'a@b.c', password: 'x' });
    return auth;
  }

  async function requests(client: GoTrueClient, count: number) {
    const tokens: (string | null)[] = [];
    for (let i = 0; i < count; i += 1) {
      const { data } = await client.getSession();
      tokens.push(data.session?.access_token ?? null);
    }
    return tokens;
  }

  it('storms and signs out an hour fast without the correction', async () => {
    deviceAheadMs = HOUR_MS;
    const tokens = await requests(await signedIn(false), 40);
    expect(refreshes).toBeGreaterThan(30);
    expect(tokens).toContain(null);
  });

  it.each([
    ['an hour fast', HOUR_MS],
    ['an hour slow', -HOUR_MS],
    ['three hours fast', 3 * HOUR_MS],
    ['right', 0],
  ])('keeps one session and does not refresh on a clock %s', async (_label, ahead) => {
    deviceAheadMs = ahead;
    const tokens = await requests(await signedIn(true), 40);
    expect(refreshes).toBe(0);
    expect(new Set(tokens)).toEqual(new Set(['token-1']));
  });

  it('refreshes once after a restart, which is how it learns the clock again', async () => {
    deviceAheadMs = HOUR_MS;
    const storage = memoryStore();
    const first = client(storage, 'sb-restart');
    await first.initialize();
    await first.signInWithPassword({ email: 'a@b.c', password: 'x' });
    // The app closes: the session stays on disk, the measured clock does not.
    resetClockSkewForTests();
    const second = client(storage, 'sb-restart');
    await second.initialize();
    const tokens = await requests(second, 20);
    expect(refreshes).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(['token-2']));
  });

  it.each([
    ['an hour slow', -HOUR_MS],
    ['an hour fast', HOUR_MS],
  ])('still refreshes before the server’s expiry on a clock %s', async (_label, ahead) => {
    deviceAheadMs = ahead;
    const client = await signedIn(true);
    // Ten seconds inside the refresh margin, by the server's clock: an hour
    // slow, the device would otherwise think fifty-nine minutes remained and
    // send a token the backend refuses a moment later.
    serverSeconds += 3600 - 80;
    const [token] = await requests(client, 1);
    expect(refreshes).toBe(1);
    expect(token).toBe('token-2');
  });
});
