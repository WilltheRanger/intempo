import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { describeOmissions, describeUndrawnScore, staveScoreFor } from './fromScore';

/**
 * Turning a read page into something the engraver can draw — and admitting
 * what it could not.
 *
 * `engrave.ts` draws four note values and no rests. The rule this module
 * exists to keep is that nothing is **rounded**: a sixteenth does not become
 * an eighth to make it drawable. Rhythm is the entire subject of this app, so
 * a stave that misreports it is the one picture it must never draw.
 *
 * The consequence is that an ordinary part — sixteenths, dotted eighths — can
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

describe('what survives the trip', () => {
  it('draws the four values it has glyphs for', () => {
    const stave = staveScoreFor(scoreOf('whole', 'half', 'quarter', 'eighth'));

    expect(stave.notes.map((n) => n.value)).toEqual(['whole', 'half', 'quarter', 'eighth']);
    expect(stave.undrawable).toBe(0);
  });

  it('leaves out what it cannot draw rather than rounding it', () => {
    // The rule the module exists for. A sixteenth drawn as an eighth is a
    // rhythmically wrong line of music presented as a right one.
    const stave = staveScoreFor(scoreOf('sixteenth', 'dotted_quarter', 'triplet_eighth'));

    expect(stave.notes).toHaveLength(0);
    expect(stave.undrawable).toBe(3);
  });

  it('counts rests without drawing them', () => {
    const stave = staveScoreFor(scoreOf('quarter', 'rest', 'rest'));

    expect(stave.notes).toHaveLength(1);
    expect(stave.rests).toBe(2);
  });

  it('never leaves a barline on the wrong note', () => {
    // A bar whose every note is undrawable must not hand its barline to the
    // next bar's opening note — the stave would show a barline in the middle
    // of a phrase.
    const score = scoreOf('quarter');
    score.measures.push(
      { measure_number: 2, notes: [{ pitch: 'E2', duration: 'sixteenth' }], slurs: [] } as never,
      { measure_number: 3, notes: [{ pitch: 'G2', duration: 'quarter' }], slurs: [] } as never,
    );

    const stave = staveScoreFor(score);

    expect(stave.notes).toHaveLength(2);
    expect(stave.notes[1].barBefore).toBe(true);
  });
});

describe('describeUndrawnScore', () => {
  it('says nothing when there is a stave to look at', () => {
    expect(describeUndrawnScore(staveScoreFor(scoreOf('quarter', 'sixteenth')))).toBeNull();
  });

  it('explains a page whose every note is undrawable', () => {
    // The screenshot this was found from: a bass part in sixteenths and dotted
    // eighths, rendering as a title and a photograph and nothing else.
    const said = describeUndrawnScore(staveScoreFor(scoreOf('sixteenth', 'dotted_eighth')));

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

  it('distinguishes a page of rests from a page of short notes', () => {
    const rests = describeUndrawnScore(staveScoreFor(scoreOf('rest', 'rest')));

    expect(rests).toMatch(/rests/i);
    expect(rests).not.toMatch(/note values/i);
  });
});

describe('describeOmissions', () => {
  it('says nothing when nothing was left out', () => {
    expect(describeOmissions(staveScoreFor(scoreOf('quarter')))).toBeNull();
  });

  it('names both kinds of omission, and gets the plurals right', () => {
    const said = describeOmissions(staveScoreFor(scoreOf('quarter', 'rest', 'sixteenth')));

    expect(said).toContain('1 rest');
    expect(said).toContain('1 note');
    expect(said).not.toContain('1 rests');
  });

  it('says the engraving is incomplete rather than approximate', () => {
    // The distinction the whole module turns on, said to the musician.
    expect(describeOmissions(staveScoreFor(scoreOf('sixteenth')))).toMatch(
      /incomplete rather than approximate/i,
    );
  });
});
