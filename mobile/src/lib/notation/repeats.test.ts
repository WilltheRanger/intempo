import { describe, expect, it } from 'vitest';

import { engrave, type StaveItem } from './engrave';
import { staveScoreFor } from './fromScore';
import type { ScoreJson, ScoreRepeat } from '../../data/types';

/**
 * Repeat signs, which the app played and never drew.
 *
 * `scheduleScore` runs `measuresInPlayOrder`, a port of the backend's
 * `expand_repeats`, so Listen has always played bars 1–8 twice for a piece with
 * a repeat — over a page showing one straight run of eight bars with no `:||`
 * anywhere. The app disagreed with itself, audibly, and a musician following
 * along on its own score got lost at bar 8.
 */

function scoreOf(measures: number, repeats: ScoreRepeat[]): ScoreJson {
  return {
    time_signature: '4/4',
    key_signature: 'C major',
    tempo_marking: null,
    bpm_hint: null,
    clef: 'treble',
    repeats,
    ocr_confidence: 1,
    notes_to_human: '',
    measures: Array.from({ length: measures }, (_, i) => ({
      measure_number: i + 1,
      slurs: [],
      notes: [
        { pitch: 'C4', duration: 'whole', tied_to_next: false },
      ],
    })),
  } as unknown as ScoreJson;
}

const repeat = (start: number, end: number): ScoreRepeat => ({
  start_measure: start,
  end_measure: end,
  type: 'repeat',
});

const marks = (items: StaveItem[]) =>
  items.map((item) => [item.repeatStartsBefore ?? false, item.repeatEndsBefore ?? false]);

describe('turning a repeat span into marks', () => {
  it('opens before its first bar and closes before the one after its last', () => {
    // A closing sign sits on the barline *after* the last repeated bar, which
    // is the same line as the one before the bar that follows it.
    const stave = staveScoreFor(scoreOf(5, [repeat(2, 4)]));
    expect(marks(stave.items)).toEqual([
      [false, false], // bar 1
      [true, false], // bar 2 — opens
      [false, false], // bar 3
      [false, false], // bar 4
      [false, true], // bar 5 — the barline before it closes bar 4
    ]);
    expect(stave.closesWithRepeat).toBe(false);
  });

  it('draws no opening sign on the first bar of the score', () => {
    // There is no barline before it to hang one on, and a printed part does not
    // draw one there either — the section is understood to start at the
    // beginning.
    const stave = staveScoreFor(scoreOf(4, [repeat(1, 3)]));
    expect(marks(stave.items)[0]).toEqual([false, false]);
    expect(marks(stave.items)[3]).toEqual([false, true]);
  });

  it('hands the last barline to the caller when the repeat ends there', () => {
    // **The one case with no item to carry the flag.** A repeat closing on the
    // final measure has nothing after it, so the engraver has to be told.
    const stave = staveScoreFor(scoreOf(4, [repeat(2, 4)]));
    expect(stave.closesWithRepeat).toBe(true);
    expect(marks(stave.items).some(([, ends]) => ends)).toBe(false);
  });

  it('puts both signs on one barline where one section meets the next', () => {
    // `:||:` — printed as one barline with dots on either side.
    const stave = staveScoreFor(scoreOf(6, [repeat(1, 3), repeat(4, 6)]));
    expect(marks(stave.items)[3]).toEqual([true, true]);
  });

  it('ignores endings, which are a bracket rather than a barline', () => {
    const stave = staveScoreFor(
      scoreOf(4, [{ start_measure: 3, end_measure: 3, type: 'first_ending' }]),
    );
    expect(marks(stave.items).flat().some(Boolean)).toBe(false);
  });
});

describe('endings', () => {
  it('reads a first ending as a closed bracket and a second as an open one', () => {
    // **The whole reading of the bracket.** A first ending is closed at the
    // right because the repeat sends you back from there; the last one is open
    // because you carry on. Drawing both the same says nothing.
    const stave = staveScoreFor(
      scoreOf(6, [
        repeat(1, 4),
        { start_measure: 4, end_measure: 4, type: 'first_ending' },
        { start_measure: 5, end_measure: 6, type: 'second_ending' },
      ]),
    );
    expect(stave.endings).toEqual([
      { label: '1.', from: 4, to: 4, closed: true },
      { label: '2.', from: 5, to: 6, closed: false },
    ]);
  });

  it('has none when the score has none', () => {
    expect(staveScoreFor(scoreOf(4, [repeat(1, 4)])).endings).toEqual([]);
  });
});

describe('drawing an ending', () => {
  // **With `measureNumber`.** A bracket spans measures, and `measureSpans` —
  // which is what it is measured from — carries whatever the items say. Items
  // out of `staveScoreFor` always number their measures; hand-built ones have
  // to, or the bracket has nothing to span.
  const bar = (number: number, extra: Partial<StaveItem> = {}): StaveItem =>
    ({ pitch: 'C4', value: 'whole', measureNumber: number, ...extra }) as StaveItem;

  const fourBars = () =>
    Array.from({ length: 4 }, (_, i) =>
      bar(i + 1, i > 0 ? { barBefore: true } : {}),
    );

  it('spans the measures it names and hooks down at the left', () => {
    const drawn = engrave(fourBars(), 'treble', {
      endings: [{ label: '1.', from: 3, to: 3, closed: true }],
    });
    const [ending] = drawn.systems[0].endings;
    expect(ending.label).toBe('1.');
    expect(ending.to).toBeGreaterThan(ending.from);
    expect(ending.hook).toBeGreaterThan(0);
  });

  it('closes at the right only for an ending that is closed', () => {
    const closed = engrave(fourBars(), 'treble', {
      endings: [{ label: '1.', from: 3, to: 3, closed: true }],
    }).systems[0].endings[0];
    const open = engrave(fourBars(), 'treble', {
      endings: [{ label: '2.', from: 3, to: 3, closed: false }],
    }).systems[0].endings[0];

    expect(closed.closesRight).toBe(true);
    expect(open.closesRight).toBe(false);
  });

  it('sits above everything else on the system', () => {
    // It has to clear beams, slurs, articulations and a tuplet bracket, which
    // is why it is built after every other extent is known rather than in the
    // note loop.
    const drawn = engrave(
      [
        bar(1),
        bar(2, { barBefore: true }),
        {
          pitch: 'C6',
          value: 'quarter',
          barBefore: true,
          measureNumber: 3,
          articulation: 'accent',
        } as StaveItem,
      ],
      'treble',
      { endings: [{ label: '1.', from: 3, to: 3, closed: true }] },
    );
    const system = drawn.systems[0];
    const ink = [
      ...system.notes.map((n) => n.y),
      ...system.notes.flatMap((n) => (n.articulation ? [n.articulation.y] : [])),
      ...system.staffLines,
    ];
    expect(system.endings[0].y).toBeLessThan(Math.min(...ink));
  });

  it('hooks at the right only on the system that finishes it', () => {
    // A bracket cut by a line break covers the measures each system holds; only
    // the one holding its last measure closes.
    const many = Array.from({ length: 10 }, (_, i) =>
      bar(i + 1, i > 0 ? { barBefore: true } : {}),
    );
    const drawn = engrave(many, 'treble', {
      maxWidth: 150,
      lineGap: 5,
      noteGap: 16,
      endings: [{ label: '1.', from: 1, to: 10, closed: true }],
    });
    expect(drawn.systems.length).toBeGreaterThan(1);
    const closing = drawn.systems.map((s) => s.endings[0]?.closesRight);
    expect(closing.slice(0, -1).every((c) => c === false)).toBe(true);
    expect(closing.at(-1)).toBe(true);
  });
});

describe('drawing them', () => {
  const bar = (extra: Partial<StaveItem> = {}): StaveItem =>
    ({ pitch: 'C4', value: 'whole', ...extra }) as StaveItem;

  it('marks the barline the item names', () => {
    const drawn = engrave(
      [bar(), bar({ barBefore: true, repeatStartsBefore: true }), bar({ barBefore: true })],
      'treble',
    );
    const kinds = drawn.systems[0].barlines.map((b) => b.repeat);
    expect(kinds).toEqual(['start', null, null]);
  });

  it('leaves every barline plain when nothing repeats', () => {
    const drawn = engrave([bar(), bar({ barBefore: true })], 'treble');
    expect(drawn.systems[0].barlines.every((b) => b.repeat === null)).toBe(true);
  });

  it('draws a repeat that ends at a line break on the line that ends it', () => {
    // **The case that lost the sign.** A repeat closing at a system break is
    // marked on the first item of the *next* run, and a system draws no barline
    // before its first item — so nothing was drawn at all. A printed part puts
    // it at the end of the line that finishes the section.
    const items = Array.from({ length: 8 }, (_, i) =>
      bar(i > 0 ? { barBefore: true } : {}),
    );
    const drawn = engrave(items, 'treble', {
      maxWidth: 150,
      lineGap: 5,
      noteGap: 16,
    });
    expect(drawn.systems.length).toBeGreaterThan(1);
    // Which item opens the second system, taken from the layout rather than
    // computed: `barlines` includes the closing one, and an off-by-one here
    // would silently test the wrong bar.
    const onFirst = drawn.systems[0].notes.length;

    const marked = items.map((item, i) =>
      i === onFirst ? { ...item, repeatEndsBefore: true } : item,
    );
    const after = engrave(marked, 'treble', {
      maxWidth: 150,
      lineGap: 5,
      noteGap: 16,
    });
    expect(after.systems[0].barlines.at(-1)!.repeat).toBe('end');
  });

  it('closes the last barline of the last system, and only that one', () => {
    // Every system ends with a barline; only the final one ends the piece.
    const drawn = engrave(
      Array.from({ length: 8 }, (_, i) => bar(i > 0 ? { barBefore: true } : {})),
      'treble',
      { maxWidth: 150, lineGap: 5, noteGap: 16, closesWithRepeat: true },
    );
    expect(drawn.systems.length).toBeGreaterThan(1);
    const closing = drawn.systems.map((system) => system.barlines.at(-1)!.repeat);
    expect(closing.slice(0, -1).every((kind) => kind === null)).toBe(true);
    expect(closing.at(-1)).toBe('end');
  });
});

describe('tempo markings', () => {
  const bar = (number: number, extra: Partial<StaveItem> = {}): StaveItem =>
    ({ pitch: 'C4', value: 'whole', measureNumber: number, ...extra }) as StaveItem;
  const fourBars = () =>
    Array.from({ length: 4 }, (_, i) => bar(i + 1, i > 0 ? { barBefore: true } : {}));

  it('are read off the score as printed, a new tempo with its number', () => {
    const stave = staveScoreFor({
      ...scoreOf(6, []),
      tempo_changes: [
        { measure_number: 3, kind: 'ritardando', text: 'poco rit.' },
        { measure_number: 5, kind: 'new_tempo', text: 'meno mosso', bpm: 88 },
      ],
    });

    expect(stave.tempoMarks).toEqual([
      { measure: 3, label: 'poco rit.' },
      { measure: 5, label: 'meno mosso · 88' },
    ]);
  });

  it('are drawn from the start of their bar, above the staff and any bracket', () => {
    const drawn = engrave(fourBars(), 'treble', {
      endings: [{ label: '1.', from: 3, to: 3, closed: true }],
      tempoMarks: [{ label: 'poco rit.', measure: 3 }],
    });
    const system = drawn.systems[0];
    const [mark] = system.tempoMarks;
    const bar3 = system.measureSpans.find((span) => span.measureNumber === 3)!;

    expect(mark.label).toBe('poco rit.');
    expect(mark.x).toBeCloseTo(bar3.from);
    expect(mark.y).toBeLessThan(Math.min(...system.staffLines));
    expect(mark.y).toBeLessThan(system.endings[0].y);
  });

  it('draw nothing on a system without them', () => {
    expect(engrave(fourBars(), 'treble', {}).systems[0].tempoMarks).toEqual([]);
  });
});
