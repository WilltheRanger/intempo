import { ApiError } from './client';

/**
 * What to tell someone when a screen could not load.
 *
 * Five screens carried the same hardcoded line — *"Check your connection and
 * try again"* — for every failure there is. That is right for exactly one of
 * them. It told a musician whose session had expired to check their wifi, and
 * told them the same thing when the server returned a 500, so the one piece of
 * advice the app ever gave was usually wrong and never actionable.
 *
 * `apiFetch` already knows which of these happened; it just had nowhere to say
 * so, because the screens threw its message away and substituted their own.
 *
 * A network failure is still the default, and deliberately: `fetch` rejects
 * with a bare `TypeError` for a dropped connection, a DNS failure and a CORS
 * refusal alike, so anything that isn't a recognisable `ApiError` genuinely is
 * "something between here and the server", and connection is the useful guess.
 */
export function describeLoadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'Your session has ended. Sign in again.';
    }
    if (error.status === 403) {
      return "This isn't yours to open.";
    }
    if (error.status === 404) {
      return "It isn't there any more — it may have been removed.";
    }
    if (error.status >= 500) {
      // Explicitly not the musician's problem to solve, and explicitly not
      // worth them retrying in the next second.
      return 'The server had a problem. This is not something you did — try again in a minute.';
    }
  }
  return 'Check your connection and try again.';
}
