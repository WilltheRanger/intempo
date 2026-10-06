import { describe, expect, it } from 'vitest';

import { latestAnswerFor, type StoredAnswer } from './savedAnswer';

/**
 * A result opened again shows the answer already given.
 *
 * Answer "How did bars 5–8 sound?", leave, come back: the question was asked
 * again with the app's own reading highlighted, as if nobody had answered.
 * The server had every answer and an endpoint to return them.
 */
const row = (measure: number, verdict: StoredAnswer['user_verdict'], at: string): StoredAnswer => ({
  measure_number: measure,
  user_verdict: verdict,
  created_at: at,
});

describe('latestAnswerFor', () => {
  it('finds the answer given to this passage', () => {
    const rows = [row(5, 'rushing', '2026-10-06T10:00:00Z'), row(6, 'rushing', '2026-10-06T10:00:00Z')];
    expect(latestAnswerFor(rows, [5, 6, 7, 8])).toBe('rushing');
  });

  it('takes the newest when the musician changed their mind', () => {
    const rows = [
      row(5, 'rushing', '2026-10-06T10:00:00Z'),
      row(5, 'on_tempo', '2026-10-06T11:00:00Z'),
      row(6, 'rushing', '2026-10-06T10:00:00Z'),
    ];
    expect(latestAnswerFor(rows, [5, 6])).toBe('on_tempo');
  });

  it('ignores answers about bars this question does not ask about', () => {
    // The passage moved on a re-analysis: an answer about bars 1–2 does not
    // answer a question about bars 5–8.
    expect(latestAnswerFor([row(1, 'dragging', '2026-10-06T10:00:00Z')], [5, 6, 7, 8])).toBeNull();
  });

  it('is nothing when nothing was said, or nothing is asked', () => {
    expect(latestAnswerFor([], [5])).toBeNull();
    expect(latestAnswerFor(undefined, [5])).toBeNull();
    expect(latestAnswerFor([row(5, 'unsure', '2026-10-06T10:00:00Z')], [])).toBeNull();
  });
});
