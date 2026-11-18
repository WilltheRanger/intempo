/**
 * How a screen moves when the stack does, on the build that has to draw it.
 *
 * **Only the web build needs this.** On a phone `@react-navigation/native-stack`
 * hands the push to UINavigationController and gets the platform's own
 * transition. On the web `react-native-screens` is a stub, and the navigator
 * shows the focused screen and hides the rest, so a push was one frame — then
 * a 32pt nudge (2026-09-06), because the screen being left had already gone.
 *
 * **The iOS slide, now** (the owner, 2026-11-13: "tapping into a screen slides
 * it in from the right edge while the one you leave drifts a third left and
 * dims; back reverses it"). That needs the screen being left to stay drawn
 * while the new one crosses it, which the web navigator allows for a screen
 * presented as `containedTransparentModal` — the screen under it is not
 * hidden — so `RootNavigator` presents every route that way on the web only,
 * and `StackScene` hides whatever this module says is not being seen.
 *
 * The numbers are UIKit's, as the reference implementations measure them:
 * the screen underneath travels a third of the width (React Navigation's JS
 * stack and Flutter use a third, Ionic 33%) under a dim of about a tenth
 * (React Navigation 0.07, Ionic 0.1). The rules are here, with tests, because
 * there is no React Native testing library (`DECISIONS.md`, 2026-08-24).
 */

/** How far the screen underneath drifts while it is covered, as a share of the width. */
export const PARALLAX = 0.3;

/** How dark the screen underneath goes while it is covered: ink at this opacity. */
export const DIM = 0.1;

/** Where a screen is drawn: its offset as a share of its own width, its dim and its opacity. */
export interface Pose {
  x: number;
  dim: number;
  opacity: number;
}

/** In front, in place. */
export const REST: Pose = { x: 0, dim: 0, opacity: 1 };
/** Off the trailing edge: where a pushed screen starts and a popped one goes. */
export const OFF_TRAILING: Pose = { x: 1, dim: 0, opacity: 1 };
/** Under the screen in front: a third of the way off the leading edge, dimmed. */
export const UNDER: Pose = { x: -PARALLAX, dim: DIM, opacity: 1 };
/** In place and transparent: where a replacing screen starts. */
export const FADED: Pose = { x: 0, dim: 0, opacity: 0 };

/** What happened to the stack since a scene last rendered. */
export interface StackChange {
  /** The stack's index the last time this scene rendered; null on its first. */
  seen: number | null;
  /** The stack's index now. */
  index: number;
  /** This scene's own place in the stack. */
  own: number;
  /** The stack's length when the stack last settled; null before it first has. */
  settledLength: number | null;
  /** The stack's length now. */
  length: number;
  /**
   * The change has already been drawn: Safari's own swipe back from its
   * snapshot (`browserBack.ts`), or the app's own slide out ahead of the pop
   * (`sceneExit.ts`). Moving again would be the transition twice.
   */
  drawnAlready: boolean;
}

/** What a scene does about a change. */
export type ScenePlan =
  /** In front: draw `from` first, then slide to rest. */
  | { kind: 'arrive'; from: Pose }
  /** It was in front and a screen has been pushed over it: drift under, then stop drawing. */
  | { kind: 'cover' }
  /** In front with nothing to show for it. */
  | { kind: 'rest' }
  /** Somewhere under the screen in front, not drawn. */
  | { kind: 'hidden' };

/**
 * The plan for a scene, given what the stack just did.
 *
 *  - **A screen pushed over this one** covers it: it was in front (`seen` is
 *    its own place) and is now one under. It drifts under and stops being
 *    drawn when the slide ends.
 *  - **A screen that appears in front** slides in from the trailing edge when
 *    the stack grew — a push — and fades in when it did not, which is a
 *    `replace`: nothing was left behind for it to slide across.
 *  - **The stack's first build is not a push.** Every scene mounts at once on
 *    a cold start or a reload of a deep link; sliding the top one in would be
 *    the app animating itself on.
 *  - **A screen returned to** comes back from under: from a third off the
 *    leading edge, dimmed, to rest.
 *  - **Same index is not a navigation.** The navigator publishes a new state
 *    for a params change or a title too (`setOptions`), and replaying an
 *    entrance every time a screen's own data settles is a flicker.
 */
export function planFor(change: StackChange): ScenePlan {
  const { seen, index, own, settledLength, length, drawnAlready } = change;
  const position = own - index;

  if (position < 0) {
    const wasInFront = seen === own && position === -1;
    return wasInFront && !drawnAlready ? { kind: 'cover' } : { kind: 'hidden' };
  }

  if (drawnAlready) {
    return { kind: 'rest' };
  }
  if (seen === null) {
    if (settledLength === null) {
      return { kind: 'rest' };
    }
    return { kind: 'arrive', from: length > settledLength ? OFF_TRAILING : FADED };
  }
  if (seen > index) {
    return { kind: 'arrive', from: UNDER };
  }
  return { kind: 'rest' };
}

/**
 * Which way a flow of steps inside one screen moved — onboarding's questions.
 *
 * Not the stack's slide: a step is not a pushed screen, there is nothing to
 * reveal under it, and it keeps the short nudge the stack had before
 * (2026-09-06), which says which way the flow went without sweeping the whole
 * question across the page.
 */
export type SceneDirection = 'forward' | 'back' | 'none';

/** How far a step travels as it arrives, in points. */
export const SCENE_TRAVEL = 32;

/** The offset a step starts at, for a direction. Negative is from the left. */
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

/** A pose as the CSS a scene is drawn with, minus the transition. */
export function poseTransform(pose: Pose): string {
  return `translateX(${pose.x * 100}%)`;
}
