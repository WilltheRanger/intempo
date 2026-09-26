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

/** "bar 5", "bars 5 and 7", "bars 2, 3, 4 and 6". */
function barList(bars: number[]): string {
  const unique = [...new Set(bars)].sort((a, b) => a - b);
  if (unique.length === 1) return `bar ${unique[0]}`;
  const head = unique.slice(0, -1).join(', ');
  return `bars ${head} and ${unique[unique.length - 1]}`;
}

/**
 * The line under the verdict for wrong notes, or null for none:
 * "1 note wasn’t what’s written: bar 5." /
 * "2 notes weren’t what’s written: bars 5 and 7."
 */
export function wrongNotesLine(notes: readonly WrongNote[]): string | null {
  if (notes.length === 0) return null;
  const where = barList(notes.map((note) => note.bar));
  return notes.length === 1
    ? `1 note wasn’t what’s written: ${where}.`
    : `${notes.length} notes weren’t what’s written: ${where}.`;
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
 * The line under the verdict for rests counted wrong, or null for none. One
 * rest is said in full — "You came in a bar early after the rest at bar 5." —
 * two are joined, and more are listed by bar.
 */
export function restEntriesLine(entries: readonly RestEntry[]): string | null {
  if (entries.length === 0) return null;
  const said = (entry: RestEntry) =>
    `${describeOffset(entry.beats, entry.barBeats)} after the rest at bar ${entry.restBar}`;
  if (entries.length === 1) return `You came in ${said(entries[0])}.`;
  if (entries.length === 2) return `You came in ${said(entries[0])}, and ${said(entries[1])}.`;
  return `You miscounted ${entries.length} rests: ${barList(entries.map((entry) => entry.restBar))}.`;
}
