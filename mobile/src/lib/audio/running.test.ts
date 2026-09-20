import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  resumeToRunning,
  type RunnableContext,
} from './running';

/**
 * A context whose state a test drives, and whose `resume()` behaves however
 * the case needs — including WebKit's way, which is to never answer.
 */
function fakeContext(options: {
  start?: AudioContextState;
  /** Become running after this many resume requests. 0 = already there. */
  runsAfter?: number;
  /** 'settles' | 'hangs' | 'rejects' | 'throws' */
  resumeBehaviour?: 'settles' | 'hangs' | 'rejects' | 'throws';
}) {
  const {
    start = 'suspended',
    runsAfter = 1,
    resumeBehaviour = 'settles',
  } = options;
  let state: AudioContextState = start;
  let asks = 0;
  const context: RunnableContext = {
    get state() {
      return state;
    },
    resume() {
      asks += 1;
      if (asks >= runsAfter) {
        state = 'running';
      }
      if (resumeBehaviour === 'hangs') {
        // Never settles. This is the iOS behaviour the module exists for.
        return new Promise<void>(() => {});
      }
      if (resumeBehaviour === 'rejects') {
        return Promise.reject(new Error('NotAllowedError'));
      }
      if (resumeBehaviour === 'throws') {
        throw new Error('InvalidStateError');
      }
      return Promise.resolve();
    },
  };
  return { context, asks: () => asks };
}

/** A clock the test advances, so nothing waits in real time. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe('resumeToRunning', () => {
  it('is true immediately for a context already running, without asking', async () => {
    const { context, asks } = fakeContext({ start: 'running' });
    const clock = fakeClock();

    await expect(resumeToRunning(context, clock)).resolves.toBe(true);
    expect(asks()).toBe(0);
  });

  /**
   * **The bug.** `audioRecorder.web.ts` awaited the resume promise against a
   * five second deadline. On iOS that promise commonly never settles on a
   * context that reaches `running` anyway, so the deadline won and a musician
   * was told "Audio did not start" while the microphone was open and the
   * context was running.
   */
  it('is true when the context runs but resume() never settles', async () => {
    const { context } = fakeContext({ resumeBehaviour: 'hangs' });
    const clock = fakeClock();

    await expect(resumeToRunning(context, clock)).resolves.toBe(true);
  });

  it('is true when resume() rejects but the context runs anyway', async () => {
    const { context } = fakeContext({ resumeBehaviour: 'rejects' });

    await expect(resumeToRunning(context, fakeClock())).resolves.toBe(true);
  });

  it('is true when resume() throws synchronously but the context runs', async () => {
    /** Some engines throw rather than reject outside a gesture. */
    const { context } = fakeContext({ resumeBehaviour: 'throws' });

    await expect(resumeToRunning(context, fakeClock())).resolves.toBe(true);
  });

  it('keeps asking, because an interrupted context can refuse the first one', async () => {
    const { context, asks } = fakeContext({ runsAfter: 4 });
    const clock = fakeClock();

    await expect(resumeToRunning(context, clock)).resolves.toBe(true);
    expect(asks()).toBe(4);
  });

  it('is false when the deadline passes with the context still suspended', async () => {
    // Never runs, however many times it is asked.
    const { context } = fakeContext({ runsAfter: Number.MAX_SAFE_INTEGER });
    const clock = fakeClock();

    await expect(
      resumeToRunning(context, { ...clock, timeoutMs: 200, pollMs: 50 }),
    ).resolves.toBe(false);
  });

  it('gives up near the deadline rather than looping forever', async () => {
    const { context, asks } = fakeContext({ runsAfter: Number.MAX_SAFE_INTEGER });
    const clock = fakeClock();

    await resumeToRunning(context, { ...clock, timeoutMs: 500, pollMs: 100 });

    // Bounded by timeout/poll, not unbounded. The exact count is an
    // implementation detail; that it is small and finite is the claim.
    expect(asks()).toBeLessThanOrEqual(500 / 100 + 2);
  });

  /**
   * A closed context can never run again. Reported as a failure rather than
   * spun on for the full timeout — nothing is going to change.
   */
  it('does not report a closed context as running', async () => {
    const { context } = fakeContext({
      start: 'closed',
      runsAfter: Number.MAX_SAFE_INTEGER,
    });

    await expect(
      resumeToRunning(context, { ...fakeClock(), timeoutMs: 100, pollMs: 50 }),
    ).resolves.toBe(false);
  });

  it('never throws, so each caller words its own failure', async () => {
    const { context } = fakeContext({
      resumeBehaviour: 'throws',
      runsAfter: Number.MAX_SAFE_INTEGER,
    });

    await expect(
      resumeToRunning(context, { ...fakeClock(), timeoutMs: 100, pollMs: 50 }),
    ).resolves.toBe(false);
  });

  it('defaults are the ones the recorder relies on', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(5_000);
    expect(DEFAULT_POLL_MS).toBe(50);
  });

  it('waits between looks rather than spinning the thread', async () => {
    const { context } = fakeContext({ runsAfter: 3 });
    const sleep = vi.fn(async () => {});
    let t = 0;

    await resumeToRunning(context, {
      sleep,
      now: () => (t += 10),
      pollMs: DEFAULT_POLL_MS,
    });

    expect(sleep).toHaveBeenCalledWith(DEFAULT_POLL_MS);
  });
});
