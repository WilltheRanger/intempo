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
  displayTempoValue,
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
 * A bar's tempo, or null where there is none to show — an older result, a
 * bar with too few notes to time, or one the page said not to judge (a
 * `rit.`, a held fermata), which keeps its existing reading.
 */
export function barTempo(
  measure: MeasureVerdict,
  targetBpm: number,
  unit: TempoBeatUnit | null | undefined,
  tolerance: Tolerance | null,
): BarTempo | null {
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

export interface TempoPoint {
  measure: number;
  /** Where along the take, 0 to 1, by the bar's place among the take's bars. */
  at: number;
  /** In the page's beat unit. */
  bpm: number;
}

export interface TempoTick {
  bpm: number;
  label: string;
  isTarget: boolean;
}

export interface TempoLineData {
  /** Runs of consecutive bars with a tempo; a bar without one breaks the line. */
  runs: TempoPoint[][];
  target: number;
  /** The axis, bottom and top, in the page's beat unit. */
  min: number;
  max: number;
  ticks: TempoTick[];
}

/**
 * "Across the take" in BPM, fitted to the take — the owner's choice of two
 * (2026-09-25). The axis spans the take's slowest and fastest bars and always
 * the target, padded so no point sits on an edge: nothing floors.
 *
 * Every bar with a tempo is plotted, a `rit.` included — slowing as marked is
 * a real tempo, and the line shows it; only the bars' colours are judgements.
 *
 * Null when fewer than two bars have one: a line needs two points.
 */
export function tempoLine(
  measures: readonly MeasureVerdict[],
  targetBpm: number,
  unit: TempoBeatUnit | null | undefined,
): TempoLineData | null {
  if (!(targetBpm > 0) || measures.length === 0) {
    return null;
  }
  const last = Math.max(1, measures.length - 1);
  const runs: TempoPoint[][] = [];
  let run: TempoPoint[] = [];
  measures.forEach((measure, index) => {
    if (measure.playedBpm === null || !(measure.playedBpm > 0)) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push({
      measure: measure.measure,
      at: index / last,
      bpm: displayTempoValue(measure.playedBpm, unit),
    });
  });
  if (run.length > 0) runs.push(run);

  const all = runs.flat();
  if (all.length < 2) {
    return null;
  }
  const target = displayTempoBpm(targetBpm, unit);
  const low = Math.min(target, ...all.map((p) => p.bpm));
  const high = Math.max(target, ...all.map((p) => p.bpm));
  const pad = Math.max((high - low) * 0.12, 2);
  const min = low - pad;
  const max = high + pad;

  // The target is always labelled. The take's own ends are labelled too,
  // unless they would sit on top of the target's label.
  const crowded = (max - min) * 0.2;
  const ticks: TempoTick[] = [{ bpm: target, label: `${target}`, isTarget: true }];
  const top = Math.round(high);
  const bottom = Math.round(low);
  if (top - target > crowded) {
    ticks.unshift({ bpm: top, label: `${top}`, isTarget: false });
  }
  if (target - bottom > crowded) {
    ticks.push({ bpm: bottom, label: `${bottom}`, isTarget: false });
  }
  return { runs, target, min, max, ticks };
}

/** Where a tempo sits on a line drawn `height` tall, 0 at the top. */
export function tempoY(bpm: number, line: TempoLineData, height: number): number {
  const span = line.max - line.min;
  if (span <= 0) {
    return height / 2;
  }
  return ((line.max - bpm) / span) * height;
}
