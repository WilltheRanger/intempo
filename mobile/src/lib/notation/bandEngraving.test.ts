import { describe, expect, it } from 'vitest';

import type { ScoreJson } from '../../data/types';
import { bandOf, engraveBand, keptEngraving } from './bandEngraving';
import { staveScoreFor } from './fromScore';
import { keySignatureFor, timeSignatureDigits } from './keySignature';
import { layOutStave } from './staveLayout';

/** Bars of four quarters walking up from G4, enough to fill several systems. */
function scoreOf(bars: number, clef: ScoreJson['clef'] = 'treble'): ScoreJson {
  const pitches = ['G4', 'A4', 'B4', 'C5'];
  return {
    clef,
    time_signature: '4/4',
    key_signature: 'D major',
    tempo_marking: null,
    bpm_hint: null,
    measures: Array.from({ length: bars }, (_unused, index) => ({
      measure_number: index + 1,
      notes: pitches.map((pitch) => ({ pitch, duration: 'quarter', tied_to_next: false })),
      slurs: [],
    })),
    repeats: [],
    ocr_confidence: 0.9,
    notes_to_human: '',
  } as unknown as ScoreJson;
}

describe('engraveBand', () => {
  it('makes the request ScoreBand has always made', () => {
    // Moving the request out of the component is only safe if it is the same
    // request: wrapped and justified to the width, shrunk to fit, a head with
    // the clef, key and metre, and no row of note names.
    const score = scoreOf(12);
    const stave = staveScoreFor(score);

    expect(engraveBand(score, 141, 0.62)).toEqual(
      layOutStave({
        notes: stave.items,
        clef: 'treble',
        maxWidth: 141,
        fitWidth: 141,
        scale: 0.62,
        justify: true,
        beatQuarters: stave.beatQuarters,
        closesWithRepeat: stave.closesWithRepeat,
        endings: stave.endings,
        tempoMarks: stave.tempoMarks,
        head: {
          clef: 'treble',
          key: keySignatureFor('D major', 'treble'),
          time: timeSignatureDigits('4/4'),
        },
        nameRow: false,
      }),
    );
  });

  it('keeps an engraving for the next band of the same notation at the same size', () => {
    const score = scoreOf(12);

    expect(keptEngraving(score, 141, 0.62)).toBeNull();
    const engraved = engraveBand(score, 141, 0.62);

    expect(keptEngraving(score, 141, 0.62)).toBe(engraved);
    expect(engraveBand(score, 141, 0.62)).toBe(engraved);
  });

  it('engraves another size of the same notation afresh', () => {
    const score = scoreOf(12);
    const narrow = engraveBand(score, 141, 0.62);

    expect(keptEngraving(score, 300, 0.62)).toBeNull();
    expect(engraveBand(score, 300, 0.62)).not.toBe(narrow);
    expect(keptEngraving(score, 141, 0.95)).toBeNull();
  });

  it('never answers for notation it was not given', () => {
    // Kept by the notation object, so an edit — which arrives as new notation
    // rather than a change to the old — is engraved as what it now says.
    const before = scoreOf(12);
    const after = { ...before, measures: before.measures.slice(0, 2) };
    engraveBand(before, 141, 0.62);

    expect(keptEngraving(after, 141, 0.62)).toBeNull();
    expect(engraveBand(after, 141, 0.62).layout.systems.length).toBeLessThan(
      engraveBand(before, 141, 0.62).layout.systems.length,
    );
  });

  it('keeps the three most recent sizes and lets older ones go', () => {
    // A window dragged to a new size passes through a width a frame; keeping
    // each would keep a whole engraved piece for every one of them.
    const score = scoreOf(4);
    for (const width of [200, 210, 220, 230]) {
      engraveBand(score, width, 0.62);
    }

    expect(keptEngraving(score, 200, 0.62)).toBeNull();
    expect(keptEngraving(score, 210, 0.62)).not.toBeNull();
    expect(keptEngraving(score, 220, 0.62)).not.toBeNull();
    expect(keptEngraving(score, 230, 0.62)).not.toBeNull();
  });
});

describe('bandOf', () => {
  it('places an unread clef as treble and draws no clef for it', () => {
    // Where the noteheads go has to be decided either way; claiming a clef
    // nothing read is the part a band must not do.
    const band = bandOf(scoreOf(1, null as unknown as ScoreJson['clef']));

    expect(band.clef).toBe('treble');
    expect(band.head.clef).toBeNull();
  });

  it('draws the clef that was read', () => {
    const band = bandOf(scoreOf(1, 'bass'));

    expect(band.clef).toBe('bass');
    expect(band.head.clef).toBe('bass');
    expect(band.head.key).toEqual(keySignatureFor('D major', 'bass'));
  });
});
