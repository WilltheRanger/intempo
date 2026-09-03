import { describe, expect, it } from 'vitest';

import { describePagePosition, pageAtOffset } from './pageIndex';

describe('pageAtOffset', () => {
  it('reports the page whose boundary the scroll settled on', () => {
    expect(pageAtOffset(0, 390, 3)).toBe(0);
    expect(pageAtOffset(390, 390, 3)).toBe(1);
    expect(pageAtOffset(780, 390, 3)).toBe(2);
  });

  it('rounds, so a scroll a pixel short does not report the page behind it', () => {
    // Truncating here is the bug: the label would read "Page 1 of 3" with page
    // 2 filling the screen.
    expect(pageAtOffset(389, 390, 3)).toBe(1);
    expect(pageAtOffset(391, 390, 3)).toBe(1);
  });

  it('clamps both ends, because both ends overscroll', () => {
    // iOS bounces past the last page; a trackpad can push the offset negative.
    expect(pageAtOffset(-40, 390, 3)).toBe(0);
    expect(pageAtOffset(1400, 390, 3)).toBe(2);
  });

  it('answers 0 before layout has measured a width', () => {
    // The first frame has a width of zero, and dividing by it gives Infinity.
    expect(pageAtOffset(0, 0, 3)).toBe(0);
    expect(pageAtOffset(120, 0, 3)).toBe(0);
    expect(pageAtOffset(120, Number.NaN, 3)).toBe(0);
  });

  it('answers 0 for a scan with no pages', () => {
    expect(pageAtOffset(0, 390, 0)).toBe(0);
  });
});

describe('describePagePosition', () => {
  it('counts from one, the way a musician numbers pages', () => {
    expect(describePagePosition(0, 3)).toBe('Page 1 of 3');
    expect(describePagePosition(2, 3)).toBe('Page 3 of 3');
  });

  it('says nothing about a one-page scan', () => {
    // "Page 1 of 1" is a label that never changes, taking space under the
    // photograph to say nothing.
    expect(describePagePosition(0, 1)).toBeNull();
    expect(describePagePosition(0, 0)).toBeNull();
  });

  it('cannot be argued into naming a page that is not there', () => {
    expect(describePagePosition(9, 3)).toBe('Page 3 of 3');
    expect(describePagePosition(-2, 3)).toBe('Page 1 of 3');
  });
});
