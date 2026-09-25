import type { ScoreJson } from '../../data/types';

/**
 * The tempo each bar is meant at, where the page changes it — the app's half
 * of `backend/app/services/score_schema.py` (`tempo_in_force`,
 * `targets_by_measure`), held to it by `fixtures/practice/tempo_map.json`.
 *
 * Listen plays a "meno mosso · 88" at 88 because of this, and the bar editor
 * starts a new tempo's stepper from what is in force. The analysis judges each
 * bar against the same numbers, so the three agree on what the page asks for.
 */

/** "Tempo I", "Tempo primo", "1o Tempo": back to the opening, not one step. */
export const TEMPO_PRIMO = /\b(tempo\s*(i|1|primo|1o|1º)|1\s*[oº°]?\s*tempo|primo\s+tempo)\b/i;

/**
 * The stated tempo in force at each bar, in the piece's own terms — null for
 * the opening, whatever a take or Listen chooses to take it at.
 *
 * Each marking pushes the tempo it leaves; "a tempo" pops one; "Tempo I"
 * goes back to the opening. A gradual change leaves the number where it was:
 * its bars are not held to one.
 */
export function statedTempoByMeasure(score: ScoreJson): Map<number, number | null> {
  const byMeasure = new Map<number, NonNullable<ScoreJson['tempo_changes']>>();
  for (const change of score.tempo_changes ?? []) {
    byMeasure.set(change.measure_number, [...(byMeasure.get(change.measure_number) ?? []), change]);
  }
  const numbers = [...new Set(score.measures.map((m) => m.measure_number))].sort((a, b) => a - b);

  let current: number | null = null;
  const left: (number | null)[] = [];
  const out = new Map<number, number | null>();
  for (const measure of numbers) {
    for (const change of byMeasure.get(measure) ?? []) {
      if (change.kind === 'a_tempo') {
        if (TEMPO_PRIMO.test(change.text)) {
          current = null;
          left.length = 0;
        } else {
          current = left.pop() ?? null;
        }
        continue;
      }
      left.push(current);
      if (change.kind === 'new_tempo' && change.bpm) {
        current = change.bpm;
      }
    }
    out.set(measure, current);
  }
  return out;
}

/**
 * The tempo a bar is played at, for a performance at `bpm`: `bpm` itself until
 * the page changes it, then the stated tempo scaled the way `bpm` is scaled
 * from the piece's marked tempo — a meno mosso marked 88 in a piece marked
 * 104, played at 52, is 44. A piece with no marked tempo takes the number as
 * it stands.
 */
export function tempoByMeasure(score: ScoreJson, bpm: number): Map<number, number> {
  const reference = score.bpm_hint && score.bpm_hint > 0 ? score.bpm_hint : bpm;
  const scale = reference > 0 ? bpm / reference : 1;
  const out = new Map<number, number>();
  for (const [measure, stated] of statedTempoByMeasure(score)) {
    out.set(measure, stated === null ? bpm : stated * scale);
  }
  return out;
}
