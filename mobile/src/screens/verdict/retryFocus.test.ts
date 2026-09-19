import { describe, expect, it } from 'vitest';

import type { MeasureVerdict } from '../../data/types';
import { retryFocus } from './retryFocus';

function bar(measure: number, over: Partial<MeasureVerdict> = {}): MeasureVerdict {
  return {
    measure,
    noteCount: 4,
    deviationPct: 0,
    band: 'on',
    direction: 'on',
    verdict: 'on_tempo',
    underTempoChange: false,
    uneven: false,
    timedNoteCount: 4,
    untimedReason: null,
    ...over,
  };
}

describe('retryFocus', () => {
  it('selects the strongest judged bar and names the recorded bar number', () => {
    const result = retryFocus([
      bar(9, { band: 'slight', direction: 'rush', deviationPct: 18 }),
      bar(10, { band: 'rush_drag', direction: 'drag', deviationPct: -24 }),
      bar(11, { band: 'rush_drag', direction: 'rush', deviationPct: 28 }),
    ]);
    expect(result).toContain('bar 11');
    expect(result).toContain('rushed');
  });

  it('ignores unjudged bars even if their deviation is larger', () => {
    const result = retryFocus([
      bar(4, { band: 'severe', deviationPct: 60, underTempoChange: true }),
      bar(5, { band: 'severe', deviationPct: 55, timedNoteCount: 0 }),
      bar(6, { band: 'slight', direction: 'drag', deviationPct: -10 }),
    ]);
    expect(result).toContain('bar 6');
    expect(result).toContain('dragged');
  });

  it('does not suggest a correction when every judged bar is on tempo', () => {
    expect(retryFocus([bar(1), bar(2, { timedNoteCount: 0 })])).toBeNull();
    expect(retryFocus([])).toBeNull();
  });
});
