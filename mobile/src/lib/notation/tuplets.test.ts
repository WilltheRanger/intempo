import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { engrave, isNote } from './engrave';
import { staveScoreFor } from './fromScore';

function scoreOf(durations: string[] | string, pitch = 'B4'): ScoreJson {
  const list = Array.isArray(durations) ? durations : [durations];
  return {
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: null,
    clef: 'treble',
    measures: [
      {
        measure_number: 1,
        notes: list.map((duration) => ({
          pitch,
          duration,
          tied_to_next: false,
        })),
        slurs: [],
      },
    ],
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
  } as ScoreJson;
}

const triplets = (n: number) => Array.from({ length: n }, () => 'triplet_eighth');
const opts = { lineGap: 10, noteGap: 30, leftPad: 20, rightPad: 10 };

describe('tuplets reach the stave at all', () => {
  it('draws a triplet, which used to be dropped', () => {
    // **The refusal this replaces was right at the time.** A triplet eighth is
    // written as an ordinary eighth; drawing the notehead with no bracket puts
    // three eighths where the page has three triplet-eighths — a bar half again
    // as long as it is, in the same ink as the notes that are right.
    const stave = staveScoreFor(scoreOf(triplets(3)));

    expect(stave.noteCount).toBe(3);
    expect(stave.undrawable).toBe(0);
    expect(stave.items.filter(isNote).map((n) => n.value)).toEqual([
      'eighth', 'eighth', 'eighth',
    ]);
  });

  it('carries the real duration, not the noteheads own', () => {
    // The bracket says what the notehead cannot, and so does this: a triplet
    // eighth lasts a third of a beat. Beam grouping counts in real time, so a
    // wrong value here breaks the beam inside the triplet and misplaces every
    // group after it in the bar.
    const [first] = staveScoreFor(scoreOf(triplets(3))).items.filter(isNote);

    expect(first.quarters).toBeCloseTo(1 / 3);
  });

  it('still refuses a tuplet whose base value has no glyph', () => {
    // A bracket marked 3 over notes drawn at the wrong length is worse than no
    // bracket: it asserts a ratio about something already wrong.
    const stave = staveScoreFor(scoreOf('triplet_thirty_second'));

    expect(stave.noteCount).toBe(0);
    expect(stave.undrawable).toBe(1);
  });
});

describe('where one group ends and the next begins', () => {
  const bracketsIn = (...durations: string[]) =>
    engrave(staveScoreFor(scoreOf(durations)).items, 'treble', opts).systems[0]
      .tuplets;

  it('makes six triplet eighths two triplets, not one bracket of six', () => {
    // **The rule that is silently wrong if it is wrong.** One bracket marked 3
    // spanning six notes is a statement about the music that is simply false,
    // and it looks deliberate.
    expect(bracketsIn(...triplets(6))).toHaveLength(2);
  });

  it('brackets a group of three as one', () => {
    expect(bracketsIn(...triplets(3))).toHaveLength(1);
    expect(bracketsIn(...triplets(3))[0].count).toBe(3);
  });

  it('ends a group when the family changes', () => {
    const brackets = bracketsIn(
      'triplet_eighth', 'triplet_eighth', 'triplet_eighth',
      'quintuplet_sixteenth', 'quintuplet_sixteenth', 'quintuplet_sixteenth',
      'quintuplet_sixteenth', 'quintuplet_sixteenth',
    );

    expect(brackets.map((t) => t.count)).toEqual([3, 5]);
  });

  it('ends a group at a plain note', () => {
    const brackets = bracketsIn(
      'triplet_eighth', 'triplet_eighth', 'quarter', 'triplet_eighth',
    );

    // Two starts, and neither reaches three notes. A bracket is still drawn
    // over the pair, because that is what the page says the pair is; the
    // single one has nothing to span and is dropped.
    expect(brackets.map((t) => t.count)).toEqual([3]);
  });

  it('keeps a rest inside the group it belongs to', () => {
    // A triplet with a rest in it is one triplet. Bracketing only the
    // noteheads would say otherwise, and would span the wrong distance.
    const items = staveScoreFor(
      scoreOf(triplets(3)),
    ).items;
    items[1] = { rest: 'eighth', quarters: 1 / 3, tuplet: { count: 3, starts: false } } as never;
    const [bracket] = engrave(items, 'treble', opts).systems[0].tuplets;

    expect(bracket).toBeDefined();
    // Spans all three columns, not just the two with noteheads.
    expect(bracket.to - bracket.from).toBeCloseTo(opts.noteGap * 2);
  });
});

describe('where the bracket sits', () => {
  it('leaves a gap in the middle for its numeral', () => {
    const [bracket] = engrave(
      staveScoreFor(scoreOf(triplets(3))).items,
      'treble',
      opts,
    ).systems[0].tuplets;

    expect(bracket.numberX).toBeCloseTo((bracket.from + bracket.to) / 2);
  });

  it('sits on the stem side, not on whichever side is higher', () => {
    // **The bug the screenshot caught.** This chose its side by asking whether
    // the group sat high on the staff — a different question with a different
    // answer, because a group of high notes has *down* stems. The bracket went
    // above three notes whose every stem pointed away from it.
    const high = engrave(
      staveScoreFor(scoreOf(['triplet_quarter', 'triplet_quarter', 'triplet_quarter'])).items,
      'treble',
      opts,
    ).systems[0];
    const low = engrave(
      staveScoreFor(
        scoreOf(['triplet_quarter', 'triplet_quarter', 'triplet_quarter'], 'C4'),
      ).items,
      'treble',
      opts,
    ).systems[0];

    // High notes: stems down, bracket below the notes.
    expect(high.notes[0].stemUp).toBe(false);
    expect(high.tuplets[0].y).toBeGreaterThan(high.notes[0].y);
    // Low notes: stems up, bracket above them.
    expect(low.notes[0].stemUp).toBe(true);
    expect(low.tuplets[0].y).toBeLessThan(low.notes[0].y);
  });

  it('hooks towards the notes, whichever side it is on', () => {
    // Above the notes the hooks drop; below them they rise. A bracket whose
    // hooks point away from the music is an open box.
    const high = engrave(
      staveScoreFor(scoreOf(triplets(3))).items,
      'treble',
      opts,
    ).systems[0];
    const [bracket] = high.tuplets;
    const towardsNotes = Math.sign(
      high.notes[0].y - bracket.y,
    );

    expect(Math.sign(bracket.hook)).toBe(towardsNotes);
  });
});
