import { describe, expect, it, vi } from 'vitest';

// `client.ts` reaches `../auth/session`, which reaches react-native — the same
// stand-in `client.test.ts` and `describeError.test.ts` use.
vi.mock('./auth/session', () => ({
  getAccessToken: () => Promise.resolve('token'),
  signOut: async () => {},
}));

import { ApiError } from './api/client';
import { createQueryClient, retryQuery, STALE_TIME_MS } from './queryClient';

/**
 * The two retry policies, and why they are worth a test.
 *
 * Both lived as a `const` in `App.tsx` with a paragraph of reasoning above
 * them and nothing holding either. They are invisible to every other check in
 * this repository: a walk cannot stage a request that times out after the
 * server already ran it, and a screenshot of a skeleton looks the same at one
 * second and at three minutes.
 *
 * The failure they prevent is not cosmetic. React Query's default is one retry
 * for **queries and mutations alike** — so the value that has to keep being
 * `false` is the one standing between a musician and a second take they never
 * recorded.
 */

/** A failure with a status: the server answered, and answered this. */
function answered(status: number): ApiError {
  return new ApiError(status, '/v1/pieces', `Request failed (${status})`);
}

describe('retryQuery', () => {
  it('never asks again about anything the server answered', () => {
    for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
      expect(retryQuery(0, answered(status))).toBe(false);
    }
  });

  it('never asks again about a request that failed before it got a status', () => {
    // `send` writes these itself, after two attempts of its own. Status 0 is
    // the *most* expensive one to repeat — ninety seconds have already gone.
    expect(retryQuery(0, new ApiError(0, '/v1/pieces', 'It may be waking up'))).toBe(
      false,
    );
  });

  it('gives an unrecognised failure exactly one more go', () => {
    const unfamiliar = new TypeError('Load failed');
    expect(retryQuery(0, unfamiliar)).toBe(true);
    expect(retryQuery(1, unfamiliar)).toBe(false);
    expect(retryQuery(2, unfamiliar)).toBe(false);
  });
});

describe('the client the app runs on', () => {
  it('asks a failing query once when the server answered, and twice otherwise', async () => {
    const attemptsFor = async (thrown: unknown): Promise<number> => {
      let attempts = 0;
      const client = createQueryClient();
      await client
        .fetchQuery({
          queryKey: ['attempts', String(attempts), Math.random()],
          queryFn: () => {
            attempts += 1;
            return Promise.reject(thrown);
          },
          // The delay is not what is under test, and React Query's default
          // backoff would put a real second between the two attempts below.
          retryDelay: 0,
        })
        .catch(() => {});
      return attempts;
    };

    // Driven through `fetchQuery` rather than read off `getDefaultOptions`,
    // because the thing that matters is what the retryer does with the policy.
    expect(await attemptsFor(answered(404))).toBe(1);
    expect(await attemptsFor(new TypeError('Load failed'))).toBe(2);
  });

  it('never repeats a write', () => {
    // Asserted as configuration rather than driven, because a mutation needs
    // an observer and there is no React testing library here (`DECISIONS.md`,
    // 2026-08-24) — and because `false` has nothing between it and the
    // library. Anything else, including React Query's default of `1`, is the
    // duplicate take.
    const mutations = createQueryClient().getDefaultOptions().mutations;
    expect(mutations?.retry).toBe(false);
  });

  it('holds a fetched answer long enough that moving around the app is free', () => {
    const queries = createQueryClient().getDefaultOptions().queries;
    // Zero is React Query's default and is the bug: every screen refetches on
    // every visit. An hour would be a screen going visibly out of date.
    expect(typeof queries?.staleTime).toBe('number');
    expect(queries?.staleTime).toBe(STALE_TIME_MS);
    expect(STALE_TIME_MS).toBeGreaterThan(0);
    expect(STALE_TIME_MS).toBeLessThanOrEqual(120_000);
  });

  it('does not refetch every screen when the window regains focus', () => {
    // On the web build this fires on every tab switch and every click back
    // into the window, against a host that sleeps.
    expect(createQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBe(
      false,
    );
  });

  it('gives each caller its own cache', () => {
    // The factory exists so a test is not sharing the app's client. If it ever
    // returned a singleton, these tests would start affecting each other in
    // ways that look like flakiness rather than like this.
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});
