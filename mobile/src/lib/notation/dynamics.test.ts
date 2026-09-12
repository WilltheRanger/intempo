import { describe, expect, it } from 'vitest';

import type { Dynamics } from '../../data/types';
import { engrave, spellDynamic, type StaveItem } from './engrave';

/**
 * Dynamics, which the pipeline has read since Batch 2 and nothing drew.
 *
 * `musicxml.py` pulls them out of an imported file, `ScoreNote.dynamics`
 * carries them, the app's own type declares them — and the engraving dropped
 * every one, on the screen that offers itself as "the notes read from the
 * page". An imported MuseScore part lost all its markings.
 *
 * They are set from the font's own letters rather than from italic type: `p`,
 * `m`, `f`, `s` and `z` are drawings in a music font for the same reason a
 * clef is, and every one of the schema's twelve marks is a run of those five.
 */
const ALL: Dynamics[] = [
  'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'fp', 'sfz', 'sf', 'fz',
];

function bar(marks: (Dynamics | undefined)[]): StaveItem[] {
  return marks.map((dynamic, index) => ({
    pitch: 'B4',
    value: 'quarter' as const,
    barBefore: index === 0,
    ...(dynamic ? { dynamic } : {}),
  }));
}

describe('every dynamic the schema can send', () => {
  it.each(ALL)('draws %s', (mark) => {
    const [system] = engrave(bar([mark]), 'treble').systems;

    expect(system.dynamics).toHaveLength(1);
    // One glyph per letter — `mf` is two, `sfz` three.
    expect(system.dynamics[0].glyphs).toHaveLength(mark.length);
    expect(system.dynamics[0].width).toBeGreaterThan(0);
  });

  it('draws nothing for a mark spelled with a letter it has no glyph for', () => {
    // The same rule the note values follow: dropped rather than approximated.
    // A hairpin's name — `dim.`, `cresc.` — is not a run of these five, and
    // half of it would be a different instruction.
    const [system] = engrave(bar(['dim' as Dynamics]), 'treble').systems;

    expect(system.dynamics).toEqual([]);
  });
});

describe('where they sit', () => {
  it('puts every mark on one baseline, whatever its note', () => {
    // A printed part lines them up. Following each note's own depth gives a
    // row of marks at different heights, which reads as noise.
    const notes: StaveItem[] = [
      { pitch: 'C4', value: 'quarter', barBefore: true, dynamic: 'p' },
      { pitch: 'C6', value: 'quarter', dynamic: 'f' },
    ];

    const [system] = engrave(notes, 'treble').systems;

    expect(system.dynamics).toHaveLength(2);
    expect(system.dynamics[0].y).toBe(system.dynamics[1].y);
  });

  it('sits below everything else on the system', () => {
    const notes: StaveItem[] = [
      { pitch: 'C4', value: 'quarter', barBefore: true, dynamic: 'mf' },
    ];
    const [system] = engrave(notes, 'treble').systems;

    const lowestNote = Math.max(...system.notes.map((n) => n.stem?.to ?? n.y));
    expect(system.dynamics[0].y).toBeGreaterThan(lowestNote);
    expect(system.dynamics[0].y).toBeGreaterThan(system.staffLines[4]);
  });

  it('clears the music with the top of the mark, not with its baseline', () => {
    // **The f and the notehead fused into one blob.** Wohlfahrt No. 28 — the
    // one fixture in the corpus with a printed dynamic — opens on a D4, which
    // in treble sits below the staff, exactly where the mark goes. The
    // clearance was measured to the mark's *baseline*, and `f` rises 1.78
    // staff spaces above its own baseline, so 1.4 spaces of clearance drew it
    // 0.38 spaces up into the note.
    //
    // Every test in this file passed while that was true, because not one of
    // them knew how tall the letter was. This one asks the font.
    const [system] = engrave(
      [{ pitch: 'D4', value: 'quarter', barBefore: true, dynamic: 'f' }],
      'treble',
    ).systems;

    const gap = system.staffLines[1] - system.staffLines[0];
    const spelled = spellDynamic('f', gap);
    if (!spelled) {
      throw new Error('f is a dynamic this draws');
    }
    // A notehead fills one staff space, so its ink ends half a space below its
    // centre. That is the definition of the glyph, not an estimate.
    const noteheadBottom = Math.max(...system.notes.map((n) => n.y)) + gap / 2;
    const top = system.dynamics[0].y - spelled.ascent;

    expect(top).toBeGreaterThan(noteheadBottom);
    expect(top).toBeGreaterThan(system.staffLines[4]);
  });

  it('is pushed further down by a note that hangs lower', () => {
    // The baseline is measured from the system's lowest ink, so a part that
    // dips below the staff moves the whole row rather than colliding with it.
    const high = engrave(bar(['f']), 'treble').systems[0];
    const low = engrave(
      [{ pitch: 'A3', value: 'quarter', barBefore: true, dynamic: 'f' }],
      'treble',
    ).systems[0];

    expect(low.dynamics[0].y).toBeGreaterThan(high.dynamics[0].y);
  });

  it('makes the box taller so the tail of an f is not clipped', () => {
    // `f` descends 0.61 staff spaces below the baseline where `m`, `s` and `z`
    // stop at 0.04 — measured out of Bravura. The flags taught this lesson
    // once already: a glyph outside the measured box is simply cut off.
    const plain = engrave(bar([undefined]), 'treble').height;
    const marked = engrave(bar(['f']), 'treble').height;

    expect(marked).toBeGreaterThan(plain);
  });

  it('centres the mark on its notehead', () => {
    const [system] = engrave(bar(['mf']), 'treble').systems;

    expect(system.dynamics[0].x).toBe(system.notes[0].x);
  });
});

describe('two marks in a row', () => {
  it('does not print them as one word', () => {
    // **`mf` and `sfz` on adjacent quarters came out as `mfsfz`.** A dynamic
    // is centred on its notehead and is wider than the ordinary column, so
    // neighbouring marks overlapped — which the beat check cannot see and a
    // screenshot can.
    const [system] = engrave(bar(['mf', 'sfz']), 'treble').systems;

    const [first, second] = system.dynamics;
    const lineGap = system.staffLines[1] - system.staffLines[0];
    const before = spellDynamic('mf', lineGap);
    const after = spellDynamic('sfz', lineGap);
    if (!before || !after) {
      throw new Error('both are dynamics this draws');
    }
    // Measured between the **ink**, not between the advances: `f` overhangs
    // its own pen by more than half a staff space on the left, so an
    // advance-to-advance gap can be positive while the letters touch.
    const rightOfFirst = first.x - first.width / 2 + before.right;
    const leftOfSecond = second.x - second.width / 2 + after.left;
    expect(leftOfSecond).toBeGreaterThan(rightOfFirst);
  });

  it('leaves the music around an isolated mark where it was', () => {
    // Reserving room around every dynamic would spread music that has no
    // collision in it. Only a marked note *following a marked note* asks.
    const plain = engrave(bar([undefined, undefined]), 'treble').width;
    const oneMark = engrave(bar([undefined, 'p']), 'treble').width;

    expect(oneMark).toBe(plain);
  });

  it('gives more room to a wider pair', () => {
    const narrow = engrave(bar(['p', 'p']), 'treble').width;
    const wide = engrave(bar(['sfz', 'sfz']), 'treble').width;

    expect(wide).toBeGreaterThan(narrow);
  });
});
