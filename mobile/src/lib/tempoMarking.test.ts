import { describe, expect, it } from 'vitest';

import { bpmForMarking } from './tempoMarking';

describe('bpmForMarking', () => {
  it('reads a bare term', () => {
    expect(bpmForMarking('Allegro')).toBe(132);
    expect(bpmForMarking('Adagio')).toBe(66);
    expect(bpmForMarking('Largo')).toBe(50);
  });

  it('reads a term inside what is actually printed', () => {
    // Almost nothing is headed with the bare word. "Allegro con brio",
    // "Andante cantabile", "Adagio sostenuto — attacca".
    expect(bpmForMarking('Allegro con brio')).toBe(132);
    expect(bpmForMarking('Andante cantabile')).toBe(76);
  });

  it('prefers the compound over the word inside it', () => {
    // **The ordering that has to be right.** A shortest-first scan reads
    // "Allegro moderato" as a plain Allegro — sixteen beats a minute faster
    // than the page asks — and "Andante moderato" as a Moderato, which is
    // faster still and the wrong one of the two words.
    expect(bpmForMarking('Allegro moderato')).toBe(116);
    expect(bpmForMarking('Allegro moderato')).not.toBe(bpmForMarking('Allegro'));
    expect(bpmForMarking('Andante moderato')).toBe(84);
    expect(bpmForMarking('Molto allegro')).toBe(144);
  });

  it('does not read allegretto as allegro, or andantino as andante', () => {
    // These are different tempos that merely start the same way. Substring
    // matching gets them right only because the longer term is listed first.
    expect(bpmForMarking('Allegretto')).toBe(104);
    expect(bpmForMarking('Andantino')).toBe(88);
  });

  it('is case-insensitive, because engravers are not consistent', () => {
    expect(bpmForMarking('ALLEGRO')).toBe(132);
    expect(bpmForMarking('adagio')).toBe(66);
  });

  it('returns null for anything it does not know', () => {
    // Null, not a default. The caller has to be able to tell "the page said a
    // word I know" from "the page said nothing usable" — one of those prints a
    // provenance under the number and the other must not.
    expect(bpmForMarking('Schnell')).toBeNull();
    expect(bpmForMarking('')).toBeNull();
    expect(bpmForMarking(null)).toBeNull();
    expect(bpmForMarking(undefined)).toBeNull();
  });

  it('puts every term in a plausible range', () => {
    // A transposed digit here is a piece offered at half or twice its tempo,
    // and nothing else in the app would notice.
    for (const marking of ['Grave', 'Largo', 'Adagio', 'Andante', 'Moderato',
      'Allegro', 'Vivace', 'Presto', 'Prestissimo']) {
      const bpm = bpmForMarking(marking);
      expect(bpm).not.toBeNull();
      expect(bpm!).toBeGreaterThanOrEqual(20);
      expect(bpm!).toBeLessThanOrEqual(208);
    }
  });

  it('keeps the terms in tempo order, which is the only check on the numbers', () => {
    const order = ['Grave', 'Largo', 'Adagio', 'Andante', 'Moderato',
      'Allegro', 'Vivace', 'Presto', 'Prestissimo'];
    const bpms = order.map((m) => bpmForMarking(m)!);

    expect(bpms).toEqual([...bpms].sort((a, b) => a - b));
  });
});
