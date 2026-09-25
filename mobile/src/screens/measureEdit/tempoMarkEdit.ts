import type { ScoreJson, ScoreTempoChange } from '../../data/types';
import { statedTempoByMeasure, TEMPO_PRIMO } from '../../lib/score/tempoMap';

/**
 * A tempo change printed at one bar — the owner's request of 2026-09-25, "how
 * am I supposed to account for tempo variations or where it says poco": the
 * page's reader sees notes, not words, so the musician marks them here.
 *
 * What the analysis does with each is `backend/app/services/score_schema.py`
 * (`tempo_in_force`, `tempo_change_spans`); this is only how one is chosen,
 * described and written into the score.
 */

/** What a musician chooses between, in the order a page uses them. */
export type TempoMarkChoice = 'slowing' | 'speeding' | 'a_tempo' | 'tempo_primo' | 'new_tempo';

export interface TempoMarkOption {
  value: TempoMarkChoice;
  label: string;
  /** What is usually printed, written in when nothing else is typed. */
  printed: string;
}

export const TEMPO_MARK_CHOICES: TempoMarkOption[] = [
  { value: 'slowing', label: 'Slowing down', printed: 'rit.' },
  { value: 'speeding', label: 'Speeding up', printed: 'accel.' },
  { value: 'a_tempo', label: 'Back to tempo', printed: 'a tempo' },
  { value: 'tempo_primo', label: 'Back to the opening tempo', printed: 'Tempo I' },
  { value: 'new_tempo', label: 'A new tempo', printed: '' },
];

/** The words the schema allows, at most. */
export const PRINTED_MAX = 40;

/** The slowest and fastest a new tempo can be set to, as the schema allows. */
export const NEW_TEMPO_MIN = 20;
export const NEW_TEMPO_MAX = 300;

/** Which choice a stored marking is. */
export function choiceOf(change: ScoreTempoChange): TempoMarkChoice {
  switch (change.kind) {
    case 'ritardando':
      return 'slowing';
    case 'accelerando':
      return 'speeding';
    case 'new_tempo':
      return 'new_tempo';
    case 'a_tempo':
      return TEMPO_PRIMO.test(change.text) ? 'tempo_primo' : 'a_tempo';
  }
}

/** The markings printed at a bar, in the order they were printed. */
export function tempoMarksAt(score: ScoreJson, measureNumber: number): ScoreTempoChange[] {
  return (score.tempo_changes ?? []).filter((c) => c.measure_number === measureNumber);
}

/**
 * The stated tempo in force as a bar begins, before anything printed at it —
 * null for the piece's opening tempo (`lib/score/tempoMap.ts`).
 */
export function statedTempoBefore(score: ScoreJson, measureNumber: number): number | null {
  let value: number | null = null;
  for (const [measure, stated] of statedTempoByMeasure(score)) {
    if (measure < measureNumber) value = stated;
  }
  return value;
}

/**
 * Where a new tempo's stepper starts: the tempo in force as the bar begins,
 * else the piece's marked tempo, else a hundred.
 */
export function startingBpm(score: ScoreJson, measureNumber: number): number {
  return Math.round(statedTempoBefore(score, measureNumber) ?? score.bpm_hint ?? 100);
}

/**
 * What a new tempo is usually printed as, from which way it goes: "meno
 * mosso" slower, "più mosso" faster, nothing when it is the same.
 */
export function printedForNewTempo(bpm: number, before: number): string {
  if (bpm < before) return 'meno mosso';
  if (bpm > before) return 'più mosso';
  return '';
}

/**
 * The marking a choice writes, with the words the musician typed or, failing
 * that, the words usually printed. Never empty: the schema needs a word, and
 * a new tempo with nothing typed is written as its number.
 */
export function markFor(
  choice: TempoMarkChoice,
  measureNumber: number,
  printed: string,
  bpm: number | null,
): ScoreTempoChange {
  const typed = printed.trim().slice(0, PRINTED_MAX);
  const usual = TEMPO_MARK_CHOICES.find((c) => c.value === choice)!.printed;
  switch (choice) {
    case 'slowing':
      return { measure_number: measureNumber, kind: 'ritardando', text: typed || usual };
    case 'speeding':
      return { measure_number: measureNumber, kind: 'accelerando', text: typed || usual };
    case 'a_tempo':
      return { measure_number: measureNumber, kind: 'a_tempo', text: typed || usual };
    case 'tempo_primo':
      // Written so the analysis recognises it whatever was typed.
      return {
        measure_number: measureNumber,
        kind: 'a_tempo',
        text: TEMPO_PRIMO.test(typed) ? typed : usual,
      };
    case 'new_tempo': {
      const clamped =
        bpm === null ? null : Math.min(NEW_TEMPO_MAX, Math.max(NEW_TEMPO_MIN, Math.round(bpm)));
      return {
        measure_number: measureNumber,
        kind: 'new_tempo',
        text: typed || 'new tempo',
        bpm: clamped,
      };
    }
  }
}

/**
 * The score with the tempo marking at one bar replaced — or removed, for
 * `null`. One marking per bar: a page prints one, and two at the same bar
 * would leave the order between them to chance.
 */
export function applyTempoMarkEdit(
  score: ScoreJson,
  measureNumber: number,
  mark: ScoreTempoChange | null,
): ScoreJson {
  const others = (score.tempo_changes ?? []).filter((c) => c.measure_number !== measureNumber);
  const next = mark ? [...others, { ...mark, measure_number: measureNumber }] : others;
  return {
    ...score,
    tempo_changes: next.sort((a, b) => a.measure_number - b.measure_number),
  };
}

/** A marking in the words the settings row shows: "poco rit.", "meno mosso · 88". */
export function describeTempoMark(mark: ScoreTempoChange | null): string {
  if (!mark) {
    return 'No change at this bar';
  }
  if (mark.kind === 'new_tempo') {
    return mark.bpm ? `${mark.text} · ${mark.bpm}` : `${mark.text} · no number`;
  }
  return mark.text;
}

/** The marks on a metronome, which is how a page states a tempo. */
export const METRONOME_MARKS = [
  40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 63, 66, 69, 72, 76, 80, 84, 88, 92, 96, 100, 104,
  108, 112, 116, 120, 126, 132, 138, 144, 152, 160, 168, 176, 184, 192, 200, 208,
];

/**
 * The next metronome mark up or down from a tempo — the stepper's step, so
 * "meno mosso, 88" from 104 is four taps rather than sixteen. Past the ends
 * of the metronome it steps by one, within what the schema allows.
 */
export function nextMetronomeMark(bpm: number, direction: 1 | -1): number {
  const next =
    direction > 0
      ? METRONOME_MARKS.find((mark) => mark > bpm)
      : [...METRONOME_MARKS].reverse().find((mark) => mark < bpm);
  return Math.min(NEW_TEMPO_MAX, Math.max(NEW_TEMPO_MIN, next ?? bpm + direction));
}

/** The words a choice starts with in the sheet's "As printed" field. */
export function usualPrinted(choice: TempoMarkChoice, bpm: number, before: number): string {
  return choice === 'new_tempo'
    ? printedForNewTempo(bpm, before)
    : TEMPO_MARK_CHOICES.find((c) => c.value === choice)!.printed;
}

/**
 * The words after the stepper moves: re-suggested while they are still the
 * app's suggestion, left alone once the musician has typed their own.
 */
export function printedAfterStep(printed: string, bpm: number, before: number): string {
  return ['', 'meno mosso', 'più mosso'].includes(printed.trim())
    ? printedForNewTempo(bpm, before)
    : printed;
}
