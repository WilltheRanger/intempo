import { describe, expect, it } from 'vitest';

import { sceneDirection, sceneOffset, SCENE_TRAVEL } from './sceneMotion';

/**
 * The rule behind the web build's push transition.
 *
 * `StackScene.tsx` decides what the movement looks like; this decides which
 * way it goes, because that is the part with an off-by-one in it and there is
 * no React Native testing library here (`DECISIONS.md`, 2026-08-24).
 */
describe('sceneDirection', () => {
  it('sends a pushed scene in from the trailing edge', () => {
    expect(sceneDirection(0, 1)).toBe('forward');
    expect(sceneDirection(2, 3)).toBe('forward');
  });

  it('returns the scene underneath from the leading edge', () => {
    // The whole reason the previous index is the one this scene *saw* rather
    // than the one it was last focused at: Tabs sits at 0, watches a push take
    // the stack to 1, and is focused again at 0. Read off focus, both readings
    // are 0 and the return is indistinguishable from no navigation at all.
    expect(sceneDirection(1, 0)).toBe('back');
    expect(sceneDirection(3, 1)).toBe('back');
  });

  it('does not animate the root when the app starts', () => {
    // A scene with no history that is also the bottom of the stack mounted
    // because the app did, not because anything was pushed. Sliding it in
    // would be the app animating itself on at launch.
    expect(sceneDirection(null, 0)).toBe('none');
  });

  it('treats a scene that mounts above the root as pushed', () => {
    // Nothing is unmounted by React Navigation, so a scene with no history at
    // an index above zero can only have arrived by being pushed. A deep link
    // opened cold is the case that reaches this.
    expect(sceneDirection(null, 2)).toBe('forward');
  });

  it('does not re-enter when the index has not moved', () => {
    // `useNavigationState` publishes a new object for a params change too, and
    // replaying the entrance every time a screen's own data settles is a
    // flicker at somebody trying to read.
    expect(sceneDirection(1, 1)).toBe('none');
    expect(sceneDirection(0, 0)).toBe('none');
  });
});

describe('sceneOffset', () => {
  it('starts a push to the trailing side and a return to the leading side', () => {
    expect(sceneOffset('forward')).toBe(SCENE_TRAVEL);
    expect(sceneOffset('back')).toBe(-SCENE_TRAVEL);
  });

  it('starts in place when there is nothing to say', () => {
    expect(sceneOffset('none')).toBe(0);
  });

  it('travels far enough to read and not far enough to expose the page', () => {
    // Longer than a nudge, shorter than the screen. A full-width slide would
    // be the new scene sweeping across an empty page background, because the
    // one it replaced is already `display: none` — see `sceneMotion.ts`.
    expect(SCENE_TRAVEL).toBeGreaterThanOrEqual(16);
    expect(SCENE_TRAVEL).toBeLessThanOrEqual(64);
  });
});
