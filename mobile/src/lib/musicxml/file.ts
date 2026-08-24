import { unzipSync } from 'fflate';

/**
 * Turning a file the musician picked into the MusicXML the backend expects.
 *
 * `POST /v1/scores/import` takes uncompressed XML and says so: "`.mxl` is a zip
 * and unpacking one is the client's job, since it already has the file open."
 * That job is here.
 *
 * It matters more than it sounds. MuseScore, Sibelius and Finale all export
 * `.mxl` by default — the compressed form is what a musician actually has in
 * their files — so a picker that only accepted raw `.musicxml` would reject
 * most real scores on the first try.
 */

/** A zip's local file header. `.mxl` is a zip; `.musicxml` is text. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/**
 * Where a `.mxl` keeps the score.
 *
 * The container is part of the format: `META-INF/container.xml` names the real
 * document in a `<rootfile full-path="...">`. Reading it rather than guessing
 * matters for files that carry more than one root, and for the ones that name
 * the score something other than `score.xml`.
 */
const CONTAINER = 'META-INF/container.xml';

export class MusicXMLFileError extends Error {}

function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= ZIP_MAGIC.length &&
    ZIP_MAGIC.every((byte, i) => bytes[i] === byte)
  );
}

/**
 * Decode as UTF-8, dropping a byte-order mark if one is there.
 *
 * A BOM ahead of `<?xml` makes the declaration unparseable to a strict reader,
 * and Finale on Windows writes them.
 */
function decode(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The five XML names every document may use without declaring them. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Turn an XML text fragment into the string a musician should read.
 *
 * Tags out, entities in, trimmed. All three matter and the middle one was
 * missing: titles, composers and part names went to the screen exactly as the
 * file spelled them, so a piece called "Rondo &amp; Variations" was listed
 * under that name, and a part called `Tromb&#243;n` was offered as `Tromb&#243;n`.
 *
 * `&` is not optional in XML — a name containing one *must* arrive encoded —
 * so this is required by the format rather than a nicety for accented
 * languages, though it fixes those too.
 *
 * One pass over the original, not a chain of replacements. Decoding `&amp;`
 * first and `&lt;` second turns the correctly-escaped `&amp;lt;` into `<`;
 * a single scan leaves it as the `&lt;` the file meant.
 */
function plainText(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
      if (body[0] !== '#') {
        return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
      }
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // Leave anything outside Unicode as it was written. A malformed entity
      // is not worth throwing over, and showing it raw at least says what the
      // file contained.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
        return whole;
      }
      return String.fromCodePoint(code);
    })
    .trim();
}

function scoreEntryName(files: Record<string, Uint8Array>): string {
  const container = files[CONTAINER];
  if (container) {
    const path = /full-path\s*=\s*["']([^"']+)["']/.exec(decode(container));
    if (path && files[path[1]]) {
      return path[1];
    }
  }

  // No container, or one pointing at something the zip does not hold. Fall back
  // to the first XML that is not the packaging — which is what the format's own
  // convention amounts to.
  const candidate = Object.keys(files).find(
    (name) =>
      !name.startsWith('META-INF/') &&
      !name.startsWith('__MACOSX/') &&
      /\.(musicxml|xml)$/i.test(name),
  );
  if (!candidate) {
    throw new MusicXMLFileError(
      "That file is a zip, but there's no score inside it.",
    );
  }
  return candidate;
}

/** The MusicXML text inside a picked file, compressed or not. */
export function readMusicXML(bytes: Uint8Array): string {
  if (!looksLikeZip(bytes)) {
    // Sniffed, not taken from the extension. A file saved as `.musicxml` from a
    // program that writes `.mxl` is still a zip, and the extension is the one
    // part of a file anybody can rename.
    return decode(bytes);
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new MusicXMLFileError("That file is compressed and won't open.");
  }
  return decode(files[scoreEntryName(files)]);
}

export interface MusicXMLPart {
  /** `P1`. What the backend matches on first. */
  id: string;
  /** "Violoncello", or the id again when the file names no part. */
  name: string;
}

/**
 * The parts a file holds, for offering a choice.
 *
 * **Advisory, not authoritative.** The backend parses the file again and its
 * answer is the one that decides — this exists so a musician importing an
 * orchestral score sees the part list before uploading eight megabytes, rather
 * than after. If this list is somehow wrong, the name still goes to a backend
 * that matches on id and on substring, and a name it cannot find comes back as
 * a 422 naming what the file really has.
 *
 * A regex rather than an XML parser because that is all this needs: the shape
 * of `<part-list>` is fixed by the format, and pulling in a DOM parser to read
 * two attributes would be the heavier, not the safer, choice.
 */
export function partsIn(xml: string): MusicXMLPart[] {
  const list = /<part-list[\s>][\s\S]*?<\/part-list>/i.exec(xml);
  if (!list) {
    return [];
  }

  const parts: MusicXMLPart[] = [];
  const entry = /<score-part\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/score-part>/gi;
  let match = entry.exec(list[0]);
  while (match !== null) {
    const [, id, body] = match;
    const named = /<part-name\b[^>]*>([\s\S]*?)<\/part-name>/i.exec(body);
    const name = named ? plainText(named[1]) : '';
    parts.push({ id, name: name || id });
    match = entry.exec(list[0]);
  }
  return parts;
}

/**
 * The `<work-title>`, or the `<movement-title>` when there is no work title.
 *
 * "No work title" means **no title**, not no element. Exporters write
 * `<work><work-title></work-title></work>` for a piece whose work title was
 * never filled in, and preferring the element over the text threw away the
 * only name the file had — a movement called "Allemande" imported as
 * untitled.
 */
export function titleIn(xml: string): string | null {
  const work = /<work-title\b[^>]*>([\s\S]*?)<\/work-title>/i.exec(xml);
  const movement = /<movement-title\b[^>]*>([\s\S]*?)<\/movement-title>/i.exec(xml);
  for (const match of [work, movement]) {
    const text = match ? plainText(match[1]) : '';
    if (text) {
      return text;
    }
  }
  return null;
}

/** The `<creator type="composer">`, which is where every exporter puts it. */
export function composerIn(xml: string): string | null {
  const match = /<creator\b[^>]*type\s*=\s*["']composer["'][^>]*>([\s\S]*?)<\/creator>/i.exec(xml);
  const text = match ? plainText(match[1]) : '';
  return text || null;
}
