import { ApiError } from '../data/api/client';

/**
 * The free-tier refusal, recognised and said out loud.
 *
 * `POST /v1/analyses` answers 403 with a structured body — `code`, `limit`,
 * `used`, `tier`, `resets_at` — and the backend's own comment explains why it
 * is structured rather than prose: *"the client has to act on it — show how
 * many are left and offer the upgrade — and parsing a sentence to do that is
 * how copy changes become bugs."*
 *
 * The client then parsed nothing. A musician who had used their three analyses
 * recorded a take, waited through the upload, and was told **"Check your
 * connection and try again"** — so they would check their wifi, find it fine,
 * and try again, and be told the same thing. Forever. The one error the backend
 * took trouble to make actionable arrived as the least actionable string in the
 * app.
 */
export interface TierLimit {
  used: number;
  limit: number | null;
  resetsAt: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** The tier-limit detail, or null when this error is something else. */
export function tierLimitOf(error: unknown): TierLimit | null {
  if (!(error instanceof ApiError) || error.status !== 403) {
    return null;
  }
  const detail = asRecord(error.detail);
  // Keyed on `code`, not on the status: a 403 is also what an ownership check
  // raises, and telling someone they are out of analyses when they have opened
  // somebody else's score would be worse than saying nothing.
  if (detail?.code !== 'tier_limit') {
    return null;
  }
  return {
    used: typeof detail.used === 'number' ? detail.used : 0,
    limit: typeof detail.limit === 'number' ? detail.limit : null,
    resetsAt: typeof detail.resets_at === 'string' ? detail.resets_at : null,
  };
}

/** When the count goes back to zero, as a person would say it. */
function whenItResets(resetsAt: string | null): string {
  if (!resetsAt) {
    return 'next month';
  }
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) {
    return 'next month';
  }
  return `on ${date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  })}`;
}

/**
 * What to tell someone who has run out, or null if that isn't what happened.
 *
 * Leads with the recording rather than the limit. They have just played
 * something; the first thing they need to know is that it wasn't wasted.
 */
export function describeTierLimit(error: unknown): string | null {
  const limit = tierLimitOf(error);
  if (!limit) {
    return null;
  }
  const count =
    limit.limit === null
      ? `${limit.used} analyses`
      : `all ${limit.limit} of your free analyses`;
  return `Your recording is safe, but you've used ${count} this month. The count resets ${whenItResets(limit.resetsAt)}.`;
}
