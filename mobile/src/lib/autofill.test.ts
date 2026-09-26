import { describe, expect, it } from 'vitest';

import { acceptsCompletion, completeComposer, completeTitle, prefixEnd } from './autofill';
import { canonical } from './composers';
import { REPERTOIRE } from './repertoire';

/**
 * The grey text after what is typed into a title or composer field — the
 * owner's "recommendation in the typing bar kind of like Google Docs"
 * (2026-09-26).
 */

describe('matching the start of a name', () => {
  it('ignores case and accents, and answers in the name’s own letters', () => {
    expect(prefixEnd('Dvořák', 'dvor')).toBe(4);
    expect('Dvořák'.slice(prefixEnd('Dvořák', 'dvor'))).toBe('ák');
    expect(prefixEnd('Études spéciales', 'etu')).toBe(3);
  });

  it('matches only from the start', () => {
    expect(prefixEnd('Ludwig van Beethoven', 'van')).toBe(-1);
    expect(prefixEnd('Bach', 'x')).toBe(-1);
    expect(prefixEnd('Bach', '')).toBe(-1);
  });
});

describe('the composer offered', () => {
  it('offers something from one letter', () => {
    // "When you type a letter it gives you a recommendation."
    expect(completeComposer('B')).toEqual({ rest: 'ach', value: 'J. S. Bach' });
  });

  it('completes the surname, and accepting gives the full name', () => {
    expect(completeComposer('Bee')).toEqual({
      rest: 'thoven',
      value: 'Ludwig van Beethoven',
    });
    expect(completeComposer('mo')).toEqual({ rest: 'zart', value: 'W. A. Mozart' });
  });

  it('reaches a composer by the name as written, when no surname starts that way', () => {
    expect(completeComposer('Lud')).toEqual({
      rest: 'wig van Beethoven',
      value: 'Ludwig van Beethoven',
    });
  });

  it('reaches an accented name from a phone keyboard', () => {
    expect(completeComposer('dvo')).toEqual({ rest: 'řák', value: 'Antonín Dvořák' });
  });

  it('offers nothing once the name is complete, or for someone it does not know', () => {
    expect(completeComposer('Bach')).toBeNull();
    expect(completeComposer('Brahms')).toBeNull();
    expect(completeComposer('Zzyzx')).toBeNull();
    expect(completeComposer('')).toBeNull();
    expect(completeComposer('   ')).toBeNull();
  });
});

describe('the title offered', () => {
  it('offers the built-in repertoire, with its composer', () => {
    expect(completeTitle('Cello Su', [])).toEqual({
      rest: 'ite No. 1 in G major, BWV 1007',
      value: 'Cello Suite No. 1 in G major, BWV 1007',
      composer: 'J. S. Bach',
    });
  });

  it('keeps what was typed and draws only the rest', () => {
    const offered = completeTitle('cello su', []);
    expect(offered?.rest).toBe('ite No. 1 in G major, BWV 1007');
    // Accepting writes the title as it is written.
    expect(offered?.value).toBe('Cello Suite No. 1 in G major, BWV 1007');
  });

  it('puts the musician’s own library first', () => {
    const library = [{ title: 'Cello Suite arr. for bass', composer: null }];
    expect(completeTitle('Cello Su', library)?.value).toBe('Cello Suite arr. for bass');
  });

  it('puts the composer already chosen ahead of the rest', () => {
    expect(completeTitle('Double Bass Con', [])?.composer).toBe('Domenico Dragonetti');
    expect(completeTitle('Double Bass Con', [], 'Bottesini')?.value).toBe(
      'Double Bass Concerto No. 2 in B minor',
    );
  });

  it('offers nothing when the title is already one it knows', () => {
    // A Return that then appended ", Op. 70" would change what was written.
    const library = [{ title: 'Elijah', composer: 'Felix Mendelssohn' }];
    expect(completeTitle('Elijah', library)).toBeNull();
    expect(completeTitle('elijah, op. 70', [])).toBeNull();
    expect(completeTitle('Eli', library)?.value).toBe('Elijah');
  });

  it('offers nothing for an empty field or a title it has never seen', () => {
    expect(completeTitle('', [])).toBeNull();
    expect(completeTitle('Qwxz', [])).toBeNull();
  });

  it('has no composer for a traditional tune', () => {
    expect(completeTitle('Lightly', [])).toEqual({
      rest: ' Row',
      value: 'Lightly Row',
      composer: null,
    });
  });
});

describe('the built-in repertoire', () => {
  it('spells every catalogued composer exactly as the catalogue does', () => {
    // Accepting a title fills the composer field, and the library groups and
    // draws covers by that spelling.
    for (const work of REPERTOIRE) {
      const known = canonical(work.composer);
      if (known) expect(work.composer).toBe(known.name);
    }
  });

  it('lists each work once', () => {
    const keys = REPERTOIRE.map((work) => `${work.title}|${work.composer}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has no title with stray spaces, which would break the match', () => {
    for (const work of REPERTOIRE) {
      expect(work.title).toBe(work.title.trim());
      expect(work.title).not.toMatch(/\s{2}/);
    }
  });
});

describe('the keys that accept a suggestion', () => {
  it('is Tab, and → at the end of the text', () => {
    expect(acceptsCompletion('Tab', false)).toBe(true);
    expect(acceptsCompletion('ArrowRight', true)).toBe(true);
  });

  it('leaves → alone in the middle of the text, where it moves the cursor', () => {
    expect(acceptsCompletion('ArrowRight', false)).toBe(false);
  });

  it('is not any other key: typing carries on', () => {
    expect(acceptsCompletion('a', true)).toBe(false);
    expect(acceptsCompletion('Enter', true)).toBe(false);
    expect(acceptsCompletion('Backspace', true)).toBe(false);
  });
});
