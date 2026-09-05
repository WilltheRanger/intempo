import { afterEach, describe, expect, it, vi } from 'vitest';

import { canCapture, isNotCapturableYet, waitForCapture } from './documentFocus';

/**
 * The waiting the spec asks a browser to do, and WebKit does not.
 *
 * > If the responsible document is not fully active, return a promise rejected
 * > with `InvalidStateError`, **and the user agent must wait until the
 * > document is fully active and has focus**.
 *
 * WebKit rejects and does not wait, so on an iPhone a tap that lands while
 * focus is elsewhere fails — and every later tap fails identically, because
 * nothing about the document changes between them. Reported from a real device
 * on 2026-09-04, which is why any of this exists.
 */

/** A document whose focus and visibility this test moves by hand. */
function stubDocument(initial: { focused: boolean; hidden?: boolean }) {
  const listeners = new Map<string, Set<() => void>>();
  const doc = {
    focused: initial.focused,
    visibilityState: initial.hidden ? 'hidden' : 'visible',
    hasFocus() {
      return doc.focused;
    },
    addEventListener(type: string, listener: () => void) {
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    /** How many listeners are still attached — a wait must not leak them. */
    get attached() {
      return [...listeners.values()].reduce((n, set) => n + set.size, 0);
    },
    /** Hand focus back, the way the browser would. */
    regainFocus() {
      doc.focused = true;
      doc.visibilityState = 'visible';
      listeners.get('visibilitychange')?.forEach((l) => l());
    },
  };
  return doc as unknown as Document & { focused: boolean; attached: number; regainFocus(): void };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('whether the document may capture', () => {
  it('may, when it has focus and is visible', () => {
    expect(canCapture(stubDocument({ focused: true }))).toBe(true);
  });

  it('may not, without focus', () => {
    // The half WebKit enforces and does not wait for.
    expect(canCapture(stubDocument({ focused: false }))).toBe(false);
  });

  it('may not, while hidden', () => {
    expect(canCapture(stubDocument({ focused: true, hidden: true }))).toBe(false);
  });

  it('may, where there is no document at all', () => {
    // A native build, or a test. Refusing here would block the platform this
    // never applies to.
    expect(canCapture(undefined)).toBe(true);
  });
});

describe('waiting for it', () => {
  it('does not wait at all when the document is already ready', async () => {
    vi.useFakeTimers();

    await expect(waitForCapture(2000, stubDocument({ focused: true }))).resolves.toBe(true);
  });

  it('resolves as soon as focus comes back, without waiting out the timeout', async () => {
    vi.useFakeTimers();
    const doc = stubDocument({ focused: false });

    const waiting = waitForCapture(2000, doc);
    doc.regainFocus();

    await expect(waiting).resolves.toBe(true);
  });

  it('gives up rather than leaving a musician in front of a thinking button', async () => {
    // Two seconds covers a dismissing sheet or a keyboard going down. Longer
    // and a tap that will never work looks like one that might.
    vi.useFakeTimers();
    const doc = stubDocument({ focused: false });

    const waiting = waitForCapture(2000, doc);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(waiting).resolves.toBe(false);
  });

  it('leaves no listener behind, either way', async () => {
    vi.useFakeTimers();
    const gained = stubDocument({ focused: false });
    const timedOut = stubDocument({ focused: false });

    const first = waitForCapture(2000, gained);
    gained.regainFocus();
    await first;

    const second = waitForCapture(2000, timedOut);
    await vi.advanceTimersByTimeAsync(2000);
    await second;

    // A take is started many times in a session; a listener per attempt is a
    // leak that grows with use.
    expect(gained.attached).toBe(0);
    expect(timedOut.attached).toBe(0);
  });

  it('settles once, even if focus and the timeout race', async () => {
    vi.useFakeTimers();
    const doc = stubDocument({ focused: false });

    const waiting = waitForCapture(2000, doc);
    await vi.advanceTimersByTimeAsync(2000);
    doc.regainFocus();

    await expect(waiting).resolves.toBe(false);
  });
});

describe('which rejection this is for', () => {
  it('is InvalidStateError, and only that', () => {
    expect(isNotCapturableYet(new DOMException('x', 'InvalidStateError'))).toBe(true);
    // A refusal is a decision, not a timing problem, and waiting for focus
    // would turn an immediate answer into a two-second pause before the same
    // answer.
    expect(isNotCapturableYet(new DOMException('x', 'NotAllowedError'))).toBe(false);
    expect(isNotCapturableYet(new DOMException('x', 'NotReadableError'))).toBe(false);
    expect(isNotCapturableYet(new Error('InvalidStateError'))).toBe(false);
  });
});
