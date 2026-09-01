import { describe, expect, it } from 'vitest';

import { engrave, type StaveItem } from './engrave';

/**
 * Fermatas, which the pipeline has read since Batch 2 and nothing drew.
 *
 * **This one is not just a missing marking.** `classification.py` refuses to
 * time the note *after* a fermata — the page has said that length is the
 * player's, so there is no written value to measure against. So a musician
 * reading a verdict met a note the app had declined to judge, above a stave
 * that offered no reason, because the mark that *is* the reason was not drawn
 * on it. Every other undrawn marking cost the page some of its meaning; this
 * one cost the app's own output its explanation.
 */
const HEAD = { clef: 'treble' as const, key: [], time: null };

function held(pitch: string, extra: Partial<StaveItem> = {}): StaveItem {
  return {
    pitch,
    value: 'quarter',
    barBefore: true,
    fermata: true,
    ...extra,
  } as StaveItem;
}

describe('a fermata is drawn', () => {
  it('is placed for a note that carries one, and only for that note', () => {
    const [system] = engrave(
      [held('B4'), { pitch: 'C5', value: 'quarter' }],
      'treble',
    ).systems;

    expect(system.notes[0].fermata).not.toBeNull();
    expect(system.notes[1].fermata).toBeNull();
  });

  it('centres it on the notehead', () => {
    const [system] = engrave([held('B4')], 'treble').systems;
    const mark = system.notes[0].fermata;
    if (!mark) {
      throw new Error('the note carries a fermata');
    }

    // `x` is the glyph's left edge, so the centre is half an advance along.
    const gap = system.staffLines[1] - system.staffLines[0];
    expect(mark.x + (gap * 2.42) / 2).toBeCloseTo(system.notes[0].x, 5);
  });
});

describe('where it sits', () => {
  it('clears the staff even for a note inside it', () => {
    // The below-staff glyph is for a second voice this engraver does not have,
    // so every fermata goes above — including one over a note in the middle of
    // the staff, where "above the note" would be inside the staff lines.
    const [system] = engrave([held('B4')], 'treble').systems;
    const mark = system.notes[0].fermata;
    if (!mark) {
      throw new Error('the note carries a fermata');
    }

    // y grows downward, so "above the top line" is a smaller number.
    expect(mark.y).toBeLessThan(system.staffLines[0]);
  });

  it('rises for a note that sits above the staff', () => {
    // **Measured from the staff, not in absolute y.** The engraving is shifted
    // so its topmost ink lands at a fixed offset, and for both of these the
    // topmost ink *is* the fermata — so both come out at the same absolute
    // height and the comparison says nothing. What moves is how far the mark
    // stands off the staff it belongs to.
    const inside = engrave([held('B4')], 'treble').systems[0];
    const above = engrave([held('C6')], 'treble').systems[0];

    const standoff = (system: typeof inside) => {
      const mark = system.notes[0].fermata;
      if (!mark) {
        throw new Error('the note carries a fermata');
      }
      return system.staffLines[0] - mark.y;
    };

    expect(standoff(above)).toBeGreaterThan(standoff(inside));
  });

  it('sits above an accent rather than on it', () => {
    // Both go over the note when the stem is down. An articulation hugs the
    // notehead; the fermata belongs to the bar and goes outside it.
    const [system] = engrave(
      [held('C6', { articulation: 'accent' })],
      'treble',
    ).systems;
    const note = system.notes[0];
    if (!note.fermata || !note.articulation) {
      throw new Error('the note carries both marks');
    }

    expect(note.articulation.above).toBe(true);
    expect(note.fermata.y).toBeLessThan(note.articulation.y);
  });

  it('clears the beam over a run of stems-up eighths', () => {
    // A beam is drawn *at* the stem tip and has thickness of its own, so a
    // mark placed by the tip alone grazes it.
    //
    // **G4, not D4.** Below about F4 the stem tip does not reach the top staff
    // line, so the staff floor decides the height and the beam allowance is
    // never consulted — a test written down there passes whatever this code
    // does with beams.
    const beamed: StaveItem[] = [
      { pitch: 'G4', value: 'eighth', barBefore: true },
      { pitch: 'G4', value: 'eighth', fermata: true } as StaveItem,
    ];
    const [system] = engrave(beamed, 'treble', { head: HEAD }).systems;
    const note = system.notes[1];
    if (!note.fermata || !note.stem) {
      throw new Error('a beamed eighth has a stem and carries the fermata');
    }
    const gap = system.staffLines[1] - system.staffLines[0];

    expect(note.stemUp).toBe(true);
    // The clearance (0.9) plus half a beam either side of the tip (0.5).
    expect(note.stem.to - note.fermata.y).toBeGreaterThanOrEqual(1.4 * gap - 1e-6);
  });
});

describe('the box around it', () => {
  it('grows so the mark is not clipped off the top', () => {
    // The lesson the flags taught: a glyph outside the measured box is simply
    // cut off, and the engraving looks fine right up until it doesn't.
    const plain = engrave([{ pitch: 'B4', value: 'quarter', barBefore: true }], 'treble');
    const marked = engrave([held('B4')], 'treble');

    expect(marked.height).toBeGreaterThan(plain.height);
  });

  it('keeps the whole glyph inside the box, not just its baseline', () => {
    const engraving = engrave([held('B4')], 'treble');
    const [system] = engraving.systems;
    const mark = system.notes[0].fermata;
    if (!mark) {
      throw new Error('the note carries a fermata');
    }
    const gap = system.staffLines[1] - system.staffLines[0];

    // The glyph rises 1.32 staff spaces above the baseline it is drawn on.
    expect(mark.y - gap * 1.32).toBeGreaterThan(0);
  });
});
