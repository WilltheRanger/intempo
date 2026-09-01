import { describe, expect, it } from 'vitest';

import { engrave, type EngravedSystem } from './engrave';

/**
 * The beamed groups on a system: one entry per run of stems joined together.
 *
 * A group can produce several `beams` — level 1 across the run and a shorter
 * level 2 over the sixteenths inside it — so counting `beams` counts lines,
 * not groups, and the two stopped being the same number when the second beam
 * learned to span only the notes that carry it.
 */
const groups = (system: EngravedSystem) => system.beams.filter((b) => b.level === 1);

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
    //
    // Sixteenths rather than eighths because beams now also break at the beat,
    // and two eighths fill one: the old fixture's four eighths around a rest
    // straddled beat 2, so it was the *beat* rule under test and the silence
    // was incidental. Four sixteenths in two pairs sit inside one beat each,
    // which leaves the rest as the only thing that can break them.
    const beamed = engrave(
      [
        { pitch: 'D3', value: 'sixteenth' },
        { pitch: 'E3', value: 'sixteenth' },
        { rest: 'eighth' },
        { pitch: 'F3', value: 'sixteenth' },
        { pitch: 'G3', value: 'sixteenth' },
      ],
      clef,
      opts,
    );

    expect(groups(beamed.systems[0])).toHaveLength(2);
  });

  it('beams the notes on either side of a rest, not across it', () => {
    // **The index alignment this could get wrong invisibly.** A rest occupies
    // a column and produces no notehead, so beaming by item index would join
    // the beam to whichever notehead happened to sit at that position.
    const laid = engrave(
      [
        { pitch: 'D3', value: 'sixteenth' },
        { rest: 'quarter' },
        { pitch: 'F3', value: 'sixteenth' },
        { pitch: 'G3', value: 'sixteenth' },
      ],
      clef,
      opts,
    );
    const [system] = laid.systems;

    expect(groups(system)).toHaveLength(1);
    // The surviving beam spans the last two notes, which sit in columns 2 and 3.
    expect(groups(system)[0].from).toBeGreaterThan(system.rests[0].x);
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
    expect(system.barlines[0].x).toBeLessThan(block.x);
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

    expect(groups(laid.systems[0])).toHaveLength(1);
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
    // so a note cannot end up carrying both. Four sixteenths, because three
    // eighths is a beat and a half and now beams as two groups.
    const system = first(notesOf('sixteenth', 'sixteenth', 'sixteenth', 'sixteenth'));

    expect(groups(system)).toHaveLength(1);
    expect(system.notes.every((n) => n.flags === 0)).toBe(true);
  });

  it('doubles the beam over a run holding a sixteenth', () => {
    // One beam over a run containing a sixteenth reads as a run of eighths —
    // notes at twice their length, in the same ink as the ones that are right.
    const system = first(notesOf('sixteenth', 'sixteenth'));

    expect(system.beams.map((b) => b.level)).toEqual([1, 2]);
    // Both levels span the pair: two sixteenths carry two beams each.
    const [primary, secondary] = system.beams;
    expect(secondary.from).toBeCloseTo(primary.from);
    expect(secondary.to).toBeCloseTo(primary.to);
  });

  it('stubs the second beam over the sixteenth of a dotted-eighth pair', () => {
    // **The rhythm this used to draw wrong, and the commonest one in string
    // writing.** A `count` carried by the whole group put two full beams
    // across the pair, which says both notes are sixteenths — the bar drawn a
    // beat and a half short of the page, in the ink of the bars that are right.
    const system = first([
      { pitch: 'D3', value: 'eighth', dots: 1 },
      { pitch: 'E3', value: 'sixteenth' },
    ]);

    const [primary, stub] = system.beams;
    expect(system.beams.map((b) => b.level)).toEqual([1, 2]);
    // The stub reaches back from the sixteenth's stem and stops well short of
    // the dotted eighth's — a partial beam, not a second full one.
    expect(stub.to).toBeCloseTo(primary.to);
    expect(stub.from).toBeGreaterThan(primary.from);
  });

  it('points a lead stub forward, because there is nothing behind it', () => {
    const system = first([
      { pitch: 'D3', value: 'sixteenth' },
      { pitch: 'E3', value: 'eighth', dots: 1 },
    ]);

    const [primary, stub] = system.beams;
    expect(stub.from).toBeCloseTo(primary.from);
    expect(stub.to).toBeLessThan(primary.to);
  });

  it('spans the second beam over the sixteenths that are adjacent, only', () => {
    // Four sixteenths, an eighth, two more sixteenths: the second beam is two
    // runs, not one line across everything and not six stubs.
    const system = first(
      notesOf('sixteenth', 'sixteenth', 'eighth', 'sixteenth', 'sixteenth'),
    );
    const seconds = system.beams.filter((b) => b.level === 2);

    expect(seconds).toHaveLength(2);
    expect(seconds[0].to).toBeLessThan(seconds[1].from);
  });

  it('stacks the second beam inside the first, on the notehead side', () => {
    const system = first(notesOf('sixteenth', 'sixteenth'));
    const [primary, secondary] = system.beams;
    const note = system.notes[0];

    // Stems point away from the notes; the inner beam is the one nearer them.
    const inward = note.stemUp ? 1 : -1;
    expect((secondary.y - primary.y) * inward).toBeGreaterThan(0);
    // And it still clears the noteheads.
    expect(Math.abs(secondary.y - note.y)).toBeGreaterThan(opts.lineGap);
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

// ---------------------------------------------------------------------------
// Beat grouping
// ---------------------------------------------------------------------------
//
// Found by looking at one. The fixture study's opening bar — sixteen
// sixteenths — engraved as **one beam sixteen notes long**: a black slab
// across the system with every stem stretched down to meet the lowest note in
// the bar. Every assertion above passed on it. It is not a rhythm anybody can
// count and not something any engraver prints.

describe('beat grouping', () => {
  const clef = 'bass' as const;
  const opts = { lineGap: 10, noteGap: 30, leftPad: 20, rightPad: 10 };
  const runOf = (n: number, value: string) =>
    Array.from({ length: n }, () => ({ pitch: 'D3', value }) as never);

  it('groups sixteen sixteenths in fours, not in one', () => {
    const system = engrave(runOf(16, 'sixteenth'), clef, opts).systems[0];

    expect(groups(system)).toHaveLength(4);
  });

  it('keeps a dotted eighth with the sixteenth that finishes its beat', () => {
    // The pair is one beat, so it is one group — and the next pair is another.
    const system = engrave(
      [
        { pitch: 'D3', value: 'eighth', dots: 1 },
        { pitch: 'E3', value: 'sixteenth' },
        { pitch: 'F3', value: 'eighth', dots: 1 },
        { pitch: 'G3', value: 'sixteenth' },
      ],
      clef,
      opts,
    ).systems[0];

    expect(groups(system)).toHaveLength(2);
  });

  it('counts a rest as time passing', () => {
    // An eighth rest, then four sixteenths: the run starts at half a beat and
    // therefore crosses beat 2, so it is two groups. Reading the rest as no
    // time at all would put all four under one beam and print a bar that is
    // beamed as though the silence were not there.
    const system = engrave(
      [{ rest: 'eighth' }, ...runOf(4, 'sixteenth')],
      clef,
      opts,
    ).systems[0];

    expect(groups(system)).toHaveLength(2);
  });

  it('restarts the count at each barline', () => {
    // Two eighths, a barline, two eighths: two groups. Counting straight
    // through would put the second bar's pair across beat 2 of the first.
    const system = engrave(
      [
        { pitch: 'D3', value: 'eighth' },
        { pitch: 'E3', value: 'eighth' },
        { pitch: 'F3', value: 'eighth', barBefore: true },
        { pitch: 'G3', value: 'eighth' },
      ],
      clef,
      opts,
    ).systems[0];

    expect(groups(system)).toHaveLength(2);
  });

  it('points a group\'s stems away from its furthest note, not its first', () => {
    // **The direction rule the screenshot caught.** A group takes one
    // direction for every stem in it. Taking it from the note that happens to
    // come first points the beam the wrong way whenever the run crosses the
    // staff: this group opens one step above the middle line and descends
    // four, so the first note says "down" and the music says "up".
    const system = engrave(
      ['E3', 'D3', 'C3', 'B2'].map((pitch) => ({ pitch, value: 'sixteenth' }) as never),
      clef,
      opts,
    ).systems[0];

    expect(system.notes.every((n) => n.stemUp)).toBe(true);
    // And the beam is above the noteheads, where the stems now point.
    expect(groups(system)[0].y).toBeLessThan(Math.min(...system.notes.map((n) => n.y)));
  });

  it('groups six eighths in threes in compound time', () => {
    // 6/8 has two beats of three eighths. Beaming them in pairs is the tell of
    // notation software that has only ever been shown 4/4.
    const system = engrave(runOf(6, 'eighth'), clef, {
      ...opts,
      beatQuarters: 1.5,
    }).systems[0];

    expect(groups(system)).toHaveLength(2);
  });

  it('shortens the stems it no longer has to stretch', () => {
    // The visible symptom of the bug, and the reason the screenshot looked
    // wrong before anything was measured: every stem in a beamed group reaches
    // the same line, so one bar-long group dragged the high notes' stems the
    // depth of the system to meet the lowest note in the bar.
    //
    // Compared against the same notes under one group rather than against a
    // constant, because the number that matters is the difference the fix
    // makes and a threshold would only record today's stem length.
    const bar = ['D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4',
      'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5'].map(
      (pitch) => ({ pitch, value: 'sixteenth' }) as never,
    );
    const longestStem = (beatQuarters: number) =>
      Math.max(
        ...engrave(bar, clef, { ...opts, beatQuarters }).systems[0].notes.map((n) =>
          Math.abs(n.stem!.to - n.stem!.from),
        ),
      );

    // A whole bar as one group is what it used to do, unconditionally: eleven
    // staff gaps of stem, which is the black slab in the screenshot. Beamed a
    // beat at a time it is under six, which is an ordinary stem.
    expect(longestStem(4)).toBeGreaterThan(opts.lineGap * 11);
    expect(longestStem(1)).toBeLessThan(opts.lineGap * 6);
  });
});

describe('accidentals', () => {
  const clef = 'treble' as const;
  const opts = { lineGap: 10, noteGap: 16, leftPad: 20, rightPad: 10 };

  it('leaves a sharp room to the left of its own notehead', () => {
    const system = engrave(
      [
        { pitch: 'F4', value: 'sixteenth' },
        { pitch: 'G#4', value: 'sixteenth' },
      ],
      clef,
      opts,
    ).systems[0];
    const [before, sharped] = system.notes;

    // **The collision this is here for.** Columns are even and tight — a bar
    // of sixteenths on a phone gets about 1.6 staff gaps each — and a sharp
    // drawn 1.55 gaps left of its notehead therefore landed on the previous
    // note. Head half-width is 0.62 gaps; the sharp reaches 0.68 left of its
    // own centre.
    expect(sharped.accidentalX - opts.lineGap * 0.68).toBeGreaterThan(
      before.x + opts.lineGap * 0.62,
    );
    // And it still sits clear of the notehead it belongs to.
    expect(sharped.accidentalX + opts.lineGap * 0.68).toBeLessThan(
      sharped.x - opts.lineGap * 0.62,
    );
  });

  it('spends the room out of the justified width, not past the margin', () => {
    // Reserving the room after justification has already divided the width up
    // would push the system past its own right margin — the accidentals would
    // fit and the last barline would be off the screen.
    const sharps = Array.from({ length: 8 }, (_unused, i) =>
      ({ pitch: i % 2 ? 'F#4' : 'C#5', value: 'sixteenth' }) as never,
    );
    const engraving = engrave(sharps, clef, {
      ...opts,
      maxWidth: 320,
      justify: true,
    });

    expect(engraving.systems[0].barlines.at(-1)!.x).toBeLessThanOrEqual(320);
  });
});

// ---------------------------------------------------------------------------
// Accidentals
// ---------------------------------------------------------------------------

describe('accidentals, all five of them', () => {
  const clef = 'treble' as const;
  const opts = { lineGap: 10, noteGap: 40, leftPad: 20, rightPad: 10 };
  const noteOf = (pitch: string) =>
    engrave([{ pitch, value: 'quarter' }] as never, clef, opts).systems[0].notes[0];

  it('reads a flat, which was drawn as no accidental at all', () => {
    // **The bug the font unlocked fixing.** `accidentalOf` returned `'sharp'`
    // or nothing, so a B♭ was engraved as a B: a different note, printed as
    // though it were right. The staff position was always correct — `stepOf`
    // reads the letter — so nothing on the screen said otherwise.
    expect(noteOf('Bb4').accidental).toBe('flat');
    expect(noteOf('F#4').accidental).toBe('sharp');
    expect(noteOf('B4').accidental).toBeNull();
  });

  it('reads a double, rather than borrowing the single', () => {
    // An F♯♯ drawn with one sharp is a semitone wrong and looks deliberate.
    expect(noteOf('F##4').accidental).toBe('double-sharp');
    expect(noteOf('Bbb4').accidental).toBe('double-flat');
  });

  it('puts a note at the same height whatever its accidental', () => {
    // The staff position comes from the letter. If an accidental ever moved a
    // note, the accidental would be being read twice.
    const y = noteOf('B4').y;
    for (const pitch of ['Bb4', 'B#4', 'Bbb4', 'B##4']) {
      expect(noteOf(pitch).y).toBeCloseTo(y);
    }
  });

  it('gives a double flat the room a double flat needs', () => {
    // Bravura's double flat is 1.65 staff spaces against a sharp's 1.0. One
    // width for all five puts it through the notehead it belongs to.
    const flat = noteOf('Bb4');
    const doubleFlat = noteOf('Bbb4');

    expect(flat.x - flat.accidentalX).toBeLessThan(
      doubleFlat.x - doubleFlat.accidentalX,
    );
  });

  it('clears the notehead, for every accidental', () => {
    // `accidentalX` is the glyph's left edge and the widths are Bravura's own,
    // so the right edge is left + width and it must stop short of the head.
    const widths = {
      sharp: 0.996, flat: 0.904, natural: 0.672,
      'double-sharp': 1.0, 'double-flat': 1.652,
    } as const;
    for (const pitch of ['F#4', 'Bb4', 'F##4', 'Bbb4']) {
      const note = noteOf(pitch);
      const right = note.accidentalX + opts.lineGap * widths[note.accidental!];
      expect(right).toBeLessThan(note.x - opts.lineGap * 0.59);
    }
  });
});
