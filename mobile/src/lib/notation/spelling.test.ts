import { describe, expect, it } from 'vitest';

import {
  engrave,
  spellAccidentals,
  type StaveItem,
  type StaveNote,
} from './engrave';
import { keySignatureFor } from './keySignature';

/**
 * Which accidentals actually get printed.
 *
 * **The two failures this replaces are opposites and only one of them is
 * cosmetic.** The engraver printed an accidental for every altered pitch and
 * none for anything else, under a key signature it also drew — so D major came
 * out with two sharps in the signature *and* a sharp on every F and C, and an
 * **F natural in D major printed nothing at all**.
 *
 * The second one is the reason this file exists. Pitch names from OCR are
 * absolute: MusicXML's `<alter>` already carries the key signature, so a
 * written F natural arrives as plain `F4`. A bare F under a two-sharp signature
 * is read by every musician as F sharp. Nothing anywhere else in the app can
 * catch that — the sound is right, the beat check passes, and the page shows a
 * different note from the one on the musician's stand.
 */

const D_MAJOR = keySignatureFor('D major', 'treble');

function note(pitch: string, extra: Partial<StaveNote> = {}): StaveNote {
  return { pitch, value: 'quarter', ...extra };
}

/** What each note in the sequence prints, in order. */
function printed(items: StaveItem[], key = D_MAJOR) {
  return spellAccidentals(items, key)
    .filter((item): item is StaveNote => 'pitch' in item)
    .map((item) => item.printed ?? null);
}

describe('spelling accidentals against a key signature', () => {
  it('prints nothing for a note the signature already sharpens', () => {
    // Two sharps in D major, and every F# under them is spelled by the
    // signature. Printing one anyway is what made the page read as a list of
    // pitches.
    expect(printed([note('F#4'), note('C#5')])).toEqual([null, null]);
  });

  it('prints a natural for a note the signature would have sharpened', () => {
    // **The wrong-note case.** `F4` in D major is an F natural, and with no
    // glyph in front of it the page says F sharp.
    expect(printed([note('F4')])).toEqual(['natural']);
  });

  it('prints an accidental the signature does not provide', () => {
    expect(printed([note('Bb4'), note('G#4')])).toEqual(['flat', 'sharp']);
  });

  it('does not repeat an accidental later in the same bar', () => {
    expect(printed([note('Bb4'), note('D5'), note('Bb4')])).toEqual([
      'flat',
      null,
      null,
    ]);
  });

  it('cancels a bar accidental with a natural', () => {
    // B flat then B natural, in a key with no B in its signature: the second
    // needs a glyph or it is read as another B flat.
    expect(printed([note('Bb4'), note('B4')])).toEqual(['flat', 'natural']);
  });

  it('forgets the bar at the barline', () => {
    expect(
      printed([note('Bb4'), note('Bb4', { barBefore: true })]),
    ).toEqual(['flat', 'flat']);
  });

  it('binds an accidental to its octave, not to its letter', () => {
    // An accidental applies to the staff position it is written on, and says
    // nothing about the same letter an octave away. Both halves are here
    // because each is what letter-binding would get wrong, in opposite
    // directions: the B an octave up needs no natural (letter-binding would
    // print one), and the B flat an octave up needs its own flat
    // (letter-binding would suppress it).
    //
    // The first example used to expect a natural, which is the courtesy
    // accidental some editions add and not the rule. Moved rather than
    // weakened: the assertion is the rule, the notes are the demonstration.
    expect(printed([note('Bb4'), note('B5')])).toEqual(['flat', null]);
    expect(printed([note('Bb4'), note('Bb5')])).toEqual(['flat', 'flat']);
  });

  it('applies the signature in every octave', () => {
    // A key signature does bind to the letter, in all octaves — the opposite of
    // the rule above it, and the pair is the whole convention.
    expect(printed([note('F#4'), note('F#5'), note('F#3')])).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('spells double accidentals and cancels them', () => {
    expect(printed([note('F##4'), note('F#4')], [])).toEqual([
      'double-sharp',
      'sharp',
    ]);
    expect(printed([note('Bbb4'), note('B4')], [])).toEqual([
      'double-flat',
      'natural',
    ]);
  });

  it('says nothing about rests, and lets them not break a bar', () => {
    const items: StaveItem[] = [note('Bb4'), { rest: 'quarter' }, note('Bb4')];
    expect(printed(items, [])).toEqual(['flat', null]);
  });

  it('leaves a note it cannot read without a glyph rather than guessing', () => {
    expect(printed([note('H4')], [])).toEqual([null]);
  });
});

describe('the engraving that comes out of it', () => {
  it('draws no accidental on a scale that the signature spells', () => {
    // A D major scale: every note is in the key, so the only accidentals on the
    // page are the two in the signature.
    const scale = ['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C#5', 'D5'].map((p) =>
      note(p),
    );
    const drawn = engrave(scale, 'treble', {
      head: { clef: 'treble', key: D_MAJOR, time: { beats: 4, unit: 4 } },
    });

    const inline = drawn.systems.flatMap((system) =>
      system.notes.filter((n) => n.accidental !== null),
    );
    expect(inline).toHaveLength(0);
    expect(drawn.systems[0].head.key).toHaveLength(2);
  });

  it('draws the natural that makes a borrowed note readable', () => {
    const drawn = engrave([note('D4'), note('F4')], 'treble', {
      head: { clef: 'treble', key: D_MAJOR, time: null },
    });
    const inline = drawn.systems
      .flatMap((system) => system.notes)
      .map((n) => n.accidental);

    expect(inline).toEqual([null, 'natural']);
  });

  it('still draws accidentals for a caller that passes no key at all', () => {
    // The warmup authors its own notes and prints no signature, so every
    // alteration it writes has to appear.
    const drawn = engrave([note('F#4'), note('C#5')], 'treble');
    expect(
      drawn.systems.flatMap((s) => s.notes).map((n) => n.accidental),
    ).toEqual(['sharp', 'sharp']);
  });
});
