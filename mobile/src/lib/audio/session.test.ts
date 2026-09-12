import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The device audio session, on the platform the app actually ships on.
 *
 * Its sibling `session.web.test.ts` says why this cannot be verified properly:
 * the thing it exists for is whether a phone with the ring switch flipped
 * makes a sound, and there is no phone here. What is knowable is **what the
 * app asks iOS for** — and `playsInSilentMode` is not a preference, it is the
 * entire fix. An unconfigured session obeys the switch, which is how Listen
 * came to play nothing at all for a musician in a quiet practice room.
 *
 * Each field below is asserted separately, with the failure it prevents, so a
 * regression names the symptom rather than printing an object diff.
 */

const calls: Record<string, unknown>[] = [];
let rejects = false;

vi.mock('expo-audio', () => ({
  setAudioModeAsync: async (mode: Record<string, unknown>) => {
    calls.push(mode);
    if (rejects) {
      throw new Error('no audio session on this runtime');
    }
  },
}));

async function prepare() {
  const { prepareForPlayback } = await import('./session');
  return prepareForPlayback();
}

beforeEach(() => {
  calls.length = 0;
  rejects = false;
  vi.resetModules();
});

describe('what it asks iOS for', () => {
  it('asks to be audible on silent — the reason this module exists', async () => {
    await prepare();

    expect(calls).toHaveLength(1);
    expect(calls[0].playsInSilentMode).toBe(true);
  });

  it('asks not to be mixed with, so another app cannot duck the click', async () => {
    // A metronome is not a sound effect. A click another app can duck is a
    // click that disappears under the beat it is supposed to give you.
    await prepare();

    expect(calls[0].interruptionMode).toBe('doNotMix');
  });

  it('does not ask for the recording category', async () => {
    // iOS drops output to receiver-level volume in `.playAndRecord`. Nothing
    // here records — the recorder configures its own session — so asking would
    // only make playback quieter.
    await prepare();

    expect(calls[0].allowsRecording).toBe(false);
  });

  it('does not claim background audio the build cannot deliver', async () => {
    // Background playback needs `UIBackgroundModes` in `app.json`, which this
    // app does not declare. Claiming it here is a promise the build breaks.
    await prepare();

    expect(calls[0].shouldPlayInBackground).toBe(false);
  });
});

describe('when the runtime has no session to set', () => {
  it('never throws, because failing to configure is a reason to be quiet, not to break', async () => {
    rejects = true;

    await expect(prepare()).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});
