/**
 * A piece's title set as a heading: the name, broken where a musician would
 * break it, and the catalogue number on a small line of its own.
 *
 * **Why this exists** (the owner, 2026-09-29, on "excessive wordiness and
 * squishing"): at heading size "Sonata No. 1 in G minor, BWV 1001" broke as
 * "Sonata No. 1 in G / minor, BWV 1001" — through the middle of the key — and
 * "Concerto in A minor, Op. 3 No. / 6" left a number alone on a line. The
 * catalogue number is how a piece is looked up, not how it is read, so it
 * goes under the name; and a name too long for one line breaks before its key
 * ("Sonata No. 1 / in G minor") rather than wherever the width runs out.
 *
 * A rules module rather than a component: there is no React Native testing
 * library here (`DECISIONS.md`, 2026-08-24), and "where does this title
 * break" is exactly the kind of rule nothing would check inside a `.tsx`.
 */

export interface TitleParts {
  /** "Sonata No. 1 in G minor". */
  name: string;
  /** "BWV 1001", "Op. 3 No. 6", or null for a title without one. */
  catalogue: string | null;
}

/**
 * The catalogues this app's repertoire uses (`repertoire.ts`), and the usual
 * others: Op., BWV, K./KV, RV, D., Hob., HWV, WoO, TWV, G. (Boccherini),
 * S. (Liszt), Sz. (Bartók), L. (Debussy).
 */
const CATALOGUE =
  /,\s*((?:Op\.|BWV|KV?\.?|RV|D\.|Hob\.|HWV|WoO|TWV|G\.|S\.|Sz\.|L\.)\s*[\w.:/-]+(?:\s*(?:No\.|Nr\.)\s*\d+\w*)?)\s*$/;

/** " in G minor", " in E-flat major", " in B♭": where a name breaks. */
const KEY = /\s(in\s+[A-G](?:[-\s]?(?:flat|sharp)|[♭♯#b])?(?:\s+(?:major|minor))?)(?=$|[\s,:])/;

/** Split a title into its name and catalogue number. */
export function splitTitle(title: string): TitleParts {
  const trimmed = title.trim();
  const match = CATALOGUE.exec(trimmed);
  if (!match || match.index === 0) {
    return { name: trimmed, catalogue: null };
  }
  return { name: trimmed.slice(0, match.index).trim(), catalogue: match[1].trim() };
}

/**
 * An estimate of how many characters of the serif fit a line: its average
 * glyph is a little under half an em. Deliberately a little generous — a name
 * this calls too long only breaks at its key, which is a good place anyway.
 */
export function charsPerLine(width: number, fontSize: number): number {
  return Math.floor(width / (fontSize * 0.46));
}

/**
 * The name as the lines to set it on: one line when it fits, otherwise broken
 * before its key when both halves then fit; otherwise one line, left to wrap
 * where the width takes it.
 */
export function nameLines(name: string, perLine: number): string[] {
  if (name.length <= perLine) return [name];
  const key = KEY.exec(name);
  if (!key || key.index === 0) return [name];
  const before = name.slice(0, key.index).trim();
  const after = name.slice(key.index).trim();
  return before.length <= perLine && after.length <= perLine ? [before, after] : [name];
}
