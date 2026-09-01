import { describe, expect, it } from 'vitest';

import { engrave } from './engrave';

/**
 * Where rests and multi-bar rests land on the staff.
 *
 * The notes were already covered by the warmup's own tests; this is the
 * geometry added on 2026-08-27, and it is here because two of its rules are
 * wrong *silently*: a whole and a half rest are the same rectangle in
 * different places, and a rest occupies a column without producing a
 * notehead, so beaming by item index quietly beams the wrong notes.
 */

describe('rests', () => {
  const clef = 'bass' as const;
  const opts = { lineGap: 10, noteGap: 30, leftPad: 20, rightPad: 10 };

  it('gives a rest a column of its own', () => {
    const laid = engrave(
      [{ pitch: 'D3', value: 'quarter' }, { rest: 'quarter' }, { pitch: 'D3', value: 'quarter' }],
      clef,
      opts,
    );
    const [system] = laid.systems;

    expect(system.notes).toHaveLength(2);
    expect(system.rests).toHaveLength(1);
    // Evenly spaced, like everything else: the rest sits between its
    // neighbours rather than being squeezed against one of them.
    expect(system.rests[0].x - system.notes[0].x).toBeCloseTo(30);
    expect(system.notes[1].x - system.rests[0].x).toBeCloseTo(30);
  });

  it('hangs a whole rest and stands a half rest, which are opposites', () => {
    // **The one thing that is silently wrong if it is wrong.** Both are the
    // same rectangle; the whole hangs below the second line from the top and
    // the half sits on the middle line. Swapped, every bar of rest in the app
    // is a beat wrong to anyone who reads music, and nothing else would show it.
    const laid = engrave([{ rest: 'whole' }, { rest: 'half' }], clef, opts);
    const [system] = laid.systems;
    const [whole, half] = system.rests;

    expect(whole.y).toBeCloseTo(system.staffLines[1]);
    expect(half.y).toBeCloseTo(system.staffLines[2]);
    expect(whole.y).toBeLessThan(half.y);
  });

  it('breaks a beam', () => {
    // A beam over a silence would group notes that are not a group.
    const beamed = engrave(
      [
        { pitch: 'D3', value: 'eighth' },
        { pitch: 'E3', value: 'eighth' },
        { rest: 'eighth' },
        { pitch: 'F3', value: 'eighth' },
        { pitch: 'G3', value: 'eighth' },
      ],
      clef,
      opts,
    );

    expect(beamed.systems[0].beams).toHaveLength(2);
  });

  it('beams the notes on either side of a rest, not across it', () => {
    // **The index alignment this could get wrong invisibly.** A rest occupies
    // a column and produces no notehead, so beaming by item index would join
    // the beam to whichever notehead happened to sit at that position.
    const laid = engrave(
      [
        { pitch: 'D3', value: 'eighth' },
        { rest: 'quarter' },
        { pitch: 'F3', value: 'eighth' },
        { pitch: 'G3', value: 'eighth' },
      ],
      clef,
      opts,
    );
    const [system] = laid.systems;

    expect(system.beams).toHaveLength(1);
    // The surviving beam spans the last two notes, which sit in columns 2 and 3.
    expect(system.beams[0].from).toBeGreaterThan(system.rests[0].x);
  });
});

describe('multi-bar rests', () => {
  const clef = 'bass' as const;
  const opts = { lineGap: 10, noteGap: 30, leftPad: 20, rightPad: 10 };

  it('draws one block, centred on the middle line, with its count', () => {
    const laid = engrave([{ pitch: 'D3', value: 'quarter' }, { bars: 12, barBefore: true }], clef, opts);
    const [system] = laid.systems;
    const [block] = system.multiRests;

    expect(block.bars).toBe(12);
    expect(block.y).toBeCloseTo(system.staffLines[2]);
    // Wider than a notehead by a long way — it has to read as a stretch of
    // silence rather than as another symbol on the line.
    expect(block.width).toBeGreaterThan(opts.lineGap * 2);
    expect(system.barlines[0]).toBeLessThan(block.x);
  });

  it('puts its number above the staff, and makes room for it', () => {
    // The number is the only part of a multi-bar rest a musician reads. A box
    // sized from the noteheads alone clips it.
    const laid = engrave([{ bars: 20 }], clef, opts);
    const [system] = laid.systems;
    const [block] = system.multiRests;

    expect(block.numberY).toBeLessThan(system.staffLines[0]);
    expect(block.numberY).toBeGreaterThan(0);
  });

  it('breaks a beam, twenty times over', () => {
    const laid = engrave(
      [
        { pitch: 'D3', value: 'eighth' },
        { pitch: 'E3', value: 'eighth' },
        { bars: 20, barBefore: true },
        { pitch: 'F3', value: 'eighth' },
      ],
      clef,
      opts,
    );

    expect(laid.systems[0].beams).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Flags, beams and dots
// ---------------------------------------------------------------------------
//
// `tools/engraver-coverage.py` measured what this could not draw: 53 of 393
// notes in the corpus had no glyph, and the worst page drew 40% of its notes.
// Sixteenths were 30 of those 53 — the commonest subdivision after the eighth.

describe('note tails', () => {
  const clef = 'bass' as const;
  const opts = { lineGap: 10, noteGap: 30, leftPad: 20, rightPad: 10 };
  const notesOf = (...values: string[]) =>
    values.map((value) => ({ pitch: 'D3', value }) as never);
  const first = (items: unknown[]) => engrave(items as never, clef, opts).systems[0];

  it('flags a lone eighth, because an unflagged one is a quarter', () => {
    // **Beams were only drawn over runs of two or more.** A single eighth — one
    // between rests, or the last in a bar — came out as a filled notehead on a
    // plain stem, which is exactly a quarter: a note drawn at twice its length
    // with nothing to say otherwise.
    const system = first(notesOf('quarter', 'eighth', 'quarter'));
    const eighth = system.notes[1];

    expect(eighth.flags).toBe(1);
    expect(system.notes[0].flags).toBe(0);
  });

  it('gives a sixteenth two tails and a quarter none', () => {
    const system = first(notesOf('sixteenth', 'quarter'));

    expect(system.notes[0].flags).toBe(2);
    expect(system.notes[1].flags).toBe(0);
  });

  it('takes the flags off a note a beam picked up', () => {
    // Flags are set on every note as it is engraved and cleared by the beam,
    // so a note cannot end up carrying both.
    const system = first(notesOf('eighth', 'eighth', 'eighth'));

    expect(system.beams).toHaveLength(1);
    expect(system.notes.every((n) => n.flags === 0)).toBe(true);
  });

  it('doubles the beam over a run holding a sixteenth', () => {
    // One beam over a run containing a sixteenth reads as a run of eighths —
    // notes at twice their length, in the same ink as the ones that are right.
    const system = first(notesOf('sixteenth', 'sixteenth'));

    expect(system.beams[0].count).toBe(2);
  });

  it('takes the beam count from the thinnest note in the run', () => {
    const system = first(notesOf('eighth', 'sixteenth'));

    expect(system.beams[0].count).toBe(2);
  });

  it('carries the augmentation dot through to the glyph', () => {
    // A dot adds half the value again. Dropping it draws a dotted quarter as a
    // quarter — a shorter note, drawn as though the page said so.
    const system = first([{ pitch: 'B4', value: 'quarter', dots: 1 }]);

    expect(system.notes[0].dots).toBe(1);
  });

  it('fills every notehead a quarter or shorter, and no other', () => {
    const system = first(notesOf('whole', 'half', 'quarter', 'eighth', 'sixteenth'));

    expect(system.notes.map((n) => n.filled)).toEqual([false, false, true, true, true]);
  });
});
