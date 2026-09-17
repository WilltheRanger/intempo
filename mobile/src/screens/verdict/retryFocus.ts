import type { MeasureVerdict } from '../../data/types';
import { wasTimed } from '../../lib/verdict/measureReading';

/**
 * Pick one judged bar to revisit. The pipeline's band sets priority; the
 * deviation only breaks ties within a band. Written tempo changes and bars
 * with no timed notes cannot become practice targets.
 */
export function retryFocus(measures: MeasureVerdict[]): string | null {
  const rank = { on: 0, slight: 1, rush_drag: 2, severe: 3 } as const;
  let focus: MeasureVerdict | null = null;

  for (const measure of measures) {
    if (!wasTimed(measure) || rank[measure.band] === 0) continue;
    if (
      focus === null ||
      rank[measure.band] > rank[focus.band] ||
      (rank[measure.band] === rank[focus.band] &&
        Math.abs(measure.deviationPct) > Math.abs(focus.deviationPct))
    ) {
      focus = measure;
    }
  }

  if (!focus) return null;
  const direction = focus.direction === 'rush' ? 'rushed' : focus.direction === 'drag' ? 'dragged' : 'drifted';
  return `Try bar ${focus.measure} again: the analysis says you ${direction} there. Then record another take.`;
}
