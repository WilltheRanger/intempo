import { useSyncExternalStore } from 'react';

/**
 * The first arrival after onboarding: "Welcome to InTempo" once, then Today
 * fading in once (`redesign/OnboardDone.dc.html`, `TodayLight.dc.html`).
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
 * - `riseIn` — dismissed; Today fades in on its first render, then settles.
 */
export type Arrival = 'none' | 'welcome' | 'riseIn';

export type ArrivalEvent = 'onboarded' | 'started' | 'settled';

/**
 * Only forward, and only one step at a time.
 *
 * `onboarded` from anything but `none` is ignored, because the answers are
 * saved from two places — `useApplyOnboardingDraft` and the gate's own
 * Continue — and a second save arriving after Today has already been reached
 * must not put the welcome back in front of it.
 */
export function nextArrival(current: Arrival, event: ArrivalEvent): Arrival {
  if (event === 'onboarded') {
    return current === 'none' ? 'welcome' : current;
  }
  if (event === 'started') {
    return current === 'welcome' ? 'riseIn' : current;
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
  /** "Start practicing". */
  started(): void {
    dispatch('started');
  },
  /** Today has faded in, or somebody signed out. */
  settled(): void {
    dispatch('settled');
  },
};
