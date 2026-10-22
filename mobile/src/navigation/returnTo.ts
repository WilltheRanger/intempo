/**
 * How to reach a screen that may already be under this one.
 *
 * **`navigate` does not go back in React Navigation 7.** To a screen that is
 * in the stack but not on top, it pushes a second copy (`StackRouter`'s
 * `NAVIGATE` only reuses the current route, or an earlier one when asked to
 * `pop`). The scan flow relied on the old behaviour: every retake pushed a
 * second Scanner, with a second live camera mounted under the first, and its
 * return pushed a second review screen, so Back walked through stale copies.
 *
 * So a screen that is below goes back to it (`popTo`), and one that is not is
 * opened fresh (`navigate`). `popTo` on its own would not do: with nothing
 * below it replaces the current screen, and the first "Done" in the scanner
 * would then leave no viewfinder to come back to.
 *
 * `useGoBack.ts` records the same router fact for the back buttons.
 */
export type Reach = 'pop' | 'push';

export function howToReach(
  routes: readonly { name: string }[] | undefined,
  name: string,
): Reach {
  return routes?.some((route) => route.name === name) ? 'pop' : 'push';
}
