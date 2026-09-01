/**
 * A printed tempo word, as a number of quarter notes per minute.
 *
 * **Why this is not `bpm_hint`.** `bpm_hint` is what the page *states* — a
 * metronome mark, `♩ = 96`, or a `<sound tempo>` in an imported file — and the
 * importer fills it only from those. A page headed "Allegro moderato" and
 * nothing else states no number, so `bpm_hint` is null and the practice tempo
 * fell back to 80: a moderately fast movement offered at a walking pace, on
 * every piece in the standard repertoire whose editor wrote a word instead of
 * a mark, which is most of them before about 1830.
 *
 * So this is a **convention, not a reading**, and it stays on this side of the
 * wire for that reason. It seeds a control the musician can move, and the
 * screen says which word it came from; nothing here is stored as though the
 * page said it.
 *
 * The numbers are the middle of the range each term is usually given. They are
 * not authoritative and could not be — Beethoven's Allegro is not Brahms's —
 * which is the argument for showing the word beside the number rather than the
 * number alone.
 */

/**
 * Terms in the order they are tried, **longest first**.
 *
 * Order is load-bearing: "allegretto" contains "allegro" nowhere, but
 * "allegro assai" contains "allegro", "molto allegro" contains "allegro", and
 * "andantino" contains "andante" nowhere while "andante moderato" contains
 * both "andante" and "moderato". A shortest-first scan reads "Allegro assai"
 * as a plain Allegro and "Andante moderato" as a Moderato — one slower than
 * the page asks and one faster.
 */
const TERMS: [string, number][] = [
  // Compounds, before the words they contain.
  ['allegro assai', 144],
  ['allegro molto', 144],
  ['molto allegro', 144],
  ['allegro vivace', 152],
  ['allegro moderato', 116],
  ['allegro ma non troppo', 120],
  ['andante moderato', 84],
  ['andante con moto', 84],
  ['piu mosso', 132],
  ['più mosso', 132],
  ['meno mosso', 76],
  ['tempo giusto', 100],
  ['alla breve', 120],

  // Single terms, slowest to fastest — order among these does not matter,
  // since none contains another.
  ['gravissimo', 36],
  ['larghissimo', 24],
  ['adagissimo', 42],
  ['prestissimo', 200],
  ['larghetto', 63],
  ['allegretto', 104],
  ['moderato', 108],
  ['andantino', 88],
  ['sostenuto', 72],
  ['vivacissimo', 172],
  ['maestoso', 76],
  ['marcia', 110],
  ['andante', 76],
  ['adagio', 66],
  ['allegro', 132],
  ['presto', 176],
  ['vivace', 160],
  ['lentement', 56],
  ['largo', 50],
  ['lento', 56],
  ['grave', 40],
  ['marche', 110],
];

/**
 * The tempo a marking conventionally means, or null.
 *
 * Null rather than a default, so the caller can tell "the page said a word I
 * know" from "the page said nothing usable" — those deserve different things
 * on screen, and collapsing them would print a made-up provenance under a
 * number that came from the fallback.
 *
 * Matched as a substring of the lower-cased marking, because what is printed
 * is rarely the bare term: "Allegro con brio", "Andante cantabile", "Adagio
 * sostenuto — attacca". A metronome mark inside the same string is not this
 * function's business; the importer has already had first refusal on those.
 */
export function bpmForMarking(marking: string | null | undefined): number | null {
  if (!marking) {
    return null;
  }
  const text = marking.toLowerCase();
  for (const [term, bpm] of TERMS) {
    if (text.includes(term)) {
      return bpm;
    }
  }
  return null;
}
