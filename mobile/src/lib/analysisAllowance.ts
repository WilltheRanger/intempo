import type { UsageResponse } from '../data/types';
import { longDate } from './calendarDate';

/**
 * **One name for the allowance: free takes** (the UI review, 2026-11-12, the
 * owner's pick). It was "Analyses · 2 of 3" on Profile, "1 free take left" on
 * Record and "free analyses" on Upload and at the limit — one thing under
 * three names, counted used on one screen and left on another. A take is what
 * a musician holds; the free ones are the ones the app analyses at no cost.
 * Every sentence here counts what is left and says when the next one comes.
 */

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
  return `on ${longDate(date)}`;
}

/**
 * What "You've used … this month" says when the server refused a take.
 *
 * The count is the server's: its limit when it sent one, else only how many
 * were used. That second form said "1 analyses" (2026-10-06).
 */
export function usedThisMonth(used: number, limit: number | null): string {
  if (limit !== null) return limit === 1 ? 'your free take' : `all ${limit} of your free takes`;
  return used === 1 ? '1 free take' : `${used} free takes`;
}

/** "Your next free take is on November 1." The reset, said as what it gives back. */
export function nextFreeTake(resetsAt: string | null | undefined): string {
  return `Your next free take is ${whenAnalysisAllowanceResets(resetsAt)}.`;
}

/**
 * Profile's row: the free takes left this month, or null with nothing true to
 * say — an unlimited plan, or no usage reported, which is an unknown count
 * rather than none.
 *
 * Counted as what is left, as Record counts it ("1 free take left this
 * month"). Profile said "2 of 3 this month", the same allowance counted the
 * other way under another name.
 */
export function describeFreeTakesLeft(
  usage: UsageResponse | null | undefined,
): string | null {
  if (!usage || usage.limit === null) {
    return null;
  }
  const left = usage.remaining ?? Math.max(0, usage.limit - usage.used);
  return left === 0 ? 'None left this month' : `${left} left this month`;
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
  // Said as what is left rather than as "Last free analysis", which a
  // first-time walk read as a warning before a note had been played
  // (2026-09-29). The reset date went in the owner's sweep the same day: it
  // belongs to the screen about the allowance, and "take" is the word the
  // musician is holding.
  return '1 free take left this month';
}

/**
 * The pre-flight explanation shown before a musician picks up the instrument.
 *
 * A limit discovered after recording wastes the performance and uploads audio
 * the server already knows it will refuse. This copy is deliberately about
 * what remains usable too: score playback, the metronome and the rest cues are
 * practice tools even when another analysis is not available yet.
 *
 * **Recording stays open at the limit** (the owner, 2026-11-12). Only Analyse
 * spends anything, and the record button used to lock with it, so a musician
 * out of free analyses could not even record a take to hear back. It is the
 * analysis that waits for the new month, and this says so.
 */
export function describeReachedAnalysisLimit(
  usage: UsageResponse | null | undefined,
): string | null {
  if (!analysisLimitReached(usage) || usage?.limit === null || !usage) {
    return null;
  }
  // What still works, then when the next one comes: the button under this
  // line is Analyse, waiting, so the sentence does not need to name it.
  return `You've used ${usedThisMonth(usage.used, usage.limit)} this month. You can still record and listen back. ${nextFreeTake(usage.resets_at)}`;
}

/**
 * The line under "Send for analysis" on the Upload screen: what sending costs.
 *
 * From the redesign (`redesign/UploadRecording.dc.html`): "This uses one of
 * your 3 free takes this month." Said before the press, because an upload is
 * a choice made at a desk rather than mid-practice, and a musician choosing
 * which file to spend a free take on deserves to know that is the choice.
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
    ? 'This uses your free take this month.'
    : `This uses one of your ${usage.limit} free takes this month.`;
}
