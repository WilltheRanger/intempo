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
 *  - **Alto and tenor saxophone** read treble, and sound below it: see
 *    `soundingOffset`.
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
  alto_sax: 'treble',
  tenor_sax: 'treble',
};

export function clefFor(instrument: Instrument): Clef {
  return CLEF_BY_INSTRUMENT[instrument];
}

/**
 * Semitones from the written note to the note the instrument sounds.
 *
 * A score holds written pitches, and a player reads them; what comes out of
 * the instrument is this many semitones away. The double bass sounds an octave
 * down. The saxophones are the first instruments here whose distance is not an
 * octave: an alto in E♭ sounds a major sixth below the page (−9), a tenor in B♭
 * a major ninth below (−14). Anything that plays the part aloud, or listens to
 * one, has to move by exactly this — `backend/app/services/analysis.py`
 * `_TRANSPOSE` holds the same numbers, and `instrument.test.ts` compares them.
 */
const SOUNDING_OFFSET: Record<Instrument, number> = {
  violin: 0,
  viola: 0,
  cello: 0,
  double_bass: -12,
  alto_sax: -9,
  tenor_sax: -14,
};

export function soundingOffset(instrument: Instrument): number {
  return SOUNDING_OFFSET[instrument];
}
