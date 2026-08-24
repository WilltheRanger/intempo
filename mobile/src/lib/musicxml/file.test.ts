import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { MusicXMLFileError, composerIn, partsIn, readMusicXML, titleIn } from './file';

/**
 * Reading a file a musician picked.
 *
 * This is the import path CLAUDE.md calls "the one whose timeline cannot be
 * wrong" — the durations are *stated* in the file rather than read off a
 * photograph. It had no tests at all, which is a strange place for the
 * trustworthy route to be.
 *
 * Everything here is about getting from bytes on a phone to the MusicXML text
 * the backend parses. The backend is the only thing that turns that into a
 * score; nothing in this file decides what a note is.
 */

const SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Suite No. 1</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Violoncello</part-name></score-part>
  </part-list>
</score-partwise>`;

function mxl(entries: Record<string, string>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(entries)) {
    files[name] = strToU8(text);
  }
  return zipSync(files);
}

const CONTAINER = (path: string) =>
  `<container><rootfiles><rootfile full-path="${path}"/></rootfiles></container>`;

describe('readMusicXML', () => {
  it('passes plain XML straight through', () => {
    expect(readMusicXML(strToU8(SCORE))).toBe(SCORE);
  });

  it('drops a byte-order mark, which Finale on Windows writes', () => {
    // A BOM ahead of `<?xml` makes the declaration unparseable to a strict
    // reader, and the backend is a strict reader.
    const withBom = readMusicXML(strToU8('﻿' + SCORE));

    expect(withBom.startsWith('<?xml')).toBe(true);
  });

  it('reads the container rather than guessing at the entry', () => {
    // The zip holds a *decoy*: another XML outside META-INF, added first, that
    // the fallback would pick. Without it this test passes whether the
    // container is consulted or not — which is how it was first written, and a
    // mutation removing the container lookup entirely stayed green.
    const bytes = mxl({
      mimetype: 'application/vnd.recordare.musicxml',
      'appearance.xml': '<appearance><line-width/></appearance>',
      'META-INF/container.xml': CONTAINER('Suite.musicxml'),
      'Suite.musicxml': SCORE,
    });

    expect(readMusicXML(bytes)).toBe(SCORE);
  });

  it('falls back when the container names something the zip does not hold', () => {
    const bytes = mxl({
      'META-INF/container.xml': CONTAINER('missing.xml'),
      'score.xml': SCORE,
    });

    expect(readMusicXML(bytes)).toBe(SCORE);
  });

  it('ignores the junk a Mac adds to a zip', () => {
    const bytes = mxl({
      '__MACOSX/._score.xml': '<not-a-score/>',
      'score.xml': SCORE,
    });

    expect(readMusicXML(bytes)).toBe(SCORE);
  });

  it('sniffs the bytes rather than trusting the extension', () => {
    // A file saved as `.musicxml` by a program that writes `.mxl` is still a
    // zip, and the extension is the one part of a file anybody can rename.
    const bytes = mxl({ 'score.xml': SCORE });

    expect(readMusicXML(bytes)).toBe(SCORE);
  });

  it('says something a musician can act on when the zip holds no score', () => {
    const bytes = mxl({ 'readme.txt': 'not a score' });

    expect(() => readMusicXML(bytes)).toThrow(MusicXMLFileError);
    expect(() => readMusicXML(bytes)).toThrow(/score/i);
  });
});

describe('partsIn', () => {
  it('lists every part with its id and name', () => {
    const xml = `<part-list>
      <score-part id="P1"><part-name>Violin I</part-name></score-part>
      <score-part id="P2"><part-name>Violoncello</part-name></score-part>
    </part-list>`;

    expect(partsIn(xml)).toEqual([
      { id: 'P1', name: 'Violin I' },
      { id: 'P2', name: 'Violoncello' },
    ]);
  });

  it('falls back to the id when a part is unnamed', () => {
    const xml = `<part-list><score-part id="P7"></score-part></part-list>`;

    expect(partsIn(xml)).toEqual([{ id: 'P7', name: 'P7' }]);
  });

  it('returns nothing for a file with no part list', () => {
    expect(partsIn('<score-partwise/>')).toEqual([]);
  });

  it('decodes the entities the format requires', () => {
    // `&` is not optional in XML — any part name containing one arrives
    // encoded, and "Violin I &amp; II" is what the musician would be asked to
    // choose between.
    const xml = `<part-list>
      <score-part id="P1"><part-name>Violin I &amp; II</part-name></score-part>
      <score-part id="P2"><part-name>Tromb&#243;n</part-name></score-part>
    </part-list>`;

    expect(partsIn(xml).map((p) => p.name)).toEqual(['Violin I & II', 'Trombón']);
  });
});

describe('titleIn', () => {
  it('prefers the work title', () => {
    const xml = `<work><work-title>Suite No. 1</work-title></work>
      <movement-title>Prélude</movement-title>`;

    expect(titleIn(xml)).toBe('Suite No. 1');
  });

  it('uses the movement title when there is no work title', () => {
    expect(titleIn('<movement-title>Allemande</movement-title>')).toBe('Allemande');
  });

  it('uses the movement title when the work title is empty', () => {
    // Exporters write `<work><work-title></work-title></work>` for a piece
    // whose work title was never filled in. Preferring the *element* over the
    // *text* loses the only title the file has.
    const xml = `<work><work-title></work-title></work>
      <movement-title>Allemande</movement-title>`;

    expect(titleIn(xml)).toBe('Allemande');
  });

  it('is null when the file names nothing', () => {
    expect(titleIn('<score-partwise/>')).toBeNull();
  });

  it('decodes entities', () => {
    const xml = '<work><work-title>Rondo &amp; Variations</work-title></work>';

    expect(titleIn(xml)).toBe('Rondo & Variations');
  });
});

describe('composerIn', () => {
  it('picks the composer, not the other creators', () => {
    const xml = `<identification>
      <creator type="lyricist">Wilhelm Müller</creator>
      <creator type="composer">Franz Schubert</creator>
    </identification>`;

    expect(composerIn(xml)).toBe('Franz Schubert');
  });

  it('is null when nobody is credited', () => {
    expect(composerIn('<identification/>')).toBeNull();
  });

  it('decodes entities', () => {
    const xml = '<creator type="composer">Camille Saint-Sa&#235;ns</creator>';

    expect(composerIn(xml)).toBe('Camille Saint-Saëns');
  });
});

describe('entity decoding, at the edges', () => {
  it('decodes in one pass, so a correctly escaped entity survives', () => {
    // `&amp;lt;` is how a file writes the literal text "&lt;". Replacing
    // `&amp;` and then `&lt;` in sequence turns it into `<` — the file said
    // one thing and the screen shows another.
    const xml = '<work><work-title>A &amp;lt; B</work-title></work>';

    expect(titleIn(xml)).toBe('A &lt; B');
  });

  it('leaves an entity it cannot make sense of exactly as written', () => {
    // Not worth throwing over, and showing it raw at least says what the file
    // contained. `&#0;` and a code point past Unicode are both refused.
    const xml = '<work><work-title>X &#0; &#9999999; &nosuchthing; Y</work-title></work>';

    expect(titleIn(xml)).toBe('X &#0; &#9999999; &nosuchthing; Y');
  });

  it('handles hex entities, which Sibelius writes', () => {
    const xml = '<work><work-title>Dvo&#x159;&#xe1;k</work-title></work>';

    expect(titleIn(xml)).toBe('Dvořák');
  });

  it('strips tags before decoding, not after', () => {
    // Decoding first could introduce a `<` that the tag strip then eats,
    // taking the rest of the title with it.
    const xml = '<work><work-title>Trio <b>No. 2</b> &amp;lt;draft&amp;gt;</work-title></work>';

    expect(titleIn(xml)).toBe('Trio No. 2 &lt;draft&gt;');
  });
});
