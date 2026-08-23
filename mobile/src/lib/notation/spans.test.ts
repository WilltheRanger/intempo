import { describe, expect, it } from 'vitest';

import { marksAfterDelete, marksAfterInsert, marksOf } from './spans';
import type { ScoreSlur, ScoreTuplet } from '../../data/types';

const slur = (start: number, end: number): ScoreSlur => ({
  start_note_index: start,
  end_note_index: end,
});

const tuplet = (start: number, end: number, actual = 3, normal = 2): ScoreTuplet => ({
  start_note_index: start,
  end_note_index: end,
  actual_notes: actual,
  normal_notes: normal,
});

const marks = (slurs: ScoreSlur[], tuplets: ScoreTuplet[] = []) => ({ slurs, tuplets });
const spans = (result: { slurs: ScoreSlur[] }) =>
  result.slurs.map((s) => [s.start_note_index, s.end_note_index]);

describe('inserting a note', () => {
  it('moves a mark that starts after it', () => {
    // Notes 0..3 with a slur over 2..3; a note inserted at 1 pushes it to 3..4.
    expect(spans(marksAfterInsert(marks([slur(2, 3)]), 1))).toEqual([[3, 4]]);
  });

  it('leaves a mark that ends before it alone', () => {
    expect(spans(marksAfterInsert(marks([slur(0, 1)]), 3))).toEqual([[0, 1]]);
  });

  it('extends a mark the note lands inside', () => {
    // A slur drawn over a run covers a note added into the middle of that run.
    expect(spans(marksAfterInsert(marks([slur(0, 3)]), 2))).toEqual([[0, 4]]);
  });

  it('extends a mark when the note lands on its last index', () => {
    // An insert at the end of a slur is inside the phrase, not the start of the
    // next one — so the mark grows rather than stopping short.
    expect(spans(marksAfterInsert(marks([slur(0, 2)]), 2))).toEqual([[0, 3]]);
  });

  it('pushes a mark that begins exactly where the note lands', () => {
    expect(spans(marksAfterInsert(marks([slur(2, 4)]), 2))).toEqual([[3, 5]]);
  });

  it('moves brackets the same way, and lets the count go wrong', () => {
    // A triplet bracket that gains a fourth note is a bracket over four notes.
    // That is wrong, and `tuplet_faults` saying so is the point: reindexing
    // keeps the mark honest, it does not make the edit correct.
    const after = marksAfterInsert(marks([], [tuplet(0, 2)]), 1);
    expect(after.tuplets[0].start_note_index).toBe(0);
    expect(after.tuplets[0].end_note_index).toBe(3);
    expect(after.tuplets[0].actual_notes).toBe(3);
  });
});

describe('deleting a note', () => {
  it('moves a mark that starts after it', () => {
    expect(spans(marksAfterDelete(marks([slur(2, 3)]), 0))).toEqual([[1, 2]]);
  });

  it('leaves a mark that ends before it alone', () => {
    expect(spans(marksAfterDelete(marks([slur(0, 1)]), 3))).toEqual([[0, 1]]);
  });

  it('shrinks a mark the deleted note was inside', () => {
    expect(spans(marksAfterDelete(marks([slur(0, 3)]), 2))).toEqual([[0, 2]]);
  });

  it('shrinks a mark whose first note was deleted', () => {
    expect(spans(marksAfterDelete(marks([slur(1, 3)]), 1))).toEqual([[1, 2]]);
  });

  it('drops a mark whose only note was deleted', () => {
    // Not a shrunken mark — a broken one. End before start is not a span.
    expect(marksAfterDelete(marks([slur(2, 2)]), 2).slurs).toEqual([]);
  });

  it('keeps the other marks when one is dropped', () => {
    const after = marksAfterDelete(marks([slur(0, 1), slur(3, 3), slur(4, 5)]), 3);
    expect(spans(after)).toEqual([[0, 1], [3, 4]]);
  });
});

describe('the bug this exists for', () => {
  it('keeps a slur over the notes it was drawn over', () => {
    // Four eighths slurred in pairs. Insert a note at the front; both slurs
    // have to move, or the second pair is timed as the first.
    const before = marks([slur(0, 1), slur(2, 3)]);
    expect(spans(marksAfterInsert(before, 0))).toEqual([[1, 2], [3, 4]]);
  });

  it('survives a sequence of edits', () => {
    // add, add, delete — the state the screen actually reaches.
    let m = marks([slur(1, 3)], [tuplet(1, 3)]);
    m = marksAfterInsert(m, 0); // -> 2..4
    m = marksAfterInsert(m, 5); // after the mark; unchanged
    m = marksAfterDelete(m, 0); // -> 1..3
    expect(spans(m)).toEqual([[1, 3]]);
    expect([m.tuplets[0].start_note_index, m.tuplets[0].end_note_index]).toEqual([1, 3]);
  });

  it('is a no-op when a measure has no marks at all', () => {
    expect(marksAfterInsert(marks([]), 0)).toEqual({ slurs: [], tuplets: [] });
    expect(marksAfterDelete(marks([]), 0)).toEqual({ slurs: [], tuplets: [] });
  });
});

describe('reading marks off a measure', () => {
  it('treats a score written before brackets existed as having none', () => {
    expect(marksOf({ measure_number: 1, notes: [], slurs: [slur(0, 1)] })).toEqual({
      slurs: [slur(0, 1)],
      tuplets: [],
    });
  });
});
