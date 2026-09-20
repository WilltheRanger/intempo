import { describe, expect, it } from 'vitest';

import { firstStep, focusReason, windowLabel } from './copy';

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
    // One sentence. It was three in a card, then two on the row; the second
    // told you to record another take, which is what pressing the row does.
    expect(reason.split('.').filter(Boolean)).toHaveLength(1);
  });

  it('says session, singular, for one', () => {
    expect(focusReason(1)).toContain('across 1 session.');
  });
});

describe('firstStep', () => {
  it('sends an empty library to the add flow', () => {
    // A record button is not reachable yet — there is nothing to record.
    expect(firstStep(0)).toEqual({
      label: 'Add your first piece',
      destination: 'add',
    });
  });

  it('sends a library with pieces to the library', () => {
    expect(firstStep(3).destination).toBe('library');
    expect(firstStep(3).label).toBe('Choose a piece to record');
  });

  it('names the one piece when there is only one', () => {
    // "Choose a piece" is an odd thing to say about a library of one.
    expect(firstStep(1).label).toBe('Record this piece');
    expect(firstStep(1).destination).toBe('library');
  });

  it('always offers somewhere to go', () => {
    // The whole point: this empty state named an action and offered no route
    // to it. Every count must produce a label and a destination.
    for (const count of [0, 1, 2, 17]) {
      const step = firstStep(count);
      expect(step.label, `${count}`).toBeTruthy();
      expect(step.destination, `${count}`).toBeTruthy();
    }
  });
});
