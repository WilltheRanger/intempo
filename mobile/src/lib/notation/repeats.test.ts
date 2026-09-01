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
