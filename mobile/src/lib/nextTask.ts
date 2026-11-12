/**
 * Give the thread back for a moment, without waiting on a timer.
 *
 * Resolves in a task of its own, so whatever was waiting — a tap, a paint, the
 * player's own clock — runs first, and the work that awaited it carries on as
 * soon as it has.
 *
 * **Not `setTimeout(0)`.** A browser clamps a timer set from inside a timer to
 * at least 4 ms once they nest five deep, and a loop that yields that way is
 * exactly such a chain: Chromium took 395 ms for a hundred of them and 2 ms for
 * a hundred of these. Listen's render yielded 970 times for three minutes of
 * music, and so sat idle for 3.9 s of the 10 it took to start (2026-10-23).
 *
 * `setImmediate` where there is one: React Native, and Node under the tests.
 * A browser has none, and a message posted to itself is the task with no
 * clamp there.
 */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(resolve);
      return;
    }
    if (typeof MessageChannel === 'function') {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => {
        port1.close();
        resolve();
      };
      port2.postMessage(undefined);
      return;
    }
    setTimeout(resolve, 0);
  });
}
