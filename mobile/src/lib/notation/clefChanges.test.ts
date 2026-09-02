import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { engrave, type StaveItem } from './engrave';
import { staveScoreFor } from './fromScore';

/**
 * A clef printed mid-piece moves every notehead after it.
 *
 * **The half that was missing.** `Measure.clef` has been in the schema and
 * stamped by `musicxml.py` for a while — its own comment says the cost of
 * ignoring it is "notes on the wrong staff position, captioned with a clef the
 * page stopped using" — and nothing in the app read it. A cello or bass part
 * moving into tenor for a high passage was drawn wholly against the opening
 * bass clef: every note of that passage a sixth off, drawn as confidently as
 * the ones that were right.
 *
 * The engraver's own convention for where a clef sits is `CLEF_LINE`; these
 * assertions go through pitch placement instead, because that is the thing a
 * reader is harmed by.
 */
const opts = { lineGap: 10, noteGap: 30, leftPad: 20, rightPad: 10 };

const at = (pitch: string, extra: Partial<StaveItem> = {}): StaveItem => ({
  pitch,
  value: 'quarter',
  ...extra,
});

describe('a clef printed mid-piece', () => {
  it('places the same pitch differently once the clef changes', () => {
    /*
      Measured against the **middle staff line of the same system**, never as a
      raw `y`. The engraver shifts each drawing by its own ink extent, so two
      separate engravings put the same note at different absolute heights while
      agreeing perfectly about where it sits on the staff — which is the only
      thing a reader sees.
    */
    const onStaff = (system: { notes: { y: number }[]; staffLines: number[] }, i = 0) =>
      system.notes[i].y - system.staffLines[2];

    const bass = engrave([at('G3')], 'bass', opts).systems[0];
    const tenor = engrave([at('G3')], 'tenor', opts).systems[0];
    const changed = engrave(
      [at('G3'), at('G3', { barBefore: true, clefChange: 'tenor' })],
      'bass',
      opts,
    ).systems[0];

    // The middle line is D3 in bass and A3 in tenor, so the same G3 sits three
    // steps above the middle line in bass and one below it in tenor.
    expect(onStaff(bass)).toBe(-15);
    expect(onStaff(tenor)).toBe(5);

    expect(onStaff(changed, 0)).toBe(onStaff(bass));
    expect(onStaff(changed, 1)).toBe(onStaff(tenor));
    // y grows downward, so the note moves down the staff.
    expect(onStaff(changed, 1)).toBeGreaterThan(onStaff(changed, 0));
  });

  it('governs the note it is printed on, not only the ones after it', () => {
    const changed = engrave(
      [at('G3'), at('G3', { barBefore: true, clefChange: 'tenor' }), at('G3')],
      'bass',
      opts,
    ).systems[0];

    // The bar carrying the change and the one after it agree.
    expect(changed.notes[1].y).toBe(changed.notes[2].y);
  });

  it('draws the new clef once, before the note it governs', () => {
    const [system] = engrave(
      [at('G3'), at('G3', { barBefore: true, clefChange: 'tenor' })],
      'bass',
      opts,
    ).systems;

    expect(system.clefChanges).toHaveLength(1);
    expect(system.clefChanges[0].clef).toBe('tenor');
    expect(system.clefChanges[0].x).toBeLessThan(system.notes[1].x);
    // And after the barline it follows, so the line is not drawn through it.
    expect(system.clefChanges[0].x).toBeGreaterThan(system.barlines[0].x);
  });

  it('opens a later system in the clef in force, and does not repeat the change', () => {
    // Narrow enough to put one bar on each line.
    const laid = engrave(
      [
        at('G3'),
        at('G3', { barBefore: true, clefChange: 'tenor' }),
        at('G3', { barBefore: true }),
      ],
      'bass',
      { ...opts, maxWidth: 150, head: { clef: 'bass', key: [], time: null } },
    );

    expect(laid.systems.length).toBeGreaterThan(1);
    expect(laid.systems[0].head.clef?.clef).toBe('bass');
    const later = laid.systems.slice(1);
    for (const system of later) {
      expect(system.head.clef?.clef).toBe('tenor');
    }
    // The head announces it; it is not also drawn again after the barline.
    expect(later.flatMap((system) => system.clefChanges)).toEqual([]);
  });

  it('draws no clef at all when nothing read one', () => {
    // `head.clef` null means no clef was read - see `ScoreJson.clef`. A change
    // must not conjure one, or an unread page gains a caption it never earned.
    const [system] = engrave([at('G3'), at('G3', { clefChange: 'tenor' })], 'bass', {
      ...opts,
      head: { clef: null, key: [], time: null },
    }).systems;
    expect(system.head.clef).toBeNull();
  });
});

describe('staveScoreFor and the clef in force', () => {
  const score = (measures: ScoreJson['measures']): ScoreJson => ({
    time_signature: '4/4',
    key_signature: 'C major',
    tempo_marking: null,
    bpm_hint: 80,
    clef: 'bass',
    measures,
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
  });

  const note = (pitch: string) => ({ pitch, duration: 'whole' as const, tied_to_next: false });

  it('carries a measure-level clef onto the item that opens the bar', () => {
    const stave = staveScoreFor(
      score([
        { measure_number: 1, notes: [note('G3')], slurs: [] },
        { measure_number: 2, clef: 'tenor', notes: [note('G3')], slurs: [] },
      ]),
    );

    expect(stave.items[0].clefChange).toBeUndefined();
    expect(stave.items[1].clefChange).toBe('tenor');
  });

  it('prints nothing when a bar restates the clef already in force', () => {
    const stave = staveScoreFor(
      score([
        { measure_number: 1, notes: [note('G3')], slurs: [] },
        { measure_number: 2, clef: 'bass', notes: [note('G3')], slurs: [] },
      ]),
    );

    expect(stave.items[1].clefChange).toBeUndefined();
  });

  it('records a return to the opening clef, which a header comparison drops', () => {
    /*
      The trap `musicxml.py` names at the same comparison: a part moving into
      tenor at bar 2 and back to bass at bar 3 states bass at 3, which equals
      the header. Comparing against the header records the departure and drops
      the return, leaving the rest of the part drawn in tenor.
    */
    const stave = staveScoreFor(
      score([
        { measure_number: 1, notes: [note('G3')], slurs: [] },
        { measure_number: 2, clef: 'tenor', notes: [note('G3')], slurs: [] },
        { measure_number: 3, clef: 'bass', notes: [note('G3')], slurs: [] },
      ]),
    );

    expect(stave.items[1].clefChange).toBe('tenor');
    expect(stave.items[2].clefChange).toBe('bass');
  });
});
