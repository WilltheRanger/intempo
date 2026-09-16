import { describe, expect, it } from 'vitest';

import type { CapturedPage } from '../../data/captureSession';
import { doubtfulCount, pageNote, queueSummary } from './pageQueue';
import { shotVerdict } from './shotVerdict';
import { MIN_PAGE_ROWS } from './legibility';

/**
 * The queue's own copy, which is the last thing said before an upload.
 *
 * Both failure directions cost something real: a doubtful page that says
 * nothing is sent, read badly and discovered minutes later; a clear page that
 * warns sends someone back to the stand for no reason.
 */
const clear = (id: string): CapturedPage => ({
  id,
  source: `file:///${id}.jpg`,
  reading: shotVerdict({ verdict: 'ok', spacing: 12 }),
});

const doubtful = (id: string): CapturedPage => ({
  id,
  source: `file:///${id}.jpg`,
  reading: shotVerdict({ verdict: 'tooSmall', spacing: 3 }, MIN_PAGE_ROWS * 4),
});

/** Everything that arrived through Import: never measured, never judged. */
const unmeasured = (id: string): CapturedPage => ({ id, source: `file:///${id}.jpg` });

describe('pageNote', () => {
  it('names the finding on a page worth another look', () => {
    expect(pageNote(doubtful('a'))).toBe('Too far away to read the notes');
  });

  it('says nothing about a page that read', () => {
    expect(pageNote(clear('a'))).toBeNull();
  });

  it('says nothing about a page nothing measured', () => {
    // Import never runs the check. A note here would be a finding the app does
    // not have, attached to a page it never looked at.
    expect(pageNote(unmeasured('a'))).toBeNull();
  });
});

describe('queueSummary', () => {
  it('states the order, which is the promise the drag handles exist for', () => {
    expect(queueSummary([clear('a'), clear('b')])).toBe(
      'InTempo uploads and reads every page in this order.',
    );
  });

  it('does not talk about order when there is only one page', () => {
    expect(queueSummary([clear('a')])).toBe('This is the page InTempo will read.');
  });

  it('adds the caveat, and counts', () => {
    expect(queueSummary([doubtful('a'), clear('b')])).toContain('One page is worth');
    expect(queueSummary([doubtful('a'), doubtful('b'), clear('c')])).toContain(
      '2 pages are worth',
    );
  });

  /** A warning that is always on screen is a warning nobody reads. */
  it('stays quiet when every page read', () => {
    expect(queueSummary([clear('a'), clear('b')])).not.toContain('worth another look');
    expect(queueSummary([unmeasured('a')])).not.toContain('worth another look');
  });

  it('keeps the order sentence in front of the caveat', () => {
    const summary = queueSummary([doubtful('a'), clear('b')]);
    expect(summary.indexOf('in this order')).toBeLessThan(summary.indexOf('worth'));
  });
});

describe('doubtfulCount', () => {
  it('counts only the pages that were measured and came back short', () => {
    expect(doubtfulCount([doubtful('a'), clear('b'), unmeasured('c'), doubtful('d')])).toBe(2);
    expect(doubtfulCount([])).toBe(0);
  });
});
