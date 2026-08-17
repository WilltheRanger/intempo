import type { Clef, Instrument } from '../data/types';

/**
 * The staff each instrument's music is normally written on.
 *
 * Used where a clef is structurally required but asking for one would be a bad
 * question — adding a piece by hand, for instance, where the musician is
 * describing something they know how to play rather than reading a page.
 *
 * "Normally" is doing real work here and the exceptions are known:
 *
 *  - **Viola** reads alto, and switches to treble for sustained high passages.
 *  - **Cello** reads bass, and tenor or treble as the part climbs.
 *  - **Double bass** reads bass, sounding an octave below what is written.
 *
 * So this is a default, not a fact. It is right for the great majority of what
 * a player at this app's level works on, and wrong quietly rather than
 * loudly — a piece filed under the wrong clef renders on the wrong staff, and
 * nothing else about the app misbehaves.
 */
const CLEF_BY_INSTRUMENT: Record<Instrument, Clef> = {
  violin: 'treble',
  viola: 'alto',
  cello: 'bass',
  double_bass: 'bass',
};

export function clefFor(instrument: Instrument): Clef {
  return CLEF_BY_INSTRUMENT[instrument];
}
