import type { ComponentType, ErrorInfo } from 'react';

/** The app's root, which takes no props — the shape `Sentry.wrap` accepts. */
type RootComponent = ComponentType<Record<string, unknown>>;

/**
 * The web build reports no crashes, so it carries no crash reporter.
 *
 * See `crashReporting.ts` for why: the SDK was a third of the page's weight,
 * spent on a reporter with no DSN to report to. `ErrorBoundary` still writes
 * the stack to the console.
 */

export function withCrashReporting(App: RootComponent): RootComponent {
  return App;
}

export function reportRenderCrash(_error: Error, _info: ErrorInfo): void {}
