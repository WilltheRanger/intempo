/**
 * The takes a Record screen has in hand, which the background drain must leave
 * alone.
 *
 * **The same performance, in two places.** A take that fails to send is kept
 * by the screen, which offers "Send it again", *and* written to the device
 * queue, which the drainer retries on every foreground. Nothing told either
 * about the other. A musician who checked a message while "Send it again" was
 * showing came back to a drain that sent the take, a screen that still offered
 * to, and one tap from a second upload, a second analysis and a second free
 * take spent on the same playing.
 *
 * So the screen holds what it holds, and the drain skips it. When the screen
 * lets go — the take was sent, or the musician left with it unsent — the
 * drainer hears and runs, so a take walked away from still goes.
 *
 * Keyed by recording filename, which is what both copies share (`idFor` in
 * `queuedTakes.ts` derives the queue id from it). Counted, so two holds of one
 * take — a remount racing an unmount — release cleanly.
 */

const held = new Map<string, number>();
const listeners = new Set<() => void>();
/**
 * Takes the server has accepted this session. The queue copy of one is
 * removed asynchronously, and a screen lets go of a take the moment it sends
 * it, which wakes the drainer: without this, the drain could read the copy
 * before the removal landed and send the same playing again.
 */
const sent = new Set<string>();

/** Hold a take; the returned function lets go of it, once. */
export function holdTake(filename: string): () => void {
  held.set(filename, (held.get(filename) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (held.get(filename) ?? 1) - 1;
    if (count > 0) {
      held.set(filename, count);
      return;
    }
    held.delete(filename);
    for (const listener of listeners) listener();
  };
}

/** Whether a screen has this take in hand right now, or has already sent it. */
export function isTakeHeld(filename: string): boolean {
  return held.has(filename) || sent.has(filename);
}

/** The server accepted this take: never hand it to the drain again. */
export function markTakeSent(filename: string): void {
  sent.add(filename);
}

/** Called whenever a take stops being held. Returns the unsubscribe. */
export function onTakeReleased(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
