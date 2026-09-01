import { describe, expect, it } from 'vitest';

import { focusReason, windowLabel } from './copy';

/**
 * Three plural rules that read fine in review and ship "1 sessions".
 *
 * Here rather than in the `.tsx` because there is no React Native testing
 * library in this project (`DECISIONS.md`, 2026-08-24), so a rule written
 * inside a component is a rule nothing checks.
 */

describe('windowLabel', () => {
  it('follows the eyebrow in lower case', () => {
    // It renders as "Insights · last 30 days", so a capital would be a second
    // sentence starting mid-line.
    expect(windowLabel(30)).toBe('last 30 days');
  });

  it('says day, singular, for one', () => {
    expect(windowLabel(1)).toBe('last day');
  });
});

describe('focusReason', () => {
  it('is one line, because it is a row and not a paragraph', () => {
    const reason = focusReason(12);

    expect(reason).toContain('12 sessions');
    // Two sentences at most: `TodayRow` gives it three lines at 13pt, and the
    // three-sentence version this replaced needed a card to hold it.
    expect(reason.split('.').filter(Boolean)).toHaveLength(2);
  });

  it('says session, singular, for one', () => {
    expect(focusReason(1)).toContain('across 1 session.');
  });
});
