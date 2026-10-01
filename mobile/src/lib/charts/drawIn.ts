/**
 * How much of a graph is drawn, `elapsed` milliseconds into its entrance.
 *
 * The owner, 2026-10-01: "animate the graph when you click on insights or
 * enter any page with a graph". The line draws itself left to right — the
 * direction it is read in, takes or bars in order — and decelerates into
 * place, so the end of the line, which is the latest take, is the part the
 * eye settles on. A rule rather than a curve inside the component, because
 * there is no React Native testing library here (`DECISIONS.md`, 2026-08-24).
 */
export const DRAW_IN_MS = 700;

export function drawProgress(elapsed: number, duration: number = DRAW_IN_MS): number {
  if (!(duration > 0) || !(elapsed > 0)) return elapsed > 0 || duration <= 0 ? 1 : 0;
  const t = Math.min(1, elapsed / duration);
  // Ease out (cubic): quick to start, gentle to finish.
  return 1 - (1 - t) ** 3;
}
