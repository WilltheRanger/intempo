import type { Schedule } from './schedule';

/**
 * Where the Listen player is in a piece, measured in whole bars.
 *
 * The redesign's player (`redesign/RecordReady.dc.html`) is a play button and
 * a scrubber with a clock under it. The playback engine starts from a bar
 * (`startAtMeasure`) and cannot seek inside one, so the scrubber seeks **by
 * bar**: a drag lands on the bar under the finger, the clock shows that bar's
 * start, and playing resumes from its first note. A position between barlines
 * would be a position the engine could not honour.
 */

export interface BarStart {
  measure: number;
  startS: number;
}

/**
 * Each sounding bar and when its first note starts, in playing order.
 *
 * First occurrence only, matching `startAtMeasure`, which starts a repeated bar
 * at its first time through.
 */
export function barStarts(schedule: Schedule): BarStart[] {
  const seen = new Set<number>();
  const out: BarStart[] = [];
  for (const note of schedule.notes) {
    if (!seen.has(note.measureNumber)) {
      seen.add(note.measureNumber);
      out.push({ measure: note.measureNumber, startS: note.startS });
    }
  }
  return out;
}

/** The bar playing at `seconds`: the last one to have started by then. */
export function barAt(starts: readonly BarStart[], seconds: number): BarStart | null {
  let found: BarStart | null = starts[0] ?? null;
  for (const start of starts) {
    if (start.startS <= seconds) {
      found = start;
    } else {
      break;
    }
  }
  return found;
}

/** When `measure` starts, or 0 for a bar the schedule does not sound. */
export function startOfBar(starts: readonly BarStart[], measure: number): number {
  return starts.find((start) => start.measure === measure)?.startS ?? 0;
}

/** `0:12`, `1:48`, `12:05` — the player's clock. */
export function clockLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
