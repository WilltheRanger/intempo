/**
 * Which way a pushed screen arrives, on the build that has to draw it itself.
 *
 * **Only the web build needs this, and the reason is worth writing down.** The
 * app runs `@react-navigation/native-stack`, which on a phone hands the push
 * to UINavigationController and gets a real platform transition. On the web,
 * `react-native-screens` is a stub: `ScreenStack` is a `View` and
 * `NativeStackView` gives the focused screen `display: 'flex'` and every other
 * one `display: 'none'`. So a push is one frame — the screen you were on
 * vanishes and the next is simply there. Reported as pages that "just pop up
 * instead of having like an animation", which is exactly what the source says
 * happens.
 *
 * A `display` change cannot be transitioned: an element that was `none` has no
 * previous computed style to interpolate from. So the entrance has to be
 * driven from state inside the screen, and this is the part of that which is a
 * rule — there is no React Native testing library here (`DECISIONS.md`,
 * 2026-08-24), so an off-by-one written inside `StackScene.tsx` is an
 * off-by-one nothing checks (`CLAUDE.md` §3).
 */

/** Which way the stack moved. */
export type SceneDirection = 'forward' | 'back' | 'none';

/**
 * The direction a scene should enter from, given where the stack was and where
 * it is now.
 *
 * `previous` is the stack index this particular scene last saw — not the one
 * it was last *focused* at, which is the version that gets this wrong. A scene
 * that stays mounted underneath a push (every screen does; React Navigation
 * unmounts nothing) watches the index go up and come back down, and it is the
 * coming back down that means "you are being returned to".
 *
 *  - **A scene that has never seen an index has just mounted**, which in a
 *    stack means it was pushed — unless it is the root, which mounted because
 *    the app did. The root arriving from the right at launch would be the app
 *    animating itself in, which is a splash screen nobody asked for.
 *  - **Up is forward, down is back.** iOS slides an incoming screen in from
 *    the trailing edge and returns the one underneath from the leading edge,
 *    and this is the half of that the web build can draw.
 *  - **Same index is not a navigation.** `useNavigationState` publishes a new
 *    state object for a params change or a title change too, and re-playing an
 *    entrance every time a screen's own data settles is a flicker at somebody
 *    trying to read.
 */
export function sceneDirection(
  previous: number | null,
  current: number,
): SceneDirection {
  if (previous === null) {
    return current === 0 ? 'none' : 'forward';
  }
  if (current > previous) {
    return 'forward';
  }
  return current < previous ? 'back' : 'none';
}

/**
 * How far a scene travels as it arrives, in points.
 *
 * **Not the width of the screen, which is what iOS does.** A full-width slide
 * works there because the screen being left slides out underneath it; here it
 * cannot — `display: none` took it away on the first frame — so a full-width
 * slide would be the new screen sweeping across an empty page background. The
 * distance is short enough that the blank is behind type which is still
 * nearly transparent, and long enough to say which direction the stack moved.
 */
export const SCENE_TRAVEL = 32;

/** The offset a scene starts at, for a direction. Negative is from the left. */
export function sceneOffset(direction: SceneDirection): number {
  switch (direction) {
    case 'forward':
      return SCENE_TRAVEL;
    case 'back':
      return -SCENE_TRAVEL;
    case 'none':
      return 0;
  }
}
