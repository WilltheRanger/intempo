import type { CorrectionInput } from '../types';
import { apiFetch } from './client';

/**
 * POST /v1/analyses/:id/corrections — "this bar wasn't rushing".
 *
 * The endpoint has existed since Batch 8 and no client had ever called it, so
 * `verdict_corrections` was empty for every account by construction — while
 * the router's own docstring calls it *"the only route out of the position
 * Batch 3 is currently stuck in"*, its thresholds still on the spec's starting
 * values for want of the ears this table collects.
 *
 * **A list, not one bar at a time.** A musician reviewing a take marks what
 * they noticed in one pass, and thirteen round trips for thirteen bars would
 * be the wrong shape for both ends. The server appends rather than replaces —
 * someone who corrects a take, plays it again and comes back with a different
 * opinion has changed their mind, and both are data.
 */
export function postCorrections(
  analysisId: string,
  corrections: CorrectionInput[],
): Promise<unknown> {
  return apiFetch(`/v1/analyses/${analysisId}/corrections`, {
    method: 'POST',
    body: JSON.stringify({ corrections }),
  });
}
