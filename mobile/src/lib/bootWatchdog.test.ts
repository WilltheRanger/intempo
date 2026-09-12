import { beforeEach, describe, expect, it } from 'vitest';

// Imported rather than read off disk: this project has no `@types/node`, so
// `readFileSync` does not typecheck (see `transcriptionProgress.test.ts`).
import indexHtml from '../../public/index.html?raw';

/**
 * The boot watchdog in `public/index.html`.
 *
 * **It took a working app off the screen.** On 2026-08-24 a musician sent in a
 * full-screen "The app crashed while starting." over "unknown error", on one
 * bar of cellular signal. The app had not crashed. It had started, mounted and
 * was running underneath.
 *
 * Two faults, and they compound:
 *
 * 1. The `error` listener runs in the capture phase so it can see a script that
 *    404s — and it therefore also sees every `<img>` that fails. A resource
 *    error dispatches a plain `Event` at the element, so it has no `.error` and
 *    no `.message`, and both fell through to the literal string
 *    `'unknown error'`. A dropped thumbnail request looked exactly like a crash.
 * 2. `report()` replaced all of `#root`'s inline style with `display:block`.
 *    The stylesheet gives `#root` `display:flex; height:100%; flex:1`, and
 *    react-native-web's container is `flex:1 1 0%` inside it — so the mounted
 *    tree collapsed to **zero height**. Measured in a browser against the build
 *    that shipped: `#root display: block, app container height: 0`.
 *
 * The watchdog is plain ES5 in an HTML file on purpose: it has to work in
 * exactly the conditions where everything else did not. That leaves it with no
 * natural test seam, so this evaluates it against a hand-built DOM stub — the
 * smallest thing that exercises the two rules above without a browser.
 */

interface FakeElement {
  tagName: string;
  src?: string;
  href?: string;
  style: { cssText: string };
  children: FakeElement[];
  childElementCount: number;
  textContent: string;
  appendChild(child: FakeElement): void;
}

function element(tagName: string): FakeElement {
  return {
    tagName,
    style: { cssText: '' },
    children: [],
    get childElementCount() {
      return this.children.length;
    },
    textContent: '',
    appendChild(child: FakeElement) {
      this.children.push(child);
    },
  } as FakeElement;
}

/** Runs the watchdog IIFE against a stub DOM and hands back the levers. */
function bootWatchdog() {
  const html = indexHtml.replace(/\r\n/g, '\n');
  const start = html.indexOf('(function () {\n        var reported = false;');
  const end = html.indexOf('})();', start);
  expect(start, 'the watchdog IIFE moved; this test can no longer find it').toBeGreaterThan(-1);
  const source = html.slice(start, end + '})();'.length);

  const root = element('DIV');
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const timers: (() => void)[] = [];

  const win = {
    addEventListener(type: string, fn: (event: unknown) => void) {
      (listeners[type] ??= []).push(fn);
    },
    isSecureContext: true,
    fetch: undefined,
  };
  const doc = {
    getElementById: (id: string) => (id === 'root' ? root : null),
    createElement: (tag: string) => element(tag.toUpperCase()),
    querySelector: () => ({ src: 'https://example.test/_expo/static/js/web/index-abc.js' }),
  };

  new Function(
    'window',
    'document',
    'navigator',
    'location',
    'setTimeout',
    source,
  )(
    win,
    doc,
    { userAgent: 'stub' },
    { origin: 'https://example.test' },
    (fn: () => void) => timers.push(fn),
  );

  return {
    root,
    fire: (type: string, event: unknown) => listeners[type]?.forEach((fn) => fn(event)),
    runTimeout: () => timers.forEach((fn) => fn()),
    text: () => root.children.map((c) => c.textContent).join(' | '),
  };
}

/** A resource that failed: a plain Event at the element. No message, no error. */
function resourceError(tagName: string, url: string) {
  const target = element(tagName);
  if (tagName === 'SCRIPT') target.src = url;
  else if (tagName === 'LINK') target.href = url;
  else target.src = url;
  return { target };
}

let app: ReturnType<typeof bootWatchdog>;

beforeEach(() => {
  app = bootWatchdog();
});

describe('an app that has already mounted', () => {
  it('is never replaced by the watchdog', () => {
    // The reported bug. Measured in a browser against the shipped build:
    // #root went to display:block and the app container's height went to 0.
    app.root.appendChild(element('DIV')); // React mounted.

    app.fire('error', resourceError('IMG', '/assets/fixtures/page.jpg'));

    expect(app.text()).not.toMatch(/crashed while starting/);
    expect(app.root.style.cssText, 'the mounted layout was overwritten').toBe('');
  });

  it('is not replaced even by a real thrown error', () => {
    // Past the mount, the app has its own error boundary. Blanking the screen
    // is worse than whatever is being reported.
    app.root.appendChild(element('DIV'));

    app.fire('error', { message: 'TypeError: x is not a function', error: null });

    expect(app.text()).not.toMatch(/crashed while starting/);
  });
});

describe('before anything has mounted', () => {
  it('still reports a bundle that failed to load', () => {
    app.fire('error', resourceError('SCRIPT', 'https://example.test/_expo/bundle.js'));

    expect(app.text()).toMatch(/bundle failed to load/);
    expect(app.text()).toContain('https://example.test/_expo/bundle.js');
  });

  it('still reports a real crash, with its message', () => {
    app.fire('error', {
      message: 'ReferenceError: nope',
      error: { message: 'ReferenceError: nope', stack: 'ReferenceError: nope\n  at boot' },
    });

    expect(app.text()).toMatch(/crashed while starting/);
    expect(app.text()).toContain('ReferenceError: nope');
  });
});

describe('a resource that failed', () => {
  it('does not by itself claim the app crashed', () => {
    // An <img> is not a crash. expo-image and react-native-web both mount real
    // in-document <img> elements, so every score thumbnail is one of these.
    app.fire('error', resourceError('IMG', '/assets/fixtures/01_simple_printed.jpg'));

    expect(app.text()).not.toMatch(/crashed while starting/);
  });

  it('does not latch, so a later real failure is still reported', () => {
    // `report` sets `reported = true` and refuses to fire again. A dropped
    // thumbnail used to spend that one shot, hiding whatever came next.
    app.fire('error', resourceError('IMG', '/assets/a.jpg'));
    app.fire('error', resourceError('SCRIPT', 'https://example.test/_expo/bundle.js'));

    expect(app.text()).toMatch(/bundle failed to load/);
  });

  it('is named in the report when nothing ever starts', () => {
    // The 8-second watchdog. A font or an image that 404s has cost this
    // project a day before, and the list is the most useful thing on the page.
    app.fire('error', resourceError('IMG', '/assets/vendor/Inter.ttf'));
    app.runTimeout();

    expect(app.text()).toContain('/assets/vendor/Inter.ttf');
  });
});

describe('an error carrying nothing at all', () => {
  it('never says only "unknown error"', () => {
    // What the musician was shown. True, and useless: it named neither what
    // failed nor where, and left nothing to work from.
    app.fire('error', { message: '', error: null });

    const said = app.text();
    expect(said).not.toMatch(/^\s*The app crashed while starting\.\s*\|\s*unknown error\s*$/);
    expect(said).toContain('bundle:');
    expect(said).toContain('secure context:');
    expect(said).toContain('agent:');
  });
});
