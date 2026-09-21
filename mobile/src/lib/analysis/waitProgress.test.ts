import { describe, expect, it } from 'vitest';

import {
  elapsedLabel,
  isTakingLong,
  LONG_WAIT_MS,
  progressFor,
  STAGES,
} from './waitProgress';
// Imported rather than read off disk, the way `transcriptionProgress.test.ts`
// does it: this project has no `@types/node`, so `readFileSync` does not
// typecheck.
import contract from '../../../../fixtures/stages/analysis.json';

describe('the stages this app knows about', () => {
  /**
   * **The two lists are duplicated across the wire, so hold them together.**
   * A leg added to the runner and forgotten here shows a musician the generic
   * line for the longest part of their wait, which is the exact defect this
   * module exists to fix — and it would do it silently.
   */
  it('are the stages the contract names, in the contract order', () => {
    expect([...STAGES]).toEqual(contract.stages);
  });

  it('places each one where the contract puts it', () => {
    for (const stage of contract.stages) {
      expect(progressFor(stage).through).toBe(
        (contract.through as Record<string, number>)[stage],
      );
    }
  });

  it('advance the bar monotonically and never reach 1 before the run ends', () => {
    let previous = 0;
    for (const stage of STAGES) {
      const { through } = progressFor(stage);
      expect(through).not.toBeNull();
      expect(through!).toBeGreaterThan(previous);
      expect(through!).toBeLessThan(1);
      previous = through!;
    }
  });

  it('give the long leg most of the track', () => {
    // Onset detection is one stage on the wire and about two thirds of the
    // wait in practice. A bar that gave it a fifth would sit at 60% through
    // the majority of the wait, which is the timer-shaped lie in another form.
    const listening = progressFor('listening').through!;
    const before = progressFor('decoding').through!;
    expect(listening - before).toBeGreaterThan(0.5);
  });

  it('name what is happening to the take, not to a file', () => {
    for (const stage of STAGES) {
      const { label } = progressFor(stage);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/upload|server|request|http|json/i);
    }
  });
});

describe('a run the app cannot place', () => {
  /**
   * Null and unknown are the same answer, and it is not zero — an empty bar
   * claims 'nothing has happened yet', which is both stronger than the app
   * knows and exactly what reads as stuck.
   */
  it.each([null, undefined, '', 'transcoding', 'STAGE_FROM_THE_FUTURE'])(
    'draws no bar for %p rather than an empty one',
    (stage) => {
      const { through, label } = progressFor(stage as string | null);
      expect(through).toBeNull();
      expect(label).toBe('Matching what you played against the score');
    },
  );
});

describe('the elapsed clock', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [1_000, '0:01'],
    [9_000, '0:09'],
    [60_000, '1:00'],
    [95_000, '1:35'],
    [155_000, '2:35'],
    [3_600_000, '60:00'],
  ])('renders %ims as %s', (ms, expected) => {
    expect(elapsedLabel(ms)).toBe(expected);
  });

  it('never renders a negative clock', () => {
    expect(elapsedLabel(-5_000)).toBe('0:00');
  });
});

describe('a wait that has gone on', () => {
  it('is not called long before it is', () => {
    // 150s is the measured normal on the deployed instance. Calling that
    // 'taking longer than usual' would worry a musician about the usual case.
    expect(isTakingLong(155_000)).toBe(false);
    expect(isTakingLong(LONG_WAIT_MS - 1)).toBe(false);
  });

  it('says so once past the threshold', () => {
    expect(isTakingLong(LONG_WAIT_MS)).toBe(true);
    expect(isTakingLong(240_000)).toBe(true);
  });
});
