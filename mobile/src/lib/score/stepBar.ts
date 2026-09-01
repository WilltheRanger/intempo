/**
 * Stepping through the bars a take can start on.
 *
 * `bars` is the list of bars that actually sound, in playing order — see
 * `startableMeasures`. Stepping walks that list rather than adding one to the
 * number, because the bar after 12 might be 14 if 13 is all rest, and a
 * control that lands on a bar nothing can be entered on has failed the person
 * using it.
 */
export function stepBar(bars: number[], current: number, direction: -1 | 1): number {
  if (bars.length === 0) {
    return current;
  }
  const at = bars.indexOf(current);
  if (at === -1) {
    // Not a bar in the list — the first is the only honest answer.
    return bars[0];
  }
  const next = Math.min(bars.length - 1, Math.max(0, at + direction));
  return bars[next];
}

/** Whether stepping in a direction would move at all. For disabling the control. */
export function canStepBar(bars: number[], current: number, direction: -1 | 1): boolean {
  return stepBar(bars, current, direction) !== current;
}
