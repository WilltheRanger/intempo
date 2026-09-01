import { describe, expect, it } from 'vitest';

import { harmonicsFor, VOICES, voiceForInstrument, type Voice } from './voice';

/** Loudest partial, and which one it is (1-based). */
function peak(amps: number[]): { index: number; value: number } {
  let index = 1;
  let value = -1;
  amps.forEach((a, i) => {
    if (a > value) {
      value = a;
      index = i + 1;
    }
  });
  return { index, value };
}

/** Amplitude-weighted mean frequency — where the sound "sits". */
function centroidHz(amps: number[], f0: number): number {
  const total = amps.reduce((a, b) => a + b, 0);
  return amps.reduce((sum, a, i) => sum + a * (i + 1) * f0, 0) / total;
}

describe('harmonicsFor', () => {
  it('normalises to a constant sum, whatever the register', () => {
    // **A low note has four times the partials of a high one.** Without this a
    // bass line would be four times as loud as the melody purely because it had
    // more of them to add up — and the renderers sum straight into a
    // fixed-point buffer, so the loud end is where it clips.
    for (const f0 of [41, 65, 98, 196, 440, 1046]) {
      const sum = harmonicsFor(VOICES.cello, f0).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it('bounds the peak of the summed waveform at one', () => {
    // Every partial is a sine, so the worst case is all of them in phase,
    // which is exactly the sum. Web Audio is handed these with normalisation
    // disabled, so this bound is the only thing keeping it from clipping.
    const amps = harmonicsFor(VOICES.violin, 196);
    expect(amps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('never synthesises above the audible ceiling', () => {
    // A partial at 15 kHz costs a multiply per sample and reaches nobody
    // through a phone speaker.
    for (const f0 of [41, 440, 2093]) {
      const amps = harmonicsFor(VOICES.violin, f0);
      expect(amps.length * f0).toBeLessThanOrEqual(10000 + f0);
    }
  });

  it('gives a very high note whatever partials still fit', () => {
    // At 2093 Hz only four harmonics are under the ceiling. The note must
    // still sound — an empty list is silence in both renderers.
    expect(harmonicsFor(VOICES.violin, 2093).length).toBeGreaterThan(0);
  });

  it('refuses a frequency that is not one', () => {
    expect(harmonicsFor(VOICES.violin, 0)).toEqual([]);
    expect(harmonicsFor(VOICES.violin, -100)).toEqual([]);
    expect(harmonicsFor(VOICES.violin, Number.NaN)).toEqual([]);
  });
});

describe('the body is fixed in frequency, and that is the whole point', () => {
  it('lifts a different harmonic in a low note than in a high one', () => {
    // A violin's main body resonances sit near 280 and 460–540 Hz whatever is
    // being played. On the open G string (196 Hz) that is around the second
    // and third harmonic; on the open E (659 Hz) the fundamental is already
    // past them. If a fixed list of amplitudes were being transposed, the same
    // harmonic would be loudest in both — which is what a synthesiser
    // sounds like, and what this voice replaced.
    const low = peak(harmonicsFor(VOICES.violin, 196)).index;
    const high = peak(harmonicsFor(VOICES.violin, 659)).index;

    expect(low).toBeGreaterThan(high);
    expect(high).toBe(1);
  });

  it('keeps the sound in roughly one place across two octaves', () => {
    // The corollary, and the audible one: an instrument does not get four
    // times as bright when you play four times as high. A transposed spectrum
    // does exactly that — its centroid is a fixed multiple of the fundamental.
    const low = centroidHz(harmonicsFor(VOICES.cello, 65), 65);
    const high = centroidHz(harmonicsFor(VOICES.cello, 262), 262);

    expect(high / low).toBeLessThan(4);
    // And it does still rise: the string's own series moves with the note.
    expect(high).toBeGreaterThan(low);
  });

  it('has no such behaviour in the reference tone, which has no body', () => {
    // The old voice, kept. With no resonances the spectrum *is* a transposed
    // shape, and this asserts the difference is the resonances rather than
    // anything else that changed.
    const low = harmonicsFor(VOICES.reference, 196);
    const high = harmonicsFor(VOICES.reference, 659);

    expect(low).toEqual(high);
  });
});

describe('the instruments differ from each other', () => {
  it('gets darker as it gets bigger', () => {
    // Compared at the same pitch, so this is the instrument and not the
    // register: middle C, which all four can play.
    const at = (voice: Voice) => centroidHz(harmonicsFor(voice, 262), 262);

    expect(at(VOICES.violin)).toBeGreaterThan(at(VOICES.viola));
    expect(at(VOICES.viola)).toBeGreaterThan(at(VOICES.cello));
    expect(at(VOICES.cello)).toBeGreaterThan(at(VOICES.double_bass));
  });

  it('does not put the fundamental on top for a low bass note', () => {
    // **The owner's own instrument.** An E1 at 41 Hz is below the body's air
    // resonance and below what a phone speaker reproduces at all; what a
    // listener hears as the pitch is the harmonics above it. A voice whose
    // fundamental dominated there would be inaudible on the device it is
    // played on.
    const amps = harmonicsFor(VOICES.double_bass, 41.2);

    expect(peak(amps).index).toBeGreaterThan(1);
    expect(centroidHz(amps, 41.2)).toBeGreaterThan(100);
  });

  it('bows rather than plucks — every voice takes time to speak', () => {
    for (const voice of Object.values(VOICES)) {
      expect(voice.attackS).toBeGreaterThan(0.005);
      expect(voice.releaseS).toBeGreaterThan(voice.attackS);
    }
  });

  it('has a voice for every instrument the app knows', () => {
    for (const instrument of ['violin', 'viola', 'cello', 'double_bass'] as const) {
      expect(VOICES[voiceForInstrument(instrument)]).toBeDefined();
    }
  });
});
