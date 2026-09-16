import { describe, expect, it } from 'vitest';

import {
  COMMIT_FRACTION,
  FLICK_VELOCITY,
  isVerticalDrag,
  offsetDuring,
  settleTo,
  travelFor,
} from './sheet';

/**
 * The sheet on the record screen, which is the one control on it a musician
 * uses with an instrument in their hands. Every case here is a way it could
 * feel stuck or feel jumpy, and neither is visible from reading the component.
 */
describe('settleTo', () => {
  const travel = 300;
  const past = travel * COMMIT_FRACTION + 1;
  const short = travel * COMMIT_FRACTION - 1;

  it('lowers a raised sheet dragged past the commit point', () => {
    expect(settleTo('raised', { dy: past, vy: 0 }, travel)).toBe('lowered');
  });

  it('leaves a raised sheet that was barely tugged', () => {
    expect(settleTo('raised', { dy: short, vy: 0 }, travel)).toBe('raised');
  });

  it('raises a lowered sheet dragged up past the commit point', () => {
    expect(settleTo('lowered', { dy: -past, vy: 0 }, travel)).toBe('raised');
  });

  it('leaves a lowered sheet that was barely tugged up', () => {
    expect(settleTo('lowered', { dy: -short, vy: 0 }, travel)).toBe('lowered');
  });

  /**
   * The case that makes the rule worth having. Dragging *down* on a sheet that
   * is already down has nowhere to go, and an implementation that only looked
   * at distance would read the large `dy` as a commit and fire a state change
   * that changes nothing — which on a screen with a live metronome is a
   * re-render a musician can see.
   */
  it('does nothing when dragged further in the direction it already sits', () => {
    expect(settleTo('lowered', { dy: past, vy: 0 }, travel)).toBe('lowered');
    expect(settleTo('raised', { dy: -past, vy: 0 }, travel)).toBe('raised');
  });

  it('commits a downward flick however short', () => {
    expect(settleTo('raised', { dy: 2, vy: FLICK_VELOCITY }, travel)).toBe('lowered');
  });

  it('commits an upward flick however short', () => {
    expect(settleTo('lowered', { dy: -2, vy: -FLICK_VELOCITY }, travel)).toBe('raised');
  });

  /**
   * A flick beats distance, not the other way round. Someone who drags the
   * sheet a long way down and then throws it back up has changed their mind,
   * and the last thing their hand did is the better evidence.
   */
  it('lets a flick overrule the distance travelled', () => {
    expect(settleTo('raised', { dy: past, vy: -FLICK_VELOCITY * 2 }, travel)).toBe('raised');
  });
});

describe('offsetDuring', () => {
  it('follows the finger from raised', () => {
    expect(offsetDuring('raised', 40, 300)).toBe(40);
  });

  it('follows the finger from lowered, which starts at full travel', () => {
    expect(offsetDuring('lowered', -40, 300)).toBe(260);
  });

  it('clamps rather than rubber-banding past either end', () => {
    expect(offsetDuring('raised', 9999, 300)).toBe(300);
    expect(offsetDuring('raised', -9999, 300)).toBe(0);
    expect(offsetDuring('lowered', 9999, 300)).toBe(300);
  });
});

describe('travelFor', () => {
  it('is the part of the sheet that slides away', () => {
    expect(travelFor(320, 72)).toBe(248);
  });

  /**
   * A zero travel would make `dy > travel / 3` true for every drag, so the
   * sheet would commit on contact. This can really happen: the handle reports
   * its layout before the content below it has measured.
   */
  it('never reports a travel of zero, however small the sheet measures', () => {
    expect(travelFor(0, 72)).toBe(1);
    expect(travelFor(72, 72)).toBe(1);
  });
});

describe('isVerticalDrag', () => {
  it('ignores movement too small to be meant', () => {
    expect(isVerticalDrag(0, 2)).toBe(false);
  });

  it('claims a clear vertical drag', () => {
    expect(isVerticalDrag(2, 30)).toBe(true);
  });

  /**
   * On iOS a horizontal swipe from the edge goes back. A sheet that captured
   * it would make this the one screen you cannot leave by swiping, which is a
   * worse bug than the sheet not opening.
   */
  it('leaves a sideways swipe alone so the back gesture still works', () => {
    expect(isVerticalDrag(40, 10)).toBe(false);
  });
});
