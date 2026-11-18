import { createContext, useContext } from 'react';

/**
 * The app's own slide out, drawn ahead of the pop it stands for.
 *
 * **The navigator removes a popped screen in the same commit as the pop**, so
 * on the web — where the app draws its own transitions (`sceneMotion.ts`) —
 * a screen cannot slide off the trailing edge after it has been popped; it is
 * already gone. iOS's back is that slide, so an in-app back draws it first:
 * the screen in front slides out, the one under it comes back from under,
 * and only then does the stack pop. The screen it reveals is already in
 * place, so its own arrival is skipped (`exitJustDrawn`), the way Safari's
 * swipe back is (`browserBack.ts`).
 *
 * Module state, like `browserBack.ts`: the scenes that take part are siblings
 * the navigator renders, with nothing above them but the navigator itself.
 */

/** Long enough to cover the render the pop causes, and no longer. */
export const EXIT_DRAWN_WINDOW_MS = 600;

let drawnAt = Number.NEGATIVE_INFINITY;

/** The rule, without the clock: was the exit drawn within the window? */
export function exitDrawnWithin(now: number, at: number): boolean {
  return now - at >= 0 && now - at < EXIT_DRAWN_WINDOW_MS;
}

/** Say that the stack change about to happen has already been drawn. */
export function markExitDrawn(): void {
  drawnAt = now();
}

/** Take that back: the pop did not happen (something held it). */
export function clearExitDrawn(): void {
  drawnAt = Number.NEGATIVE_INFINITY;
}

/** Whether the stack change being rendered now was drawn by an exit. */
export function exitJustDrawn(): boolean {
  return exitDrawnWithin(now(), drawnAt);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** What a scene underneath is asked to do while the one above it moves. */
export type UnderRequest = 'reveal' | 'cover';

type UnderListener = (own: number, request: UnderRequest) => void;
const listeners = new Set<UnderListener>();

/** A scene listening for requests addressed to its place in the stack. */
export function onUnderRequest(listener: UnderListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ask the scene at `own` to come back from under (`reveal`) or go back under (`cover`). */
export function requestUnder(own: number, request: UnderRequest): void {
  listeners.forEach((listener) => listener(own, request));
}

/**
 * The stack's length when it last settled; null before it first has.
 *
 * A screen appearing in front tells a push (the stack grew) from a replace
 * (it did not) by comparing with this, and the stack's first build — a cold
 * start, a reload of a deep link — by its being null (`sceneMotion.planFor`).
 */
let settledLength: number | null = null;

export function settledStackLength(): number | null {
  return settledLength;
}

export function noteStackLength(length: number): void {
  settledLength = length;
}

/**
 * Slide the screen in front out, then run `then` — the pop. Provided by
 * `StackScene`; outside one, or where nothing is drawn, it runs `then` at once.
 */
export type SceneExit = (then: () => void) => void;

const runAtOnce: SceneExit = (then) => then();

export const SceneExitContext = createContext<SceneExit>(runAtOnce);

/** The exit of the screen this is drawn in. */
export function useSceneExit(): SceneExit {
  return useContext(SceneExitContext);
}
