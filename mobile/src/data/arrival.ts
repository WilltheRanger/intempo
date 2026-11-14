import { useSyncExternalStore } from 'react';

/**
 * The first arrival after onboarding: "Welcome to InTempo" once, then the
 * Library opening its add sheet once (`redesign/OnboardDone.dc.html`).
 *
 * The prototype carried this in `sessionStorage` (`intempo:from-welcome`),
 * which the handoff lists among the things that exist only so the prototype
 * could click through. It is three states in memory here, and memory is the
 * right lifetime: an app relaunched between the save and the welcome has
 * already been used, and greeting somebody on their second visit as though it
 * were their first is the thing the flag exists to avoid.
 *
 * - `none` — nothing to show.
 * - `welcome` — the answers have just landed on the account; the done screen
 *   stands in front of the app until it is dismissed.
 * - `firstPiece` — dismissed with "Add your first piece"; the Library opens
 *   its add sheet if the shelf is still empty, then settles.
 *
 * **`firstPiece` was `riseIn`, and nothing read it for six weeks.** Today
 * consumed it to fade in once; when the Library replaced Today (2026-09-30)
 * the state was still set and nothing answered it, so "Start practicing" ended
 * on an empty shelf with the only action in the top quarter. The button now
 * says what it does and the Library does it.
 */
export type Arrival = 'none' | 'welcome' | 'firstPiece';

export type ArrivalEvent = 'onboarded' | 'started' | 'settled';

/**
 * Only forward, and only one step at a time.
 *
 * `onboarded` from anything but `none` is ignored: a second save — a retried
 * Finish, say — arriving after the Library has already been reached must not
 * put the welcome back in front of it.
 */
export function nextArrival(current: Arrival, event: ArrivalEvent): Arrival {
  if (event === 'onboarded') {
    return current === 'none' ? 'welcome' : current;
  }
  if (event === 'started') {
    return current === 'welcome' ? 'firstPiece' : current;
  }
  return 'none';
}

let current: Arrival = 'none';
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Arrival {
  return current;
}

function dispatch(event: ArrivalEvent): void {
  const next = nextArrival(current, event);
  if (next === current) {
    return;
  }
  current = next;
  listeners.forEach((listener) => listener());
}

export function useArrival(): Arrival {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const arrival = {
  /** The account has just been through onboarding. */
  onboarded(): void {
    dispatch('onboarded');
  },
  /** "Add your first piece". */
  started(): void {
    dispatch('started');
  },
  /** The Library has answered the arrival, or somebody signed out. */
  settled(): void {
    dispatch('settled');
  },
};
