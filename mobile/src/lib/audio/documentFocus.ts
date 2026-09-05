/**
 * Whether this document is in a state that is allowed to open a microphone.
 *
 * **The rule, from the Media Capture and Streams spec**, on `getUserMedia`:
 *
 * > If the relevant settings object's responsible document is not fully
 * > active, return a promise rejected with `InvalidStateError`, **and the user
 * > agent must wait until the document is fully active and has focus** before
 * > continuing.
 *
 * WebKit does the first half and not the second: it rejects, and it does not
 * wait. So on an iPhone a tap that lands while the document does not have
 * focus fails with `InvalidStateError` — reported from a real device on
 * 2026-09-04, on a page that looked perfectly ordinary — and every subsequent
 * tap fails the same way, because nothing about the document changes between
 * taps. Reloading works, which is what made it look like a page-state problem
 * rather than a timing one.
 *
 * This is the waiting WebKit skips. It is not a workaround for a bug in the
 * app: the spec says an implementation should do exactly this, and doing it
 * ourselves turns a dead end into a take.
 *
 * A module rather than a branch in `audioRecorder.web.ts`, for the reason this
 * directory keeps repeating: there is no React Native testing library here
 * (`DECISIONS.md`, 2026-08-24), and a rule about focus that only runs on a
 * phone is a rule nothing checks.
 */

/**
 * How long to wait for focus before giving up.
 *
 * Long enough to cover a transient loss — a dismissing sheet, a keyboard going
 * down, the browser chrome settling after a tap — and short enough that a
 * musician who really has switched away is not left holding an instrument in
 * front of a button that appears to be thinking. A tap that produces nothing
 * for two seconds has already lost them.
 */
export const FOCUS_TIMEOUT_MS = 2000;

/** Whether the document can capture right now, as the spec defines it. */
export function canCapture(doc: Document | undefined = globalThis.document): boolean {
  if (!doc) {
    // No document at all — a native build, or a test. Nothing to wait for, and
    // refusing here would block the platform where this never applies.
    return true;
  }
  // `hasFocus` is the half WebKit enforces and does not wait for. `hidden`
  // covers a backgrounded tab, where a document is not fully active.
  const focused = typeof doc.hasFocus === 'function' ? doc.hasFocus() : true;
  return focused && doc.visibilityState !== 'hidden';
}

/**
 * Wait until the document can capture, or until the timeout.
 *
 * Resolves `true` if it became capturable and `false` if the wait ran out —
 * the caller decides what that means, because "still not focused" is a
 * different sentence from "the microphone is busy".
 *
 * Listens rather than polls: `focus` and `visibilitychange` are exactly the
 * two transitions that can make this true, and a poll would either miss the
 * moment or spend the whole timeout waking up.
 */
export function waitForCapture(
  timeoutMs: number = FOCUS_TIMEOUT_MS,
  doc: Document | undefined = globalThis.document,
): Promise<boolean> {
  if (canCapture(doc)) {
    return Promise.resolve(true);
  }
  if (!doc) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      doc.removeEventListener('visibilitychange', check);
      globalThis.removeEventListener?.('focus', check);
      resolve(value);
    };

    function check() {
      if (canCapture(doc)) {
        finish(true);
      }
    }

    const timer = setTimeout(() => finish(false), timeoutMs);
    doc.addEventListener('visibilitychange', check);
    // `focus` fires on the window, not the document, and it is the one that
    // answers when browser chrome hands the page back.
    globalThis.addEventListener?.('focus', check);

    // Ask for it, in case nothing else is going to. Harmless where the page
    // already has focus and unavailable in some embeddings, hence the guard.
    try {
      (globalThis as { focus?: () => void }).focus?.();
    } catch {
      // A frame that may not focus itself. The wait still stands.
    }
  });
}

/** Whether a rejection is the one this waiting exists for. */
export function isNotCapturableYet(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'InvalidStateError';
}
