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
 * and says it once: "Bars 5–8 were fast".
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
): BarPassage<TempoKind> | null {
  const index = measures.findIndex((m) => m.measure === measure);
  if (index < 0) return null;
  const kinds = measures.map((m) => tempoKind(m, target, unit, tolerance));
  const [first, last] = runAround(kinds, index);
  return { from: measures[first].measure, to: measures[last].measure, kind: kinds[index] };
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

/**
 * The tapped passage in a few words: "Bars 5–8 were fast", "Bars 1–4 were on
 * tempo".
 *
 * **The finding, no number** (the owner, 2026-09-30). "Bars 15–24 · about 95,
 * aiming for 104" was jargon, and "Bars 5–8 were fast: 104 beats a minute,
 * not 96" was still too wordy. The graph already draws how far the line went
 * and labels the target, so the line only has to say which way.
 */
export function tempoPassageLine(passage: BarPassage<TempoKind>): string {
  const where = barsLabel(passage);
  const were = passage.from === passage.to ? 'was' : 'were';
  if (passage.kind === 'untimed') return `${where} ${were}n't timed`;
  if (passage.kind === 'on') return `${where} ${were} on tempo`;
  return `${where} ${were} ${passage.kind === 'rush' ? 'fast' : 'slow'}`;
}

/** "Bars 7–8 were flat", "Bars 1–6 were in tune", "Bar 3's pitch couldn't be read". */
export function pitchPassageLine(passage: BarPassage<PitchKind>): string {
  const where = barsLabel(passage);
  const single = passage.from === passage.to;
  switch (passage.kind) {
    case 'in_tune':
      return `${where} ${single ? 'was' : 'were'} in tune`;
    case 'unread':
      return single
        ? `${where}'s pitch couldn't be read`
        : `The pitch of ${where.toLowerCase()} couldn't be read`;
    default:
      return `${where} ${single ? 'was' : 'were'} ${passage.kind}`;
  }
}
