/**
 * Which build this is, and where it came from, in one short line.
 *
 * **Written because a whole day was spent unable to answer that.** The
 * microphone fix shipped, the owner tested, and it still failed — and neither
 * of us could tell whether the phone was running the new bundle. It might have
 * been a stale cache, a home-screen app resumed rather than relaunched, or a
 * test taken before the deploy landed. Three very different answers, no way to
 * distinguish them, and the app itself knew all along.
 *
 * The bundle filename is content-hashed by the export, so eight characters of
 * it identify a build exactly. The host separates production from a branch
 * preview — which is what the owner had actually been comparing. And whether
 * this is the home-screen app matters because iOS treats it as its own
 * context, with its own cache and its own permission grant.
 *
 * **A rule with a test, not a line inside a `.tsx`** — `CLAUDE.md` §3, and the
 * reason is this module's own subject: nothing here is checkable by eye.
 *
 * Deliberately *not* `EXPO_PUBLIC_BUILD`. That would need the value threaded
 * through every build command and CI job, and a marker that is only right when
 * someone remembered to set it is worse than none: it would read as fact while
 * naming the wrong build.
 */

/** Eight characters of the export's content hash, or '' when unrecognisable. */
export function hashFrom(src: string | null): string {
  if (!src) {
    return '';
  }
  // `index-<hash>.js`, the app bundle. The export also emits
  // `__expo-metro-runtime-<hash>.js` and `__common-<hash>.js`, and a selector
  // matching merely `_expo` picks whichever comes first in the document —
  // which is not the app. The crash watchdog in `public/index.html` had that
  // bug and reported the runtime's hash as "bundle:" for months.
  const match = /\/index-([0-9a-f]{8})[0-9a-f]*\.js/.exec(src);
  return match ? match[1] : '';
}

/**
 * The line to show, given what the environment says about itself.
 *
 * Pure, so the composition is testable. Anything missing is simply left out
 * rather than rendered as "unknown": a marker is only useful if every part of
 * it is a fact.
 */
export function markerFrom(
  src: string | null,
  host: string,
  standalone: boolean,
): string {
  const parts = [hashFrom(src), host, standalone ? 'home screen' : ''].filter(
    (part) => part !== '',
  );
  return parts.join(' · ');
}

/**
 * The marker for the running page, or '' where there is no page.
 *
 * Every read is guarded: this module is imported by a screen whose tests run
 * in Node against a hand-built `window`, and an unguarded `document` there
 * throws inside a render — reporting a crash for a missing global, which is
 * precisely the class of misreported failure this file exists to end.
 */
export function buildMarker(standalone: boolean): string {
  if (typeof document === 'undefined' || typeof location === 'undefined') {
    return '';
  }
  const tag = document.querySelector('script[src*="/index-"]');
  const src = tag?.getAttribute('src') ?? null;
  return markerFrom(src, location.host ?? '', standalone);
}
