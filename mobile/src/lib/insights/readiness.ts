import type { TakeResult } from '../../data/types';

/**
 * Insights waits for five takes (the owner, 2026-09-30: "require 5 takes
 * before it shows insights, so the graph has complete data"). Before that the
 * trend was a line through two or three points and every finding was a guess
 * about a take or two; now the tab counts down to the fifth instead.
 */
export const INSIGHTS_MIN_TAKES = 5;

export interface InsightsProgress {
  /** Takes that count: analysed, not refused. */
  counted: number;
  needed: number;
  ready: boolean;
  /** "3 more takes to go", "1 more take to go". */
  title: string;
  /** The piece of the newest take that counts — what "Record a take" opens. */
  lastPieceId: string | null;
}

/**
 * How close Insights is to having enough to say. `takes` are the recent takes,
 * newest first, or undefined while they load — then `sessions`, the insights
 * window's own count of completed analyses, stands in.
 *
 * **A refused take does not count.** "Nothing reached the microphone" or a
 * page the take did not match is not practice the graph can draw.
 */
export function insightsProgress(
  takes: readonly TakeResult[] | undefined,
  sessions: number,
): InsightsProgress {
  const counting = takes?.filter((t) => t.failure === null && t.status === 'ok');
  const counted = Math.min(counting ? counting.length : sessions, INSIGHTS_MIN_TAKES);
  const left = INSIGHTS_MIN_TAKES - counted;
  return {
    counted,
    needed: INSIGHTS_MIN_TAKES,
    ready: left <= 0,
    title: `${left} more ${left === 1 ? 'take' : 'takes'} to go`,
    lastPieceId: counting?.[0]?.pieceId ?? null,
  };
}
