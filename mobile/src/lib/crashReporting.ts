import * as Sentry from '@sentry/react-native';
import type { ComponentType, ErrorInfo } from 'react';

/** The app's root, which takes no props — the shape `Sentry.wrap` accepts. */
type RootComponent = ComponentType<Record<string, unknown>>;

/**
 * Crash reporting for native release builds.
 *
 * On only when the build is a release and `EXPO_PUBLIC_SENTRY_DSN` is set —
 * which `scripts/check-release-environment.mjs` requires of App Store and
 * TestFlight builds and of nothing else. Unhandled crashes only: no analytics,
 * no tracing, no personal data.
 *
 * **The web build gets `crashReporting.web.ts` instead, which does nothing.**
 * Imported at the entry point, the SDK added 329 KB gzipped to the page every
 * musician loads, against a 560 KB budget, to do nothing: no DSN is set for
 * the web deployment. If one ever is, it should arrive as a lazy import behind
 * the DSN check rather than by deleting the web file.
 */

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
const enabled = !__DEV__ && Boolean(dsn);

/** Start the reporter and wrap the root, or hand the root back untouched. */
export function withCrashReporting(App: RootComponent): RootComponent {
  if (!enabled) {
    return App;
  }
  Sentry.init({ dsn, sendDefaultPii: false, tracesSampleRate: 0 });
  return Sentry.wrap(App);
}

/** A render that threw and was caught by `ErrorBoundary`. */
export function reportRenderCrash(error: Error, info: ErrorInfo): void {
  if (!enabled) {
    return;
  }
  Sentry.captureException(error, {
    contexts: { react: { componentStack: info.componentStack } },
  });
}
