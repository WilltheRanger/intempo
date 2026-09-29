import type { MeasureVerdict, TakeIntonation, TempoBeatUnit, Tolerance } from '../../data/types';
import { barTempo } from './barTempo';
import { pitchBand } from './intonation';
import { readMeasure } from './measureReading';

/**
 * The passage a tapped bar belongs to, and what to say about it.
 *
 * **Passages, not bars** (the owner, 2026-09-29: the bar card was "too
 * specific and doesn't make sense"). A musician practises a passage, and one
 * bar's tempo is the shakiest number the app has — a handful of notes — so a
 * card of "Bar 7 · 105 BPM" on a scale was precision the measurement did not
 * have. A tap now selects the run of neighbouring bars that went the same way
 * and says it once: "Bars 5–8 · about 104, aiming for 96".
 */

/** How a bar went, in the terms a passage is grouped by. */
export type TempoKind = 'on' | 'rush' | 'drag' | 'untimed';
export type PitchKind = 'in_tune' | 'sharp' | 'flat' | 'unread';

export interface BarPassage<K extends string = string> {
  from: number;
  to: number;
  kind: K;
}

function tempoKind(
  measure: MeasureVerdict,
  target: number,
  unit: TempoBeatUnit | null | undefined,
  tolerance: Tolerance | null,
): TempoKind {
  const tempo = barTempo(measure, target, unit, tolerance);
  if (tempo) {
    if (tempo.band === 'on') return 'on';
    return tempo.direction === 'rush' ? 'rush' : 'drag';
  }
  // An older result with no bar tempi, or a bar the page said not to judge.
  if (!readMeasure(measure).showsDeviation) return 'untimed';
  if (measure.band === 'on') return 'on';
  return measure.direction === 'rush' ? 'rush' : 'drag';
}

function pitchKind(measure: MeasureVerdict, take: TakeIntonation): PitchKind {
  if (measure.pitchCents == null) return 'unread';
  if (pitchBand(measure.pitchCents, take) === 'in_tune') return 'in_tune';
  return measure.pitchCents > 0 ? 'sharp' : 'flat';
}

/** The run of neighbouring bars around `index` that share its kind. */
function runAround<K extends string>(kinds: readonly K[], index: number): [number, number] {
  let first = index;
  let last = index;
  while (first > 0 && kinds[first - 1] === kinds[index]) first -= 1;
  while (last < kinds.length - 1 && kinds[last + 1] === kinds[index]) last += 1;
  return [first, last];
}

/**
 * The tempo passage around a bar: every neighbour that was also on tempo, or
 * also ahead, or also behind — a gold bar beside a red one is one rushed
 * passage, not two. Null for a bar that is not in the take.
 */
export function tempoPassageAt(
  measures: readonly MeasureVerdict[],
  measure: number,
  target: number,
  unit: TempoBeatUnit | null | undefined,
  tolerance: Tolerance | null,
): (BarPassage<TempoKind> & { bpm: number | null; aim: number | null }) | null {
  const index = measures.findIndex((m) => m.measure === measure);
  if (index < 0) return null;
  const kinds = measures.map((m) => tempoKind(m, target, unit, tolerance));
  const [first, last] = runAround(kinds, index);
  const tempi = measures
    .slice(first, last + 1)
    .map((m) => barTempo(m, target, unit, tolerance))
    .filter((t): t is NonNullable<typeof t> => t !== null);
  const bpm = tempi.length ? Math.round(tempi.reduce((sum, t) => sum + t.bpm, 0) / tempi.length) : null;
  return {
    from: measures[first].measure,
    to: measures[last].measure,
    kind: kinds[index],
    bpm,
    aim: tempi.length ? tempi[0].target : null,
  };
}

/** The pitch passage around a bar: its neighbours also in tune, or also sharp, or also flat. */
export function pitchPassageAt(
  measures: readonly MeasureVerdict[],
  measure: number,
  take: TakeIntonation,
): BarPassage<PitchKind> | null {
  const index = measures.findIndex((m) => m.measure === measure);
  if (index < 0) return null;
  const kinds = measures.map((m) => pitchKind(m, take));
  const [first, last] = runAround(kinds, index);
  return { from: measures[first].measure, to: measures[last].measure, kind: kinds[index] };
}

/** "Bar 6", "Bars 5–8". */
export function barsLabel(passage: { from: number; to: number }): string {
  return passage.from === passage.to ? `Bar ${passage.from}` : `Bars ${passage.from}–${passage.to}`;
}

/** "Bars 5–8 · about 104, aiming for 96", "Bars 1–4 · on tempo". */
export function tempoPassageLine(
  passage: BarPassage<TempoKind> & { bpm: number | null; aim: number | null },
): string {
  const where = barsLabel(passage);
  if (passage.kind === 'untimed') return `${where} · not timed`;
  if (passage.kind === 'on') return `${where} · on tempo`;
  if (passage.bpm !== null && passage.aim !== null) {
    return `${where} · about ${passage.bpm}, aiming for ${passage.aim}`;
  }
  return `${where} · ${passage.kind === 'rush' ? 'ahead' : 'behind'}`;
}

/** "Bars 7–8 · played flat", "Bars 1–6 · in tune". */
export function pitchPassageLine(passage: BarPassage<PitchKind>): string {
  const where = barsLabel(passage);
  switch (passage.kind) {
    case 'in_tune':
      return `${where} · in tune`;
    case 'unread':
      return `${where} · pitch not read`;
    default:
      return `${where} · played ${passage.kind}`;
  }
}
