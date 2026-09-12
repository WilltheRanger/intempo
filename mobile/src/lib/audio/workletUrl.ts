/**
 * Where the recording worklet actually lives, from any route in the app.
 *
 * **This is why recording was broken on the deployed site.** The recorder asked
 * `addModule` for the bare filename and left the browser to resolve it, on the
 * reasoning that a relative path is what a build served from a sub-path needs.
 * A relative URL resolves against the *document's* base — and this is a single
 * page app, so on `/pieces/fixture-bach-bwv1001/record` the document's base is
 * `/pieces/fixture-bach-bwv1001/`. The browser fetched
 * `/pieces/fixture-bach-bwv1001/pcm-recorder.worklet.js`, the server answered
 * every unknown path with `index.html` as a single page app must, and
 * `addModule` was handed a page of HTML to parse as a module.
 *
 * Measured against the built bundle on 2026-09-06:
 *
 *     /pcm-recorder.worklet.js                             200 application/javascript
 *     /pieces/fixture-bach-bwv1001/pcm-recorder.worklet.js 200 text/html
 *
 * It failed with a 200, which is why nothing looked wrong: no console error, no
 * failed request, just `The recording worklet could not be loaded.` on a screen
 * whose only job is to record. The record screen is **always** nested under a
 * piece, so this was every take on every device.
 *
 * The rest of the build already emits root-absolute URLs — `/manifest.webmanifest`,
 * `/_expo/static/js/web/…` — so resolving from the app's root is what the
 * worklet should have done all along, and a `<base href>` is still honoured for
 * the sub-path case the original reasoning was worried about.
 */

/** The worklet, copied verbatim into the build from `public/`. */
export const WORKLET_FILE = 'pcm-recorder.worklet.js';

/**
 * Resolve the worklet against the application root rather than the route.
 *
 * `baseHref` is the `href` of the document's `<base>` element when it has one,
 * which is how a build served from a sub-path declares where it lives. With no
 * `<base>`, the root of the origin is the answer — and it is the *route* that
 * must never be used, whichever of the two applies.
 */
export function workletUrl(baseHref: string | null, origin: string): string {
  const root = baseHref ? new URL(baseHref, origin) : new URL('/', origin);
  return new URL(WORKLET_FILE, root).toString();
}

/**
 * The URL to hand `addModule`, read from the live document.
 *
 * The impure half, kept in one place so {@link workletUrl} stays a pure rule
 * with tests. Every read is guarded: this module is imported by a recorder
 * whose test suite runs in Node with a hand-built `window` that has no
 * `location`, and an unguarded `window.location.origin` there throws inside the
 * recorder's own try/catch — reporting "the worklet could not be loaded" for a
 * missing global rather than a missing file, which is precisely the kind of
 * misreported failure this whole module exists to end.
 *
 * With no origin to resolve against there is no browser to load a worklet
 * either, so the bare filename is returned and the caller's stub sees exactly
 * what it saw before.
 */
export function resolveWorkletUrl(): string {
  const origin =
    typeof window !== 'undefined' ? (window.location?.origin ?? null) : null;
  if (!origin) {
    return WORKLET_FILE;
  }
  const baseHref =
    typeof document !== 'undefined'
      ? (document.querySelector('base')?.getAttribute('href') ?? null)
      : null;
  return workletUrl(baseHref, origin);
}
