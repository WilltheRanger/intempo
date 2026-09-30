import { describe, expect, it } from 'vitest';

import type { TakeIntonation } from '../../data/types';
import { pitchBand, pitchWord } from './intonation';

const TAKE: TakeIntonation = {
  tuningCents: 25,
  spreadCents: 14,
  notes: 60,
  inTuneCents: 15,
  slightCents: 30,
  tuningWorthSayingCents: 10,
  byNote: [],
  byNoteShowNotes: 4,
};

describe('a bar in words', () => {
  it('is in tune within the take’s own band', () => {
    expect(pitchBand(-12, TAKE)).toBe('in_tune');
    expect(pitchWord(-12, TAKE)).toBe('In tune');
  });

  it('says which way beyond it, without cents', () => {
    expect(pitchWord(22, TAKE)).toBe('Played a little sharp');
    expect(pitchWord(-22, TAKE)).toBe('Played a little flat');
    expect(pitchWord(-41, TAKE)).toBe('Played flat');
    expect(pitchWord(60, TAKE)).toBe('Played sharp');
  });
});
