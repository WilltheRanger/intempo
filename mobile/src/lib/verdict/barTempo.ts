import type {
  Band,
  Direction,
  MeasureVerdict,
  TempoBeatUnit,
  Tolerance,
  UserVerdict,
} from '../../data/types';
import type { ColorToken } from '../../design';
import {
  bandFor,
  directionFor,
  displayTempoBpm,
  tempoUnitLabel,
  verdictColorFor,
} from '../tempo';
import { appVerdictFor } from './correction';
import type { ChartBar } from './measureChart';
import { MIN_BAR } from './measureChart';
import { readMeasure } from './measureReading';

/**
 * The verdict's charts in BPM — the owner's request of 2026-09-25: "have the
 * graph show in a scale of BPM instead of rushing or dragging".
 *
 * **What they plotted before, and why it floored.** Each note's deviation is
 * measured from where it would fall had the take held the target tempo from
 * its first note. That is the right question beside a click, and a take held
 * steadily at 90 against 104 answers it by growing a beat late every seven
 * beats: 6% in bar 1, 305% by bar 11, 773% by bar 24. "Across the take" sat on
 * its floor from bar 2, and bar 22's card said "More than a beat behind" of a
 * bar played steadily. Each bar's own tempo (`PerMeasure.played_bpm`) is the
 * same take said the way a musician hears it.
 *
 * The screen's title and the server's sentence still answer the click's
 * question; the charts, the bar's card and what "What did you hear?" says the
 * app read now answer this one, so a bar tells one story.
 *
 * Every figure is shown in the page's own beat unit, as the Target fact is.
 */

export interface BarTempo {
  /** The tempo the bar was played at, in the page's beat unit, rounded. */
  bpm: number;
  /** The tempo the musician set, in the same unit. */
  target: number;
  /** `bpm - target`, whole numbers: negative is under. */
  difference: number;
  /**
   * How far from the target, as a percentage of it, rush-positive — the unit
   * `Tolerance`'s bands are in, so a bar's colour means what it means
   * everywhere else in the app.
   */
  deviationPct: number;
  band: Band;
  direction: Direction;
  tone: ColorToken;
  /** "85 BPM" — the card's figure. */
  label: string;
  /** "19 under your 104", "3 over your 104", "On your 104". */
  detail: string;
  /** Read out for the bar. */
  spoken: string;
}

/**
 * The tempo a bar is judged against: its own where the page moved it ("meno
 * mosso 88", `MeasureVerdict.targetBpm`), the take's everywhere else.
 */
export function barTarget(measure: MeasureVerdict, takeTargetBpm: number): number {
  return measure.targetBpm != null && measure.targetBpm > 0 ? measure.targetBpm : takeTargetBpm;
}

/**
 * A bar's tempo, or null where there is none to show — an older result, a
 * bar with too few notes to time, or one the page said not to judge (a
 * `rit.`, a held fermata), which keeps its existing reading.
 *
 * Against the bar's own target (`barTarget`): a bar of a meno mosso at 88,
 * played at 88, is on it — "On your 88" — not 16 under the opening's 104.
 */
export function barTempo(
  measure: MeasureVerdict,
  takeTargetBpm: number,
  unit: TempoBeatUnit | null | undefined,
  tolerance: Tolerance | null,
): BarTempo | null {
  const targetBpm = barTarget(measure, takeTargetBpm);
  if (
    measure.playedBpm === null ||
    !(measure.playedBpm > 0) ||
    !(targetBpm > 0) ||
    !readMeasure(measure).showsDeviation
  ) {
    return null;
  }
  const deviationPct = (measure.playedBpm / targetBpm - 1) * 100;
  const band = bandFor(deviationPct, tolerance);
  const direction = directionFor(deviationPct, band);
  const bpm = displayTempoBpm(measure.playedBpm, unit);
  const target = displayTempoBpm(targetBpm, unit);
  const difference = bpm - target;
  const detail =
    difference === 0
      ? `On your ${target}`
      : `${Math.abs(difference)} ${difference < 0 ? 'under' : 'over'} your ${target}`;
  const label = `${bpm} ${tempoUnitLabel(unit)}`;
  return {
    bpm,
    target,
    difference,
    deviationPct,
    band,
    direction,
    tone: verdictColorFor(band),
    label,
    detail,
    spoken: `${label}, ${detail}`,
  };
}

/**
 * What "What did you hear?" says the app read of this bar: its tempo where
 * the card shows one, so the prompt corrects what the musician was shown.
 */
export function appVerdictForBar(
  measure: MeasureVerdict,
  targetBpm: number,
  unit: TempoBeatUnit | null | undefined,
  tolerance: Tolerance | null,
): UserVerdict {
  const tempo = barTempo(measure, targetBpm, unit, tolerance);
  if (tempo === null) {
    return appVerdictFor(measure);
  }
  if (tempo.band === 'on') {
    return 'on_tempo';
  }
  return tempo.direction === 'rush' ? 'rushing' : 'dragging';
}

/**
 * The smallest distance from the target the bars' half-height stands for,
 * in percent: a take steady to within a whisker must not draw its whisker as
 * a full-height wall. The same floor `measureChartBars` uses.
 */
const BAR_SCALE_FLOOR_PCT = 10;

/**
 * "Bar by bar" in tempo: up for faster than the target, down for slower,
 * scaled to the take's furthest bar. Null when no bar has a tempo — an older
 * result — so the screen draws the chart it always did.
 */
export function tempoChartBars(
  measures: readonly MeasureVerdict[],
  targetBpm: number,
  unit: TempoBeatUnit | null | undefined,
  tolerance: Tolerance | null,
): ChartBar[] | null {
  const tempi = measures.map((m) => barTempo(m, targetBpm, unit, tolerance));
  if (tempi.every((t) => t === null)) {
    return null;
  }
  const scale = Math.max(
    BAR_SCALE_FLOOR_PCT,
    ...tempi.map((t) => (t === null ? 0 : Math.abs(t.deviationPct))),
  );
  return measures.map((measure, index) => {
    const tempo = tempi[index];
    if (tempo === null) {
      // No tempo to draw: a neutral stub on the line, as an untimed bar is.
      return { measure: measure.measure, up: true, size: MIN_BAR, tone: null };
    }
    return {
      measure: measure.measure,
      up: tempo.deviationPct >= 0,
      size: Math.max(MIN_BAR, Math.min(1, Math.abs(tempo.deviationPct) / scale)),
      tone: tempo.tone,
    };
  });
}
