import { describe, expect, it } from 'vitest';

import type { MeasureVerdict } from '../../data/types';
import { readMeasure, wasTimed } from './measureReading';

/**
 * A bar under a written `rit.` is not a bar that was played well.
 *
 * The pipeline forces `band` to `on` for it — the tolerance bands measure
 * distance from a steady beat and the page has said there is no steady beat —
 * while still reporting the real deviation. The app carried neither fact and
 * rendered both, so the row said "On the beat", drew a long deviation bar, and
 * revealed `-30%` on a tap. Three statements about one bar, two contradicting
 * the third.
 */

function measure(over: Partial<MeasureVerdict> = {}): MeasureVerdict {
  return {
    measure: 7,
    noteCount: 4,
    deviationPct: -30,
    band: 'on',
    direction: 'on',
    verdict: 'on_tempo',
    underTempoChange: false,
    uneven: false,
    ...over,
  };
}

describe('an ordinary measure', () => {
  it('reads as its verdict, with its bar and its figure', () => {
    const reading = readMeasure(
      measure({ band: 'rush_drag', direction: 'rush', verdict: 'rushing', deviationPct: -14 }),
    );

    expect(reading.showsDeviation).toBe(true);
    expect(reading.revealsFigure).toBe(true);
    expect(reading.tone).toBe('verdictBad');
    expect(reading.accessibilityLabel).toContain('Measure 7');
  });
});

describe('a measure under a written tempo change', () => {
  it('answers the column\'s question instead of claiming the beat was held', () => {
    const reading = readMeasure(measure({ underTempoChange: true }));

    expect(reading.label).toBe('Not timed');
    // **Not "On the beat".** The bar was not timed; saying it was is the app
    // taking credit on the musician's behalf for a judgement nobody made.
    expect(reading.label).not.toMatch(/beat/i);
  });

  it('draws no deviation and reveals no figure', () => {
    const reading = readMeasure(measure({ underTempoChange: true, deviationPct: -30 }));

    expect(reading.showsDeviation).toBe(false);
    // The figure is real — the musician did slow by that much — but in the
    // column where every other row shows how far off the beat it was, it reads
    // as an error.
    expect(reading.revealsFigure).toBe(false);
  });

  it('says when the change lurched, which is the one thing worth saying', () => {
    const reading = readMeasure(measure({ underTempoChange: true, uneven: true }));

    expect(reading.label).toBe('Uneven');
    expect(reading.tone).toBe('verdictMid');
    expect(reading.accessibilityLabel).toContain('uneven');
  });

  it('does not colour a steady change as though something were wrong', () => {
    // `verdictOn` would be a claim about playing; the greens and reds on this
    // screen all are. This row is a note about the page.
    expect(readMeasure(measure({ underTempoChange: true })).tone).toBe('textTertiary');
  });

  it('ignores `uneven` on a measure that was timed', () => {
    // The pipeline only sets it under a change, but the reading must not
    // depend on that — a stray flag should never relabel a judged bar.
    const reading = readMeasure(measure({ uneven: true, verdict: 'rushing', band: 'rush_drag' }));

    expect(reading.label).not.toBe('Uneven');
    expect(reading.showsDeviation).toBe(true);
  });
});

describe('wasTimed', () => {
  it('keeps a bar out of an average when the page said the beat would move', () => {
    expect(wasTimed({ underTempoChange: true })).toBe(false);
    expect(wasTimed({ underTempoChange: false })).toBe(true);
    // An older backend that sends neither field: judged, as it always was.
    expect(wasTimed({})).toBe(true);
  });
});

describe('the label fits the column it sits in', () => {
  it('is no longer than the longest verdict already in it', () => {
    // `MEASURE_COLUMNS.verdict` is 78pt and "Slight rush" is the widest label
    // that has ever fitted. "Tempo change" did not — it wrapped to two lines
    // and made one row of twelve taller than the rest. A character count is a
    // crude proxy for a text measurement and it is the one that can run here;
    // the real check was the screenshot.
    const longestExisting = 'Slight rush'.length;

    expect(readMeasure(measure({ underTempoChange: true })).label.length)
      .toBeLessThanOrEqual(longestExisting);
    expect(readMeasure(measure({ underTempoChange: true, uneven: true })).label.length)
      .toBeLessThanOrEqual(longestExisting);
  });
});
