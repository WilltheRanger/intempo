import { describe, expect, it, vi } from 'vitest';

// `client.ts` reaches `../auth/session`, which reaches react-native — the same
// stand-in `client.test.ts` uses, for the same reason.
vi.mock('../auth/session', () => ({
  getAccessToken: () => Promise.resolve('token'),
  signOut: async () => {},
}));

import clientSource from './client.ts?raw';
import { ApiError } from './client';
import { describeLoadError } from './describeError';

/**
 * The sentence a musician reads when a screen will not load.
 *
 * This module exists because five screens hardcoded *"Check your connection
 * and try again"* for every failure there is — and then it did the same thing
 * one level down. `client.ts` writes four different sentences for the four
 * ways a request can fail before it gets a status, and all four arrived here
 * as `status === 0` and left as "check your connection".
 *
 * The expensive one is the host waking up. This app's backend sleeps, so
 * "It may be waking up — try again in a moment" is the failure a musician
 * meets most often, and the advice they got instead was to go and look at
 * their wifi.
 */

/** The four sentences `client.ts` writes itself, verbatim from the source. */
function authoredMessages(): string[] {
  // Read out of the source rather than retyped: a copy here would keep
  // passing after the real sentence changed, which is the failure mode this
  // whole file is about.
  const constants = [...clientSource.matchAll(/^const (?:SESSION_UNREADABLE|RESPONSE_STALLED) =\s*\n?\s*'([^']+)'/gm)]
    .map((m) => m[1]);
  const inline = [...clientSource.matchAll(/new ApiError\(\s*0,\s*path,\s*\n\s*'([^']+)'/g)].map(
    (m) => m[1],
  );
  return [...constants, ...inline];
}

describe('what a failed screen says', () => {
  it('reads four authored sentences out of the client', () => {
    // Every case below is driven from this list; an empty one would pass them
    // all while checking nothing.
    expect(authoredMessages()).toHaveLength(4);
  });

  it('passes each of them through untouched', () => {
    for (const message of authoredMessages()) {
      expect(describeLoadError(new ApiError(0, '/v1/scores', message))).toBe(message);
    }
  });

  it('keeps the waking-host sentence, which is the common one', () => {
    const waking = authoredMessages().find((m) => /waking up/.test(m));
    expect(waking, 'client.ts no longer names a waking host').toBeTruthy();
    expect(describeLoadError(new ApiError(0, '/v1/scores', waking as string))).toContain(
      'waking up',
    );
  });

  it('never hands a musician a sentence the server wrote', () => {
    /*
     * The rule that makes reading `error.message` safe: status 0 is minted
     * only in `client.ts`, and only with a sentence written here. A future
     * `new ApiError(0, path, message)` — `message` being the parsed `detail`
     * from a response — would put FastAPI's words on a screen, and nothing
     * else in this tree would notice.
     */
    const zeroes = [...clientSource.matchAll(/new ApiError\(\s*0,\s*path,\s*\n?\s*([^,)]+)/g)].map(
      (m) => m[1].trim(),
    );
    expect(zeroes.length).toBeGreaterThanOrEqual(4);
    for (const argument of zeroes) {
      // A quoted sentence, or a SCREAMING_CASE constant defined in this file.
      expect(argument, argument).toMatch(/^('|[A-Z][A-Z0-9_]*$)/);
    }
  });

  it('still names the failures a status can explain', () => {
    expect(describeLoadError(new ApiError(401, '/x', 'x'))).toMatch(/session has ended/i);
    expect(describeLoadError(new ApiError(403, '/x', 'x'))).toMatch(/isn't yours/i);
    expect(describeLoadError(new ApiError(404, '/x', 'x'))).toMatch(/isn't there/i);
    expect(describeLoadError(new ApiError(500, '/x', 'x'))).toMatch(/not something you did/i);
    expect(describeLoadError(new ApiError(503, '/x', 'x'))).toMatch(/not something you did/i);
  });

  it('does not repeat what the server said for a status it does not know', () => {
    // A 422's `detail` is a validation error naming a field. Useful to me,
    // useless on a screen, and this is the line that keeps it off one.
    const said = describeLoadError(
      new ApiError(422, '/x', "body -> tempo_bpm: value is not a valid integer"),
    );
    expect(said).toBe('Check your connection and try again.');
  });

  it('says the same for anything that is not an ApiError', () => {
    // `fetch` rejects with a bare `TypeError` for a dropped connection, a DNS
    // failure and a CORS refusal alike, so connection is the useful guess.
    expect(describeLoadError(new TypeError('Failed to fetch'))).toBe(
      'Check your connection and try again.',
    );
    expect(describeLoadError(undefined)).toBe('Check your connection and try again.');
  });
});
