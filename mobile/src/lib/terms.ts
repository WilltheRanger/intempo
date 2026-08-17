import type { ScoreJson } from '../data/types';
import { dayIndex } from './excerpt';

/**
 * A term and a fact, one of each, daily.
 *
 * **The term is taken from your own music where it can be.** `score_json`
 * carries the tempo marking, key and time signature that OCR read off the
 * page, so the definition on Today is usually about a word printed on the
 * score in front of you rather than a word from a list. That is the whole
 * difference between a reference book and a companion.
 *
 * **The fact is not about you**, and is the one thing on this screen that
 * isn't. Kept short, checkable, and about the repertoire rather than about
 * composers' private lives — the register is a programme note, not trivia
 * night. Every entry here is a settled, uncontroversial statement; anything
 * that needed a "probably" was left out rather than hedged.
 */

export interface Term {
  /** The word as it appears on the page. */
  word: string;
  /** What it means. Two sentences at most. */
  meaning: string;
}

/**
 * Tempo and expression marks, keyed by the lowercase word.
 *
 * Matched against `tempo_marking` by looking for any of these inside it, so
 * "Allegro moderato" finds *allegro* and "Adagio ma non troppo" finds *adagio*.
 */
const TEMPO_TERMS: Term[] = [
  { word: 'Largo', meaning: 'Broad. The slowest of the common markings, and a direction about breadth of line as much as about speed.' },
  { word: 'Adagio', meaning: 'At ease. Slower than andante and quicker than largo — the word is about character, not only tempo.' },
  { word: 'Andante', meaning: 'Walking. A moving tempo rather than a slow one; the mistake is to play it as an adagio.' },
  { word: 'Moderato', meaning: 'Moderate. Rarely alone — it usually qualifies another marking, as in allegro moderato.' },
  { word: 'Allegretto', meaning: 'A little lively. Below allegro, and lighter in weight rather than simply slower.' },
  { word: 'Allegro', meaning: 'Cheerful, and by convention quick. The tempo follows from the character, which is why allegro in Mozart is not allegro in Bartók.' },
  { word: 'Vivace', meaning: 'Lively. Quicker than allegro, and marked for energy rather than for speed alone.' },
  { word: 'Presto', meaning: 'Quick. Faster than vivace; prestissimo is as fast as the writing allows.' },
  { word: 'Grave', meaning: 'Solemn, and slow. The marking carries weight — it asks for gravity, not just a low number.' },
  { word: 'Cantabile', meaning: 'Singing. A direction about line: shape the phrase as a voice would, and let the bow follow the breath.' },
  { word: 'Sostenuto', meaning: 'Sustained. Hold the sound through the note rather than letting it decay into the next.' },
  { word: 'Maestoso', meaning: 'Majestic. Broad and deliberate, usually with weight in the bow rather than speed in it.' },
];

/** Terms that stand alone, for when the score gives nothing to define. */
const GENERAL_TERMS: Term[] = [
  { word: 'Rubato', meaning: 'Robbed. Time taken from one note is given back to another — the phrase bends, the pulse underneath does not disappear.' },
  { word: 'Détaché', meaning: 'Detached. Separate bows for separate notes, without lifting the hair from the string.' },
  { word: 'Portato', meaning: 'Carried. Several notes in one bow, each given its own gentle pressure — between legato and staccato.' },
  { word: 'Sul tasto', meaning: 'On the fingerboard. Bow over the fingerboard for a pale, flute-like sound with little edge.' },
  { word: 'Sul ponticello', meaning: 'On the bridge. Bow close to the bridge; the fundamental thins and the upper partials take over.' },
  { word: 'Col legno', meaning: 'With the wood. Strike or draw the stick rather than the hair — a colour, and hard on a good bow.' },
  { word: 'Martelé', meaning: 'Hammered. Each stroke starts from a bitten consonant and stops, leaving a silence before the next.' },
  { word: 'Spiccato', meaning: 'Separated. The bow leaves the string between notes, bouncing from its own weight rather than being lifted.' },
  { word: 'Ritardando', meaning: 'Slowing down. Gradual, unlike a fermata, and it should be measured — a rit. that begins too early has nowhere to go.' },
  { word: 'Tenuto', meaning: 'Held. Give the note its full value, and usually a little weight with it.' },
  { word: 'Sforzando', meaning: 'Forcing. A single note pushed harder than its neighbours; the dynamic returns immediately afterwards.' },
  { word: 'Ossia', meaning: 'Or else. An alternative passage printed above the stave, usually easier, occasionally harder.' },
];

/** Time signatures worth a sentence, keyed exactly as OCR reports them. */
const METRE_TERMS: Record<string, Term> = {
  '4/4': { word: 'Common time', meaning: 'Four beats to the bar, the first strongest and the third next. Written C as often as 4/4.' },
  '3/4': { word: 'Three-four', meaning: 'Three beats to the bar, weight on the first. The metre of the minuet and the waltz.' },
  '2/4': { word: 'Two-four', meaning: 'Two beats to the bar. Marches and much folk dance; brisker in feel than 4/4 at the same pulse.' },
  '2/2': { word: 'Cut time', meaning: 'Two minim beats to the bar. Written 4/4 but felt in two, which changes the phrasing more than the speed.' },
  '6/8': { word: 'Six-eight', meaning: 'Six quavers, felt as two groups of three. Compound duple — count in two, subdivide in three.' },
  '9/8': { word: 'Nine-eight', meaning: 'Nine quavers in three groups of three. Compound triple: three beats, each divided in three.' },
  '12/8': { word: 'Twelve-eight', meaning: 'Twelve quavers in four groups of three. The compound cousin of 4/4.' },
  '5/4': { word: 'Five-four', meaning: 'Five beats to the bar, usually grouped 3+2 or 2+3. Which grouping applies is a matter for the phrasing, not the barline.' },
};

export interface Fact {
  text: string;
}

/**
 * A short fact a day.
 *
 * Repertoire and craft rather than biography, and each one is a plain
 * statement of record. They rotate by date and repeat once the set is
 * exhausted — which after 24 entries is roughly a month, and is why the block
 * is a footnote on this screen rather than a feature of it.
 */
const FACTS: Fact[] = [
  { text: 'Bach’s six sonatas and partitas for solo violin survive in his own fair copy of 1720, titled in his hand: Sei Solo à Violino senza Basso accompagnato.' },
  { text: 'The Chaconne that ends the D minor Partita is longer than the four movements before it put together.' },
  { text: 'Viola parts are written in alto clef so that the instrument’s range sits on the staff instead of below it. High passages switch to treble.' },
  { text: 'The double bass sounds an octave lower than it is written. Printing it at pitch would put most of the part under the staff.' },
  { text: 'Kreutzer’s 42 Études were written for a violinist who never played them in public — Rodolphe Kreutzer never performed the Beethoven sonata dedicated to him either.' },
  { text: 'Paganini published only the 24 Caprices as his Opus 1. He kept most of his other music unpublished during his lifetime.' },
  { text: 'A modern violin bow is bent inwards towards the hair. The outward-curving Baroque bow gives a lighter, more articulated stroke.' },
  { text: 'Concert A has not always been 440 Hz. Orchestras today tune anywhere between 440 and 446, and Baroque ensembles often to 415 — a semitone lower.' },
  { text: 'Vibrato was an ornament before it was a default. Nineteenth-century treatises describe it as an effect to be applied to particular notes.' },
  { text: 'The cello’s endpin came into general use only in the late nineteenth century. Before it, players held the instrument between the calves.' },
  { text: 'Wohlfahrt’s Op. 45 studies stay in first position throughout the first book — the difficulty is deliberately all in the bow arm.' },
  { text: 'Tartini’s "Devil’s Trill" was published forty years after his death, and no manuscript in his hand survives.' },
  { text: 'The word "sonata" originally meant simply "sounded" — played on instruments — as opposed to "cantata", which meant sung.' },
  { text: 'Mozart’s five violin concertos were all written in Salzburg in 1775, when he was nineteen.' },
  { text: 'The viola d’amore has a second set of strings that are never bowed. They run under the fingerboard and vibrate in sympathy.' },
  { text: 'Rosin is pine resin, cooked and cooled. Without it the bow hair slides across the string and produces almost no sound.' },
  { text: 'Beethoven’s Violin Concerto was a failure at its 1806 premiere. It entered the repertoire only after Joseph Joachim played it in 1844, aged twelve.' },
  { text: 'A "wolf tone" is a note where the body of the instrument resonates against the string and the sound stutters. Cellos suffer from it most.' },
  { text: 'The standard string quartet — two violins, viola and cello — was settled by Haydn, who wrote sixty-eight of them.' },
  { text: 'Bartók pizzicato, where the string is pulled up and released to snap against the fingerboard, is written with a circle and a stalk above the note.' },
  { text: 'Sight-reading and practice use different skills. Reading improves fastest on music comfortably below your playing level, not at it.' },
  { text: 'The Guarneri "del Gesù" instruments were made in Cremona in the 1730s and 40s. Paganini played one, which he called "Il Cannone".' },
  { text: 'Harmonics sound where a finger touches the string lightly at a node instead of stopping it. The written note and the sounding note are different.' },
  { text: 'The metronome was patented in 1815. Beethoven was among the first composers to publish tempo markings in beats per minute.' },
];

/** Finds a tempo term inside a marking like "Allegro ma non troppo". */
function termFromMarking(marking: string | null | undefined): Term | null {
  if (!marking) {
    return null;
  }
  const haystack = marking.toLowerCase();
  return (
    TEMPO_TERMS.find((term) => haystack.includes(term.word.toLowerCase())) ?? null
  );
}

/**
 * Today's term.
 *
 * The score's own tempo marking first, then its time signature, then the
 * general list. OCR is allowed to return the literal string `"unknown"` for an
 * illegible header, which falls through to the list like any other miss.
 */
export function termFor(score: ScoreJson | null, now: Date = new Date()): Term {
  const fromMarking = termFromMarking(score?.tempo_marking);
  if (fromMarking) {
    return fromMarking;
  }

  const metre = score?.time_signature ? METRE_TERMS[score.time_signature.trim()] : null;
  if (metre) {
    return metre;
  }

  return GENERAL_TERMS[dayIndex(now) % GENERAL_TERMS.length];
}

/** Today's fact. Same for everyone, all day. */
export function factFor(now: Date = new Date()): Fact {
  return FACTS[dayIndex(now) % FACTS.length];
}
