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
 * and says it once: "Bars 5–8 were fast: 104 beats a minute, not 96".
 */

const NBSP = '\u00A0';

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

/**
 * The tapped passage as a plain sentence: "Bars 15–24 were slow: 95 beats a
 * minute, not 104", "Bars 1–4 were on tempo".
 *
 * **A sentence, not a readout** (the owner, 2026-09-30, of "Bars 15–24 ·
 * about 95, aiming for 104": "let's fix this jargon"). A bare 95 beside a bare
 * 104 asked the reader to know both were tempi and which was theirs; the
 * sentence says it, and says the number is beats a minute.
 */
export function tempoPassageLine(
  passage: BarPassage<TempoKind> & { bpm: number | null; aim: number | null },
): string {
  const where = barsLabel(passage);
  const were = passage.from === passage.to ? 'was' : 'were';
  if (passage.kind === 'untimed') return `${where} ${were}n't timed`;
  if (passage.kind === 'on') return `${where} ${were} on tempo`;
  const way = passage.kind === 'rush' ? 'fast' : 'slow';
  if (passage.bpm !== null && passage.aim !== null) {
    // Held together, so a narrow screen breaks after the colon and not before
    // the target: "…not" over a lone "96" read as a second, stray number.
    const detail = `${passage.bpm} beats a minute, not ${passage.aim}`.replace(/ /g, NBSP);
    return `${where} ${were} ${way}: ${detail}`;
  }
  return `${where} ${were} ${way}`;
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
