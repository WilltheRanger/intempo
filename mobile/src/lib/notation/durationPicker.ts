import type { Duration } from '../../data/types';
import { EDITABLE_DURATIONS } from './reading';

/**
 * The bar editor's duration picker: a note value, and whether it is dotted or
 * a triplet.
 *
 * **Five note values and two toggles, where there were ten word chips.** The
 * chips spelled durations out ("Half ·", "Quarter ³"), invented a shorthand a
 * musician had to decode, and gave a dotted half the same weight as a
 * sixteenth. MuseScore and Dorico both pick a duration as one row of note
 * symbols with the dot and the triplet as separate toggles, which is how a
 * musician thinks about it: the value first, then what modifies it (the
 * reviews of 2026-11-12).
 *
 * **`EDITABLE_DURATIONS` stays the one list of what may be chosen.** Every
 * combination here is checked against it rather than listed again, so a
 * duration added there becomes reachable here, and a toggle that would make a
 * duration the list does not offer (a dotted whole, a triplet half) is simply
 * unavailable.
 */

/** The values a musician picks from, longest first, as the page orders them. */
export const NOTE_VALUES = ['whole', 'half', 'quarter', 'eighth', 'sixteenth'] as const;
export type NoteValue = (typeof NOTE_VALUES)[number];

export type DurationModifier = 'plain' | 'dotted' | 'triplet';

/** What a screen reader says for each value. */
export const NOTE_VALUE_NAMES: Record<NoteValue, string> = {
  whole: 'Whole note',
  half: 'Half note',
  quarter: 'Quarter note',
  eighth: 'Eighth note',
  sixteenth: 'Sixteenth note',
};

function isNoteValue(name: string): name is NoteValue {
  return (NOTE_VALUES as readonly string[]).includes(name);
}

/** The duration a value and modifier make, or null where the editor does not offer it. */
export function durationFor(value: NoteValue, modifier: DurationModifier): Duration | null {
  const name = modifier === 'plain' ? value : `${modifier}_${value}`;
  return (EDITABLE_DURATIONS as readonly string[]).includes(name) ? (name as Duration) : null;
}

/**
 * A duration taken apart. `value` is null for one the picker cannot show (a
 * double dot, a quintuplet, a thirty-second): the bar can hold those, and the
 * editor labels them, but nothing in the picker is selected for them.
 */
export function partsOf(duration: Duration): { value: NoteValue | null; modifier: DurationModifier } {
  for (const modifier of ['dotted', 'triplet'] as const) {
    const prefix = `${modifier}_`;
    if (duration.startsWith(prefix)) {
      const rest = duration.slice(prefix.length);
      return { value: isNoteValue(rest) ? rest : null, modifier };
    }
  }
  return { value: isNoteValue(duration) ? duration : null, modifier: 'plain' };
}

/**
 * Choosing a value keeps the note's dot or triplet where the new value can
 * carry it: a dotted quarter becomes a dotted eighth, and a dotted quarter
 * made whole becomes a plain whole, because the editor offers no dotted whole.
 */
export function withValue(current: Duration, value: NoteValue): Duration {
  const { modifier } = partsOf(current);
  return durationFor(value, modifier) ?? durationFor(value, 'plain') ?? current;
}

/** Whether the dot or the triplet can apply to the note as it is. */
export function canApply(current: Duration, modifier: 'dotted' | 'triplet'): boolean {
  const { value } = partsOf(current);
  return value !== null && durationFor(value, modifier) !== null;
}

/** The toggle pressed: on if it was off, off if it was on. Null where it cannot apply. */
export function toggled(current: Duration, modifier: 'dotted' | 'triplet'): Duration | null {
  const parts = partsOf(current);
  if (parts.value === null) {
    return null;
  }
  return durationFor(parts.value, parts.modifier === modifier ? 'plain' : modifier);
}
