import { dayIndex } from './warmup';

/**
 * A short fact a day, at the foot of Today.
 *
 * **The one thing on the screen that is not about you.** Everything above it
 * is your repertoire, your drift, your warmup; this is the page turning.
 *
 * Repertoire and craft rather than biography, and each entry is a plain
 * statement of record — the register is a programme note, not trivia night.
 * Anything that needed a "probably" was left out rather than hedged, because a
 * wrong fact about Bach in an app for classical musicians is expensive.
 *
 * It rotates by date and repeats once the set is exhausted, which after 24
 * entries is roughly a month. That is why it is a footnote here rather than a
 * feature.
 */

export interface Fact {
  /**
   * A short phrase over the sentence.
   *
   * Not a headline and not a hook — it names the subject so the block has the
   * same label / lead / detail shape as every other section on Today. A fact
   * that arrives as three lines of grey prose is the only body copy on the
   * screen, and it read as one.
   */
  lead: string;
  text: string;
}

const FACTS: Fact[] = [
  { lead: 'In Bach’s own hand', text: 'Bach’s six sonatas and partitas for solo violin survive in his own fair copy of 1720, titled in his hand: Sei Solo à Violino senza Basso accompagnato.' },
  { lead: 'The Chaconne', text: 'The Chaconne that ends the D minor Partita is longer than the four movements before it put together.' },
  { lead: 'Why violas read alto', text: 'Viola parts are written in alto clef so that the instrument’s range sits on the staff instead of below it. High passages switch to treble.' },
  { lead: 'An octave down', text: 'The double bass sounds an octave lower than it is written. Printing it at pitch would put most of the part under the staff.' },
  { lead: 'Kreutzer never played them', text: 'Kreutzer’s 42 Études were written for a violinist who never played them in public — Rodolphe Kreutzer never performed the Beethoven sonata dedicated to him either.' },
  { lead: 'Opus 1, and little else', text: 'Paganini published only the 24 Caprices as his Opus 1. He kept most of his other music unpublished during his lifetime.' },
  { lead: 'Which way the bow bends', text: 'A modern violin bow is bent inwards towards the hair. The outward-curving Baroque bow gives a lighter, more articulated stroke.' },
  { lead: 'A is not always 440', text: 'Concert A has not always been 440 Hz. Orchestras today tune anywhere between 440 and 446, and Baroque ensembles often to 415 — a semitone lower.' },
  { lead: 'Vibrato as ornament', text: 'Vibrato was an ornament before it was a default. Nineteenth-century treatises describe it as an effect to be applied to particular notes.' },
  { lead: 'Before the endpin', text: 'The cello’s endpin came into general use only in the late nineteenth century. Before it, players held the instrument between the calves.' },
  { lead: 'All in the bow arm', text: 'Wohlfahrt’s Op. 45 studies stay in first position throughout the first book — the difficulty is deliberately all in the bow arm.' },
  { lead: 'The Devil’s Trill', text: 'Tartini’s "Devil’s Trill" was published forty years after his death, and no manuscript in his hand survives.' },
  { lead: 'Sounded, not sung', text: 'The word "sonata" originally meant simply "sounded" — played on instruments — as opposed to "cantata", which meant sung.' },
  { lead: 'Five concertos, one year', text: 'Mozart’s five violin concertos were all written in Salzburg in 1775, when he was nineteen.' },
  { lead: 'Strings never bowed', text: 'The viola d’amore has a second set of strings that are never bowed. They run under the fingerboard and vibrate in sympathy.' },
  { lead: 'What rosin is', text: 'Rosin is pine resin, cooked and cooled. Without it the bow hair slides across the string and produces almost no sound.' },
  { lead: 'Rescued by a twelve-year-old', text: 'Beethoven’s Violin Concerto was a failure at its 1806 premiere. It entered the repertoire only after Joseph Joachim played it in 1844, aged twelve.' },
  { lead: 'The wolf tone', text: 'A "wolf tone" is a note where the body of the instrument resonates against the string and the sound stutters. Cellos suffer from it most.' },
  { lead: 'Sixty-eight quartets', text: 'The standard string quartet — two violins, viola and cello — was settled by Haydn, who wrote sixty-eight of them.' },
  { lead: 'Bartók pizzicato', text: 'Bartók pizzicato, where the string is pulled up and released to snap against the fingerboard, is written with a circle and a stalk above the note.' },
  { lead: 'Read below your level', text: 'Sight-reading and practice use different skills. Reading improves fastest on music comfortably below your playing level, not at it.' },
  { lead: 'Il Cannone', text: 'The Guarneri "del Gesù" instruments were made in Cremona in the 1730s and 40s. Paganini played one, which he called "Il Cannone".' },
  { lead: 'Touch, don’t stop', text: 'Harmonics sound where a finger touches the string lightly at a node instead of stopping it. The written note and the sounding note are different.' },
  { lead: 'Patented in 1815', text: 'The metronome was patented in 1815. Beethoven was among the first composers to publish tempo markings in beats per minute.' },
];

/** Today's fact. Same for everyone, all day. */
export function factFor(now: Date = new Date()): Fact {
  return FACTS[dayIndex(now) % FACTS.length];
}
