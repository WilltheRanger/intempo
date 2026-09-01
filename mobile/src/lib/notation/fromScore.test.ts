import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { isMultiRest, isNote, isRest, type StaveItem } from './engrave';
import {
  beamBeatQuarters,
  describeOmissions,
  describeUndrawnScore,
  staveScoreFor,
} from './fromScore';

/**
 * Turning a read page into something the engraver can draw — and admitting
 * what it could not.
 *
 * `engrave.ts` draws four note values, the four rests that match them, and a
 * multi-bar rest. The rule this module exists to keep is that nothing is
 * **rounded**: a triplet eighth does not become an eighth to make it drawable.
 * Rhythm is the entire subject of this app, so a stave that misreports it is
 * the one picture it must never draw.
 *
 * Rests were dropped outright until 2026-08-27 — counted, and drawn as
 * nothing. On the orchestral part fixture that deleted six bars of nineteen,
 * and the note before a silence sat against the note after it.
 *
 * The consequence is that a part using tuplets or values finer than a
 * sixteenth can
 * lose every note, and until now the screen rendered the title, the
 * photograph, and nothing else. No explanation, no action, no sign anything
 * had been read. It usually had been.
 */

function scoreOf(...durations: string[]): ScoreJson {
  return {
    clef: 'bass',
    time_signature: '4/4',
    key_signature: null,
    tempo_marking: null,
    bpm_hint: null,
    measures: [
      {
        measure_number: 1,
        notes: durations.map((duration) => ({
          pitch: duration === 'rest' ? 'rest' : 'E2',
          duration: duration === 'rest' ? 'quarter' : duration,
          tied_to_next: false,
        })),
        slurs: [],
      },
    ],
    repeats: [],
    ocr_confidence: 0.9,
    notes_to_human: '',
  } as unknown as ScoreJson;
}

/** A score of several bars, each given as a list of durations. */
function barsOf(...bars: string[][]): ScoreJson {
  return {
    ...scoreOf(),
    measures: bars.map((durations, index) => ({
      measure_number: index + 1,
      notes: durations.map((duration) => ({
        pitch: duration === 'rest' ? 'rest' : 'E2',
        duration: duration === 'rest' ? 'quarter' : duration.replace(/^r:/, ''),
        tied_to_next: false,
      })),
      slurs: [],
    })),
  } as unknown as ScoreJson;
}

/** A bar of `count` whole rests — what an expanded multi-bar rest looks like. */
const SILENT_BAR = ['rest'];

const valuesOf = (items: StaveItem[]) => items.filter(isNote).map((n) => n.value);

describe('what survives the trip', () => {
  it('draws the four values it has glyphs for', () => {
    const stave = staveScoreFor(scoreOf('whole', 'half', 'quarter', 'eighth'));

    expect(valuesOf(stave.items)).toEqual(['whole', 'half', 'quarter', 'eighth']);
    expect(stave.undrawable).toBe(0);
  });

  it('leaves out what it cannot draw rather than rounding it', () => {
    // The rule the module exists for: a note drawn as a longer one is a
    // rhythmically wrong line of music presented as a right one.
    //
    // **The examples keep changing with the engraver, and the rule does not.**
    // This has been a triplet eighth, then a thirty-second and a sixty-fourth,
    // and each of them draws now. What is left is the 128th family — four of
    // the schema's forty-six durations, left undrawn on purpose: five beams at
    // this stave size is a smudge rather than a rhythm, and counting a note as
    // missing is a better answer than an illegible mark presented as a reading.
    const stave = staveScoreFor(
      scoreOf('one_twenty_eighth', 'triplet_one_twenty_eighth'),
    );

    expect(stave.items).toHaveLength(0);
    expect(stave.undrawable).toBe(2);
  });

  it('draws rests, and does not count them as missing', () => {
    // **This asserted the opposite.** Rests were counted and drawn as nothing,
    // so a bar of silence was a gap between two notes with no sign it existed.
    const stave = staveScoreFor(scoreOf('quarter', 'rest', 'rest'));

    expect(stave.items.filter(isNote)).toHaveLength(1);
    expect(stave.items.filter(isRest).map((r) => r.rest)).toEqual(['quarter', 'quarter']);
    expect(stave.rests).toBe(0);
  });

  it('still refuses to round a rest it has no glyph for', () => {
    // The same rule as the notes, and it has to be the same rule: a rest drawn
    // at the wrong length is a bar that no longer adds up.
    //
    // **The examples here are expected to keep moving, and have four times.**
    // A sixteenth rest was one, until the rests moved onto Bravura. A dotted
    // rest was one, until the dot followed. A double-dotted half was one, until
    // `Stave` learned to draw the second dot. The *rule* is the invariant — a
    // rest is never drawn at a length the page does not print — and these are
    // only the shortest way to reach it today. If a future change makes both
    // of these drawable, replace them; do not weaken the assertion.
    const score = scoreOf('quarter');
    score.measures[0].notes.push(
      { pitch: 'rest', duration: 'one_twenty_eighth' } as never,
      { pitch: 'rest', duration: 'triplet_one_twenty_eighth' } as never,
    );

    const stave = staveScoreFor(score);

    expect(stave.items.filter(isRest)).toHaveLength(0);
    expect(stave.rests).toBe(2);
  });

  it('draws a sixteenth rest, which it used to drop', () => {
    // It was dropped on purpose: `Stave` drew four rest shapes by hand and an
    // unknown value fell through to the eighth-rest hook, so drawing it would
    // have printed silence twice as long as the page prints. The glyph table
    // is exhaustive now and there is no fall-through left.
    const score = scoreOf('quarter');
    score.measures[0].notes.push({ pitch: 'rest', duration: 'sixteenth' } as never);

    const stave = staveScoreFor(score);

    expect(stave.items.filter(isRest).map((r) => r.rest)).toEqual(['sixteenth']);
    expect(stave.rests).toBe(0);
  });

  it('never leaves a barline on the wrong note', () => {
    // A bar whose every note is undrawable must not hand its barline to the
    // next bar's opening note — the stave would show a barline in the middle
    // of a phrase.
    const score = scoreOf('quarter');
    score.measures.push(
      { measure_number: 2, notes: [{ pitch: 'E2', duration: 'one_twenty_eighth' }], slurs: [] } as never,
      { measure_number: 3, notes: [{ pitch: 'G2', duration: 'quarter' }], slurs: [] } as never,
    );

    const stave = staveScoreFor(score);

    expect(stave.items).toHaveLength(2);
    expect(stave.items[1].barBefore).toBe(true);
  });
});

describe('bars of silence', () => {
  it('folds a run of silent bars into one multi-bar rest', () => {
    // **What the backend took apart on purpose.** `<multiple-rest>4</...>` is
    // expanded into four bars of whole rest so the timeline waits four bars.
    // Four empty bars is not what the part prints and not what anybody counts.
    const stave = staveScoreFor(
      barsOf(['quarter'], SILENT_BAR, SILENT_BAR, SILENT_BAR, SILENT_BAR, ['quarter']),
    );

    const blocks = stave.items.filter(isMultiRest);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].bars).toBe(4);
    expect(blocks[0].barBefore).toBe(true);
    expect(stave.items.filter(isNote)).toHaveLength(2);
  });

  it('draws a single silent bar as a bar of rest, not a block of one', () => {
    // A block with "1" over it is not something an engraver writes.
    const stave = staveScoreFor(barsOf(['quarter'], SILENT_BAR, ['quarter']));

    expect(stave.items.filter(isMultiRest)).toHaveLength(0);
    expect(stave.items.filter(isRest)).toHaveLength(1);
  });

  it('starts a bar before the block and after it', () => {
    const stave = staveScoreFor(barsOf(['quarter'], SILENT_BAR, SILENT_BAR, ['quarter']));

    const [note, block, after] = stave.items;
    expect(isNote(note)).toBe(true);
    expect(isMultiRest(block)).toBe(true);
    expect(block.barBefore).toBe(true);
    expect(after.barBefore).toBe(true);
  });

  it('folds a run that opens the page without a barline before it', () => {
    const stave = staveScoreFor(barsOf(SILENT_BAR, SILENT_BAR, ['quarter']));

    expect(stave.items[0].barBefore).toBeFalsy();
    expect((stave.items[0] as { bars: number }).bars).toBe(2);
  });

  it('does not fold a bar that holds a note as well as rests', () => {
    // A bar of three rests and a quarter is music, and counting it as silence
    // would hide the note.
    const stave = staveScoreFor(
      barsOf(SILENT_BAR, ['rest', 'quarter'], SILENT_BAR),
    );

    expect(stave.items.filter(isMultiRest)).toHaveLength(0);
    expect(stave.items.filter(isNote)).toHaveLength(1);
  });
});

describe('describeUndrawnScore', () => {
  it('says nothing when there is a stave to look at', () => {
    expect(describeUndrawnScore(staveScoreFor(scoreOf('quarter', 'sixteenth')))).toBeNull();
  });

  it('explains a page whose every note is undrawable', () => {
    // The screenshot this was found from: a bass part in sixteenths and dotted
    // eighths, rendering as a title and a photograph and nothing else.
    const said = describeUndrawnScore(
      staveScoreFor(scoreOf('one_twenty_eighth', 'triplet_one_twenty_eighth')),
    );

    expect(said).toMatch(/can't draw yet/i);
    // It has to say the reading survived, or a musician reads a blank stave as
    // a failed scan and photographs the page again for nothing.
    expect(said).toMatch(/reading is stored/i);
    expect(said).toMatch(/photograph/i);
  });

  it('says something different when nothing was read at all', () => {
    // A page that yielded notes and a page that yielded none need different
    // things from the person: one is finished and usable, the other is not.
    const said = describeUndrawnScore(staveScoreFor(scoreOf()));

    expect(said).toMatch(/nothing was read/i);
    expect(said).not.toMatch(/reading is stored/i);
  });

  it('says nothing about a page that is only silence, because it draws it', () => {
    // **This asserted the opposite**, and had to: a page of rests produced no
    // stave at all, so it needed a sentence explaining the blank. It draws now.
    expect(describeUndrawnScore(staveScoreFor(scoreOf('rest', 'rest')))).toBeNull();
  });

  it('distinguishes undrawable rest values from undrawable note values', () => {
    // Thirty-seconds: sixteenth rests and dotted rests are both drawn now.
    const score = scoreOf();
    score.measures[0].notes.push(
      { pitch: 'rest', duration: 'one_twenty_eighth' } as never,
      { pitch: 'rest', duration: 'one_twenty_eighth' } as never,
    );

    const rests = describeUndrawnScore(staveScoreFor(score));

    expect(rests).toMatch(/rest values/i);
    expect(rests).not.toMatch(/note values/i);
  });
});

describe('describeOmissions', () => {
  it('says nothing when nothing was left out', () => {
    expect(describeOmissions(staveScoreFor(scoreOf('quarter')))).toBeNull();
  });

  it('names both kinds of omission, and gets the plurals right', () => {
    // A *drawable* rest is no longer an omission — that is the change. What is
    // still one is a rest whose value has no glyph, exactly as for a note.
    const score = scoreOf('quarter', 'one_twenty_eighth');
    score.measures[0].notes.push({ pitch: 'rest', duration: 'one_twenty_eighth' } as never);

    const said = describeOmissions(staveScoreFor(score));

    expect(said).toContain('1 rest ');
    expect(said).toContain('1 note ');
    expect(said).not.toContain('1 rests');
  });

  it('says nothing about rests it could draw', () => {
    expect(describeOmissions(staveScoreFor(scoreOf('quarter', 'rest')))).toBeNull();
  });

  it('says the engraving is incomplete rather than approximate', () => {
    // The distinction the whole module turns on, said to the musician.
    expect(describeOmissions(staveScoreFor(scoreOf('one_twenty_eighth')))).toMatch(
      /incomplete rather than approximate/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Pitches the engraver cannot place
// ---------------------------------------------------------------------------

describe('a pitch the engraver cannot place', () => {
  function scoreWith(pitches: string[]): ScoreJson {
    return {
      time_signature: '4/4',
      clef: 'treble',
      ocr_confidence: 1,
      measures: [
        {
          measure_number: 1,
          notes: pitches.map((pitch) => ({ pitch, duration: 'quarter' as const })),
        },
      ],
    } as unknown as ScoreJson;
  }

  it('is left out and counted, not drawn on the middle line', () => {
    // **What it used to do.** `engrave.ts` read `stepOf(note.pitch)` and fell
    // back to `y = 0` — the middle line — for anything it could not parse. So a
    // note at a pitch nobody could place was drawn among the ones that were
    // right, in the same ink, under whatever name it carried. That is the pitch
    // version of drawing a sixteenth as an eighth, and this module's own
    // docstring forbids it: drawing less and admitting it is honest, drawing
    // something else is not.
    const out = staveScoreFor(scoreWith(['C4', 'F###4', 'D4']));

    expect(out.noteCount).toBe(2);
    expect(out.undrawable).toBe(1);
    expect(out.items.every((item) => !('pitch' in item) || item.pitch !== 'F###4')).toBe(
      true,
    );
  });

  it('does not leave a double accidental out — those are placeable now', () => {
    // The server spells `F##` and `Bbb`, so the engraver must too, or the fix
    // above turns into a note quietly missing from the stave instead of a note
    // quietly in the wrong place.
    const out = staveScoreFor(scoreWith(['F##4', 'Bbb3', 'C4']));

    expect(out.noteCount).toBe(3);
    expect(out.undrawable).toBe(0);
  });
});

describe('beamBeatQuarters', () => {
  it('beams simple metres at their own denominator', () => {
    expect(beamBeatQuarters('4/4')).toBe(1);
    expect(beamBeatQuarters('3/4')).toBe(1);
    // Cut time counts in halves, so four eighths make one group.
    expect(beamBeatQuarters('2/2')).toBe(2);
  });

  it('beams compound metres in threes', () => {
    // 6/8 is two beats of three eighths, not six of one. Beaming its eighths
    // in pairs is the tell of notation drawn by something that has only ever
    // been shown 4/4.
    expect(beamBeatQuarters('6/8')).toBe(1.5);
    expect(beamBeatQuarters('9/8')).toBe(1.5);
    expect(beamBeatQuarters('12/8')).toBe(1.5);
    // 3/8 too, where the beat *is* the bar — which is what an engraver prints.
    expect(beamBeatQuarters('3/8')).toBe(1.5);
    expect(beamBeatQuarters('6/16')).toBe(0.75);
  });

  it('does not read a numerator divisible by three over a quarter as compound', () => {
    // 3/4 and 6/4 are simple. The denominator is half the test.
    expect(beamBeatQuarters('6/4')).toBe(1);
  });

  it('tolerates the spacing the backend tolerates', () => {
    // `beatsPerMeasure` learned this the hard way — a metre OCR read as
    // " 4 / 4 " switched the app's beat check off while the server went on
    // flagging the same bars. Same regex shape, same tolerance.
    expect(beamBeatQuarters(' 6 / 8 ')).toBe(1.5);
  });

  it('falls back to a quarter when nothing states a metre', () => {
    // A guess, and a safe one here in a way it is not in `problemMeasures`:
    // the cost is a beam grouped in the wrong place, not every waltz on the
    // page reported as wrong.
    expect(beamBeatQuarters(null)).toBe(1);
    expect(beamBeatQuarters('unknown')).toBe(1);
    expect(beamBeatQuarters('4/0')).toBe(1);
  });
});
