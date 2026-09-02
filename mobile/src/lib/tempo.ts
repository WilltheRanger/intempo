import type { ColorToken } from '../design';
import type {
  Band,
  Direction,
  MeasureVerdict,
  Tolerance,
  Verdict,
  TempoBeatUnit,
} from '../data/types';
import { BEATS } from './score/schedule';

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

/**
 * The outer threshold to assume when a take doesn't carry its own.
 *
 * Only reachable for analyses finished before the pipeline started recording
 * them — every new result carries the real numbers. It matches the shipped
 * `backend/config.toml` default, which is what those takes were judged by, so
 * it is a correct answer for exactly the rows that need it and a stale one for
 * nothing.
 */
const FALLBACK_OUTER_PCT = 20;

/**
 * Where a chart's full deflection sits for one signed deviation.
 *
 * Full deflection means "beyond here the pipeline calls it severe", so it is
 * the outer threshold on whichever side of the beat the deviation fell. The
 * two sides are independent by design — the tuning appendix widens dragging
 * because musicians tolerate it better — and a bar drawn against a single
 * number would overstate one side and understate the other the moment they
 * diverge.
 */
export function fullScaleFor(
  tolerance: Tolerance | null,
  deviationPct: number,
): number {
  if (tolerance === null) {
    return FALLBACK_OUTER_PCT;
  }
  // Rush-positive, the convention everything downstream of `toTake` uses.
  return deviationPct >= 0
    ? tolerance.rushing_outer_pct
    : tolerance.dragging_outer_pct;
}

/**
 * The default inner threshold, for takes that carry no tolerance of their own.
 *
 * The sibling of `FALLBACK_OUTER_PCT` and reachable for the same rows: takes
 * analysed before the pipeline started recording the numbers it judged them
 * by. It matches the shipped `backend/config.toml`, which is what those takes
 * were judged by.
 */
const FALLBACK_INNER_PCT = 5;

/**
 * Which band one signed deviation falls in, by the thresholds it was judged by.
 *
 * **A port of the pipeline's `classify_band`, and only safe because the
 * thresholds travel with the take.** `result_json.tolerance` carries the six
 * numbers the server used, so this applies the server's cutoffs rather than
 * inventing cutoffs here — the objection that kept the aggregate from being
 * banded at all, and the reason Insights borrowed a band off an arbitrary take
 * instead.
 *
 * Rush-positive, the convention everything downstream of `toTake` uses, so the
 * sign selects the opposite side from the pipeline's own drag-positive code.
 * The two sets are independent because musicians tolerate dragging better.
 */
export function bandFor(deviationPct: number, tolerance: Tolerance | null): Band {
  const magnitude = Math.abs(deviationPct);
  const [inner, mid, outer] =
    tolerance === null
      ? [FALLBACK_INNER_PCT, FALLBACK_OUTER_PCT / 2, FALLBACK_OUTER_PCT]
      : deviationPct >= 0
        ? [
            tolerance.rushing_inner_pct,
            tolerance.rushing_mid_pct,
            tolerance.rushing_outer_pct,
          ]
        : [
            tolerance.dragging_inner_pct,
            tolerance.dragging_mid_pct,
            tolerance.dragging_outer_pct,
          ];
  if (magnitude <= inner) {
    return 'on';
  }
  if (magnitude <= mid) {
    return 'slight';
  }
  return magnitude <= outer ? 'rush_drag' : 'severe';
}

/**
 * Which side of the beat a deviation fell on, once it is outside tolerance.
 *
 * A port of the pipeline's `_direction`. Inside the inner band there is no
 * side to name: a deviation the thresholds call `on` is one the app has
 * agreed not to call rushing or dragging, and naming a side anyway is how a
 * musician gets told which way they drift when the answer is "you didn't".
 */
export function directionFor(deviationPct: number, band: Band): Direction {
  if (band === 'on') {
    return 'on';
  }
  return deviationPct > 0 ? 'rush' : 'drag';
}

/**
 * How far off the beat a spread has to be before it is worth a word.
 *
 * The **wider** of the two inner thresholds, deliberately. A spread has no
 * side — it is an average distance measured in both directions — so there is
 * no sign to pick a set with, and taking the wider one means the app never
 * calls a take uneven over a distance it would have called on-tempo on either
 * side. This screen's credibility rests on not inventing problems, so where
 * the two thresholds disagree the quiet one wins.
 */
export function spreadIsBeyondTolerance(
  spreadPct: number,
  tolerance: Tolerance | null,
): boolean {
  const inner =
    tolerance === null
      ? FALLBACK_INNER_PCT
      : Math.max(tolerance.rushing_inner_pct, tolerance.dragging_inner_pct);
  return spreadPct > inner;
}

/**
 * One scale for a chart that draws both sides of the beat on a shared axis.
 *
 * The wider of the two, deliberately. A line crossing zero has to stay
 * straight: scaling the halves independently would bend a steady drift at the
 * origin, which reads as a change in the playing rather than a change in the
 * axis. Taking the wider one keeps the geometry linear and guarantees nothing
 * clips — the cost is that the tighter side reaches full height a little
 * early, which is a smaller lie than a false kink.
 */
export function sharedFullScaleFor(tolerance: Tolerance | null): number {
  if (tolerance === null) {
    return FALLBACK_OUTER_PCT;
  }
  return Math.max(tolerance.rushing_outer_pct, tolerance.dragging_outer_pct);
}

/** Quarter-note BPM expressed in the note value printed on the page. */
export function displayTempoBpm(
  quarterBpm: number,
  unit: TempoBeatUnit | null | undefined,
): number {
  return Math.round(quarterBpm / BEATS[unit ?? 'quarter']);
}

/** A displayed metronome number returned to the quarter-note timing clock. */
export function quarterBpmFromDisplay(
  displayedBpm: number,
  unit: TempoBeatUnit | null | undefined,
): number {
  return Math.round(displayedBpm * BEATS[unit ?? 'quarter']);
}

/** The readable unit beside a tempo number. */
export function tempoUnitLabel(
  unit: TempoBeatUnit | null | undefined,
): string {
  const value = unit ?? 'quarter';
  if (value === 'quarter') {
    return 'BPM';
  }
  const words = value.replace(/_/g, '-');
  return value === 'double_whole' ? 'breve BPM' : `${words}-note BPM`;
}

/** A complete tempo label using the number a musician sees on the page. */
export function formatTempo(
  quarterBpm: number,
  unit: TempoBeatUnit | null | undefined,
): string {
  return `${displayTempoBpm(quarterBpm, unit)} ${tempoUnitLabel(unit)}`;
}

/** Display-space bounds corresponding to the backend's quarter-BPM bounds. */
export function tempoDisplayRange(
  unit: TempoBeatUnit | null | undefined,
  minQuarterBpm = 20,
  maxQuarterBpm = 300,
): { min: number; max: number } {
  const beats = BEATS[unit ?? 'quarter'];
  return {
    min: Math.ceil(minQuarterBpm / beats),
    max: Math.floor(maxQuarterBpm / beats),
  };
}

/**
 * "Working at 76  ·  marked 92".
 *
 * The tempo a musician has actually settled on for a piece is the most
 * personal thing the app knows about their practice, and until now it only
 * existed on the Record screen — you had to open a take to find out where you
 * left off. Naming both numbers matters when they differ: the gap between them
 * *is* the work in progress.
 *
 * When they agree, or nothing was marked, one number is the whole truth and
 * saying it twice would invent a distinction.
 */
export function formatWorkingTempo(
  workingBpm: number,
  markedBpm: number | null,
  unit?: TempoBeatUnit | null,
): string {
  const working = displayTempoBpm(workingBpm, unit);
  const label = tempoUnitLabel(unit);
  if (markedBpm === null || markedBpm === workingBpm) {
    return `${working} ${label}`;
  }
  return `Working at ${working}  ·  marked ${displayTempoBpm(markedBpm, unit)} ${label}`;
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
