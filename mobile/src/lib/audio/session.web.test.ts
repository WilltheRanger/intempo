import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareForPlayback } from './session.web';

/**
 * Making the browser audible on a phone that is on silent.
 *
 * The module's own docstring says what a test here can and cannot do: *"What
 * can be checked here is that it is called on every path that makes a sound,
 * and that it cannot throw."* Neither half was checked. This file holds the
 * second; `session.reach.test.ts` holds the first.
 *
 * The thing itself — whether a phone with the ring switch flipped makes a
 * noise — needs an iPhone, and there is none in this environment. What is
 * knowable without one is that the app **asks**: Safari applies the ring/silent
 * switch to Web Audio, `navigator.audioSession.type = 'playback'` is the only
 * way to opt out of it, and a build that stops asking is silent for most
 * musicians in most practice rooms with nothing failing anywhere.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what it asks the browser for', () => {
  it("declares this page's audio to be the point, not an incidental noise", async () => {
    // 'playback' and not 'play-and-record': the recorder owns its own session,
    // and the recording category drops output to receiver volume for no gain.
    const session = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession: session });

    await prepareForPlayback();

    expect(session.type).toBe('playback');
  });
});

describe('what it does where there is nothing to ask', () => {
  it('says nothing on a browser with no audio session at all', async () => {
    // Everything but Safari 16.4+. There is no ring switch to override, so
    // doing nothing is the whole correct behaviour.
    const navigator = {};
    vi.stubGlobal('navigator', navigator);

    await expect(prepareForPlayback()).resolves.toBeUndefined();
    expect(navigator).toEqual({});
  });

  it('says nothing where there is no navigator', async () => {
    // Server-side rendering, and the module graph a native build resolves.
    vi.stubGlobal('navigator', undefined);

    await expect(prepareForPlayback()).resolves.toBeUndefined();
  });
});

describe('what it does when the browser refuses', () => {
  it('never throws, because the caller is about to make a noise', async () => {
    // A browser that exposes the object and rejects the value. Every caller is
    // inside a button press that is meant to start a sound; a throw there
    // takes the press down, which is a worse version of the bug this module
    // exists to fix — the label flips and nothing plays.
    vi.stubGlobal('navigator', {
      audioSession: {
        set type(_value: string) {
          throw new Error('not a settable type');
        },
        get type() {
          return 'auto';
        },
      },
    });

    await expect(prepareForPlayback()).resolves.toBeUndefined();
  });
});
