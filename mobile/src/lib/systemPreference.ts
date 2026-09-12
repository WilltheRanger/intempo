/**
 * A boolean the operating system owns, published to React once for the app.
 *
 * `useReducedMotion` and `useReducedTransparency` are the same store twice: a
 * cached value, a set of listeners, a one-time platform read and a `listening`
 * flag so the second subscriber does not register a second listener. Only the
 * *source* differs — one asks `AccessibilityInfo` about motion, the other
 * about transparency and, on the web, a media query instead.
 *
 * `reducedTransparency.ts` said so in prose: "shaped exactly like
 * `useReducedMotion`". A shape described in a comment is a shape nothing keeps,
 * which this repository has now been bitten by twice in one week — the second
 * time in the audio pipeline, where a copy claiming to run the same steps was
 * one argument short of it.
 *
 * The one-listener-per-app property is the reason the shape exists at all:
 * every animated Library row used to register its own accessibility read and
 * listener, so a long repertoire did accessibility work at exactly the moment
 * its entrance and scrolling needed the main thread.
 */

export interface SystemPreference {
  /** For `useSyncExternalStore`. Starts watching on the first subscriber. */
  subscribe: (listener: () => void) => () => void;
  /** For `useSyncExternalStore`, as both the client and the server snapshot. */
  getSnapshot: () => boolean;
}

/**
 * `watch` is called at most once, when something first subscribes, and is
 * handed the publisher to report the value through — now and whenever it
 * changes. It is never called again, and nothing unwatches: the app's answer
 * to "is Reduce Motion on" outlives any one screen, and a store that tore its
 * platform listener down on the last unmount would re-read on every navigation.
 *
 * A repeated value publishes nothing, so a platform that fires its change
 * event on every setting rather than only its own does not re-render the app.
 */
export function systemPreference(
  watch: (publish: (value: boolean) => void) => void,
): SystemPreference {
  let current = false;
  let watching = false;
  const listeners = new Set<() => void>();

  function publish(value: boolean): void {
    if (current === value) {
      return;
    }
    current = value;
    listeners.forEach((listener) => listener());
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (!watching) {
        watching = true;
        watch(publish);
      }
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): boolean {
      return current;
    },
  };
}
