import { describe, expect, it } from 'vitest';

import {
  anchorNearest,
  COMMIT_FRACTION,
  FLICK_VELOCITY,
  isVerticalDrag,
  offsetFromGrab,
  settleFrom,
  travelFor,
} from './sheet';

/**
 * The sheet on the record screen, which is the one control on it a musician
 * uses with an instrument in their hands. Every case here is a way it could
 * feel stuck or feel jumpy, and neither is visible from reading the component.
 */
describe('settleFrom', () => {
  const travel = 300;
  const past = travel * COMMIT_FRACTION + 1;
  const short = travel * COMMIT_FRACTION - 1;
  /** A sheet at rest, raised, is at offset 0; lowered is at full travel. */
  const RAISED = 0;
  const LOWERED = travel;

  const drag = (grabbedAt: number, dy: number, vy = 0) =>
    settleFrom(
      { grabbedAt, releasedAt: offsetFromGrab(grabbedAt, dy, travel), vy },
      travel,
    );

  it('lowers a raised sheet dragged past the commit point', () => {
    expect(drag(RAISED, past)).toBe('lowered');
  });

  it('leaves a raised sheet that was barely tugged', () => {
    expect(drag(RAISED, short)).toBe('raised');
  });

  it('raises a lowered sheet dragged up past the commit point', () => {
    expect(drag(LOWERED, -past)).toBe('raised');
  });

  it('leaves a lowered sheet that was barely tugged up', () => {
    expect(drag(LOWERED, -short)).toBe('lowered');
  });

  /**
   * The case that makes the rule worth having. Dragging *down* on a sheet that
   * is already down has nowhere to go, and an implementation that only looked
   * at distance would read the large `dy` as a commit and fire a state change
   * that changes nothing — which on a screen with a live metronome is a
   * re-render a musician can see.
   *
   * It is the clamp in `offsetFromGrab` that makes this true now: the sheet
   * cannot move, so the distance it moved is zero however far the finger went.
   */
  it('does nothing when dragged further in the direction it already sits', () => {
    expect(drag(LOWERED, past)).toBe('lowered');
    expect(drag(RAISED, -past)).toBe('raised');
  });

  it('commits a downward flick however short', () => {
    expect(drag(RAISED, 2, FLICK_VELOCITY)).toBe('lowered');
  });

  it('commits an upward flick however short', () => {
    expect(drag(LOWERED, -2, -FLICK_VELOCITY)).toBe('raised');
  });

  /**
   * A flick beats distance, not the other way round. Someone who drags the
   * sheet a long way down and then throws it back up has changed their mind,
   * and the last thing their hand did is the better evidence.
   */
  it('lets a flick overrule the distance travelled', () => {
    expect(drag(RAISED, past, -FLICK_VELOCITY * 2)).toBe('raised');
  });

  /**
   * **The mid-flight grab, which is what this rewrite is for.**
   *
   * Two honest notes about what these two assertions do and do not prove,
   * because the first version of this block claimed more than it delivered.
   *
   * *What changed.* The old rule took a `SheetPosition` and measured the drag
   * against that anchor, and the component passed it `positionRef` — which is
   * set to the **target** of a settle before the spring has moved anything. A
   * sheet caught two thirds of the way down while flying back up therefore
   * still reported `raised`, so a deliberate push *down* was measured as 50pt
   * of travel from an anchor 200pt above where the sheet actually was: short
   * of the commit point, so the old rule sent it to `raised`. The sheet you
   * just pushed down flew up. Swept over every catch point, heading and drag
   * distance, the two rules disagree on 2,379 settle decisions.
   *
   * *What these assertions prove.* They pin the new behaviour — pushed down
   * lands down, pushed up lands up — and they cannot be made to fail against
   * the old rule, because the old rule is no longer callable: the parameter
   * that carried the wrong origin does not exist any more. **That is the
   * actual fix.** `settleFrom` and `offsetFromGrab` take an offset rather than
   * an anchor, so "measured from a position the sheet is not at" stopped being
   * something you can express, rather than something you must remember not to
   * write. A test cannot demonstrate the absence of an argument; the signature
   * is the guarantee and these cases are the behaviour it buys.
   */
  it('sends a caught sheet where it was pushed, not where it was going', () => {
    // Caught at 200 of 300 while flying up; pushed down 50.
    expect(drag(200, 50)).toBe('lowered');
    // Caught at 100 while falling; pushed up 50.
    expect(drag(100, -50)).toBe('raised');
  });

  /**
   * A flick still wins from anywhere, including from a position that is not
   * an anchor — which is the case a rule keyed to `SheetPosition` could not
   * represent at all.
   */
  it('lets a flick commit from mid-flight', () => {
    expect(drag(travel * 0.3, 2, FLICK_VELOCITY)).toBe('lowered');
    expect(drag(travel * 0.7, -2, -FLICK_VELOCITY)).toBe('raised');
  });
});

describe('anchorNearest', () => {
  it('picks the end the sheet is closer to', () => {
    expect(anchorNearest(10, 300)).toBe('raised');
    expect(anchorNearest(290, 300)).toBe('lowered');
  });

  /**
   * Exactly halfway has to resolve somewhere, and down is the safer default:
   * it is the position with the peek still on screen, so the way back is
   * always visible. Pinned so a refactor cannot flip it silently.
   */
  it('resolves the exact midpoint downwards', () => {
    expect(anchorNearest(150, 300)).toBe('lowered');
  });
});

describe('offsetFromGrab', () => {
  it('follows the finger from a raised sheet', () => {
    expect(offsetFromGrab(0, 40, 300)).toBe(40);
  });

  it('follows the finger from a lowered sheet, which starts at full travel', () => {
    expect(offsetFromGrab(300, -40, 300)).toBe(260);
  });

  /** The whole point: any starting offset, not just the two anchors. */
  it('follows the finger from wherever the sheet was caught', () => {
    expect(offsetFromGrab(137, 20, 300)).toBe(157);
    expect(offsetFromGrab(137, -20, 300)).toBe(117);
  });

  /**
   * **The jump, which is the visible half of the bug.** The old rule based the
   * drag on one of two anchors, so the first frame of a mid-flight grab drew
   * the sheet wherever the anchor implied rather than where the finger had
   * just landed. A sheet caught at 240 of 300 and nudged up 10 was drawn at
   * 290 — it leapt 50pt *down* in response to an upward drag. Across the
   * whole space the worst first-frame jump was the full 300pt travel.
   *
   * Handing the live value in means the first frame is always within a finger
   * width of where the sheet already was, which is what `CLAUDE.md` §3 means
   * by a control answering the finger.
   */
  it('does not jump on the first frame of a grab', () => {
    const caught = 240;

    expect(offsetFromGrab(caught, 0, 300)).toBe(caught);
    expect(offsetFromGrab(caught, -10, 300)).toBe(230);
  });

  it('clamps rather than rubber-banding past either end', () => {
    expect(offsetFromGrab(0, 9999, 300)).toBe(300);
    expect(offsetFromGrab(0, -9999, 300)).toBe(0);
    expect(offsetFromGrab(300, 9999, 300)).toBe(300);
    expect(offsetFromGrab(150, -9999, 300)).toBe(0);
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
