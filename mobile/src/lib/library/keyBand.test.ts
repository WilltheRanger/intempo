import { describe, expect, it } from 'vitest';

import { keyBands } from '../../design/colors';
import { keyBandFor } from './keyBand';

describe('keyBandFor', () => {
  it('colours G minor oxblood, two flats', () => {
    expect(keyBandFor('G minor')).toBe(keyBands[-2]);
  });

  it('gives relative keys one colour, because they share a signature', () => {
    expect(keyBandFor('B♭ major')).toBe(keyBandFor('G minor'));
    expect(keyBandFor('G major')).toBe(keyBandFor('E minor'));
    expect(keyBandFor('A minor')).toBe(keyBandFor('C major'));
  });

  it('tells neighbouring keys apart', () => {
    expect(keyBandFor('G major')).not.toBe(keyBandFor('D major'));
    expect(keyBandFor('F major')).not.toBe(keyBandFor('C major'));
    expect(keyBandFor('G major')).not.toBe(keyBandFor('F major'));
  });

  it('reads the spellings the reading produces', () => {
    expect(keyBandFor('Bb major')).toBe(keyBands[-2]);
    expect(keyBandFor('f# minor')).toBe(keyBands[3]);
    expect(keyBandFor('E♭ major')).toBe(keyBands[-3]);
  });

  it('falls back to C major for a key it cannot read, rather than no band', () => {
    expect(keyBandFor(null)).toBe(keyBands[0]);
    expect(keyBandFor(undefined)).toBe(keyBands[0]);
    expect(keyBandFor('unknown')).toBe(keyBands[0]);
    expect(keyBandFor('H dorian')).toBe(keyBands[0]);
  });

  it('covers every signature from seven flats to seven sharps', () => {
    for (let count = -7; count <= 7; count += 1) {
      expect(keyBands[count as keyof typeof keyBands]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
