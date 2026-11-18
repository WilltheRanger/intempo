/**
 * Whether a screen should refresh itself when the app comes back into view.
 *
 * **The web app can stay open for days.** Installed to the home screen it has
 * no reload button, and pull-to-refresh does nothing on the web build
 * (react-native-web's `RefreshControl` drops `onRefresh`), so a Library opened
 * on Monday still showed Monday's shelf on Thursday unless the app was quit
 * (the mobile-native review, 2026-11-12).
 *
 * **Not React Query's `refetchOnWindowFocus`**, which stays off for the reason
 * `queryClient.test.ts` gives: on the web it fires on every tab switch and
 * every click back into the window, against a host that sleeps. This fires
 * once, for the screen in front, and only after the app has been out of view
 * long enough for the shelf to have plausibly changed somewhere else.
 */
export const REFRESH_AFTER_AWAY_MS = 10 * 60_000;

/** `hiddenAt` is when the page last went out of view, or null if it has not. */
export function shouldRefreshOnReturn(hiddenAt: number | null, now: number): boolean {
  return hiddenAt !== null && now - hiddenAt >= REFRESH_AFTER_AWAY_MS;
}
