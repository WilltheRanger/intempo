/**
 * The composers a musician at this app's level actually plays.
 *
 * **Why a list at all**, when the field is free text and always will be. Three
 * things it buys, in the order they matter:
 *
 *  1. **A picture.** The owner asked for it: *"some composers are tied to a
 *     picture of them selves such as beethoven, so thats the cover."* A piece
 *     entered by hand has no photograph of a page, and the Library then shows
 *     it as ruled staff lines — honest, and indistinguishable from every other
 *     piece entered by hand.
 *  2. **One spelling.** "J.S. Bach", "JS Bach", "Johann Sebastian Bach" and
 *     "bach" are four rows in a library that groups by composer and four
 *     different covers. Typing any of them should land on the same person.
 *  3. **Fewer keystrokes**, on a phone, for a name with an umlaut in it.
 *
 * **It is a suggestion, never a constraint.** Anything typed is kept exactly as
 * typed: a musician working on a living composer, a teacher's own exercises, or
 * a name spelled the way their edition spells it is not wrong, and a picker
 * that refuses it would be. `canonical` only ever fires on an exact match
 * against a known name or alias.
 */

export interface Composer {
  /** How the app writes the name. Surname-first is for sorting, not display. */
  name: string;
  /** For searching and for the letter shown when there is no portrait. */
  surname: string;
  /** Birth–death, shown under the name in the picker so two Bachs separate. */
  dates: string;
  /**
   * Spellings that mean this person, beyond what `normalise` already handles.
   *
   * **Most of what looks like it needs an alias does not.** `normalise` strips
   * diacritics and punctuation, so "Dvorak" already reaches Dvořák and
   * "Saint-Saens" already reaches Saint-Saëns — fifteen entries here were
   * exactly that, restating what the normaliser does and hiding the fact that
   * it does it. What is left is genuinely different: a run-together initial
   * ("JS Bach", where the normaliser sees one word), a different transliteration
   * ("Shostakovitch"), an outright variant spelling ("Haendel").
   *
   * The canonical name and surname are matched automatically and are never
   * repeated here; a test asserts no two keys collide, which is what caught
   * the fifteen.
   */
  aliases: string[];
}

/**
 * Strings compare after this: lower case, no punctuation, single spaces.
 *
 * So "J.S. Bach", "JS Bach" and "j s bach" are one string, and a musician who
 * types the initials the way their part prints them is not told they are
 * wrong.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    // Strip diacritics: someone typing "Dvorak" on a phone keyboard means
    // Dvořák, and making them find the háček would be the app being pedantic
    // about the one thing it could have handled.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The list. Standard string repertoire, roughly by how often it is practised.
 *
 * Deliberately not exhaustive — a thousand names is a worse picker than sixty,
 * and the field takes anything. Composers are here because a student or an
 * amateur is likely to be working on them.
 */
export const COMPOSERS: Composer[] = [
  { name: 'J. S. Bach', surname: 'Bach', dates: '1685–1750', aliases: ['johann sebastian bach', 'js bach', 'bach js'] },
  { name: 'Ludwig van Beethoven', surname: 'Beethoven', dates: '1770–1827', aliases: ['l van beethoven', 'van beethoven'] },
  { name: 'Johannes Brahms', surname: 'Brahms', dates: '1833–1897', aliases: [] },
  { name: 'Frédéric Chopin', surname: 'Chopin', dates: '1810–1849', aliases: [] },
  { name: 'Antonín Dvořák', surname: 'Dvořák', dates: '1841–1904', aliases: [] },
  { name: 'Edward Elgar', surname: 'Elgar', dates: '1857–1934', aliases: [] },
  { name: 'Gabriel Fauré', surname: 'Fauré', dates: '1845–1924', aliases: [] },
  { name: 'George Frideric Handel', surname: 'Handel', dates: '1685–1759', aliases: ['g f handel', 'georg friedrich handel', 'haendel'] },
  { name: 'Joseph Haydn', surname: 'Haydn', dates: '1732–1809', aliases: ['franz joseph haydn'] },
  { name: 'Felix Mendelssohn', surname: 'Mendelssohn', dates: '1809–1847', aliases: ['mendelssohn bartholdy'] },
  { name: 'W. A. Mozart', surname: 'Mozart', dates: '1756–1791', aliases: ['wolfgang amadeus mozart', 'wa mozart'] },
  { name: 'Niccolò Paganini', surname: 'Paganini', dates: '1782–1840', aliases: [] },
  { name: 'Sergei Prokofiev', surname: 'Prokofiev', dates: '1891–1953', aliases: ['prokofieff'] },
  { name: 'Camille Saint-Saëns', surname: 'Saint-Saëns', dates: '1835–1921', aliases: [] },
  { name: 'Franz Schubert', surname: 'Schubert', dates: '1797–1828', aliases: [] },
  { name: 'Robert Schumann', surname: 'Schumann', dates: '1810–1856', aliases: [] },
  { name: 'Dmitri Shostakovich', surname: 'Shostakovich', dates: '1906–1975', aliases: ['shostakovitch'] },
  { name: 'Jean Sibelius', surname: 'Sibelius', dates: '1865–1957', aliases: [] },
  { name: 'Pyotr Ilyich Tchaikovsky', surname: 'Tchaikovsky', dates: '1840–1893', aliases: ['tchaikowsky', 'chaikovsky', 'pi tchaikovsky'] },
  { name: 'Antonio Vivaldi', surname: 'Vivaldi', dates: '1678–1741', aliases: [] },

  // Étude and method writers — the pages actually on most stands.
  { name: 'Rodolphe Kreutzer', surname: 'Kreutzer', dates: '1766–1831', aliases: [] },
  { name: 'Franz Wohlfahrt', surname: 'Wohlfahrt', dates: '1833–1884', aliases: ['wohlfart'] },
  { name: 'Heinrich Ernst Kayser', surname: 'Kayser', dates: '1815–1888', aliases: ['h e kayser'] },
  { name: 'Jacques Féréol Mazas', surname: 'Mazas', dates: '1782–1849', aliases: [] },
  { name: 'Pierre Rode', surname: 'Rode', dates: '1774–1830', aliases: [] },
  { name: 'Jakob Dont', surname: 'Dont', dates: '1815–1888', aliases: [] },
  { name: 'Otakar Ševčík', surname: 'Ševčík', dates: '1852–1934', aliases: [] },
  { name: 'Carl Flesch', surname: 'Flesch', dates: '1873–1944', aliases: [] },
  { name: 'Friedrich Dotzauer', surname: 'Dotzauer', dates: '1783–1860', aliases: ['j j f dotzauer'] },
  { name: 'Sebastian Lee', surname: 'Lee', dates: '1805–1887', aliases: [] },
  { name: 'Franz Simandl', surname: 'Simandl', dates: '1840–1912', aliases: [] },
  { name: 'Édouard Nanny', surname: 'Nanny', dates: '1872–1942', aliases: [] },
  { name: 'Giovanni Bottesini', surname: 'Bottesini', dates: '1821–1889', aliases: [] },
  { name: 'Jules Massenet', surname: 'Massenet', dates: '1842–1912', aliases: [] },
  { name: 'Pablo de Sarasate', surname: 'Sarasate', dates: '1844–1908', aliases: [] },
  { name: 'Fritz Kreisler', surname: 'Kreisler', dates: '1875–1962', aliases: [] },
];

/** Every string that means this composer, normalised. */
function keysFor(composer: Composer): string[] {
  return [composer.name, composer.surname, ...composer.aliases].map(normalise);
}

/**
 * The composer a typed string names exactly, or null.
 *
 * **Exact match only.** A prefix match here would rewrite "Bar" into
 * "Barber" mid-keystroke, and a fuzzy one would decide that a living
 * composer's name was a misspelling of a dead one. Suggesting is
 * `searchComposers`; this is for deciding whether a *saved* name is a known
 * person — which cover to show, and how to group a library.
 */
export function canonical(name: string | null | undefined): Composer | null {
  if (!name) {
    return null;
  }
  const key = normalise(name);
  if (!key) {
    return null;
  }
  return COMPOSERS.find((c) => keysFor(c).includes(key)) ?? null;
}

/**
 * Composers to offer for what has been typed so far.
 *
 * Surname first, because that is how a musician thinks of them and how the
 * spine of the book is printed — a search for "bee" should reach Beethoven
 * before it reaches anyone whose *forename* starts that way. Within each group
 * the list keeps its own order, which is roughly how often the music is
 * played.
 *
 * An empty query returns the whole list rather than nothing: opening the picker
 * with no text is browsing, and a browser needs something to browse.
 */
export function searchComposers(query: string, limit = 8): Composer[] {
  const key = normalise(query);
  if (!key) {
    return COMPOSERS.slice(0, limit);
  }

  const surnameMatch: Composer[] = [];
  const anywhere: Composer[] = [];
  for (const composer of COMPOSERS) {
    if (normalise(composer.surname).startsWith(key)) {
      surnameMatch.push(composer);
    } else if (keysFor(composer).some((k) => k.includes(key))) {
      anywhere.push(composer);
    }
  }
  return [...surnameMatch, ...anywhere].slice(0, limit);
}
