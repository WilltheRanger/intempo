import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { engrave, resolveKeyChanges, spellAccidentals, type StaveItem } from './engrave';
import { staveScoreFor } from './fromScore';
import { keyChangeGlyphs, keySignatureFor, sameSignature } from './keySignature';

/**
 * A key printed mid-piece is a change of key, and the page has to show it.
 *
 * **What was wrong.** `ScoreJson.key_signature` was the only key the app knew,
 * so a part that turns from B-flat to G at bar 7 was engraved with two flats on
 * every system to the end and an inline sharp on every F after the change — a
 * signature saying one thing and the notes another, which no printed part does.
 * The photograph in `fixtures/musicxml/audiveris_phone_photo.musicxml` does
 * exactly this at its bar 7.
 *
 * Three rules, each tested here because each was reasoned about rather than
 * copied: the new signature is printed after the barline of the bar it opens;
 * a system that opens on the changed bar shows it in its head and nowhere
 * else; and a change to a key with no accidentals prints naturals, because
 * printing nothing would make the change invisible.
 */

const BB = keySignatureFor('Bb major', 'bass');
const G = keySignatureFor('G major', 'bass');
const opts = { lineGap: 10, noteGap: 30, leftPad: 20, rightPad: 10 };

function bar(pitches: string[], extra: Partial<StaveItem> = {}): StaveItem[] {
  return pitches.map((pitch, index) => ({
    pitch,
    value: 'quarter' as const,
    ...(index === 0 ? extra : {}),
  }));
}

describe('what a key change prints', () => {
  it('prints the new signature when it has accidentals of its own', () => {
    expect(keyChangeGlyphs(BB, G)).toEqual([{ pitch: 'F3', kind: 'sharp' }]);
  });

  it('cancels the old one with naturals when the new key has none', () => {
    // Otherwise a change to C major prints nothing and the flats silently
    // stop applying — every B and E after it read a semitone off.
    expect(keyChangeGlyphs(BB, keySignatureFor('C major', 'bass'))).toEqual([
      { pitch: 'B2', kind: 'natural' },
      { pitch: 'E3', kind: 'natural' },
    ]);
  });

  it('prints nothing between two keys that print nothing', () => {
    expect(keyChangeGlyphs([], [])).toEqual([]);
  });

  it('treats the relative key as the same signature', () => {
    expect(sameSignature('Bb major', 'G minor')).toBe(true);
    expect(sameSignature('Bb major', 'G major')).toBe(false);
    // Nothing readable on either side is not a change either.
    expect(sameSignature(null, 'unknown')).toBe(true);
    expect(sameSignature(null, 'C major')).toBe(true);
  });
});

describe('spelling after a key change', () => {
  it('spells the notes after the change against the new key', () => {
    const items = [
      ...bar(['Bb2', 'F3']),
      ...bar(['F#3', 'F3', 'Bb2'], { barBefore: true, keyChange: { key: 'G major' } }),
    ];
    const printed = spellAccidentals(items, BB).map((item) =>
      'printed' in item ? item.printed : undefined,
    );

    // Bar 1, in B-flat: the B-flat prints nothing, the F prints nothing.
    // Bar 2, in G: the F sharp prints nothing, the F natural prints a natural,
    // and the B-flat now prints a flat.
    expect(printed).toEqual([null, null, null, 'natural', 'flat']);
  });
});

describe('where a key change is drawn', () => {
  it('prints the new signature after the barline, before the first note of the bar', () => {
    const items = [
      ...bar(['D3', 'D3']),
      ...bar(['D3', 'D3'], { barBefore: true, keyChange: { key: 'G major' } }),
    ];
    const laid = engrave(items, 'bass', { ...opts, head: { clef: 'bass', key: BB, time: null } });
    const [system] = laid.systems;

    expect(system.keyChanges).toHaveLength(1);
    const [glyph] = system.keyChanges;
    const barline = system.barlines[0];
    const firstOfBar = system.notes[2];
    expect(glyph.kind).toBe('sharp');
    expect(glyph.x).toBeGreaterThan(barline.x);
    expect(glyph.x).toBeLessThan(firstOfBar.x);
    // On the same line the head would put it: F3 on a bass staff is the
    // fourth line, which is one gap above the middle.
    expect(system.head.key).toHaveLength(2);
    expect(glyph.y).toBeCloseTo(system.staffLines[2] - opts.lineGap);
  });

  it('gives the change room, so the note after it is not printed through it', () => {
    const plain = engrave(
      [...bar(['D3', 'D3']), ...bar(['D3', 'D3'], { barBefore: true })],
      'bass',
      { ...opts, head: { clef: 'bass', key: BB, time: null } },
    );
    const changed = engrave(
      [...bar(['D3', 'D3']), ...bar(['D3', 'D3'], { barBefore: true, keyChange: { key: 'C major' } })],
      'bass',
      { ...opts, head: { clef: 'bass', key: BB, time: null } },
    );

    // Two naturals cancel the two flats, and the bar they open moves right by
    // at least the width of the glyphs.
    expect(changed.systems[0].keyChanges.map((g) => g.kind)).toEqual(['natural', 'natural']);
    expect(changed.systems[0].notes[2].x - changed.systems[0].barlines[0].x).toBeGreaterThan(
      plain.systems[0].notes[2].x - plain.systems[0].barlines[0].x + 2 * opts.lineGap,
    );
  });

  it('opens the next system in the new key and prints the change once', () => {
    // A width that fits one bar per line.
    const items = [
      ...bar(['D3', 'D3', 'D3', 'D3']),
      ...bar(['D3', 'D3', 'D3', 'D3'], { barBefore: true, keyChange: { key: 'G major' } }),
      ...bar(['D3', 'D3', 'D3', 'D3'], { barBefore: true }),
    ];
    // 240, not 200: a bar of four quarters behind a full head is 217pt wide
    // before any key change, and the engraver breaks only at barlines — a
    // single bar that does not fit is laid out anyway and `fitWidth` scales
    // it. Asserting 200 here would have been asserting something the engraver
    // never promised, and it would have failed with the courtesy removed too.
    const laid = engrave(items, 'bass', {
      ...opts,
      maxWidth: 240,
      head: { clef: 'bass', key: BB, time: { beats: 4, unit: 4 } },
    });

    expect(laid.systems).toHaveLength(3);
    // Opens in B-flat: two flats. Then G: one sharp, on the head and not
    // again after the barline. The third line is still in G.
    expect(laid.systems[0].head.key.map((a) => a.kind)).toEqual(['flat', 'flat']);
    expect(laid.systems[1].head.key.map((a) => a.kind)).toEqual(['sharp']);
    expect(laid.systems[1].keyChanges).toEqual([]);
    expect(laid.systems[2].head.key.map((a) => a.kind)).toEqual(['sharp']);
    expect(laid.systems[2].keyChanges).toEqual([]);

    // **The courtesy.** The first line ends by warning that the next is in G:
    // the sharp sits after its last note and before its closing barline, and
    // the barline has moved right to make room. A printed part does this, and
    // a change to C major — which the next head announces with *nothing* —
    // would otherwise be invisible.
    const [first] = laid.systems;
    expect(first.keyChanges.map((g) => g.kind)).toEqual(['sharp']);
    const lastNote = first.notes[first.notes.length - 1];
    const closing = first.barlines[first.barlines.length - 1];
    expect(first.keyChanges[0].x).toBeGreaterThan(lastNote.x);
    expect(first.keyChanges[0].x).toBeLessThan(closing.x);
    // And the line still fits the width it was given.
    expect(first.width).toBeLessThanOrEqual(240);
  });

  it('keeps a line that would fit narrow enough to print the courtesy on it', () => {
    /*
      **The bar that changes key is not the one that pays for it.** The packer
      charges the courtesy to the line in *front* of the change, and it only
      knows there is a line in front once it has chosen to break — so the room
      has to be reserved one bar ahead.

      Measured, at this width, with the reservation removed: the first line
      takes both of the opening bars, the change is pushed onto a line of its
      own, and the courtesy announcing it makes that first line **283pt inside
      a 262pt column** — the notes spill past the right margin. Reserving it
      moves one bar down instead, and every line fits.

      Charging it to the previous bar *unconditionally* does not fix this: it
      breaks the line, and the break is what creates the courtesy.
    */
    const width = 262;
    const items = [
      ...bar(['D3', 'D3']),
      ...bar(['D3', 'D3'], { barBefore: true }),
      ...bar(['D3', 'D3'], { barBefore: true, keyChange: { key: 'C major' } }),
    ];
    const laid = engrave(items, 'bass', {
      ...opts,
      maxWidth: width,
      head: { clef: 'bass', key: keySignatureFor('E major', 'bass'), time: { beats: 2, unit: 4 } },
    });

    expect(laid.systems.every((system) => system.width <= width)).toBe(true);
    // Four naturals cancelling E major, printed once, at the end of the line
    // that runs into the change.
    expect(laid.systems.flatMap((system) => system.keyChanges).map((g) => g.kind)).toEqual([
      'natural',
      'natural',
      'natural',
      'natural',
    ]);
  });

  it('warns of a change to C major at the end of the line, which nothing else would show', () => {
    const items = [
      ...bar(['D3', 'D3', 'D3', 'D3']),
      ...bar(['D3', 'D3', 'D3', 'D3'], { barBefore: true, keyChange: { key: 'C major' } }),
    ];
    const laid = engrave(items, 'bass', {
      ...opts,
      maxWidth: 200,
      head: { clef: 'bass', key: BB, time: null },
    });

    expect(laid.systems).toHaveLength(2);
    expect(laid.systems[1].head.key).toEqual([]);
    expect(laid.systems[0].keyChanges.map((g) => g.kind)).toEqual(['natural', 'natural']);
  });

  it('resolves each change against the key before it, wherever that was set', () => {
    const items = [
      ...bar(['D3']),
      ...bar(['D3'], { barBefore: true, keyChange: { key: 'G major' } }),
      ...bar(['D3'], { barBefore: true, keyChange: { key: 'C major' } }),
    ];
    const resolved = resolveKeyChanges(items, BB, 'bass');

    expect(resolved[0]).toBeNull();
    expect(resolved[1]?.printed.map((g) => g.kind)).toEqual(['sharp']);
    // Cancelling G, not B-flat: one natural, on the F line.
    expect(resolved[2]?.printed).toEqual([{ pitch: 'F3', kind: 'natural' }]);
  });
});

describe('from the score', () => {
  const score = (measures: ScoreJson['measures'], key: string | null = 'Bb major'): ScoreJson => ({
    time_signature: '4/4',
    key_signature: key,
    tempo_marking: null,
    bpm_hint: null,
    clef: 'bass',
    measures,
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
  });
  const quarter = (pitch: string) => ({ pitch, duration: 'quarter' as const, tied_to_next: false });

  it('puts the change on the first item of the bar that prints it', () => {
    const { items } = staveScoreFor(
      score([
        { measure_number: 1, notes: [quarter('D3'), quarter('D3')], slurs: [] },
        { measure_number: 2, key_signature: 'G major', notes: [quarter('D3'), quarter('D3')], slurs: [] },
      ]),
    );

    expect(items.map((item) => item.keyChange ?? null)).toEqual([
      null,
      null,
      { key: 'G major' },
      null,
    ]);
  });

  it('rides on a rest when the bar opens with one', () => {
    const { items } = staveScoreFor(
      score([
        { measure_number: 1, notes: [quarter('D3')], slurs: [] },
        {
          measure_number: 2,
          key_signature: 'G major',
          notes: [quarter('rest'), quarter('D3')],
          slurs: [],
        },
      ]),
    );

    expect(items[1]).toMatchObject({ rest: 'quarter', keyChange: { key: 'G major' } });
  });

  it('ignores a name that only changes the mode over the same signature', () => {
    const { items } = staveScoreFor(
      score([
        { measure_number: 1, notes: [quarter('D3')], slurs: [] },
        { measure_number: 2, key_signature: 'G minor', notes: [quarter('D3')], slurs: [] },
      ]),
    );

    expect(items.every((item) => !item.keyChange)).toBe(true);
  });

  it('ignores a change nothing can read', () => {
    const { items } = staveScoreFor(
      score([
        { measure_number: 1, notes: [quarter('D3')], slurs: [] },
        { measure_number: 2, key_signature: 'unknown', notes: [quarter('D3')], slurs: [] },
      ]),
    );

    expect(items.every((item) => !item.keyChange)).toBe(true);
  });

  it('compares a later change against the key then in force, not the header', () => {
    // B-flat → G → B-flat: the return equals the header and is still a change.
    const { items } = staveScoreFor(
      score([
        { measure_number: 1, notes: [quarter('D3')], slurs: [] },
        { measure_number: 2, key_signature: 'G major', notes: [quarter('D3')], slurs: [] },
        { measure_number: 3, key_signature: 'Bb major', notes: [quarter('D3')], slurs: [] },
      ]),
    );

    expect(items.map((item) => item.keyChange?.key ?? null)).toEqual([null, 'G major', 'Bb major']);
  });

  it('waits for the next drawn item when the bar that changes key draws nothing', () => {
    const { items } = staveScoreFor(
      score([
        { measure_number: 1, notes: [quarter('D3')], slurs: [] },
        // A pitch the engraver cannot place, so the bar has no item.
        { measure_number: 2, key_signature: 'G major', notes: [quarter('H3')], slurs: [] },
        { measure_number: 3, notes: [quarter('D3')], slurs: [] },
      ]),
    );

    expect(items.map((item) => item.keyChange?.key ?? null)).toEqual([null, 'G major']);
  });
});
