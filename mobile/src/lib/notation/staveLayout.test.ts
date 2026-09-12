import { describe, expect, it } from 'vitest';

import { LEFT_PAD, LINE_GAP, NOTE_GAP, RIGHT_PAD, layOutStave } from './staveLayout';
import type { StaveItem } from './engrave';

/**
 * A stave never draws wider than the box it was given.
 *
 * `layOutStave` shrinks an engraving to fit in **one corrective pass**, and
 * its own comment says why that is allowed to work:
 *
 * > Every geometry constant here is multiplied by the scale and nothing else,
 * > so the engraved width is linear in it: measuring once and dividing gives
 * > the scale that fits, rather than converging on it.
 *
 * That is a claim about `engrave`, not about this function — and it is exactly
 * the kind that stops being true quietly. One unscaled constant added down
 * there (a fixed font size, a fixed pad, a stroke width that forgot the
 * multiplier) makes width **affine** rather than linear, `fitWidth / width`
 * overshoots, and the single pass lands past the edge. Nothing else in this
 * repository would notice: the engraving is still correct music, drawn a few
 * points too wide, and the only symptom is a stave clipped by its container on
 * a screen nobody screenshots at that width.
 *
 * Measured when this was written: every case needing a shrink lands on
 * `fitWidth` to within a hundredth of a point.
 */

/** `n` quarter notes, cycling a triad so beams and stems vary. */
function notes(count: number): StaveItem[] {
  return Array.from({ length: count }, (_, index) => ({
    pitch: ['C4', 'E4', 'G4', 'B4'][index % 4],
    value: 'quarter' as const,
  }));
}

const COUNTS = [4, 8, 16, 32];
const WIDTHS = [120, 200, 320, 500];

describe('fitting a stave to a width', () => {
  const cases = COUNTS.flatMap((count) =>
    WIDTHS.map((fitWidth) => ({
      count,
      fitWidth,
      out: layOutStave({ notes: notes(count), clef: 'treble', fitWidth }),
    })),
  );

  it('shrinks in some of these, or the rules below prove nothing', () => {
    // Vacuity: if every case already fitted, "never exceeds" would hold for a
    // function that did no fitting at all.
    const shrunk = cases.filter(({ out }) => out.fitted < 1);
    expect(shrunk.length).toBeGreaterThanOrEqual(cases.length / 2);
  });

  it('never draws wider than the box', () => {
    for (const { count, fitWidth, out } of cases) {
      expect(
        out.layout.width,
        `${count} notes into ${fitWidth}pt drew ${out.layout.width.toFixed(2)}`,
      ).toBeLessThanOrEqual(fitWidth + 0.01);
    }
  });

  it('lands on the width in one pass rather than merely under it', () => {
    // The difference that matters: a function that shrank by a safe margin
    // would also satisfy the rule above, and would waste a tenth of the screen
    // on every score. Linear width is what makes one division exact.
    for (const { count, fitWidth, out } of cases) {
      if (out.fitted === 1) continue;
      expect(
        out.layout.width,
        `${count} notes into ${fitWidth}pt landed at ${out.layout.width.toFixed(2)}`,
      ).toBeCloseTo(fitWidth, 1);
    }
  });

  it('only ever shrinks', () => {
    // `fitWidth` is documented as "Only ever down". A stave stretched up to
    // fill a wide container would draw a handful of notes at cartoon size.
    for (const { out } of cases) {
      expect(out.fitted).toBeLessThanOrEqual(1);
    }
    const roomy = layOutStave({ notes: notes(4), clef: 'treble', fitWidth: 2000 });
    expect(roomy.fitted).toBe(1);
    expect(roomy.layout.width).toBeLessThan(2000);
  });

  it('reports the line gap it actually drew at', () => {
    // `Stave` positions noteheads with this, so a `lineGap` that did not match
    // the engraving would put every note off its line.
    for (const { out } of cases) {
      expect(out.lineGap).toBeCloseTo(LINE_GAP * out.fitted, 10);
    }
  });

  it('scales every geometry constant, which is what makes the width linear', () => {
    // The property stated in the docstring, checked directly: double the
    // scale, double the width. An unscaled constant shows up here as an
    // intercept — and this is the assertion that names the cause when the
    // one-pass rule above starts failing.
    const half = layOutStave({ notes: notes(12), clef: 'treble', scale: 0.5 });
    const one = layOutStave({ notes: notes(12), clef: 'treble', scale: 1 });
    const two = layOutStave({ notes: notes(12), clef: 'treble', scale: 2 });

    expect(one.layout.width).toBeCloseTo(half.layout.width * 2, 6);
    expect(two.layout.width).toBeCloseTo(one.layout.width * 2, 6);
    // And the constants are the ones the width is built from, so a new pad
    // added to `engrave` without a home here is caught by the ratios above.
    expect(LINE_GAP + NOTE_GAP + LEFT_PAD + RIGHT_PAD).toBeGreaterThan(0);
  });
});
