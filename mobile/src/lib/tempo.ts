import type { ColorToken } from '../design';
import type {
  Band,
  Direction,
  MeasureVerdict,
  Verdict,
} from '../data/types';

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
 * The headline for a whole window of practice — Insights, not one take.
 *
 * "You tend to..." is a claim about a habit, and a habit needs more than one
 * recording to observe. A single take gets `formatTakeVerdict` instead.
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

/**
 * The colour for a band, on the verdict screen only.
 *
 * Keyed off the pipeline's band rather than the display verdict, because the
 * band is what the tolerance maths produced — `severe` and `rush_drag` share a
 * colour for the same reason they share a word: the vocabulary the musician
 * reads has three levels, not four.
 *
 * Always paired with that word. Colour alone would put the whole verdict
 * behind a hue that ~8% of men can't separate.
 */
export function verdictColorFor(band: Band): ColorToken {
  if (band === 'on') {
    return 'verdictOn';
  }
  return band === 'slight' ? 'verdictMid' : 'verdictBad';
}

/** Where in the take the drift sat. */
type Span = 'start' | 'middle' | 'end' | 'throughout';

const RUSH_HEADLINES: Record<Span, string> = {
  start: 'You rushed at the start',
  middle: 'You rushed in the middle',
  end: 'You rushed towards the end',
  throughout: 'You rushed throughout',
};

const DRAG_HEADLINES: Record<Span, string> = {
  start: 'You dragged at the start',
  middle: 'You dragged in the middle',
  end: 'You dragged towards the end',
  throughout: 'You dragged throughout',
};

/**
 * The headline for one recording.
 *
 * Says what happened in this take and where, never what the musician tends to
 * do — one recording can't see a habit. Insights is where a pattern across
 * sessions gets to make that claim.
 *
 * Slight drift gets the gentler "Tempo drifted ahead": at that band the
 * pipeline is inside the tolerance where the spec says not to claim certainty,
 * so naming the player would be more confident than the measurement.
 */
export function formatTakeVerdict(measures: MeasureVerdict[]): string {
  const off = measures.filter((m) => m.band !== 'on');
  if (measures.length === 0 || off.length === 0) {
    return 'You held the tempo';
  }

  const ahead = off.filter((m) => m.direction === 'rush').length;
  const behind = off.length - ahead;
  const drifting = ahead >= behind ? 'ahead' : 'behind';

  const worst = off.some((m) => m.band === 'rush_drag' || m.band === 'severe');
  if (!worst) {
    return drifting === 'ahead' ? 'Tempo drifted ahead' : 'Tempo drifted behind';
  }

  const headlines = drifting === 'ahead' ? RUSH_HEADLINES : DRAG_HEADLINES;
  return headlines[spanOf(off, measures)];
}

/**
 * Which third of the take the drift fell in.
 *
 * By the midpoint of the affected measures rather than their extent, so one
 * stray measure at the end doesn't relabel a take that went wrong in the
 * middle. A run covering more than two thirds is called throughout.
 */
function spanOf(off: MeasureVerdict[], all: MeasureVerdict[]): Span {
  const positions = off.map((m) =>
    all.findIndex((candidate) => candidate.measure === m.measure),
  );
  const first = Math.min(...positions);
  const last = Math.max(...positions);
  const length = all.length;

  if ((last - first + 1) / length > 2 / 3) {
    return 'throughout';
  }
  const midpoint = (first + last) / 2 / Math.max(1, length - 1);
  if (midpoint < 1 / 3) {
    return 'start';
  }
  return midpoint > 2 / 3 ? 'end' : 'middle';
}
