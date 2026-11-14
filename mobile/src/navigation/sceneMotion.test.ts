import { describe, expect, it } from 'vitest';

import {
  DIM,
  FADED,
  OFF_TRAILING,
  PARALLAX,
  REST,
  UNDER,
  planFor,
  poseTransform,
  sceneOffset,
  SCENE_TRAVEL,
  type StackChange,
} from './sceneMotion';

/**
 * The rules behind the web build's iOS slide.
 *
 * `StackScene.tsx` draws the movement; this decides which movement, because
 * that is the part with an off-by-one in it and there is no React Native
 * testing library here (`DECISIONS.md`, 2026-08-24).
 */
const settled = (overrides: Partial<StackChange>): StackChange => ({
  seen: 0,
  index: 0,
  own: 0,
  settledLength: 1,
  length: 1,
  drawnAlready: false,
  ...overrides,
});

describe('a push', () => {
  it('slides the new screen in from the trailing edge', () => {
    expect(planFor(settled({ seen: null, own: 1, index: 1, settledLength: 1, length: 2 }))).toEqual({
      kind: 'arrive',
      from: OFF_TRAILING,
    });
  });

  it('drifts the screen it covers under it', () => {
    expect(planFor(settled({ seen: 0, own: 0, index: 1, length: 2 }))).toEqual({ kind: 'cover' });
  });

  it('leaves the screens further down alone, undrawn', () => {
    // Tabs at 0, a piece at 1, its score pushed to 2: only the piece moves.
    expect(planFor(settled({ seen: 1, own: 0, index: 2, length: 3 }))).toEqual({ kind: 'hidden' });
  });
});

describe('a replace', () => {
  it('fades the new screen in, with nothing left behind for it to cross', () => {
    // Record replaced by its result: the stack is the same length.
    expect(planFor(settled({ seen: null, own: 2, index: 2, settledLength: 3, length: 3 }))).toEqual({
      kind: 'arrive',
      from: FADED,
    });
  });
});

describe('going back', () => {
  it('brings the screen returned to back from under', () => {
    expect(planFor(settled({ seen: 1, own: 0, index: 0, length: 1 }))).toEqual({
      kind: 'arrive',
      from: UNDER,
    });
  });

  it('does not move again when the change was already drawn', () => {
    // Safari's swipe back, or the app's own slide out ahead of the pop.
    expect(planFor(settled({ seen: 1, own: 0, index: 0, drawnAlready: true }))).toEqual({
      kind: 'rest',
    });
    expect(planFor(settled({ seen: 0, own: 0, index: 1, drawnAlready: true }))).toEqual({
      kind: 'hidden',
    });
  });

  it('comes back from under after a pop of several screens', () => {
    expect(planFor(settled({ seen: 3, own: 1, index: 1, length: 2 })).kind).toBe('arrive');
  });
});

describe('what is not a navigation', () => {
  it('does not animate the stack being built on a cold start or a reload', () => {
    expect(planFor(settled({ seen: null, own: 0, index: 2, settledLength: null, length: 3 }))).toEqual({
      kind: 'hidden',
    });
    expect(planFor(settled({ seen: null, own: 2, index: 2, settledLength: null, length: 3 }))).toEqual({
      kind: 'rest',
    });
  });

  it('does not re-enter when the index has not moved', () => {
    // A params change or a title published with `setOptions`.
    expect(planFor(settled({ seen: 1, own: 1, index: 1, length: 2 }))).toEqual({ kind: 'rest' });
  });

  it('keeps a screen under the stack hidden while the stack moves above it', () => {
    expect(planFor(settled({ seen: 3, own: 0, index: 2, length: 3 }))).toEqual({ kind: 'hidden' });
  });
});

describe('the poses', () => {
  it('drift the covered screen a third of the width under a light dim', () => {
    expect(UNDER).toEqual({ x: -PARALLAX, dim: DIM, opacity: 1 });
    expect(PARALLAX).toBeGreaterThanOrEqual(0.2);
    expect(PARALLAX).toBeLessThanOrEqual(1 / 3);
    expect(DIM).toBeGreaterThan(0);
    expect(DIM).toBeLessThanOrEqual(0.12);
  });

  it('rest in place, undimmed', () => {
    expect(REST).toEqual({ x: 0, dim: 0, opacity: 1 });
  });

  it('are drawn as a share of the screen’s own width', () => {
    expect(poseTransform(OFF_TRAILING)).toBe('translateX(100%)');
    expect(poseTransform(UNDER)).toBe('translateX(-30%)');
    expect(poseTransform(REST)).toBe('translateX(0%)');
  });
});

describe('a step inside one screen', () => {
  it('starts a step forward on the trailing side and a step back on the leading side', () => {
    expect(sceneOffset('forward')).toBe(SCENE_TRAVEL);
    expect(sceneOffset('back')).toBe(-SCENE_TRAVEL);
    expect(sceneOffset('none')).toBe(0);
  });

  it('travels far enough to read and not far enough to sweep the question away', () => {
    expect(SCENE_TRAVEL).toBeGreaterThanOrEqual(16);
    expect(SCENE_TRAVEL).toBeLessThanOrEqual(64);
  });
});
