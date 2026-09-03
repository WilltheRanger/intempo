import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../data/types';
import { timeSignaturesByMeasure } from '../lib/notation/meter';
import { describeBeats } from '../lib/notation/reading';

/**
 * The bar editor judges a bar against the metre in force at it.
 *
 * **The metronome and the bar check disagreed about the same bar.**
 * `plan.ts` and `practiceCues.ts` have both walked `timeSignaturesByMeasure`
 * for a while, so the click followed a metre change correctly — while
 * `MeasureEditScreen` passed `piece.score.time_signature`, the metre printed at
 * the *top of the page*, to `describeBeats`. On a part that turns 3/4, a
 * correct three-beat bar was reported as **"3 of 4 beats"** and marked
 * unbalanced, which invites a musician to add a beat the page does not print —
 * and a note added there moves every onset after it, which is the one kind of
 * correction that cannot be seen by looking at the bar afterwards.
 *
 * Two halves, because either alone lets it come back. The arithmetic below is
 * the real check; the source assertion is the only thing that can see a rule
 * living in a `.tsx`, and there is no React Native testing library here
 * (`DECISIONS.md`, 2026-08-24).
 */
const q = () => ({ pitch: 'D4', duration: 'quarter' as const, tied_to_next: false });

const TURNS_TO_THREE_FOUR: ScoreJson = {
  time_signature: '4/4',
  key_signature: 'C major',
  tempo_marking: null,
  bpm_hint: 80,
  clef: 'treble',
  measures: [
    { measure_number: 1, notes: [q(), q(), q(), q()], slurs: [] },
    { measure_number: 2, notes: [q(), q(), q(), q()], slurs: [] },
    // The change is printed here and holds for every bar after it.
    { measure_number: 3, time_signature: '3/4', notes: [q(), q(), q()], slurs: [] },
    { measure_number: 4, notes: [q(), q(), q()], slurs: [] },
  ],
  repeats: [],
  ocr_confidence: 1,
  notes_to_human: '',
};

const source = Object.entries(
  import.meta.glob('./measureEdit/MeasureEditScreen.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>,
);

describe('the bar editor and the metre', () => {
  it('finds the screen it is about', () => {
    expect(source).toHaveLength(1);
  });

  it('does not hand describeBeats the page-opening metre', () => {
    const [, text] = source[0];

    expect(text).not.toContain('describeBeats(working, piece.score.time_signature');
    expect(text).toContain('timeSignaturesByMeasure');
  });

  it('calls a bar after the change balanced, where the header metre would not', () => {
    const bar = TURNS_TO_THREE_FOUR.measures[3];
    const inForce = timeSignaturesByMeasure(TURNS_TO_THREE_FOUR).get(4) ?? null;

    expect(inForce).toBe('3/4');

    const correct = describeBeats(bar.notes, inForce, { first: false });
    expect(correct.text).toBe('3 of 3 beats');
    expect(correct.balanced).toBe(true);

    // What the screen used to do, kept as the thing being guarded against.
    const byHeader = describeBeats(bar.notes, TURNS_TO_THREE_FOUR.time_signature, {
      first: false,
    });
    expect(byHeader.text).toBe('3 of 4 beats');
    expect(byHeader.balanced).toBe(false);
  });

  it('still judges a bar before the change against the opening metre', () => {
    const bar = TURNS_TO_THREE_FOUR.measures[1];
    const inForce = timeSignaturesByMeasure(TURNS_TO_THREE_FOUR).get(2) ?? null;

    expect(inForce).toBe('4/4');
    expect(describeBeats(bar.notes, inForce, { first: false }).balanced).toBe(true);
  });

  it('judges the bar that prints the change against the metre it prints', () => {
    // A bar carrying its own signature is in that metre, not the previous one.
    const bar = TURNS_TO_THREE_FOUR.measures[2];
    const inForce = timeSignaturesByMeasure(TURNS_TO_THREE_FOUR).get(3) ?? null;

    expect(inForce).toBe('3/4');
    expect(describeBeats(bar.notes, inForce, { first: false }).balanced).toBe(true);
  });
});
