/**
 * What a key does to a slider, by the ARIA slider pattern.
 *
 * The result screen's two bar charts and the tempo slider each handled the
 * arrows and nothing else, so Home and End — first and last, the keys the
 * pattern names — did nothing on a thirteen-bar chart (measured 2026-10-05),
 * and there was no bigger step than one. One rule for the three, here.
 *
 * `big` is the slider's own large step (a few bars, ten beats a minute):
 * Page Up and Page Down take it, and Shift with an arrow where the slider
 * already used Shift for one.
 */
export type SliderMove = { by: number } | { to: 'first' | 'last' };

export function sliderMove(
  key: string,
  { big, shift = false }: { big: number; shift?: boolean },
): SliderMove | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return { by: shift ? big : 1 };
    case 'ArrowLeft':
    case 'ArrowDown':
      return { by: shift ? -big : -1 };
    case 'PageUp':
      return { by: big };
    case 'PageDown':
      return { by: -big };
    case 'Home':
      return { to: 'first' };
    case 'End':
      return { to: 'last' };
    default:
      return null;
  }
}

/**
 * Where a move lands on a slider of `count` steps, from `at` (-1 for nothing
 * picked). The first move onto a slider with nothing picked lands on its first
 * step whichever way it points — the bar-by-bar chart's arrow put it on the
 * *second* bar, while the trend chart beside it started on the first.
 */
export function moveIndex(at: number, count: number, move: SliderMove): number {
  if (count <= 0) return -1;
  if ('to' in move) return move.to === 'first' ? 0 : count - 1;
  if (at < 0) return 0;
  return Math.max(0, Math.min(count - 1, at + move.by));
}
