import { describe, expect, it } from 'vitest';

// Read as text, not imported: `click.ts` pulls in `expo-audio` and
// `expo-file-system` at module scope, which do not load outside a device. The
// same technique `bootWatchdog.test.ts` uses on an HTML file, for the same
// reason — the alternative is mocking two Expo modules to check one literal.
import nativeSource from './click.ts?raw';
import webSource from './click.web.ts?raw';

/**
 * The half of `ClickTrack` that both platforms have to get right.
 *
 * `leadInS` is not decoration: `useMetronome` hands it to `startBeatClock`, so
 * whatever a click track reports is how long the **on-screen pulse waits**. A
 * platform that reports a lead-in it does not take delays the screen against
 * its own clicks; one that reports none while taking one does the reverse,
 * which is the 100ms mismatch this field was added to fix.
 *
 * Native takes none — it strikes a player from the same kind of timer the
 * pulse uses — and that is a claim worth pinning, because it is one literal
 * and nothing else would notice it changing.
 */

/** Every `leadInS:` value a source file returns. */
function reported(source: string): string[] {
  // The value token only — the inline `{ stop: () => {}, leadInS: 0 }` form
  // would otherwise capture the closing brace with it.
  return [...source.matchAll(/leadInS:\s*([A-Za-z0-9_.]+)/g)].map((m) => m[1]);
}

describe('ClickTrack.leadInS', () => {
  it('is zero on native, on every path out of startClicks', () => {
    const values = reported(nativeSource);

    expect(values.length, 'a return path stopped reporting a lead-in').toBe(2);
    expect(values).toEqual(['0', '0']);
  });

  it('is a real wait on web, and zero when nothing will sound', () => {
    const values = reported(webSource);

    expect(values).toContain('LEAD_IN_S');
    expect(values).toContain('0');
  });

  it('is the same number web books its first click at', () => {
    // Two places, one value: the constant is what the audio clock is offset by
    // and what the beat clock is told to wait. A test elsewhere proves the
    // first click lands there; this proves they are not two constants that
    // happen to agree today.
    expect(webSource).toMatch(/const startedAt = context\.currentTime \+ LEAD_IN_S;/);
    expect(webSource).toMatch(/leadInS: LEAD_IN_S,/);
  });
});
