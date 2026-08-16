import type { Verdict } from '../data/types';

/**
 * Tempo verdict thresholds, in BPM either side of the target.
 *
 * From the product spec's five-state vocabulary: on tempo within ±2, slight
 * rush or drag out to ±5, rushing or dragging beyond that. The backend's
 * analysis pipeline will classify against the same numbers; this is here so
 * the UI and its fixtures can't drift from them independently.
 */
const ON_TEMPO_BPM = 2;
const SLIGHT_BPM = 5;

/** Classifies a BPM deviation. Positive is ahead of the beat. */
export function verdictForDeviation(bpmDeviation: number): Verdict {
  if (Math.abs(bpmDeviation) <= ON_TEMPO_BPM) {
    return 'on_tempo';
  }
  if (bpmDeviation > 0) {
    return bpmDeviation <= SLIGHT_BPM ? 'slight_rush' : 'rushing';
  }
  return bpmDeviation >= -SLIGHT_BPM ? 'slight_drag' : 'dragging';
}

const VERDICT_LABELS: Record<Verdict, string> = {
  on_tempo: 'On tempo',
  slight_rush: 'Slight rush',
  rushing: 'Rushing',
  slight_drag: 'Slight drag',
  dragging: 'Dragging',
};

/** The verdict as a musician reads it. */
export function formatVerdict(verdict: Verdict): string {
  return VERDICT_LABELS[verdict] ?? VERDICT_LABELS.on_tempo;
}

const TENDENCY_HEADLINES: Record<Verdict, string> = {
  on_tempo: 'You play steadily',
  slight_rush: 'You drift slightly ahead',
  rushing: 'You tend to rush',
  slight_drag: 'You drift slightly behind',
  dragging: 'You tend to drag',
};

/**
 * The headline for a whole window of practice.
 *
 * A description of what happened, not encouragement about it — the spec is
 * explicit that words carry the verdict, and a musician can tell the
 * difference between a diagnosis and a compliment.
 */
export function formatTendency(verdict: Verdict): string {
  return TENDENCY_HEADLINES[verdict] ?? TENDENCY_HEADLINES.on_tempo;
}

const TENDENCY_DETAIL: Record<Verdict, string> = {
  on_tempo: 'you held the beat',
  slight_rush: 'you sat a little ahead of the beat',
  rushing: 'you were usually ahead of the beat',
  slight_drag: 'you sat a little behind the beat',
  dragging: 'you were usually behind the beat',
};

/**
 * "Across 34 sessions, you were usually ahead of the beat."
 *
 * No BPM figure: the spec keeps timing deviations out of production copy and
 * leaves the magnitude to the bar. Session counts aren't a timing measurement,
 * so they stay.
 */
export function formatTendencyDetail(
  verdict: Verdict,
  sessions: number,
): string {
  const count = sessions === 1 ? '1 session' : `${sessions} sessions`;
  const detail = TENDENCY_DETAIL[verdict] ?? TENDENCY_DETAIL.on_tempo;
  return `Across ${count}, ${detail}.`;
}
