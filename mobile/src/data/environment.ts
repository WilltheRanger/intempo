/**
 * Whether this build talks to a real backend, or to the sample data.
 *
 * **Presence is the switch.** There is no flag to flip and no build mode to
 * remember: a build that was given a Supabase project *and* an API host runs
 * live, and a build that wasn't runs on fixtures. Both are legitimate: the
 * production Cloudflare project receives all three values and serves real
 * accounts, while an unconfigured local or branch preview remains a safe
 * sample build instead of pointing at a developer machine.
 *
 * This replaced a hardcoded `USE_FIXTURES = true` in `sources/index.ts`. That
 * constant was a loaded gun: flipping it to `false` and pushing would have
 * shipped a site pointed at `http://127.0.0.1:8000`, the default in
 * `api/client.ts` — every screen on the live site would have failed to load
 * against a host that only exists on a developer's laptop. The switch had to
 * stop being a decision someone makes and start being a fact about the
 * environment.
 *
 * All three are required, and the reason differs for each:
 *
 *  - **URL + anon key** — without them `getSupabaseClient()` returns null,
 *    so there is no session and therefore no bearer token to send.
 *  - **API base URL** — because `api/client.ts` falls back to
 *    `http://127.0.0.1:8000`. An unset var means "no backend was named",
 *    which is not the same as "the backend is at the default", and a build
 *    that confused the two would point the live site at a host that exists
 *    only on a developer's laptop.
 *
 * This said the API host was "checked for *explicit presence*, not
 * truthiness". It is not, and truthiness is the **safer** of the two: under
 * an explicit-presence rule, `EXPO_PUBLIC_API_BASE_URL=""` counts as a
 * backend having been named and sends a production build at the localhost
 * fallback — exactly the failure the paragraph above describes. The empty
 * string and the unset var mean the same thing here on purpose, and
 * `environment.test.ts` pins it.
 *
 * Every reference below spells out `process.env.EXPO_PUBLIC_…` in full.
 * Expo substitutes these textually at build time, so a destructured or
 * computed lookup would read an empty object in the bundle and put a
 * correctly-configured build on fixtures.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

/**
 * True when the app should read and write real data.
 *
 * A constant rather than a function of runtime state: these values are frozen
 * into the bundle, so this cannot change while the app is running, and making
 * it look like it might would invite a component to subscribe to it.
 */
export const IS_LIVE_BACKEND: boolean = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && API_BASE_URL,
);

/**
 * Why the app is on sample data, in one sentence, or null when it isn't.
 *
 * For the developer reading a console on a build that unexpectedly shows
 * seeded pieces — "it silently fell back" is the failure mode this whole
 * module exists to avoid, so it says which var is missing rather than leaving
 * it to be guessed at.
 */
export function describeFixtureReason(): string | null {
  if (IS_LIVE_BACKEND) {
    return null;
  }
  const missing = [
    SUPABASE_URL ? null : 'EXPO_PUBLIC_SUPABASE_URL',
    SUPABASE_ANON_KEY ? null : 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    API_BASE_URL ? null : 'EXPO_PUBLIC_API_BASE_URL',
  ].filter((name): name is string => name !== null);

  return `Running on sample data: ${missing.join(', ')} ${
    missing.length === 1 ? 'is' : 'are'
  } not set.`;
}
