import type { Band, Direction, Verdict } from '../data/types';

/**
 * The pipeline's band and direction, in the words the UI shows.
 *
 * Two vocabularies meet here, and both are the spec's. The analysis pipeline
 * classifies into four bands with a separate direction, because that is what
 * the tolerance maths produces. The interface shows five states, because that
 * is what a musician can act on. This is the only place they are joined.
 *
 * `severe` folds into plain rushing or dragging: the display vocabulary has no
 * fifth level of alarm, and the spec's own table stops at three. Severity is
 * still in `result_json` for anyone who needs it — it just isn't a word this
 * screen says.
 */
export function verdictFor(band: Band, direction: Direction): Verdict {
  if (band === 'on' || direction === 'on') {
    return 'on_tempo';
  }
  if (band === 'slight') {
    return direction === 'rush' ? 'slight_rush' : 'slight_drag';
  }
  return direction === 'rush' ? 'rushing' : 'dragging';
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
 * No timing figure: the spec keeps deviations out of production copy and
 * leaves the magnitude to the bar. Session counts aren't a timing
 * measurement, so they stay.
 */
export function formatTendencyDetail(
  verdict: Verdict,
  sessions: number,
): string {
  const count = sessions === 1 ? '1 session' : `${sessions} sessions`;
  const detail = TENDENCY_DETAIL[verdict] ?? TENDENCY_DETAIL.on_tempo;
  return `Across ${count}, ${detail}.`;
}
