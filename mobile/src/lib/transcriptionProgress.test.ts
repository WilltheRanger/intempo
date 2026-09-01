import { describe, expect, it } from 'vitest';

import {
  QUEUED_PROGRESS,
  STAGE_PROGRESS,
  progressFor,
} from './transcriptionProgress';
// Imported rather than read off disk, the way `meters.parity.test.ts` does it:
// this project has no `@types/node`, so `readFileSync` does not typecheck.
import parity from '../../../fixtures/stages/parity.json';

/**
 * The contract with the worker. `backend/app/tests/test_stage_parity.py` holds
 * the server to the same file — a second copy of the answer in either test is
 * the failure being tested for.
 */

describe('the stage contract', () => {
  it('places exactly the stages the fixture names, at the fixture positions', () => {
    expect(STAGE_PROGRESS).toEqual(parity.static);
    expect(QUEUED_PROGRESS).toBe(parity.queued_progress);
  });

  it('never walks backwards through the static stages in order', () => {
    // The positions are the order of the work. "Checking the bar counts" used
    // to sit at 0.6 against reading's 0.7, so reaching the later step would
    // have moved the bar back even once the key matched.
    const positions = parity._static_order.map((stage) => STAGE_PROGRESS[stage]);
    expect(positions.every((value) => value !== undefined)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(QUEUED_PROGRESS).toBeLessThan(positions[0]);
    expect(positions[positions.length - 1]).toBeLessThanOrEqual(1);
  });
});

describe('progressFor', () => {
  it('holds the bar for a step this build has never heard of', () => {
    // The bug. This fell through to QUEUED_PROGRESS, so a server one deploy
    // ahead of the app did not merely fail to move the bar — it threw the bar
    // from 70% back to 5% in the middle of a read, which reads as the scan
    // having restarted. A spinner and a hang being indistinguishable is the
    // whole reason this panel exists.
    expect(progressFor('Transcribing the ossia', 0.7)).toBe(0.7);
    expect(progressFor('Checking the reading', 0.7)).toBe(0.7);
  });

  it('starts at queued when the worker has not said anything yet', () => {
    expect(progressFor(undefined, 0.7)).toBe(QUEUED_PROGRESS);
    expect(progressFor(null, 0.7)).toBe(QUEUED_PROGRESS);
    expect(progressFor('', 0.7)).toBe(QUEUED_PROGRESS);
  });

  it('steps the bar once per stave, across the reading band', () => {
    const [start, end] = parity._reading_band;
    const total = 7;
    let held = STAGE_PROGRESS['Finding the staves'];
    const seen: number[] = [];
    for (let done = 1; done <= total; done += 1) {
      held = progressFor(`Reading stave ${done} of ${total}`, held);
      seen.push(held);
    }

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[0]).toBeGreaterThan(start);
    expect(seen[total - 1]).toBeCloseTo(end, 10);
    // Where the whole-page path puts it, so a split page that fails and falls
    // back does not walk the bar backwards.
    expect(seen[total - 1]).toBeCloseTo(STAGE_PROGRESS['Reading the notation'], 10);
  });

  it('places every stave line the fixture says the worker can emit', () => {
    for (const { words } of parity.per_stave) {
      const placed = progressFor(words, 0.3);
      expect(placed, words).not.toBe(0.3);
      expect(placed, words).toBeGreaterThanOrEqual(parity._reading_band[0]);
      expect(placed, words).toBeLessThanOrEqual(parity._reading_band[1]);
    }
  });

  it('holds the bar for a stave count that cannot be a count', () => {
    // `0 of 0` divides by zero and `9 of 7` is a server saying something
    // impossible. Neither is worth drawing, and NaN on an Animated.Value is
    // worse than a bar that does not move.
    expect(progressFor('Reading stave 0 of 0', 0.42)).toBe(0.42);
    expect(progressFor('Reading stave 9 of 7', 0.42)).toBe(0.42);
    expect(progressFor('Reading stave 3 of', 0.42)).toBe(0.42);
    expect(Number.isNaN(progressFor('Reading stave 0 of 0', 0.42))).toBe(false);
  });

  it('says nothing about which engine read a page it read whole', () => {
    // Both provider forms collapse to one position — the app is never told the
    // provider's name, and a page read whole has no measurable progress inside
    // the reading step.
    for (const { words } of parity.whole_page) {
      expect(progressFor(words, 0.3)).toBe(STAGE_PROGRESS['Reading the notation']);
    }
  });
  describe('a multi-page scan', () => {
    it('places every page of the contract exactly where the fixture says', () => {
      for (const { words, progress } of parity.per_page) {
        expect(progressFor(words, 0), words).toBeCloseTo(progress, 5);
      }
    });

    it('never walks backwards from one page to the next', () => {
      // The failure the whole module exists to prevent. Page 2 must not sit
      // below page 1, whatever the arithmetic works out to.
      const placed = parity.per_page
        .filter((entry) => entry.total === 3)
        .map((entry) => progressFor(entry.words, 0));
      placed.slice(1).forEach((position, index) => {
        expect(position).toBeGreaterThanOrEqual(placed[index]);
      });
    });

    it('stays inside the reading band', () => {
      const [start, end] = parity._reading_band;
      for (const { words } of parity.per_page) {
        const placed = progressFor(words, 0);
        expect(placed, words).toBeGreaterThanOrEqual(start);
        expect(placed, words).toBeLessThanOrEqual(end);
      }
    });

    it('never claims the page it is still reading', () => {
      // `Reading page 1 of 3` means no page is finished, so it sits at the
      // bottom of the band. Placing it at 1/3 would report a page as read
      // while it is still being read.
      expect(progressFor('Reading page 1 of 3', 0)).toBe(parity._reading_band[0]);
    });

    it('holds the bar on a count that cannot be a count', () => {
      for (const impossible of [
        'Reading page 0 of 3',
        'Reading page 4 of 3',
        'Reading page 1 of 0',
      ]) {
        expect(progressFor(impossible, 0.7), impossible).toBe(0.7);
      }
    });
  });
});
