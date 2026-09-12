/**
 * Whether the app behind an overlay is reachable, counted rather than toggled.
 *
 * **Extracted from `useInertAppRoot`, where it was module-level mutable state
 * inside a hook** — so the one rule in this app that can leave the whole
 * interface dead to a mouse and a keyboard was the one nothing could test.
 * There is no React Native testing library here (`DECISIONS.md`, 2026-08-24),
 * and `CLAUDE.md` §3 is explicit about what that means: put the rule in a
 * module with tests and let the component call it.
 *
 * **What it is for.** React Native Web renders `Modal` into a portal beside
 * `#root`, and the platform's `aria-modal` does not take the root's buttons and
 * fields out of the browser's keyboard order. HTML `inert` does, and it also
 * blocks pointer input and removes the subtree from assistive technology.
 *
 * **Counted, because dialogs stack.** A confirmation opened over a sheet must
 * not hand the app back when only the confirmation closes. The count is the
 * whole rule, and getting it wrong fails in the two worst directions available:
 * one decrement too many and the app is live underneath an open dialog; one too
 * few and it is permanently dead with nothing on screen to explain why.
 */

/** Anything with an `inert` flag — the root element, or a stand-in. */
export interface Inertable {
  inert: boolean;
}

export interface OverlayDepth {
  /** How many overlays are currently covering the root. */
  depth: number;
  /**
   * What `inert` was before the first of them, to be put back after the last.
   *
   * Restored rather than assumed false: something else may have set it, and a
   * cleanup that writes `false` unconditionally would quietly take over a flag
   * it does not own.
   */
  restoreTo: boolean;
}

export const noOverlays = (): OverlayDepth => ({ depth: 0, restoreTo: false });

/** An overlay became visible. */
export function cover(state: OverlayDepth, root: Inertable): void {
  // Read only on the way in from zero. Reading it on every open would capture
  // `true` — the value this function itself just wrote — and the last close
  // would then leave the app inert for good.
  if (state.depth === 0) {
    state.restoreTo = root.inert;
  }
  state.depth += 1;
  root.inert = true;
}

/** An overlay went away. */
export function uncover(state: OverlayDepth, root: Inertable): void {
  // Clamped, so an unbalanced close cannot drive the count negative and leave
  // the next open unable to reach zero again — which would be the permanent
  // version of the failure above.
  state.depth = Math.max(0, state.depth - 1);
  if (state.depth === 0) {
    root.inert = state.restoreTo;
  }
}
