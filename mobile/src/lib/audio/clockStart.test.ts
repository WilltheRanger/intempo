import { describe, expect, it } from 'vitest';

import {
  clockStopped,
  KICK_AFTER_RUNNING_MS,
  START_TIMEOUT_MS,
  startStep,
  type StartLook,
} from './clockStart';

/**
 * Waiting for a playback's audio clock to move — and the case an iPhone
 * reported on 2026-09-26: `AudioStartTimeout: context running after 2030ms`, a
 * context saying `running` with its clock stopped, which every retry handed
 * back unchanged.
 */

const look = (over: Partial<StartLook>): StartLook => ({
  started: false,
  state: 'running',
  visibleMs: 0,
  runningMs: 0,
  kicked: false,
  ...over,
});

describe('waiting for the audio clock to start', () => {
  it('is done as soon as the clock passes the start, whatever else is true', () => {
    expect(startStep(look({ started: true, visibleMs: 99_999, runningMs: 99_999 }))).toBe(
      'started',
    );
  });

  it('waits while a context is still being resumed', () => {
    // Suspended at the tap and resumed inside it: a moment of `suspended` is
    // normal, and is not a stopped clock.
    expect(startStep(look({ state: 'suspended', visibleMs: 900, runningMs: 0 }))).toBe('wait');
  });

  it('waits out a healthy clock’s first moments', () => {
    // A running clock passes a start scheduled 80 ms ahead in about 80 ms.
    expect(startStep(look({ visibleMs: 300, runningMs: 300 }))).toBe('wait');
  });

  it('kicks a context that has said running for half a second with its clock still', () => {
    expect(
      startStep(look({ visibleMs: KICK_AFTER_RUNNING_MS, runningMs: KICK_AFTER_RUNNING_MS })),
    ).toBe('kick');
  });

  it('times the kick from when it was last seen running, not from the tap', () => {
    // A context that spent a second resuming and has just arrived at running
    // is given the same half second as one that was running at the tap.
    expect(startStep(look({ visibleMs: 1200, runningMs: 100 }))).toBe('wait');
  });

  it('kicks once, then waits for the kick to work', () => {
    expect(startStep(look({ visibleMs: 1500, runningMs: 1500, kicked: true }))).toBe('wait');
  });

  it('gives up at the deadline, in any state', () => {
    for (const state of ['running', 'suspended', 'interrupted']) {
      expect(startStep(look({ state, visibleMs: START_TIMEOUT_MS }))).toBe('give-up');
    }
  });
});

describe('whether a playback that gave up leaves the context unusable', () => {
  it('does when the clock stopped under a running context', () => {
    // No resume can start a context that is already running, so the retry
    // needs a new one.
    expect(clockStopped('running', false)).toBe(true);
  });

  it('does when this playback kicked it, whatever it says now', () => {
    // WebKit may refuse the resume that follows a kick outside a gesture.
    expect(clockStopped('suspended', true)).toBe(true);
  });

  it('does not when it was suspended or interrupted all along', () => {
    // The retry resumes those inside a gesture, which is what they were
    // waiting for; and a new context in a phone call is interrupted too.
    expect(clockStopped('suspended', false)).toBe(false);
    expect(clockStopped('interrupted', false)).toBe(false);
  });
});
