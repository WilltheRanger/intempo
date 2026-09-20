import { ApiError } from '../data/api/client';
import { whenAnalysisAllowanceResets } from './analysisAllowance';

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

/**
 * What to tell someone who has run out, or null if that isn't what happened.
 *
 * **This used to open "Your recording is safe", and it wasn't.** The take was a
 * local in `RecordScreen.stop()` and was dropped the moment the send failed —
 * so the one reassuring clause in the sentence was the only false one. Every
 * other failure now really does keep the take and offer to send it again; the
 * quota is the exception, because the count does not move until next month and
 * holding audio in memory for weeks is not something this app does.
 *
 * So it says what is true instead. It still leads with the take rather than
 * the limit — they have just played something, and being told about billing
 * first would be answering a question they did not ask — but it says the take
 * was not analysed rather than implying it is waiting somewhere.
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
  return `That take wasn't analysed. You've used ${count} this month. The count resets ${whenAnalysisAllowanceResets(limit.resetsAt)}.`;
}
