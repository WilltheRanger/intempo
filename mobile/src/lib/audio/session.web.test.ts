import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareForCapture, prepareForPlayback } from './session.web';

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
    const session = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession: session });

    await prepareForPlayback();

    expect(session.type).toBe('playback');
  });

  /*
   * **The assertion this pair exists for, and the comment that used to sit
   * where it does.**
   *
   * The test above once carried: *"'playback' and not 'play-and-record': the
   * recorder owns its own session, and the recording category drops output to
   * receiver volume for no gain."* On iOS native that is true. On web it is
   * not — `navigator.audioSession` belongs to the page, the recorder has none
   * of its own, and WebKit refuses `getUserMedia` outright while the page is
   * declared `playback`. Five fixes to the recorder went past it because the
   * refusal names neither this API nor this module.
   *
   * So the category a take runs under is now a rule with a test, and the two
   * values are asserted apart. `play-and-record` and not `auto`: both satisfy
   * WebKit's guard, and only one keeps the ring/silent override the metronome
   * needs while the take is running.
   */
  it('asks for a category a take can actually record under', async () => {
    const session = { type: 'playback' };
    vi.stubGlobal('navigator', { audioSession: session });

    await prepareForCapture();

    expect(session.type).toBe('play-and-record');
  });

  it('hands the page back to playback when the take is over', async () => {
    const session = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession: session });

    await prepareForCapture();
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
    await expect(prepareForCapture()).resolves.toBeUndefined();
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
    // Capture too: a throw here would take down the Record press, which is
    // the failure this whole change is about, arrived at from the other side.
    await expect(prepareForCapture()).resolves.toBeUndefined();
  });
});
