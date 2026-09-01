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
    timedNoteCount: 4,
    untimedReason: null,
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

describe('a measure with nothing in it that could be timed', () => {
  it('says so, whatever the reason', () => {
    // **A `rit.` is not the only way.** A fermata says one length is not
    // written down at all; an ornament and the note it decorates are placed by
    // a number the pipeline invented. A bar made entirely of those — a held
    // final chord, a bar that is one ornamented note — read "On tempo": the app
    // agreeing a bar was played in time when nothing in it was timed.
    const reading = readMeasure(
      measure({ timedNoteCount: 0, deviationPct: -64, verdict: 'on_tempo' }),
    );

    expect(reading.label).toBe('Not timed');
    expect(reading.showsDeviation).toBe(false);
    expect(reading.revealsFigure).toBe(false);
    expect(reading.accessibilityLabel).toContain('timed against the page');
  });

  it('leaves a bar alone when the take predates the count', () => {
    // `null` is an analysis stored before the pipeline reported it. Those rows
    // meant "all of them", and reading them as "none" would relabel every
    // measure of every take a musician has already recorded.
    const reading = readMeasure(
      measure({ timedNoteCount: null, band: 'rush_drag', verdict: 'rushing' }),
    );

    expect(reading.label).toBe('Rushing');
    expect(reading.showsDeviation).toBe(true);
  });

  it('keeps such a bar out of an average', () => {
    expect(wasTimed({ timedNoteCount: 0 })).toBe(false);
    expect(wasTimed({ timedNoteCount: 3 })).toBe(true);
    expect(wasTimed({ timedNoteCount: null })).toBe(true);
    expect(wasTimed({})).toBe(true);
  });
});

describe('a bar the page said not to judge', () => {
  it('says it is held when the page marks a fermata', () => {
    // **"Not timed" is the app's word, not the page's.** It reads as a failure
    // to measure, which is right for an ornament — where the pipeline is
    // admitting it guessed — and wrong here, where a composer gave an
    // instruction and the musician followed it. A held final chord is not a
    // bar the app could not judge; it is a bar it was told not to.
    const reading = readMeasure(
      measure({ timedNoteCount: 0, untimedReason: 'fermata', deviationPct: 64 }),
    );

    expect(reading.label).toBe('Held');
    expect(reading.accessibilityLabel).toContain('fermata');
    expect(reading.showsDeviation).toBe(false);
    expect(reading.revealsFigure).toBe(false);
  });

  it('still says not timed for an ornament, because that one is a guess', () => {
    const reading = readMeasure(
      measure({ timedNoteCount: 0, untimedReason: 'ornament' }),
    );

    expect(reading.label).toBe('Not timed');
    expect(reading.accessibilityLabel).toContain('estimate');
  });

  it('falls back to the old wording when no reason is given', () => {
    // Two cases share this: a take analysed before the pipeline reported a
    // reason, and a bar whose untimed notes disagree. Both mean "no single
    // reason", and the honest silence is better than a headline that only
    // explains half the bar.
    const reading = readMeasure(
      measure({ timedNoteCount: 0, untimedReason: null }),
    );

    expect(reading.label).toBe('Not timed');
    expect(reading.accessibilityLabel).toContain(
      'nothing here could be timed against the page',
    );
  });

  it('lets a written tempo change answer first', () => {
    // A bar can be both. The tempo change covers a passage and is the broader
    // fact, and it has its own reading with "Uneven" in it.
    const reading = readMeasure(
      measure({
        underTempoChange: true,
        uneven: true,
        timedNoteCount: 0,
        untimedReason: 'tempo_change',
      }),
    );

    expect(reading.label).toBe('Uneven');
  });
});
