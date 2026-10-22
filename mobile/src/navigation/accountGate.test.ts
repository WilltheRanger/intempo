import { describe, expect, it } from 'vitest';

import source from './RootNavigator.tsx?raw';

/**
 * The signed-in app stays mounted through a failed refetch of the account.
 *
 * **`isError` is true with the account in hand.** A query whose *next* fetch
 * rejects keeps its data and reports `isError` (`lib/loadState.ts` has the
 * measurement). The gate in `SignedInApp` read `isError || !me`, so one dropped
 * connection — the refetch after a take is accepted, or the first refetch of a
 * profile restored from the device with no signal — swapped the whole
 * navigator for the startup error screen, and a Record screen unmounted
 * mid-take with it.
 *
 * Read as source text because there is no React Native testing library here
 * (`DECISIONS.md`, 2026-08-24); the rule itself is `loadStateFor`, which
 * `lib/loadState.test.ts` holds.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('the signed-in gate', () => {
  const code = withoutComments(source);

  it('decides on whether the account has arrived, not on the last fetch', () => {
    expect(code).toContain('loadStateFor(');
  });

  it('does not treat a failed refetch as a missing account', () => {
    expect(code).not.toMatch(/isError\s*\|\|/);
  });
});
