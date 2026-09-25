import type { MeasureVerdict, TakeIntonation } from '../../data/types';
import type { ColorToken } from '../../design';
import { MIN_BAR, type ChartBar } from './measureChart';

/**
 * How in tune a take was — the owner's request of 2026-09-25, "pitch
 * variation as a graph", measured the way they chose: in cents, per bar,
 * against their own tuning (`backend/app/services/intonation.py`).
 *
 * The bands travel with the take (`TakeIntonation`), as `Tolerance` does, so
 * a stored take is drawn with the thresholds it was measured by.
 */

/** Where a bar's pitch sits against the player's tuning. */
export type PitchBand = 'in_tune' | 'slight' | 'off';

/** The distance the chart's half-height stands for, in cents. */
export const PITCH_SCALE_CENTS = 50;

export function pitchBand(cents: number, take: TakeIntonation): PitchBand {
  const distance = Math.abs(cents);
  if (distance <= take.inTuneCents) return 'in_tune';
  return distance <= take.slightCents ? 'slight' : 'off';
}

/** The same three colours the tempo charts use, for the same three meanings. */
export function pitchTone(band: PitchBand): ColorToken {
  return band === 'in_tune' ? 'verdictOn' : band === 'slight' ? 'verdictMid' : 'verdictBad';
}

/** "In tune", "12 cents sharp", "40 cents flat" — a bar's pitch in words. */
export function pitchWords(cents: number, take: TakeIntonation): string {
  if (pitchBand(cents, take) === 'in_tune') return 'In tune';
  return `${Math.round(Math.abs(cents))} cents ${cents > 0 ? 'sharp' : 'flat'}`;
}

/**
 * "In tune", one bar per measure: up for sharp, down for flat, against the
 * player's own tuning, in the band's colour. Null when the take has no pitch
 * to draw — an older result, or too few notes read — so the section is left
 * out rather than drawn empty.
 */
export function pitchChartBars(
  measures: readonly MeasureVerdict[],
  take: TakeIntonation | null,
): ChartBar[] | null {
  if (take === null || measures.every((m) => m.pitchCents === null)) {
    return null;
  }
  return measures.map((m) => {
    if (m.pitchCents === null) {
      // Nothing in the bar could be read: a neutral stub, as an untimed bar is.
      return { measure: m.measure, up: true, size: MIN_BAR, tone: null };
    }
    return {
      measure: m.measure,
      up: m.pitchCents >= 0,
      size: Math.max(MIN_BAR, Math.min(1, Math.abs(m.pitchCents) / PITCH_SCALE_CENTS)),
      tone: pitchTone(pitchBand(m.pitchCents, take)),
    };
  });
}

interface OffRun {
  first: number;
  last: number;
  sharp: boolean;
  length: number;
}

/** The longest stretch of consecutive bars clearly off the same way. */
function longestOffRun(
  read: readonly (MeasureVerdict & { pitchCents: number })[],
  take: TakeIntonation,
): OffRun | null {
  let best: OffRun | null = null;
  let run: OffRun | null = null;
  for (const m of read) {
    const off = pitchBand(m.pitchCents, take) === 'off';
    const sharp = m.pitchCents > 0;
    if (off && run !== null && run.sharp === sharp) {
      run = { first: run.first, last: m.measure, sharp, length: run.length + 1 };
    } else {
      run = off ? { first: m.measure, last: m.measure, sharp, length: 1 } : null;
    }
    if (run !== null && (best === null || run.length > best.length)) best = run;
  }
  return best;
}

/** Share of the bars read that must be in tune for "mostly in tune" to be true. */
const MOST = 0.6;

/**
 * The line under "In tune", and the tuning as a caption when the whole take
 * sat off A = 440: "Bars 17–18 flat" and "Tuned 25¢ sharp".
 *
 * **Short, because the chart says the rest** (the owner, 2026-09-25: "too
 * wordy", over "Most bars within 15 cents of your tuning; bars 17–18 sat
 * flat." and "Tuned 25 cents sharp of A = 440."). The line names the one
 * place worth practising — the longest stretch of consecutive bars clearly
 * off the same way — and only when there is none says how the take sat as a
 * whole.
 */
export function pitchLines(
  measures: readonly MeasureVerdict[],
  take: TakeIntonation,
): { summary: string; tuning: string | null } {
  const read = measures.filter(
    (m): m is MeasureVerdict & { pitchCents: number } => m.pitchCents !== null,
  );
  const best = longestOffRun(read, take);
  let summary: string;
  if (best) {
    const where = best.first === best.last ? `Bar ${best.first}` : `Bars ${best.first}–${best.last}`;
    summary = `${where} ${best.sharp ? 'sharp' : 'flat'}`;
  } else {
    const inTune = read.filter((m) => pitchBand(m.pitchCents, take) === 'in_tune').length;
    summary =
      inTune === read.length
        ? 'In tune throughout'
        : inTune / Math.max(1, read.length) >= MOST
          ? 'Mostly in tune'
          : 'A little off in places';
  }

  const tuning =
    Math.abs(take.tuningCents) >= take.tuningWorthSayingCents
      ? `Tuned ${Math.round(Math.abs(take.tuningCents))}¢ ${take.tuningCents > 0 ? 'sharp' : 'flat'}`
      : null;
  return { summary, tuning };
}
