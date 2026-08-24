import { describe, expect, it } from 'vitest';

import {
  QUEUED_PROGRESS,
  STAGE_PROGRESS,
  progressFor,
} from './transcriptionProgress';

describe('progressFor', () => {
  it('places each step the worker reports', () => {
    expect(progressFor('Fetching the page', QUEUED_PROGRESS)).toBe(0.15);
    expect(progressFor('Finding the staves', 0.15)).toBe(0.3);
    expect(progressFor('Reading the notation', 0.3)).toBe(0.7);
    expect(progressFor('Checking the bar counts', 0.7)).toBe(0.85);
  });

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

  it('never walks backwards through the steps in order', () => {
    // The positions are the order of the work. "Checking the bar counts" used
    // to sit at 0.6 against reading's 0.7, so reaching the later step would
    // have moved the bar back even once the key matched.
    const inOrder = [
      'Fetching the page',
      'Finding the staves',
      'Reading the notation',
      'Checking the bar counts',
    ];
    const positions = inOrder.map((stage) => STAGE_PROGRESS[stage]);
    expect(positions.every((value) => value !== undefined)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(QUEUED_PROGRESS).toBeLessThan(positions[0]);
    expect(positions[positions.length - 1]).toBeLessThanOrEqual(1);
  });

  it('keeps the bar still while a page is read one system at a time', () => {
    // Every crop reports "Reading the notation", so a nine-system page moves
    // the bar once and not nine times. Stepping per line would be reporting a
    // fraction nobody measures: the systems are not the same size, and the app
    // is not told how many there are.
    let held = QUEUED_PROGRESS;
    for (let line = 0; line < 9; line += 1) {
      held = progressFor('Reading the notation', held);
    }
    expect(held).toBe(0.7);
  });
});
