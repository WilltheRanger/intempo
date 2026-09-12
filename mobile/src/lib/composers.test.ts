import { describe, expect, it } from 'vitest';

import { canonical, COMPOSERS, normalise, searchComposers } from './composers';

describe('normalise', () => {
  it('makes the punctuated ways of writing Bach one string', () => {
    // A library that groups by composer shows four rows otherwise, with four
    // different covers, for one person.
    //
    // "JS Bach" is deliberately not in this list: run together there is no
    // separator for the normaliser to find, so it is one word and stays one
    // word. That is what the alias list is for, and the test below is where it
    // has to hold.
    const forms = ['J.S. Bach', 'j s bach', 'J. S.  Bach', 'J . S . Bach'];
    expect(new Set(forms.map(normalise)).size).toBe(1);
  });

  it('reaches the same composer from all four, which is what matters', () => {
    for (const form of ['J.S. Bach', 'JS Bach', 'j s bach', 'Johann Sebastian Bach']) {
      expect(canonical(form)?.surname).toBe('Bach');
    }
  });

  it('strips diacritics, because a phone keyboard does not have them', () => {
    // Someone typing "Dvorak" means Dvořák. Making them find the háček is the
    // app being pedantic about the one thing it could have handled.
    expect(normalise('Dvorak')).toBe(normalise('Dvořák'));
    expect(normalise('Faure')).toBe(normalise('Fauré'));
    expect(normalise('Saint-Saens')).toBe(normalise('Saint-Saëns'));
  });
});

describe('canonical', () => {
  it('finds a composer by name, surname or alias', () => {
    expect(canonical('J. S. Bach')?.surname).toBe('Bach');
    expect(canonical('bach')?.surname).toBe('Bach');
    expect(canonical('Johann Sebastian Bach')?.surname).toBe('Bach');
    expect(canonical('WA Mozart')?.surname).toBe('Mozart');
  });

  it('matches exactly, and never by prefix', () => {
    // **The rule that keeps this a convenience rather than a correction.** A
    // prefix match would decide "Bar" is Bartók while it is still being typed,
    // and rewrite a living composer's name into a dead one's.
    expect(canonical('Bee')).toBeNull();
    expect(canonical('Bachmann')).toBeNull();
  });

  it('is null for a name it does not know, which is not an error', () => {
    // A musician working on a living composer, a teacher's own exercises, or
    // an edition's own spelling is not wrong. The field takes anything.
    expect(canonical('Anna Clyne')).toBeNull();
    expect(canonical('')).toBeNull();
    expect(canonical(null)).toBeNull();
  });
});

describe('searchComposers', () => {
  it('puts a surname match first', () => {
    // "bee" should reach Beethoven before anyone whose forename starts that
    // way: a musician thinks in surnames, and so does the spine of the book.
    expect(searchComposers('bee')[0].surname).toBe('Beethoven');
    expect(searchComposers('kreu')[0].surname).toBe('Kreutzer');
  });

  it('still finds someone by their forename or an alias', () => {
    expect(searchComposers('wolfgang').map((c) => c.surname)).toContain('Mozart');
    expect(searchComposers('shostakovitch').map((c) => c.surname)).toContain('Shostakovich');
  });

  it('browses when nothing has been typed', () => {
    // Opening the picker with an empty field is browsing, and a browser needs
    // something to browse.
    expect(searchComposers('').length).toBeGreaterThan(0);
  });

  it('finds an accented name from an unaccented query', () => {
    expect(searchComposers('sevcik')[0].surname).toBe('Ševčík');
    expect(searchComposers('dvorak')[0].surname).toBe('Dvořák');
  });

  it('returns nothing for a name it does not have', () => {
    expect(searchComposers('zzzz')).toEqual([]);
  });
});

describe('the list itself', () => {
  it('has no two composers answering to the same string', () => {
    // Two rows matching one query is a picker that offers the same person
    // twice, or worse, silently picks whichever came first.
    const seen = new Map<string, string>();
    for (const composer of COMPOSERS) {
      for (const key of [composer.name, composer.surname, ...composer.aliases]) {
        const norm = normalise(key);
        expect(seen.has(norm), `${norm} claimed by ${seen.get(norm)} and ${composer.name}`)
          .toBe(false);
        seen.set(norm, composer.name);
      }
    }
  });

  it('gives everyone dates, which is what separates two of the same name', () => {
    for (const composer of COMPOSERS) {
      expect(composer.dates).toMatch(/^\d{4}–\d{4}$/);
    }
  });

  it('canonicalises its own names, which is the round trip that matters', () => {
    for (const composer of COMPOSERS) {
      expect(canonical(composer.name)).toBe(composer);
    }
  });
});
