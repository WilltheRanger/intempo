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
  MAX_UNZIPPED_BYTES,
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

/**
 * A zip is small until you open it.
 *
 * `unzipSync` decompresses every entry into memory, and `ImportFile`'s size
 * check runs on the text that comes out — the wrong side of the allocation.
 */
describe('a file that unpacks to far more than a score', () => {
  const twentyFiveMB = new Uint8Array(25_000_000).fill(0x78); // 'x'

  it('compresses about a thousand to one, which is the whole problem', () => {
    const zipped = zipSync({ 'p.xml': twentyFiveMB }, { level: 9 });
    // Measured when written: 25MB → ~25KB. A 10MB file — an unremarkable thing
    // to be sent — therefore expands to something around ten gigabytes.
    expect(twentyFiveMB.length / zipped.length).toBeGreaterThan(500);
  });

  it('is refused without being decompressed', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 8; i += 1) {
      files[`p${i}.xml`] = twentyFiveMB;
    }
    const bomb = zipSync(files, { level: 9 });
    expect(bomb.length).toBeLessThan(1_000_000);

    const started = Date.now();
    const grew = grownBy(() => expect(() => readMusicXML(bomb)).toThrow(MusicXMLFileError));
    expect(Date.now() - started).toBeLessThan(BUDGET_MS);
    // **The refusal is not the point; not allocating is.** Both guards reach
    // the same verdict, so asserting only that it throws cannot tell "refused
    // before decompressing" from "decompressed and then refused" — and a
    // mutation removing the filter survived exactly that test. Measured:
    // extracting these 200MB grows resident memory by ~197MB, and refusing
    // them grows it by nothing.
    expect(grew).toBeLessThan(64 * 1024 * 1024);
  });

  it('counts the entries together, not one at a time', () => {
    // Each well under the limit; the eight of them are over it. A bomb is as
    // easily built this way, and a per-entry check would wave it through — and
    // would still *refuse* it further down, having already paid for it, which
    // is why this measures the memory too.
    const eighth = new Uint8Array(MAX_UNZIPPED_BYTES / 4).fill(0x78);
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 8; i += 1) {
      files[`p${i}.xml`] = eighth;
    }
    const zipped = zipSync(files, { level: 9 });
    const grew = grownBy(() =>
      expect(() => readMusicXML(zipped)).toThrow(MusicXMLFileError),
    );
    expect(grew).toBeLessThan(64 * 1024 * 1024);
  });

  it('still reads a score that is merely large', () => {
    const big = '<score-partwise>' + '<!--' + 'x'.repeat(4_000_000) + '-->' + '</score-partwise>';
    const out = readMusicXML(zipSync({ 'score.xml': new TextEncoder().encode(big) }, { level: 9 }));
    expect(out).toHaveLength(big.length);
  });

  it('a header that understates itself truncates rather than smuggling', () => {
    // The central directory's uncompressed-size field is what `fflate` reads
    // and what it allocates to. Patching it to 0 does not slip a large entry
    // past the filter — it produces an empty one, which the "isn't a MusicXML
    // score" check downstream refuses.
    const zipped = zipSync(
      { 'score.xml': new TextEncoder().encode('<score-partwise>' + 'x'.repeat(200_000) + '</score-partwise>') },
      { level: 9 },
    );
    const at = indexOfSignature(zipped, [0x50, 0x4b, 0x01, 0x02]);
    expect(at).toBeGreaterThan(0);
    new DataView(zipped.buffer, zipped.byteOffset).setUint32(at + 24, 0, true);
    expect(readMusicXML(zipped)).toBe('');
  });
});

/**
 * How much resident memory a call left behind.
 *
 * The only observable that separates a guard which refuses early from one that
 * refuses late. Heap size does not work: `fflate` returns typed arrays, which
 * live outside the JS heap and read as ~0 there.
 */
function grownBy(run: () => void): number {
  const before = process.memoryUsage().rss;
  run();
  return process.memoryUsage().rss - before;
}

function indexOfSignature(bytes: Uint8Array, signature: number[]): number {
  for (let i = 0; i <= bytes.length - signature.length; i += 1) {
    if (signature.every((byte, k) => bytes[i + k] === byte)) {
      return i;
    }
  }
  return -1;
}
