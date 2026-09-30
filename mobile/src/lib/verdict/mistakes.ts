import type { RestEntry, WrongNote } from '../../data/types';

/**
 * Two mistakes the timing verdict cannot see, in words (the owner,
 * 2026-09-26): notes heard clearly as another note, and a rest counted wrong.
 * What was found, and why it can be trusted, is `backend/app/services/
 * player_mistakes.py`; this is only how the verdict says it.
 *
 * A rules module per `CLAUDE.md` §3: the screen calls these and holds no
 * wording of its own.
 */

/** "F#" → "F♯", "Bb" → "B♭": the way a page prints them. */
export function displayPitch(name: string): string {
  return name.replace(/#/g, '♯').replace(/(?<=[A-G])b/g, '♭');
}

/** The bar card's own words for each wrong note in it: "We heard F where the page has F♯." */
export function wrongNotesInBar(notes: readonly WrongNote[], bar: number): string[] {
  return notes
    .filter((note) => note.bar === bar)
    .map(
      (note) =>
        `We heard ${displayPitch(note.heard)} where the page has ${displayPitch(note.written)}.`,
    );
}

/**
 * How far off an entrance was: "a bar early", "2 bars late", "a beat late",
 * "a beat and a half early", "3 beats late". A whole number of bars is said
 * as bars — a musician counts a rest in bars.
 */
export function describeOffset(beats: number, barBeats: number | null): string {
  const size = Math.abs(beats);
  const way = beats < 0 ? 'early' : 'late';
  if (barBeats && barBeats > 0 && size >= barBeats - 0.25) {
    const bars = size / barBeats;
    if (Math.abs(bars - Math.round(bars)) * barBeats <= 0.25) {
      const whole = Math.round(bars);
      return `${whole === 1 ? 'a bar' : `${whole} bars`} ${way}`;
    }
  }
  const halves = Math.round(size * 2) / 2;
  const whole = Math.floor(halves);
  const half = halves - whole >= 0.5;
  if (whole === 0) return `half a beat ${way}`;
  if (whole === 1) return `${half ? 'a beat and a half' : 'a beat'} ${way}`;
  return `${half ? `${whole}½` : whole} beats ${way}`;
}

/**
 * The bar card's words for a rest counted wrong, in the bar the entrance is
 * in: "You came in a bar early after the rest." Said where it happened rather
 * than as a sentence under the verdict (2026-09-29): the verdict's own line is
 * one short list, and the detail belongs to the bar.
 */
export function restEntriesInBar(entries: readonly RestEntry[], bar: number): string[] {
  return entries
    .filter((entry) => entry.bar === bar)
    .map((entry) => `You came in ${describeOffset(entry.beats, entry.barBeats)} after the rest.`);
}

/**
 * The bars the chart puts a dot under: those with a note heard as another,
 * and those an entrance after a miscounted rest landed in — the bar whose card
 * then says what it was (`wrongNotesInBar`, `restEntriesInBar`).
 *
 * **A dot, not a line of words** (the owner, 2026-09-29, circling "1 note
 * missed · 1 wrong note, bar 6" under the title as more to read before the
 * picture). The chart is already where a musician looks for a bar.
 */
export function mistakeBars(
  wrongNotes: readonly WrongNote[],
  restEntries: readonly RestEntry[],
): ReadonlySet<number> {
  return new Set([...wrongNotes.map((note) => note.bar), ...restEntries.map((entry) => entry.bar)]);
}
