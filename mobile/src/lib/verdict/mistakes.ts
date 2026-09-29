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
 * The one grey line under the verdict, or null when nothing went wrong:
 * "1 note missed · 1 wrong note, bar 6 · 1 rest miscounted, bar 12".
 *
 * **One line, three counts** (the owner, 2026-09-29: the result screen was
 * "way too wordy and hard to read"). It replaces two full sentences under the
 * title and a "Missed" figure in a row of facts — which sat directly under
 * "1 note wasn't what's written" and, both reading "1 note", looked like the
 * same thing said twice. A missed note is one not heard at all; a wrong note
 * is one heard clearly as another; they are named differently here so they
 * cannot be mistaken for each other. What each was is in the bar's card.
 */
export function mistakesSummary(
  missedNotes: number,
  wrongNotes: readonly WrongNote[],
  restEntries: readonly RestEntry[],
): string | null {
  const parts: string[] = [];
  if (missedNotes > 0) {
    parts.push(missedNotes === 1 ? '1 note missed' : `${missedNotes} notes missed`);
  }
  if (wrongNotes.length > 0) {
    const noun = wrongNotes.length === 1 ? 'wrong note' : 'wrong notes';
    parts.push(`${wrongNotes.length} ${noun}, ${barList(wrongNotes.map((note) => note.bar))}`);
  }
  if (restEntries.length > 0) {
    const noun = restEntries.length === 1 ? 'rest miscounted' : 'rests miscounted';
    parts.push(
      `${restEntries.length} ${noun}, ${barList(restEntries.map((entry) => entry.restBar))}`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
