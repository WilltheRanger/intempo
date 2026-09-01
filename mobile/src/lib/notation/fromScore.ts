import type { ScoreJson, ScoreMeasure } from '../../data/types';
import { isNote, stepOf } from './engrave';
import { BEATS } from '../score/schedule';
import type { Duration } from '../../data/types';
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
  /**
   * The score's final barline closes a repeated section.
   *
   * Every other repeat sign rides on the item after it; a repeat ending on the
   * last measure has no such item, so this is the one the engraver has to be
   * told.
   */
  closesWithRepeat: boolean;
  /** First- and second-time ending brackets, by measure number. */
  endings: { label: string; from: number; to: number; closed: boolean }[];
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
 * Dots arrived with the glyphs: an augmentation dot on a rest is the same
 * mark in the same place as one on a note, and a dotted quarter rest was the
 * last thing in the corpus this could not draw.
 */
const DRAWABLE_RESTS: Partial<Record<string, { value: NoteValue; dots: number }>> = {
  whole: { value: 'whole', dots: 0 },
  half: { value: 'half', dots: 0 },
  quarter: { value: 'quarter', dots: 0 },
  eighth: { value: 'eighth', dots: 0 },
  sixteenth: { value: 'sixteenth', dots: 0 },
  // Dots, which this had never carried. A dotted quarter rest was the last
  // thing in the corpus with no glyph — and only because nothing had put the
  // dot after a rest. The mark, and the rule for lifting it off a staff line,
  // were already there for the notes.
  dotted_half: { value: 'half', dots: 1 },
  dotted_quarter: { value: 'quarter', dots: 1 },
  dotted_eighth: { value: 'eighth', dots: 1 },
};

/**
 * Tuplets: a base value, and the number over the bracket.
 *
 * **This used to refuse them, and the refusal was right at the time.** A
 * `triplet_eighth` is written as an ordinary eighth under a bracket marked 3.
 * Drawing the notehead alone puts three eighths where the page has three
 * triplet-eighths — a bar half again as long as it is, in the same ink as the
 * notes around it that are right, which is the one thing this module exists to
 * refuse. So they were dropped, and the screen said how many.
 *
 * `engrave.ts` draws brackets now, so the notehead is no longer alone. Two
 * things travel with it and both are load-bearing: the **count**, which is
 * what the bracket says, and the note's **true duration in quarters**, because
 * beam grouping counts in real time and a triplet eighth is a third of a beat
 * rather than half of one.
 *
 * Only the families the vocabulary has — three, five and seven. A tuplet
 * written any other way is still dropped and still counted, because a bracket
 * marked with the wrong number is worse than no bracket.
 */
const TUPLET_FAMILIES: { prefix: string; count: number }[] = [
  { prefix: 'triplet_', count: 3 },
  { prefix: 'quintuplet_', count: 5 },
  { prefix: 'septuplet_', count: 7 },
];

/** The base value a tuplet duration is *written* as, and its group size. */
function tupletOf(duration: string): { base: string; count: number } | null {
  for (const family of TUPLET_FAMILIES) {
    if (duration.startsWith(family.prefix)) {
      return { base: duration.slice(family.prefix.length), count: family.count };
    }
  }
  return null;
}

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
  /** Global, so two slurs in neighbouring bars never merge into one arc. */
  let slurId = 0;

  /**
   * Where the repeat signs go, by measure number.
   *
   * A span `[s, e]` puts an opening sign on the barline **before** measure `s`
   * and a closing one on the barline before measure `e + 1` — which is the
   * barline *after* `e`, and the same line either way. When `e` is the last
   * measure there is no `e + 1`, so the score's final barline carries it and
   * `closesWithRepeat` says so; the engraver has no item there to read a flag
   * from.
   *
   * A repeat starting on the first measure gets no opening sign. There is no
   * barline before it to hang one on, and a printed part does not draw one
   * there either — the section is understood to start at the beginning.
   */
  /**
   * First- and second-time endings, as brackets over measure ranges.
   *
   * Closed at the right for a first ending — the repeat sends you back from
   * there — and open for the last one, because you carry on. That is the whole
   * reading of the bracket.
   *
   * The label is the ordinal with a full stop, which is what a printed part
   * uses. A third ending would be `3.`; the pipeline only reports two, so
   * anything else is named by its index rather than guessed at.
   */
  const endings: { label: string; from: number; to: number; closed: boolean }[] = [];

  const opensRepeat = new Set<number>();
  const closesRepeat = new Set<number>();
  let closesWithRepeat = false;
  {
    const numbers = score.measures.map((m) => m.measure_number);
    const last = numbers[numbers.length - 1];
    const first = numbers[0];
    for (const repeat of score.repeats ?? []) {
      if (repeat.type === 'first_ending' || repeat.type === 'second_ending') {
        endings.push({
          label: repeat.type === 'first_ending' ? '1.' : '2.',
          from: repeat.start_measure,
          to: repeat.end_measure,
          closed: repeat.type === 'first_ending',
        });
        continue;
      }
      if (repeat.type !== 'repeat') {
        continue;
      }
      if (repeat.start_measure !== first) {
        opensRepeat.add(repeat.start_measure);
      }
      if (repeat.end_measure === last) {
        closesWithRepeat = true;
      } else {
        closesRepeat.add(repeat.end_measure + 1);
      }
    }
  }

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

    /**
     * How far through the current tuplet group we are.
     *
     * A group's first item carries the bracket's start, so the run has to be
     * counted — and reset whenever it is interrupted, which is what makes a
     * bar of six triplet eighths two triplets rather than one bracket of six.
     */
    let inTuplet: { count: number; taken: number } | null = null;

    /**
     * Where each of this measure's notes ended up in `items`, by its index in
     * `measure.notes`.
     *
     * **Slurs address notes by index and items are not notes.** A rest is an
     * item, a note this engraver cannot place is no item at all, and a repeat
     * or a long-rest block inserts items of its own — so `start_note_index: 2`
     * is almost never item 2. Mapping it after the fact is how a slur ends up
     * over the wrong notes, which is worse than no slur: it is a bowing
     * instruction for a passage that is not there.
     */
    const itemOfNote = new Map<number, number>();
    let noteIndexInMeasure = -1;

    for (const note of measure.notes) {
      noteIndexInMeasure += 1;
      const tuplet = tupletOf(note.duration);
      const written = tuplet ? tuplet.base : note.duration;
      const drawn =
        note.pitch === 'rest' ? DRAWABLE_RESTS[written] : DRAWABLE[written];
      const value = drawn?.value;

      // A group ends when the family changes, and a full one ends by being
      // full. Both have to close it, or six triplet eighths become one
      // bracket marked 3 spanning all six.
      if (!tuplet || (inTuplet && inTuplet.count !== tuplet.count)) {
        inTuplet = null;
      }
      let mark: { count: number; starts: boolean } | undefined;
      if (tuplet) {
        if (!inTuplet || inTuplet.taken >= inTuplet.count) {
          inTuplet = { count: tuplet.count, taken: 0 };
          mark = { count: tuplet.count, starts: true };
        } else {
          mark = { count: tuplet.count, starts: false };
        }
        inTuplet.taken += 1;
      }
      // Its real length, which is not what its notehead says. Beam grouping
      // counts in time, and a triplet eighth is a third of a beat.
      const quarters = tuplet ? BEATS[note.duration as Duration] : undefined;
      if (note.pitch === 'rest') {
        if (!value) {
          rests += 1;
          continue;
        }
        items.push({
          rest: value,
          dots: drawn!.dots,
          measureNumber: measure.measure_number,
          ...(mark ? { tuplet: mark } : {}),
          ...(quarters !== undefined ? { quarters } : {}),
          ...(opensMeasure ? { barBefore: true } : {}),
          // A bar can open on a rest, and its repeat sign has to ride with
          // whichever item takes the barline — not only with a note.
          ...(opensMeasure && opensRepeat.has(measure.measure_number)
            ? { repeatStartsBefore: true }
            : {}),
          ...(opensMeasure && closesRepeat.has(measure.measure_number)
            ? { repeatEndsBefore: true }
            : {}),
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
      // **The other notes of a chord**, which the app has been dropping since
      // the backend started reading them. A double stop is not decoration on a
      // string part — the demo fixture is Bach's G minor Sonata, whose first
      // bar is a four-note chord — and drawing one notehead where the page has
      // four is drawing something else, which is the thing this module refuses
      // to do everywhere else.
      //
      // Filtered by the same rule as the principal: a pitch this engraver
      // cannot place is left out rather than put somewhere it does not belong.
      // The count follows, so the caveat line still adds up.
      const chord = (note.chord_pitches ?? []).filter((pitch) => {
        if (stepOf(pitch) !== null) {
          return true;
        }
        undrawable += 1;
        return false;
      });

      itemOfNote.set(noteIndexInMeasure, items.length);
      items.push({
        pitch: note.pitch,
        value,
        dots: drawn!.dots,
        measureNumber: measure.measure_number,
        ...(chord.length > 0 ? { chord } : {}),
        ...(note.articulation ? { articulation: note.articulation } : {}),
        ...(mark ? { tuplet: mark } : {}),
        ...(quarters !== undefined ? { quarters } : {}),
        ...(opensMeasure ? { barBefore: true } : {}),
        ...(opensMeasure && opensRepeat.has(measure.measure_number)
          ? { repeatStartsBefore: true }
          : {}),
        ...(opensMeasure && closesRepeat.has(measure.measure_number)
          ? { repeatEndsBefore: true }
          : {}),
      });
      noteCount += 1;
      opensMeasure = false;
    }

    /**
     * The measure's slurs, as ids on the items they cover.
     *
     * **An endpoint that fell on a rest or on a note this engraver dropped
     * moves inward** to the nearest note that was actually drawn, rather than
     * being discarded or left dangling: a slur over four notes with one
     * unreadable in the middle is still a slur over the other three, and that
     * is the bowing.
     *
     * A slur that ends up covering one note is dropped. A slur has to join two
     * notes to mean anything; a one-note arc is a smudge over a notehead.
     *
     * The counter is global rather than per measure on purpose. Two slurs in
     * neighbouring bars that shared an id would be drawn as **one** arc across
     * the barline — a single long bow where the page asks for two.
     */
    for (const slur of measure.slurs ?? []) {
      let from: number | undefined;
      for (let n = slur.start_note_index; n <= slur.end_note_index; n += 1) {
        const at = itemOfNote.get(n);
        if (at !== undefined) {
          from = at;
          break;
        }
      }
      let to: number | undefined;
      for (let n = slur.end_note_index; n >= slur.start_note_index; n -= 1) {
        const at = itemOfNote.get(n);
        if (at !== undefined) {
          to = at;
          break;
        }
      }
      if (from === undefined || to === undefined || from >= to) {
        continue;
      }
      slurId += 1;
      for (let at = from; at <= to; at += 1) {
        const item = items[at];
        if (isNote(item)) {
          item.slur = slurId;
        }
      }
    }

    index += 1;
  }

  return {
    items,
    noteCount,
    rests,
    undrawable,
    beatQuarters: beamBeatQuarters(score.time_signature),
    closesWithRepeat,
    endings,
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
