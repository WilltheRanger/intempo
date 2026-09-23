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
 * The warning shown before the **last** free analysis is spent.
 *
 * `describeReachedAnalysisLimit` below only speaks once the allowance is gone,
 * which is one take too late to be useful: a free account gets three analyses
 * a **calendar month**, so the third is a third of the month and a musician
 * spent it without knowing it was the last. The count did exist — as a row on
 * the Profile screen reading "2 of 3 this month" — which is not where anyone
 * is standing when the decision is made.
 *
 * Only on the last one. Announcing "2 of 3 left" before a take nobody is
 * worried about turns a practice screen into a meter, and the number changes
 * nothing until it is the number that does (§3 law 10). Silent for a Pro
 * account, which has no quota to be near the end of.
 *
 * Advisory, never blocking: the take is allowed and the button is live. This
 * says which take it is, not that it cannot happen.
 */
export function describeLastFreeAnalysis(
  usage: UsageResponse | null | undefined,
): string | null {
  if (!usage || usage.limit === null || usage.remaining !== 1) {
    return null;
  }
  // Two lines of centred prose under the record button for one fact. The
  // fact is which take this is; the reset date is a detail for the screen
  // that is about the allowance, not for the one with an instrument in hand.
  return `Last free analysis. Next one ${whenAnalysisAllowanceResets(usage.resets_at)}.`;
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

/**
 * The line under "Send for analysis" on the Upload screen: what sending costs.
 *
 * From the redesign (`redesign/UploadRecording.dc.html`): "This uses one of
 * your 3 free analyses this month." Said before the press, because an upload
 * is a choice made at a desk rather than mid-practice, and a musician choosing
 * which file to spend a free analysis on deserves to know that is the choice.
 *
 * The last one says so, in the same words Record uses; a spent allowance is
 * `describeReachedAnalysisLimit`'s to say; an unlimited plan costs nothing
 * worth a line.
 */
export function describeAnalysisCost(
  usage: UsageResponse | null | undefined,
): string | null {
  if (!usage || usage.limit === null || analysisLimitReached(usage)) {
    return null;
  }
  if (usage.remaining === 1) {
    return describeLastFreeAnalysis(usage);
  }
  return usage.limit === 1
    ? 'This uses your free analysis this month.'
    : `This uses one of your ${usage.limit} free analyses this month.`;
}
