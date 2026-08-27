/**
 * A file the musician picked is the only truly arbitrary input this app takes.
 *
 * A photograph comes from the camera and a recording from the microphone; a
 * `.mxl` comes from anywhere, and `readMusicXML` unzips it before anything has
 * looked at it. `ImportFile` catches `MusicXMLFileError` and shows its message;
 * anything else reaches the screen's generic `catch` and becomes "Couldn't read
 * that file", which is true and says nothing.
 *
 * So the contract is the same one the backend importer keeps: **every input
 * either yields text or throws `MusicXMLFileError`.** These are the inputs
 * written to break it. None of them did, which is the result worth recording —
 * the table is kept so that stays true rather than being assumed again.
 */
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  MusicXMLFileError,
  composerIn,
  partsIn,
  readMusicXML,
  titleIn,
} from './file';

const bytes = (text: string) => new TextEncoder().encode(text);

const HOSTILE: Record<string, Uint8Array> = {
  'nothing at all': new Uint8Array(),
  'one byte of a zip header': new Uint8Array([0x50]),
  'zip magic and then nothing': new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
  'zip magic and then noise': new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, ...new Array(500).fill(7),
  ]),
  'a zip holding only its packaging': zipSync({
    'META-INF/container.xml': bytes('<x/>'),
  }),
  // The container names a file the zip does not hold. The fallback — first XML
  // that is not packaging — is what keeps this readable.
  'a container pointing at nothing': zipSync({
    'META-INF/container.xml': bytes(
      '<container><rootfiles><rootfile full-path="gone.xml"/></rootfiles></container>',
    ),
    'score.xml': bytes('<score-partwise/>'),
  }),
  // Nothing here touches a filesystem — the path is a key in a map — but a
  // traversal in a container is worth pinning as harmless rather than assumed.
  'a container pointing outside the zip': zipSync({
    'META-INF/container.xml': bytes('<rootfile full-path="../../../etc/passwd"/>'),
    'score.xml': bytes('<score-partwise/>'),
  }),
  'a zip of nothing but macOS resource forks': zipSync({
    '__MACOSX/score.xml': bytes('<x/>'),
  }),
  'a zip whose only entry is a directory': zipSync({ 'score.xml/': new Uint8Array() }),
  'bytes that are not valid UTF-8': new Uint8Array([0xff, 0xfe, 0x00, 0x41]),
  'a real score with a byte-order mark': bytes('﻿<score-partwise/>'),
};

describe('readMusicXML on a file nobody here wrote', () => {
  it.each(Object.keys(HOSTILE))('yields text or refuses: %s', (label) => {
    try {
      const out = readMusicXML(HOSTILE[label]);
      expect(typeof out).toBe('string');
    } catch (error) {
      expect(error).toBeInstanceOf(MusicXMLFileError);
    }
  });
});

/**
 * The readers below run on the *decompressed* text, which can be megabytes,
 * and all four are regexes. A regex that backtracks catastrophically is a
 * frozen screen on the phone rather than an exception, so these are timed
 * rather than merely called.
 *
 * Measured when written: the worst of them is 100,000 `<score-part>` entries
 * at ~90ms, and a 200KB tag with no `id` in it at ~1ms.
 */
const BUDGET_MS = 2000;

function within(budget: number, run: () => unknown): void {
  const started = Date.now();
  run();
  expect(Date.now() - started).toBeLessThan(budget);
}

describe('the readers cannot be made to hang', () => {
  it('a part-list that never closes', () => {
    within(BUDGET_MS, () => partsIn('<part-list><score-part id="P1">'));
  });

  it('a hundred thousand parts', () => {
    const list =
      '<part-list>' +
      '<score-part id="P1"><part-name>a</part-name></score-part>'.repeat(100_000) +
      '</part-list>';
    within(BUDGET_MS, () => expect(partsIn(list)).toHaveLength(100_000));
  });

  it('a two-hundred-kilobyte tag with no id in it', () => {
    // `[^>]*\bid\s*=` is the shape that backtracks if the engine is naive:
    // every split point of the first `[^>]*` has to be tried before failing.
    const tag = '<part-list><score-part ' + 'a'.repeat(200_000) + '></part-list>';
    within(BUDGET_MS, () => expect(partsIn(tag)).toEqual([]));
  });

  it('two hundred thousand entities in one part name', () => {
    const list =
      '<part-list><score-part id="P1"><part-name>' +
      '&amp;'.repeat(200_000) +
      '</part-name></score-part></part-list>';
    within(BUDGET_MS, () => expect(partsIn(list)[0].name).toHaveLength(200_000));
  });

  it('a title and a composer that never close', () => {
    within(BUDGET_MS, () => expect(titleIn('<work-title>' + 'x'.repeat(1_000_000))).toBeNull());
    within(BUDGET_MS, () =>
      expect(composerIn('<creator type="composer">' + 'x'.repeat(1_000_000))).toBeNull(),
    );
  });
});
