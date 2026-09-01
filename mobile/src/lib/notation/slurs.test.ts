import { describe, expect, it } from 'vitest';

import { engrave, type StaveItem, type StaveNote } from './engrave';
import { staveScoreFor } from './fromScore';
import type { ScoreJson, ScoreSlur } from '../../data/types';

/**
 * Slurs — the bowing.
 *
 * `spans.ts` has kept `measure.slurs` pointing at the right notes through every
 * insert and delete since the editor shipped, and `engrave.ts` drew none of
 * them: its own docstring said "no slurs". On a string part that is not a
 * missing ornament. A Kreutzer étude without its slurs is a page you cannot
 * bow.
 *
 * The one thing that is genuinely easy to get wrong is the indexing. Slurs
 * address `measure.notes`; the engraver draws `items`, and the two are not the
 * same list — a note it cannot place makes no item, and repeats and long-rest
 * blocks insert items of their own. A slur mapped naively lands on the wrong
 * notes, which is worse than none: it is a bowing instruction for a passage
 * that is not there.
 */

function scoreOf(
  notes: { pitch: string; duration?: string }[],
  slurs: ScoreSlur[],
): ScoreJson {
  return {
    time_signature: '4/4',
    key_signature: 'C major',
    tempo_marking: null,
    bpm_hint: null,
    clef: 'treble',
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
    measures: [
      {
        measure_number: 1,
        slurs,
        notes: notes.map((n) => ({
          pitch: n.pitch,
          duration: n.duration ?? 'quarter',
          tied_to_next: false,
        })),
      },
    ],
  } as unknown as ScoreJson;
}

const slurIds = (items: StaveItem[]) =>
  items.map((item) => ('pitch' in item ? (item as StaveNote).slur : undefined));

describe('turning a score slur into marks on the items', () => {
  it('covers the notes the slur names', () => {
    const stave = staveScoreFor(
      scoreOf(
        [{ pitch: 'C4' }, { pitch: 'D4' }, { pitch: 'E4' }, { pitch: 'F4' }],
        [{ start_note_index: 1, end_note_index: 2 }],
      ),
    );
    const ids = slurIds(stave.items);
    expect(ids[0]).toBeUndefined();
    expect(ids[1]).toBeDefined();
    expect(ids[1]).toBe(ids[2]);
    expect(ids[3]).toBeUndefined();
  });

  it('counts rests, because the slur indices do', () => {
    // A rest is an entry in `measure.notes` and an item on the stave, so the
    // two lists happen to agree here — which is exactly why the naive mapping
    // survives casual testing and fails on a dropped note.
    const stave = staveScoreFor(
      scoreOf(
        [{ pitch: 'C4' }, { pitch: 'rest' }, { pitch: 'E4' }, { pitch: 'F4' }],
        [{ start_note_index: 2, end_note_index: 3 }],
      ),
    );
    const ids = slurIds(stave.items);
    expect(ids[0]).toBeUndefined();
    expect(ids[2]).toBeDefined();
    expect(ids[2]).toBe(ids[3]);
  });

  it('moves an endpoint inward when its note was not drawn', () => {
    // `H4` is not a pitch this engraver can place — German notation for B
    // natural, which the fuzzing found — so it makes no item. The slur over
    // the three notes is still the bowing for the two that are there.
    const stave = staveScoreFor(
      scoreOf(
        [{ pitch: 'H4' }, { pitch: 'D4' }, { pitch: 'E4' }],
        [{ start_note_index: 0, end_note_index: 2 }],
      ),
    );
    const ids = slurIds(stave.items);
    expect(ids.filter((id) => id !== undefined)).toHaveLength(2);
  });

  it('drops a slur that ends up over one note', () => {
    const stave = staveScoreFor(
      scoreOf(
        [{ pitch: 'C4' }, { pitch: 'H4' }],
        [{ start_note_index: 0, end_note_index: 1 }],
      ),
    );
    expect(slurIds(stave.items).filter((id) => id !== undefined)).toHaveLength(0);
  });

  it('never gives two slurs the same id', () => {
    // Neighbouring slurs that shared an id would be drawn as one arc across
    // the barline — a single long bow where the page asks for two.
    const stave = staveScoreFor(
      scoreOf(
        [{ pitch: 'C4' }, { pitch: 'D4' }, { pitch: 'E4' }, { pitch: 'F4' }],
        [
          { start_note_index: 0, end_note_index: 1 },
          { start_note_index: 2, end_note_index: 3 },
        ],
      ),
    );
    const ids = slurIds(stave.items);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
  });
});

describe('drawing the arc', () => {
  const slurred = (notes: StaveNote[]): StaveItem[] =>
    notes.map((note) => ({ ...note, slur: 1 }));

  it('draws one arc over a run and none over a single note', () => {
    const two = engrave(
      slurred([
        { pitch: 'C4', value: 'quarter' },
        { pitch: 'E4', value: 'quarter' },
      ]),
      'treble',
    );
    expect(two.systems[0].slurs).toHaveLength(1);

    const one = engrave(
      slurred([{ pitch: 'C4', value: 'quarter' }]),
      'treble',
    );
    expect(one.systems[0].slurs).toHaveLength(0);
  });

  it('arcs away from the stems', () => {
    // Low notes stem up, so the slur goes below them; high notes stem down, so
    // it goes above. A slur drawn through a group's stems is the same mistake
    // as a tuplet bracket on the wrong side.
    const low = engrave(
      slurred([
        { pitch: 'D4', value: 'quarter' },
        { pitch: 'E4', value: 'quarter' },
      ]),
      'treble',
    ).systems[0];
    expect(low.slurs[0].control.y).toBeGreaterThan(low.slurs[0].from.y);

    const high = engrave(
      slurred([
        { pitch: 'D5', value: 'quarter' },
        { pitch: 'E5', value: 'quarter' },
      ]),
      'treble',
    ).systems[0];
    expect(high.slurs[0].control.y).toBeLessThan(high.slurs[0].from.y);
  });

  it('clears the outer notehead of a chord, not just the principal', () => {
    // Measured from the principals alone, the arc cuts through a double stop's
    // upper note.
    const plain = engrave(
      slurred([
        { pitch: 'D5', value: 'quarter' },
        { pitch: 'E5', value: 'quarter' },
      ]),
      'treble',
    ).systems[0];
    const withChord = engrave(
      slurred([
        { pitch: 'D5', value: 'quarter', chord: ['B5'] },
        { pitch: 'E5', value: 'quarter' },
      ]),
      'treble',
    ).systems[0];
    expect(withChord.slurs[0].from.y).toBeLessThan(plain.slurs[0].from.y);
  });

  it('breaks into one arc per system rather than spanning the break', () => {
    // Runs, not endpoints: a slur cut by a line break is simply shorter on each
    // system, which is what a printed page does.
    const many = Array.from({ length: 12 }, (_, i) => ({
      pitch: `${'CDEFGAB'[i % 7]}4`,
      value: 'quarter' as const,
      ...(i % 4 === 0 && i > 0 ? { barBefore: true } : {}),
    }));
    const drawn = engrave(slurred(many), 'treble', {
      maxWidth: 200,
      lineGap: 5,
      noteGap: 14,
    });
    expect(drawn.systems.length).toBeGreaterThan(1);
    for (const system of drawn.systems) {
      expect(system.slurs.length).toBeLessThanOrEqual(1);
      for (const slur of system.slurs) {
        expect(slur.to.x).toBeLessThanOrEqual(system.width);
      }
    }
  });
});
