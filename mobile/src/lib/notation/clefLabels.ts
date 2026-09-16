import type { Clef } from '../../data/types';

/**
 * The four clefs, named for a musician.
 *
 * **This file used to summarise a score** — whether the clef or the metre
 * lasts, for a metadata line under the engraving. That line was removed on
 * 2026-09-16 and both summaries went with it rather than being kept against a
 * future use, which is what `check-dead-exports.py` is for. What is left is
 * the vocabulary: the clef picker's rows, the note the screen shows when a
 * page's clef was never read, and `clefEdit`'s choices all name a clef, and
 * they must all name it the same way. `git log -- src/lib/notation/` has the
 * summaries if the line ever comes back.
 */
export const CLEF_LABELS: Record<Clef, string> = {
  treble: 'Treble clef',
  bass: 'Bass clef',
  alto: 'Alto clef',
  tenor: 'Tenor clef',
};
