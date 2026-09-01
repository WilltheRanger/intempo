import { describe, expect, it } from 'vitest';

import {
  entryAccessibilityLabel,
  entryLabel,
  entrySheetTitle,
} from './entryCopy';

/**
 * The picker sets where a *take* begins now, not only where playback does, and
 * the label has to say which. Getting this wrong in either direction is a
 * promise about the analysis: "Listen from" on the record screen understates
 * what the control does, and "Start at" on the score screen claims a recording
 * that is not happening.
 */
describe('what the bar picker calls itself', () => {
  it('names the take on a screen that records one', () => {
    expect(entryLabel('take', 9)).toBe('Start at bar 9');
    expect(entrySheetTitle('take')).toBe('Start the take at');
  });

  it('names listening on a screen that does not', () => {
    expect(entryLabel('listen', 9)).toBe('Listen from bar 9');
    expect(entrySheetTitle('listen')).toBe('Listen from');
  });

  it('says what tapping does, in both', () => {
    // The visible line is four words; the label is where there is room to say
    // that it is a control and what it changes.
    expect(entryAccessibilityLabel('take', 9)).toContain('Change where the take begins');
    expect(entryAccessibilityLabel('listen', 9)).toContain('Change');
  });

  it('never says "listen" when it governs the take', () => {
    // The failure this guards is the quiet one: a musician sets the bar to
    // hear a passage and unknowingly records from there.
    expect(entryLabel('take', 3).toLowerCase()).not.toContain('listen');
    expect(entryAccessibilityLabel('take', 3).toLowerCase()).not.toContain('listen');
  });
});
