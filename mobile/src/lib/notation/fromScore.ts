import type { ScoreJson } from '../../data/types';
import type { NoteValue, StaveNote } from './engrave';

/**
 * A parsed score, turned into something the engraver can draw.
 *
 * **Nothing is rounded.** `engrave.ts` draws four note values — whole, half,
 * quarter, eighth — and no rests. A `score_json` from OCR can hold dotted
 * values, sixteenths, thirty-seconds and rests, and the tempting move is to
 * map each to the nearest drawable thing: a sixteenth becomes an eighth, a
 * dotted half becomes a half, a rest disappears.
 *
 * That would put a rhythmically wrong line of music in front of a musician and
 * say nothing about it — which is worse than drawing less. Rhythm is the entire
 * subject of this app; a stave that misreports it is the one picture it must
 * never draw.
 *
 * So anything undrawable is **left out and counted**, and the screen says what
 * it left out. Drawing less and admitting it is honest; drawing something else
 * is not.
 */
export interface StaveScore {
  notes: StaveNote[];
  /** Rests in the score. Not drawn — the engraver has no rest glyph. */
  rests: number;
  /** Notes whose value the engraver cannot draw: dots, sixteenths, shorter. */
  undrawable: number;
}

/**
 * The durations that survive the trip.
 *
 * Absent by design rather than oversight: `dotted_*` needs a dot, `sixteenth`
 * and below need a second beam or flag. Adding them means adding glyphs to
 * `engrave.ts`, not entries here.
 */
const DRAWABLE: Partial<Record<string, NoteValue>> = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
};

export function staveScoreFor(score: ScoreJson): StaveScore {
  const notes: StaveNote[] = [];
  let rests = 0;
  let undrawable = 0;

  for (const [index, measure] of score.measures.entries()) {
    // The barline belongs before the first note of every measure but the
    // first. Tracked here rather than counted later, because notes get
    // dropped below and a bar whose every note was undrawable must not leave
    // its barline attached to the next measure's opening note.
    let opensMeasure = index > 0;

    for (const note of measure.notes) {
      if (note.pitch === 'rest') {
        rests += 1;
        continue;
      }
      const value = DRAWABLE[note.duration];
      if (!value) {
        undrawable += 1;
        continue;
      }
      notes.push(
        opensMeasure ? { pitch: note.pitch, value, barBefore: true } : { pitch: note.pitch, value },
      );
      opensMeasure = false;
    }
  }

  return { notes, rests, undrawable };
}

/**
 * What was left out, in one sentence, or null when nothing was.
 *
 * Plural-aware and specific about which of the two limitations bit, because
 * "some notes aren't shown" tells a musician looking at a stave with a hole in
 * it nothing they can act on.
 */
/**
 * What to say when the stave came out **empty**.
 *
 * `describeOmissions` is written for a stave with a hole in it. This is the
 * case where there is no stave at all, and it is not rare: `DRAWABLE` holds
 * four note values, so an ordinary part written in sixteenths and dotted
 * eighths loses every note, and the screen had nothing left to render.
 *
 * What a musician saw was the title, the photograph, and nothing else — no
 * explanation, no action, no sign that anything had been read. The reading was
 * usually fine. The app simply could not draw it and did not say so.
 *
 * Two different sentences, because they need different things from the person:
 * a page that was read and cannot be drawn is finished and usable, and a page
 * that yielded nothing is not.
 */
export function describeUndrawnScore({
  notes,
  rests,
  undrawable,
}: StaveScore): string | null {
  if (notes.length > 0) {
    return null;
  }
  if (rests + undrawable === 0) {
    return "Nothing was read from this page. The photograph is below — try reading it again, or photograph the page closer and straighter.";
  }
  const values = undrawable > 0 ? 'note values' : 'rests';
  return `This page is written in ${values} the app can't draw yet, so there is no stave to show. The reading is stored and recording will use it — the photograph is below.`;
}

export function describeOmissions({ rests, undrawable }: StaveScore): string | null {
  const parts: string[] = [];
  if (rests > 0) {
    parts.push(`${rests} ${rests === 1 ? 'rest' : 'rests'}`);
  }
  if (undrawable > 0) {
    parts.push(
      `${undrawable} ${undrawable === 1 ? 'note' : 'notes'} shorter than an eighth or dotted`,
    );
  }
  if (parts.length === 0) {
    return null;
  }
  return `Not drawn: ${parts.join(' and ')}. The engraving is incomplete rather than approximate — playback uses the full score.`;
}
