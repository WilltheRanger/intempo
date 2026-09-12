import { describe, expect, it } from 'vitest';

import { engrave, type StaveNote } from './engrave';
import { staveScoreFor } from './fromScore';
import { scheduleScore } from '../score/schedule';
import type { Articulation, ScoreJson } from '../../data/types';

/**
 * Staccato, tenuto and accent.
 *
 * Read off the page since Batch 2, stored on `ScoreNote.articulation`, and used
 * by nothing in the app — not drawn, not played. A staccato dot is not
 * decoration: it changes what you play. A page that omits it teaches the
 * passage wrong, and a musician copying what they hear then records a take
 * judged against durations they were never shown.
 */

function marked(
  pitch: string,
  articulation: Articulation | undefined,
  extra: Partial<StaveNote> = {},
): StaveNote {
  return { pitch, value: 'quarter', ...(articulation ? { articulation } : {}), ...extra };
}

function scoreOf(notes: { pitch: string; articulation?: Articulation }[]): ScoreJson {
  return {
    time_signature: '4/4',
    key_signature: 'C major',
    tempo_marking: null,
    bpm_hint: null,
    clef: 'treble',
    repeats: [],
    ocr_confidence: 1,
    notes_to_human: '',
    measures: [
      {
        measure_number: 1,
        slurs: [],
        notes: notes.map((n) => ({
          pitch: n.pitch,
          duration: 'quarter',
          tied_to_next: false,
          ...(n.articulation ? { articulation: n.articulation } : {}),
        })),
      },
    ],
  } as unknown as ScoreJson;
}

const first = (drawn: ReturnType<typeof engrave>) => drawn.systems[0].notes[0];

describe('drawing an articulation', () => {
  it('draws nothing when the page said nothing', () => {
    expect(first(engrave([marked('C4', undefined)], 'treble')).articulation).toBeNull();
  });

  it.each(['staccato', 'tenuto', 'accent'] as const)('draws a %s', (kind) => {
    expect(first(engrave([marked('C4', kind)], 'treble')).articulation?.kind).toBe(kind);
  });

  it('puts it on the side away from the stem', () => {
    // Where a reader looks for it and the only side with room. A low note stems
    // up, so its mark goes below; a high note stems down, so its mark goes
    // above.
    const low = first(engrave([marked('D4', 'staccato')], 'treble'));
    expect(low.stemUp).toBe(true);
    expect(low.articulation?.above).toBe(false);

    const high = first(engrave([marked('D5', 'staccato')], 'treble'));
    expect(high.stemUp).toBe(false);
    expect(high.articulation?.above).toBe(true);
  });

  it('clears the whole chord, not just the principal', () => {
    // A mark placed against the principal sits inside a double stop.
    //
    // Asserted against the chord's own heads rather than against a plain note's
    // mark: the system is shifted so its topmost ink sits at a fixed padding,
    // so the two absolute positions come out identical and say nothing. The
    // rule is the clearance, not the coordinate.
    const chord = first(engrave([marked('D5', 'staccato', { chord: ['B5'] })], 'treble'));
    const ys = [chord.y, ...chord.chord.map((head) => head.y)];
    const top = Math.min(...ys);

    expect(chord.articulation!.above).toBe(true);
    expect(chord.articulation!.y).toBeLessThan(top);
    // Above the top head by the clearance, and therefore much further than
    // that above the principal — which is what "clears the chord" means.
    expect(top - chord.articulation!.y).toBeGreaterThan(0);
    expect(chord.y - chord.articulation!.y).toBeGreaterThan(top - chord.articulation!.y);
  });

  it('sits under the slur rather than through it', () => {
    // Both go on the notehead side, so a slur measured from the noteheads alone
    // is drawn straight across a row of staccato dots.
    const bare = engrave(
      [
        { pitch: 'D5', value: 'quarter', slur: 1 },
        { pitch: 'E5', value: 'quarter', slur: 1 },
      ],
      'treble',
    ).systems[0];
    const dotted = engrave(
      [
        { pitch: 'D5', value: 'quarter', slur: 1, articulation: 'staccato' },
        { pitch: 'E5', value: 'quarter', slur: 1, articulation: 'staccato' },
      ],
      'treble',
    ).systems[0];
    // Above the notes, so further out is a smaller y.
    expect(dotted.slurs[0].from.y).toBeLessThan(bare.slurs[0].from.y);
  });

  it('carries the mark from the score through to the stave', () => {
    const stave = staveScoreFor(scoreOf([{ pitch: 'C4', articulation: 'accent' }]));
    expect((stave.items[0] as StaveNote).articulation).toBe('accent');
  });
});

describe('hearing an articulation', () => {
  const lengthOf = (score: ScoreJson) => scheduleScore(score, 60).notes[0].durationS;

  it('plays a staccato note markedly short', () => {
    const plain = lengthOf(scoreOf([{ pitch: 'C4' }]));
    const short = lengthOf(scoreOf([{ pitch: 'C4', articulation: 'staccato' }]));
    expect(short).toBeLessThan(plain * 0.7);
  });

  it('plays a tenuto note for its whole written value', () => {
    // The opposite instruction: hold it. It overrides the default gap entirely
    // rather than shortening it slightly less.
    const held = lengthOf(scoreOf([{ pitch: 'C4', articulation: 'tenuto' }]));
    expect(held).toBeCloseTo(1, 9); // one quarter at 60 BPM
  });

  it('plays an accent exactly like an unmarked note', () => {
    // An accent changes weight, not length, and this player has no dynamics.
    // Asserted rather than left implicit so nobody later reads the omission as
    // an oversight.
    const plain = lengthOf(scoreOf([{ pitch: 'C4' }]));
    const accented = lengthOf(scoreOf([{ pitch: 'C4', articulation: 'accent' }]));
    expect(accented).toBeCloseTo(plain, 9);
  });

  it('does not let a short note shorten the bar', () => {
    // Articulation changes how long a note sounds, never when the next one
    // starts — otherwise a staccato passage would run ahead of the beat and
    // every bar after it be judged early.
    const plain = scheduleScore(scoreOf([{ pitch: 'C4' }, { pitch: 'D4' }]), 60);
    const short = scheduleScore(
      scoreOf([
        { pitch: 'C4', articulation: 'staccato' },
        { pitch: 'D4' },
      ]),
      60,
    );
    expect(short.notes[1].startS).toBeCloseTo(plain.notes[1].startS, 9);
    expect(short.durationS).toBeCloseTo(plain.durationS, 9);
  });
});
