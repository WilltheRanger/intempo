import { describe, expect, it } from 'vitest';

import type { MeasureVerdict } from '../../data/types';
import {
  appVerdictFor,
  canCorrect,
  correctionAcknowledgement,
  CORRECTION_CHOICES,
  correctionWord,
} from './correction';

/**
 * The rules behind "this bar wasn't rushing".
 *
 * They live in a module rather than in `MeasureRow.tsx` because there is no
 * React Native testing library here, so a rule inside a component is a rule
 * nothing checks — the doctrine that came out of the capture-path audit, where
 * eight of nine defects were rules inside `.tsx` files.
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

describe('which bars can be corrected', () => {
  it('offers the question on a bar the app actually judged', () => {
    expect(canCorrect(measure({ band: 'rush_drag', direction: 'rush' }))).toBe(true);
  });

  it('does not ask about a bar under a written tempo change', () => {
    // The page said the beat stops being steady, so the bands measured
    // nothing. Asking "what actually happened?" would be asking a musician to
    // adjudicate a measurement that was never made — and the answer would
    // enter the tuning data as a disagreement about a threshold that was not
    // applied.
    expect(canCorrect(measure({ underTempoChange: true }))).toBe(false);
  });

  it('does not ask about a held bar or an ornamented one', () => {
    // A fermata says the length is the player's; an ornament is placed by an
    // estimate this code invented. Neither is a claim about the playing.
    expect(
      canCorrect(measure({ timedNoteCount: 0, untimedReason: 'fermata' })),
    ).toBe(false);
    expect(
      canCorrect(measure({ timedNoteCount: 0, untimedReason: 'ornament' })),
    ).toBe(false);
  });

  it('asks about a bar that was on tempo, which is still a judgement', () => {
    // Agreement is data. A musician confirming "yes, that was on tempo" is the
    // control group for every threshold in `config.toml`, and a form that only
    // collects disagreement measures how often people disagree rather than how
    // often the app is right.
    expect(canCorrect(measure({ band: 'on', direction: 'on' }))).toBe(true);
  });

  // There was a fourth case here asserting `canCorrect(m) ===
  // readMeasure(m).revealsFigure`. That is `canCorrect`'s own body, so it
  // passed for every input and could never fail — the "don't grow a second
  // predicate" intent is a design constraint, and the concrete cases above are
  // what actually holds it.
});

describe('what the app said, in the musician’s words', () => {
  it('collapses every degree of rushing onto one word', () => {
    // A musician disagreeing with a bar is not adjudicating between "slight
    // rush" and "severe". How far off it was is not lost — the take's
    // `result_json` carries the thresholds and the figure, and the correction
    // names the analysis.
    for (const band of ['slight', 'rush_drag', 'severe'] as const) {
      expect(appVerdictFor(measure({ band, direction: 'rush' }))).toBe('rushing');
      expect(appVerdictFor(measure({ band, direction: 'drag' }))).toBe('dragging');
    }
  });

  it('reads a bar inside tolerance as on tempo whichever way it leans', () => {
    // `band: 'on'` is the app agreeing not to call it anything. Reporting the
    // lean anyway would send `rushing` as the app's verdict for a row whose
    // column says "On tempo" — a pair that contradicts itself in the one table
    // built to compare the two.
    expect(appVerdictFor(measure({ band: 'on', direction: 'rush' }))).toBe('on_tempo');
    expect(appVerdictFor(measure({ band: 'on', direction: 'drag' }))).toBe('on_tempo');
    expect(appVerdictFor(measure({ band: 'slight', direction: 'on' }))).toBe('on_tempo');
  });
});

describe('the words offered', () => {
  it('offers the three real answers, on tempo first', () => {
    // Ordered as the verdict column reads them, and matching the deviation
    // bar's own left-to-right sense would put dragging first — but the row
    // above says "Behind ← Target → Ahead" about *distance*, and these are
    // answers to a question, not positions on a scale.
    expect(CORRECTION_CHOICES).toEqual(['on_tempo', 'rushing', 'dragging']);
  });

  it('has a word for every answer the API accepts, including unsure', () => {
    // `unsure` is not in `CORRECTION_CHOICES` because it is offered apart from
    // the three — but it still needs its word, and a missing one would render
    // `undefined` in the control.
    for (const choice of [...CORRECTION_CHOICES, 'unsure' as const]) {
      expect(correctionWord(choice)).toMatch(/\S/);
    }
    expect(correctionWord('unsure')).toBe('Not sure');
  });
});

describe('what it says afterwards', () => {
  it('records the answer without claiming the verdict changed', () => {
    // The bar still reads what it read. This is a note to whoever tunes the
    // thresholds, not an edit to the take, and a tick or a "Fixed" would be
    // the app pretending to have learned something in two seconds.
    const said = correctionAcknowledgement('dragging');

    expect(said).toBe('Noted as dragging.');
    expect(said).not.toMatch(/updat|chang|fix|correct/i);
  });

  it('does not read back "unsure" as a verdict', () => {
    // "Noted as not sure" is not a sentence about the playing.
    expect(correctionAcknowledgement('unsure')).toBe('Noted — thanks for saying.');
  });
});
