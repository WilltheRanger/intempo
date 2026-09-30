import { describe, expect, it } from 'vitest';

import type { TakeResult } from '../../data/types';
import { INSIGHTS_MIN_TAKES, insightsProgress } from './readiness';

/** Newest first; `false` is a refused take. */
function takes(...ok: boolean[]): TakeResult[] {
  return ok.map(
    (good, index) =>
      ({
        id: `take-${index}`,
        pieceId: `piece-${index}`,
        failure: good ? null : { code: 'silent' },
        status: good ? 'ok' : 'failed',
      }) as unknown as TakeResult,
  );
}

describe('insightsProgress', () => {
  it('waits for five takes', () => {
    expect(INSIGHTS_MIN_TAKES).toBe(5);
    expect(insightsProgress(takes(true, true, true, true), 4).ready).toBe(false);
    expect(insightsProgress(takes(true, true, true, true, true), 5).ready).toBe(true);
  });

  it('counts down in the title', () => {
    expect(insightsProgress(takes(true, true), 2)).toMatchObject({
      counted: 2,
      needed: 5,
      title: '3 more takes to go',
    });
    expect(insightsProgress(takes(true, true, true, true), 4).title).toBe('1 more take to go');
  });

  it('does not count a refused take', () => {
    const progress = insightsProgress(takes(false, true, false, true, true, true), 6);

    expect(progress.counted).toBe(4);
    expect(progress.ready).toBe(false);
  });

  it('records on the piece of the newest take that counts', () => {
    expect(insightsProgress(takes(false, true, true), 2).lastPieceId).toBe('piece-1');
    expect(insightsProgress(takes(), 0).lastPieceId).toBeNull();
  });

  it('reads the window’s own count while the takes load', () => {
    expect(insightsProgress(undefined, 3)).toMatchObject({ counted: 3, ready: false });
    expect(insightsProgress(undefined, 9)).toMatchObject({ counted: 5, ready: true });
  });

  it('never counts past five', () => {
    expect(insightsProgress(takes(...Array(12).fill(true)), 12).counted).toBe(5);
  });
});
