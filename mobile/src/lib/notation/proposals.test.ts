import { describe, expect, it } from 'vitest';

import type { ScoreJson, ScoreNote } from '../../data/types';
import { proposalsFor, proposalsSummary } from './proposals';

/**
 * What the app is willing to say is wrong with a reading it produced.
 *
 * The cost of a false proposal is higher than the cost of a missed one: a
 * musician who accepts a confident suggestion has had their part changed by
 * something that cannot see the page. So most of these tests are about the
 * cases where it must stay quiet.
 */
const note = (pitch: string, duration = 'quarter'): ScoreNote =>
  ({ pitch, duration, tied_to_next: false }) as ScoreNote;

function score(
  measures: { n: number; notes: ScoreNote[] }[],
  timeSignature: string | null = '4/4',
): ScoreJson {
  return {
    time_signature: timeSignature,
    measures: measures.map((m) => ({ measure_number: m.n, notes: m.notes })),
  } as unknown as ScoreJson;
}

const FOUR = [note('A4'), note('A4'), note('B4'), note('C5')];

describe('a pitch below the instrument', () => {
  /**
   * The failure this was written for, measured on the live project: a real
   * 25-bar part read back at exactly 4.00 beats a bar and carried C3 on a
   * violin. Every arithmetic check passed.
   */
  it('proposes the octave that fits', () => {
    const [only] = proposalsFor(
      score([{ n: 1, notes: [note('C3'), note('A4'), note('B4'), note('C5')] }]),
      'violin',
    );
    expect(only.from).toBe('C3');
    expect(only.to).toBe('C4');
    expect(only.where).toBe('Bar 1, note 1');
    expect(only.why).toContain('violin\u2019s lowest string');
  });

  it('applies to the note it names and nothing else', () => {
    const before = score([
      { n: 1, notes: [note('C3'), note('C3'), note('B4'), note('C5')] },
      { n: 2, notes: FOUR },
    ]);
    const [first] = proposalsFor(before, 'violin');
    const after = first.apply(before);

    expect(after.measures[0].notes.map((n) => n.pitch)).toEqual([
      'C4',
      'C3',
      'B4',
      'C5',
    ]);
    expect(after.measures[1]).toEqual(before.measures[1]);
    // Pure: the score it was handed is untouched.
    expect(before.measures[0].notes[0].pitch).toBe('C3');
  });

  it('says nothing about a note the instrument can play', () => {
    expect(proposalsFor(score([{ n: 1, notes: FOUR }]), 'violin')).toEqual([]);
    // G3 is the violin's open G. The floor is inclusive or the open string
    // itself would be proposed away on every piece that uses it.
    expect(
      proposalsFor(score([{ n: 1, notes: [note('G3'), note('A4'), note('B4'), note('C5')] }]), 'violin'),
    ).toEqual([]);
  });

  it('knows the instruments apart', () => {
    const low = score([{ n: 1, notes: [note('C3'), note('A4'), note('B4'), note('C5')] }]);
    expect(proposalsFor(low, 'violin')).toHaveLength(1);
    // C3 is the viola's own bottom string.
    expect(proposalsFor(low, 'viola')).toEqual([]);
    expect(proposalsFor(low, 'cello')).toEqual([]);
  });

  /**
   * A bass with a C extension really does print written C2, so a floor at
   * written E2 would propose a correction to music that is correct.
   */
  it('leaves an extended bass alone', () => {
    expect(
      proposalsFor(score([{ n: 1, notes: [note('C2'), note('A4'), note('B4'), note('C5')] }]), 'double_bass'),
    ).toEqual([]);
  });

  it('stays quiet when one octave up would still be too low', () => {
    // More than an octave below is a stranger failure than a misread clef, and
    // choosing between two octaves is the app guessing.
    expect(
      proposalsFor(score([{ n: 1, notes: [note('C1'), note('A4'), note('B4'), note('C5')] }]), 'violin'),
    ).toEqual([]);
  });

  it('ignores rests, which have no pitch to be out of range', () => {
    expect(
      proposalsFor(score([{ n: 1, notes: [note('rest'), note('A4'), note('B4'), note('C5')] }]), 'violin'),
    ).toEqual([]);
  });
});

describe('a bar over by a repeated note', () => {
  it('proposes dropping the repeat', () => {
    const before = score([
      { n: 1, notes: [note('A4'), note('A4'), note('A4'), note('B4'), note('C5')] },
    ]);
    const [only] = proposalsFor(before, 'violin');
    expect(only.from).toBe('5 beats');
    expect(only.to).toBe('4 beats');
    expect(only.fixLabel).toBe('Drop the repeat');

    const after = only.apply(before);
    expect(after.measures[0].notes).toHaveLength(4);
    expect(after.measures[0].notes.map((n) => n.pitch)).toEqual([
      'A4',
      'A4',
      'B4',
      'C5',
    ]);
  });

  /**
   * The conservatism the whole module rests on. A bar can be long for many
   * reasons and only one of them has a correction nobody could argue with.
   */
  it('stays quiet when dropping the repeat would not fix it', () => {
    expect(
      proposalsFor(
        score([{ n: 1, notes: [note('A4'), note('A4'), note('A4'), note('A4'), note('A4'), note('B4')] }]),
        'violin',
      ),
    ).toEqual([]);
  });

  it('stays quiet when the long bar has no repeated pair', () => {
    expect(
      proposalsFor(
        score([{ n: 1, notes: [note('A4'), note('B4'), note('C5'), note('D5'), note('E5')] }]),
        'violin',
      ),
    ).toEqual([]);
  });

  it('wants the pair adjacent, and the same length', () => {
    expect(
      proposalsFor(
        score([{ n: 1, notes: [note('A4'), note('B4'), note('A4'), note('C5'), note('D5')] }]),
        'violin',
      ),
    ).toEqual([]);
    expect(
      proposalsFor(
        score([{ n: 1, notes: [note('A4'), note('A4', 'half'), note('B4'), note('C5')] }]),
        'violin',
      ),
    ).toEqual([]);
  });

  /** Half a bar missing has no single right answer, so nothing is offered. */
  it('proposes nothing about a bar that is short', () => {
    expect(proposalsFor(score([{ n: 1, notes: [note('A4'), note('B4')] }]), 'violin')).toEqual([]);
  });

  it('proposes nothing when no time signature was read', () => {
    expect(
      proposalsFor(
        score([{ n: 1, notes: [note('A4'), note('A4'), note('A4'), note('B4'), note('C5')] }], null),
        'violin',
      ),
    ).toEqual([]);
  });

  it('offers one proposal per bar, not one per pair', () => {
    const long = score([
      { n: 1, notes: [note('A4'), note('A4'), note('B4'), note('B4'), note('C5')] },
    ]);
    expect(proposalsFor(long, 'violin')).toHaveLength(1);
  });
});

describe('the list', () => {
  it('reads down the page rather than by rule', () => {
    const mixed = score([
      { n: 1, notes: [note('A4'), note('A4'), note('A4'), note('B4'), note('C5')] },
      { n: 2, notes: [note('C3'), note('A4'), note('B4'), note('C5')] },
      { n: 3, notes: [note('A4'), note('A4'), note('A4'), note('B4'), note('C5')] },
    ]);
    expect(proposalsFor(mixed, 'violin').map((p) => p.measureNumber)).toEqual([1, 2, 3]);
  });

  it('is empty for a piece nothing has read', () => {
    expect(proposalsFor(null, 'violin')).toEqual([]);
    expect(proposalsFor(undefined, 'cello')).toEqual([]);
  });

  it('gives every proposal an id that survives a redraw', () => {
    const mixed = score([
      { n: 1, notes: [note('C3'), note('A4'), note('B4'), note('C5')] },
      { n: 2, notes: [note('A4'), note('A4'), note('A4'), note('B4'), note('C5')] },
    ]);
    const first = proposalsFor(mixed, 'violin').map((p) => p.id);
    expect(new Set(first).size).toBe(first.length);
    expect(proposalsFor(mixed, 'violin').map((p) => p.id)).toEqual(first);
  });
});

describe('proposalsSummary', () => {
  it('says the reading is usable when there is nothing to say', () => {
    expect(proposalsSummary(0)).toContain('Nothing looks off');
  });

  it('reads as English at one', () => {
    expect(proposalsSummary(1)).toBe('One thing looks off. Keep it or fix it.');
    expect(proposalsSummary(4)).toBe('4 things look off. Keep or fix each one.');
  });
});
