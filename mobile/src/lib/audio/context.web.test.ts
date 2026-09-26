import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  abandonAudioContext,
  audioContext,
  kickAudio,
  resetAudioContextForTests,
  resumeAudio,
} from './context.web';

/**
 * One `AudioContext` for the life of the page.
 *
 * This is a four-line module holding one rule, and the rule is load-bearing:
 * the bug it fixes is *"Listen works the first time and never again"*, which
 * every other part of the app reports as success. The button toggles, the
 * schedule is built, the oscillators are created and started, and there is no
 * sound — so nothing short of a test on this module notices it.
 */

class StubContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  resumes = 0;
  suspends = 0;
  closes = 0;
  resume() {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.suspends += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.closes += 1;
    this.state = 'closed';
    return Promise.resolve();
  }
}

let built: StubContext[];

beforeEach(() => {
  built = [];
  resetAudioContextForTests();
  vi.stubGlobal('window', {
    AudioContext: class extends StubContext {
      constructor() {
        super();
        built.push(this);
      }
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAudioContextForTests();
});

describe('the shared audio context', () => {
  it('hands back the same context however many times it is asked', () => {
    const first = audioContext();
    const second = audioContext();
    const third = audioContext();

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(built).toHaveLength(1);
  });

  it('builds a new one only if the old one has been closed', () => {
    // Nothing in this app closes a context — that is the whole point — but a
    // closed context accepts no nodes at all, so returning one would be the
    // silent failure this module exists to prevent, permanently.
    const first = audioContext();
    (first as unknown as StubContext).state = 'closed';

    expect(audioContext()).not.toBe(first);
    expect(built).toHaveLength(2);
  });

  it('is null where the browser has no Web Audio', () => {
    vi.stubGlobal('window', {});
    resetAudioContextForTests();

    expect(audioContext()).toBeNull();
  });

  it('accepts the webkit-prefixed constructor', () => {
    // Older iOS, which is exactly the platform the sharing rule is for.
    const webkit: StubContext[] = [];
    vi.stubGlobal('window', {
      webkitAudioContext: class extends StubContext {
        constructor() {
          super();
          webkit.push(this);
        }
      },
    });
    resetAudioContextForTests();

    expect(audioContext()).not.toBeNull();
    expect(webkit).toHaveLength(1);
  });

  it('is null rather than a throw when the browser refuses to build one', () => {
    // iOS throws from the constructor once a page is at its context limit,
    // and this is reached from a press handler: a throw there flips the button
    // to Stop and plays nothing, which is a worse version of the bug the
    // sharing rule exists to fix.
    vi.stubGlobal('window', {
      AudioContext: class {
        constructor() {
          throw new Error('too many audio contexts');
        }
      },
    });
    resetAudioContextForTests();

    expect(() => audioContext()).not.toThrow();
    expect(audioContext()).toBeNull();
  });

  it('resumes a suspended context and leaves a running one alone', () => {
    const context = audioContext() as unknown as StubContext;

    resumeAudio(context as unknown as AudioContext);
    expect(context.resumes).toBe(0);

    context.state = 'suspended';
    resumeAudio(context as unknown as AudioContext);
    expect(context.resumes).toBe(1);
  });

  it('never throws when the browser refuses the resume', () => {
    // Some browsers reject a resume outside a user gesture. Every caller is
    // about to make a sound; a refusal is a reason for silence, not for the
    // screen to break.
    const hostile = {
      state: 'suspended',
      resume() {
        throw new Error('not allowed');
      },
    } as unknown as AudioContext;

    expect(() => resumeAudio(hostile)).not.toThrow();
  });
});

describe('a context whose clock stopped (2026-09-26)', () => {
  it('is kicked by suspending it, for the caller to resume', () => {
    const context = audioContext() as unknown as StubContext;

    kickAudio(context as unknown as AudioContext);

    expect(context.suspends).toBe(1);
    expect(context.state).toBe('suspended');
  });

  it('never throws when the browser refuses the kick', () => {
    const hostile = {
      state: 'running',
      suspend() {
        throw new Error('not allowed');
      },
    } as unknown as AudioContext;

    expect(() => kickAudio(hostile)).not.toThrow();
  });

  it('is let go, so the next Listen builds a new one', () => {
    // A retry inside the tap is the one place iOS lets a new context start,
    // and handing the stopped one back again is what made every retry fail.
    const stopped = audioContext() as unknown as StubContext;

    abandonAudioContext(stopped as unknown as AudioContext);

    expect(stopped.closes).toBe(1);
    const next = audioContext();
    expect(next).not.toBe(stopped);
    expect(built).toHaveLength(2);
    // And the new one is shared from then on, like the first.
    expect(audioContext()).toBe(next);
  });

  it('lets go only of the shared one', () => {
    // A playback still holding a context this module has already replaced
    // must not take the new one down with it.
    const old = audioContext() as unknown as StubContext;
    abandonAudioContext(old as unknown as AudioContext);
    const current = audioContext() as unknown as StubContext;

    abandonAudioContext(old as unknown as AudioContext);

    expect(audioContext()).toBe(current);
    expect(current.closes).toBe(0);
    expect(old.closes).toBe(1);
  });
});
