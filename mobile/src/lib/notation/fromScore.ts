import type { ScoreJson, ScoreMeasure } from '../../data/types';
import { stepOf } from './engrave';
import type { NoteValue, StaveItem } from './engrave';

/**
 * A parsed score, turned into something the engraver can draw.
 *
 * **Nothing is rounded.** `engrave.ts` draws whole through sixteenth, with
 * dots, and four rest values. A `score_json` from OCR can hold thirty-seconds,
 * tuplets and doubly-dotted values besides, and the tempting move is to map
 * each to the nearest drawable thing: a thirty-second becomes a sixteenth, a
 * triplet eighth becomes a plain one.
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
  /** Notes, rests and multi-bar rests, in the order they are read. */
  items: StaveItem[];
  /** How many of `items` are noteheads — what "there is a stave" means. */
  noteCount: number;
  /**
   * Rests whose *value* the engraver cannot draw: dotted, sixteenth, shorter.
   *
   * Was every rest, because none were drawn at all. Now it is the same
   * exception the notes have, for the same reason and counted the same way.
   */
  rests: number;
  /** Notes whose value the engraver cannot draw: dots, sixteenths, shorter. */
  undrawable: number;
  /** The beat this score's beams break at, in quarter notes. */
  beatQuarters: number;
}

/**
 * The beat a beam may not cross, in quarter notes, read off the time signature.
 *
 * **Compound metres count in threes.** 6/8 has two beats of three eighths, not
 * six of one, and beaming its eighths in pairs is the mark of software that has
 * only ever been shown 4/4. The test is the numerator, not the name: a
 * numerator divisible by three over an eighth or sixteenth is compound, which
 * covers 6/8, 9/8, 12/8 and 3/16, and 3/8 too — where the whole bar is one
 * group, which is what an engraver prints.
 *
 * Everything else beams at the denominator's own value: quarters in 4/4 and
 * 3/4, halves in cut time.
 *
 * An unreadable or absent time signature gives a quarter. That is a guess, and
 * it is a safe one to make here in a way it is not in `problemMeasures` —
 * assuming 4/4 there would report every waltz on the page as wrong, whereas
 * here the cost is a beam grouped in the wrong place on a page whose metre
 * nothing knows.
 */
export function beamBeatQuarters(timeSignature: string | null): number {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec((timeSignature ?? '').trim());
  if (!match) {
    return 1;
  }
  const beats = Number(match[1]);
  const unit = Number(match[2]);
  if (!Number.isFinite(beats) || !Number.isFinite(unit) || beats <= 0 || unit <= 0) {
    return 1;
  }
  const oneUnit = 4 / unit;
  const compound = beats % 3 === 0 && (unit === 8 || unit === 16);
  return compound ? oneUnit * 3 : oneUnit;
}

/**
 * The durations that survive the trip.
 *
 * Absent by design rather than oversight: `dotted_*` needs a dot, `sixteenth`
 * and below need a second beam or flag. Adding them means adding glyphs to
 * `engrave.ts`, not entries here.
 */
const DRAWABLE: Partial<Record<string, { value: NoteValue; dots: number }>> = {
  whole: { value: 'whole', dots: 0 },
  half: { value: 'half', dots: 0 },
  quarter: { value: 'quarter', dots: 0 },
  eighth: { value: 'eighth', dots: 0 },
  // **The commonest thing this could not draw.** `tools/engraver-coverage.py`
  // across the corpus: 30 of the 53 notes with no glyph were sixteenths, and
  // the worst page drew 40% of its notes. Three notes in five missing is not a
  // stave of that music.
  sixteenth: { value: 'sixteenth', dots: 0 },
  // A dot is the same notehead with one more mark, so these are not new values
  // — see `NoteValue`. Leaving a dot off draws a dotted quarter as a quarter,
  // which is a shorter note presented as though the page said so.
  dotted_half: { value: 'half', dots: 1 },
  dotted_quarter: { value: 'quarter', dots: 1 },
  dotted_eighth: { value: 'eighth', dots: 1 },
};

/**
 * What a *rest* can be drawn as.
 *
 * **It used to be narrower than the notes, and the reason has gone.** `Stave`
 * drew four rest shapes by hand and a value it did not know fell through to
 * the eighth-rest hook — so a sixteenth rest would have come out as an eighth:
 * silence twice as long as the page prints, in the same ink as the rests
 * around it that are right. Keeping this table short was how that was stopped.
 *
 * The rests are Bravura glyphs now, in a table typed over the whole of
 * `NoteValue`, so there is no fall-through left to be wrong about — and a
 * sixteenth rest is a real thing on a real page that this was quietly
 * dropping.
 *
 * Dots are still absent: nothing draws one on a rest.
 */
const DRAWABLE_RESTS: Partial<Record<string, { value: NoteValue; dots: number }>> = {
  whole: { value: 'whole', dots: 0 },
  half: { value: 'half', dots: 0 },
  quarter: { value: 'quarter', dots: 0 },
  eighth: { value: 'eighth', dots: 0 },
  sixteenth: { value: 'sixteenth', dots: 0 },
};

/**
 * **Tuplets are still left out, and that is a decision rather than a gap.**
 *
 * A `triplet_eighth` is written as an ordinary eighth under a bracket marked 3,
 * and this engraver draws no brackets. Drawing the notehead alone would put
 * three eighths where the page has three triplet-eighths — a bar that reads as
 * half again as long as it is, in the same ink as the notes around it that are
 * right. That is the one thing `fromScore` exists to refuse.
 *
 * 12 of the corpus's remaining undrawn notes are tuplets. They stay counted in
 * `undrawable`, and the screen says so.
 */

/** A bar holding notes, none of which is one. */
function isSilent(measure: ScoreMeasure): boolean {
  return (
    measure.notes.length > 0 && measure.notes.every((note) => note.pitch === 'rest')
  );
}

/**
 * Runs of consecutive silent bars, folded back into one symbol each.
 *
 * **Because the backend took the printed form apart on purpose.**
 * `<multiple-rest>20</multiple-rest>` is expanded into twenty bars of whole
 * rest, and that expansion is load-bearing — without it the timeline runs
 * twenty bars early and a musician who counts correctly is told they rushed
 * the rest of the page. What it costs is the *picture*: twenty empty bars is
 * not what the part prints and not what anybody counts on a phone.
 *
 * Detected here rather than recorded on the schema, because a run of silent
 * bars is a run of silent bars however it got that way — a part that really
 * does print twenty separate bars of rest is counted the same, which is what
 * its player does too.
 *
 * Two bars is the floor. A single bar of rest is drawn as a bar of rest; a
 * block with "1" over it is not something an engraver writes.
 */
const MULTI_REST_MIN_BARS = 2;

export function staveScoreFor(score: ScoreJson): StaveScore {
  const items: StaveItem[] = [];
  let noteCount = 0;
  let rests = 0;
  let undrawable = 0;

  let index = 0;
  while (index < score.measures.length) {
    if (isSilent(score.measures[index])) {
      let end = index;
      while (end < score.measures.length && isSilent(score.measures[end])) {
        end += 1;
      }
      const bars = end - index;
      if (bars >= MULTI_REST_MIN_BARS) {
        items.push({
          bars,
          barBefore: index > 0,
          measureNumber: score.measures[index].measure_number,
        });
        index = end;
        continue;
      }
    }

    const measure = score.measures[index];
    // The barline belongs before the first item of every measure but the
    // first. Tracked here rather than counted later, because items get
    // dropped below and a bar whose every note was undrawable must not leave
    // its barline attached to the next measure's opening note.
    let opensMeasure = index > 0;

    for (const note of measure.notes) {
      const drawn =
        note.pitch === 'rest'
          ? DRAWABLE_RESTS[note.duration]
          : DRAWABLE[note.duration];
      const value = drawn?.value;
      if (note.pitch === 'rest') {
        if (!value) {
          rests += 1;
          continue;
        }
        items.push({
          rest: value,
          measureNumber: measure.measure_number,
          ...(opensMeasure ? { barBefore: true } : {}),
        });
        opensMeasure = false;
        continue;
      }
      // **A pitch this engraver cannot place is left out and counted**, the
      // same treatment as a duration it cannot draw and for the same reason.
      // It used to go through, and `engrave.ts` put it on the **middle line**
      // under whatever name it carried — a note at a pitch it never had,
      // presented exactly like the ones around it that were right. That is the
      // pitch version of drawing a sixteenth as an eighth, and this module's
      // whole premise is that drawing less beats drawing something else.
      //
      // Nothing reaches this today that should not: the server's grammar and
      // `stepOf` now agree, doubles included. It is the guard for the next
      // spelling neither of them has heard of — a triple accidental, a
      // quarter-tone — which is precisely how the last one arrived.
      if (!value || stepOf(note.pitch) === null) {
        undrawable += 1;
        continue;
      }
      items.push({
        pitch: note.pitch,
        value,
        dots: drawn!.dots,
        measureNumber: measure.measure_number,
        ...(opensMeasure ? { barBefore: true } : {}),
      });
      noteCount += 1;
      opensMeasure = false;
    }
    index += 1;
  }

  return {
    items,
    noteCount,
    rests,
    undrawable,
    beatQuarters: beamBeatQuarters(score.time_signature),
  };
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
  items,
  rests,
  undrawable,
}: StaveScore): string | null {
  // **`items`, not the notes.** A page that is nothing but a twenty-bar rest
  // has something to show now, and telling its owner there is no stave while
  // drawing one underneath would be the caveat contradicting the picture.
  if (items.length > 0) {
    return null;
  }
  if (rests + undrawable === 0) {
    return "Nothing was read from this page. The photograph is below — try reading it again, or photograph the page closer and straighter.";
  }
  const values = undrawable > 0 ? 'note values' : 'rest values';
  return `This page is written in ${values} the app can't draw yet, so there is no stave to show. The reading is stored and recording will use it — the photograph is below.`;
}

export function describeOmissions({ rests, undrawable }: StaveScore): string | null {
  const short = 'shorter than an eighth or dotted';
  const parts: string[] = [];
  if (undrawable > 0) {
    parts.push(`${undrawable} ${undrawable === 1 ? 'note' : 'notes'} ${short}`);
  }
  // **Only the rests whose value cannot be drawn.** This used to name every
  // rest on the page, because none of them were drawn — so a bass part
  // reported "Not drawn: 8 rests" while eight bars of silence were missing
  // from the stave. They are drawn now, and what is left is the same
  // exception the notes have.
  if (rests > 0) {
    parts.push(`${rests} ${rests === 1 ? 'rest' : 'rests'} ${short}`);
  }
  if (parts.length === 0) {
    return null;
  }
  return `Not drawn: ${parts.join(' and ')}. The engraving is incomplete rather than approximate — playback uses the full score.`;
}
