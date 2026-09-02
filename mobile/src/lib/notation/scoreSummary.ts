import type { Clef, ScoreJson } from '../../data/types';
import { timeSignaturesByMeasure } from './meter';

export const CLEF_LABELS: Record<Clef, string> = {
  treble: 'Treble clef',
  bass: 'Bass clef',
  alto: 'Alto clef',
  tenor: 'Tenor clef',
};

/**
 * What the score's metadata line says about the clef, and whether it lasts.
 *
 * **The line used to state the opening values and stop.** That was right while
 * a piece could only have one clef and one metre. Now that a change is read,
 * stamped, carried across a page break and drawn, "Bass clef" can be true at
 * bar 1 and false at bar 3 — and a musician looking at a C clef partway down
 * the page has been told "Bass clef" and nothing else.
 *
 * Named rather than enumerated. A part that turns tenor once says so; one that
 * moves between three clefs says only that it changes, because listing them in
 * a metadata line is a worse way to learn that than looking at the stave, and
 * the line is not where a reader should be doing this work (§3 law 10).
 *
 * A piece that leaves the opening clef and comes back — bass, tenor, bass —
 * names tenor: the set is what it *turns to*, so the return is not a third
 * entry, and "changes" would understate a part that only ever visits one other
 * clef.
 */
export function clefSummary(score: ScoreJson | null | undefined): string[] {
  if (!score) {
    return [];
  }
  const opening = score.clef ?? null;
  if (!opening) {
    // Never guessed. `ScoreJson.clef` is nullable precisely so an unread page
    // is not captioned with a clef it may not use.
    return ['Clef not read'];
  }

  const others = new Set<Clef>();
  for (const measure of score.measures ?? []) {
    if (measure.clef && measure.clef !== opening) {
      others.add(measure.clef);
    }
  }

  const label = CLEF_LABELS[opening];
  if (others.size === 0) {
    return [label];
  }
  if (others.size === 1) {
    const [only] = [...others];
    return [label, `turns ${CLEF_LABELS[only].replace(' clef', '').toLowerCase()}`];
  }
  return [label, 'changes clef'];
}

/**
 * The same for the metre, and by the same rules.
 *
 * `unknown` is the escape hatch an unreadable header gets, and it is not a
 * metre — printing it would caption the piece with the word rather than admit
 * nothing was read, so it yields no entry at all.
 */
export function meterSummary(score: ScoreJson | null | undefined): string[] {
  if (!score) {
    return [];
  }
  const stated = (value: string | null | undefined) =>
    value && value !== 'unknown' ? value : null;

  const opening = stated(score.time_signature);
  if (!opening) {
    return [];
  }

  // Read through the same walk the metronome and the bar check use, so the
  // three cannot disagree about what a bar is in.
  const inForce = timeSignaturesByMeasure(score);
  const others = new Set<string>();
  for (const metre of inForce.values()) {
    const value = stated(metre);
    if (value && value !== opening) {
      others.add(value);
    }
  }

  if (others.size === 0) {
    return [opening];
  }
  if (others.size === 1) {
    const [only] = [...others];
    return [opening, `turns ${only}`];
  }
  return [opening, 'changes metre'];
}
