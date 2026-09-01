import { describe, expect, it } from 'vitest';

import { engrave, type StaveItem } from '../../lib/notation/engrave';

/**
 * A stave that has to fit a box smaller than the music.
 *
 * **`maxWidth` cannot do this.** It wraps onto further systems and the
 * engraver breaks only at a barline, so a bar of four notes behind a clef
 * comes to 335pt and stays 335pt however narrow the box is. Measured on the
 * Today preview at 320pt: a 335pt engraving inside a 280pt view under
 * `overflow: hidden` — a sixth of the music cut off, through a notehead.
 *
 * `Stave`'s `fitWidth` shrinks instead, in **one** corrective pass. This is
 * the property that makes one pass enough, and it is the thing worth testing:
 * every geometry constant is multiplied by the scale and nothing else, so the
 * engraved width is linear in it. If that stops being true, halving the scale
 * will stop halving the width and the fit will silently miss.
 */
const NOTES: StaveItem[] = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'].map(
  (pitch, index) => ({ pitch, value: 'quarter', barBefore: index % 4 === 0 }),
);

function widthAt(scale: number): number {
  return engrave(NOTES, 'treble', {
    lineGap: 7 * scale,
    noteGap: 26 * scale,
    leftPad: 12 * scale,
    rightPad: 12 * scale,
    head: { clef: 'treble', key: [], time: null },
  }).width;
}

describe('fitting an engraving to a width', () => {
  it('is linear in the scale, which is why one pass lands exactly', () => {
    const full = widthAt(1);
    expect(widthAt(0.5)).toBeCloseTo(full / 2, 6);
    expect(widthAt(2)).toBeCloseTo(full * 2, 6);
  });

  it('reaches the target in one step from any starting scale', () => {
    for (const start of [0.6, 1, 1.8]) {
      for (const target of [120, 240, 300]) {
        const measured = widthAt(start);
        const fitted = start * (target / measured);
        expect(widthAt(fitted), `${start} → ${target}`).toBeCloseTo(target, 6);
      }
    }
  });
});
