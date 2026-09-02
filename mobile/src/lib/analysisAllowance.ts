import type { UsageResponse } from '../data/types';

/** When the server says the calendar-month allowance returns. */
export function whenAnalysisAllowanceResets(
  resetsAt: string | null | undefined,
): string {
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

/** Whether beginning another take can only end in the server refusing it. */
export function analysisLimitReached(
  usage: UsageResponse | null | undefined,
): boolean {
  if (!usage || usage.limit === null) {
    return false;
  }
  // `remaining` is the server's direct answer. The used/limit comparison is a
  // defensive fallback for older responses and makes an over-limit account no
  // less blocked than one exactly at the line.
  return usage.remaining === 0 || usage.used >= usage.limit;
}

/**
 * The pre-flight explanation shown before a musician picks up the instrument.
 *
 * A limit discovered after recording wastes the performance and uploads audio
 * the server already knows it will refuse. This copy is deliberately about
 * what remains usable too: score playback, the metronome and the rest cues are
 * practice tools even when another analysis is not available yet.
 */
export function describeReachedAnalysisLimit(
  usage: UsageResponse | null | undefined,
): string | null {
  if (!analysisLimitReached(usage) || usage?.limit === null || !usage) {
    return null;
  }
  const allowance =
    usage.limit === 1 ? 'your free analysis' : `all ${usage.limit} free analyses`;
  return `You've used ${allowance} this month. Recording returns ${whenAnalysisAllowanceResets(usage.resets_at)}. You can still listen to the score and practise with the metronome.`;
}
