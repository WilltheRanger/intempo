import posthog from "posthog-js";

const key = import.meta.env.VITE_POSTHOG_KEY;
let started = false;

/** No-op unless VITE_POSTHOG_KEY is set — safe to call unconditionally. */
export function initAnalytics(): void {
  if (started || !key) return;
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: true,
  });
  started = true;
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (started) posthog.capture(event, props);
}
